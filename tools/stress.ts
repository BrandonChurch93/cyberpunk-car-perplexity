import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { defaultPaint, frameCount, isTier, paintById } from '../src/config.ts'
import { planCrops } from './lib/crops.ts'
import { args, buildHash, config, ensureDir, readJson, workDir, writeJson } from './lib/env.ts'
import { checkFrame, decode } from './lib/image.ts'
import type { StressPair } from './lib/pack-build.ts'
import { beatFrames } from './lib/pack.ts'
import { probe } from './lib/probe.ts'
import { RenderSession, runTool, type StillSpec } from './lib/render.ts'
import { cameraForFrame, sceneAnchors } from './lib/scene.ts'

const toRgb = 'scale=in_color_matrix=bt709:in_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=rgb24'
const toYuv = 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p'
const colorTags = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']

function atBitrate(input: string[], mbps: number, out: string): void {
  const rate = `${mbps}M`
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...input, '-vf', toYuv, '-c:v', 'libx264', '-preset', 'slow', '-b:v', rate, '-maxrate', rate, '-bufsize', `${mbps * 2}M`, ...colorTags, '-r', String(config.film.fps), '-movflags', '+faststart', out], { stdio: ['ignore', 'inherit', 'inherit'] })
}

function frameOf(film: string, index: number, out: string): void {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', film, '-vf', `select=eq(n\\,${index}),${toRgb}`, '-fps_mode', 'passthrough', '-frames:v', '1', out], { stdio: ['ignore', 'inherit', 'inherit'] })
}

/** A run of quality.stress.seconds frames centered on the middle of the beat. */
export function stressFrames(beat: string): number[] {
  const n = Math.max(1, Math.round(config.quality.stress.seconds * config.film.fps))
  const { first, middle, last } = beatFrames(beat)
  const start = Math.min(Math.max(first, middle - Math.floor(n / 2)), Math.max(first, last - n + 1))
  return Array.from({ length: n }, (_, i) => Math.min(start + i, frameCount - 1))
}

void runTool(async () => {
  const a = args()
  const tier = a.confirm === 'true' ? config.quality.stress.confirmTier : config.quality.stress.tier
  if (!isTier(tier)) throw new Error(`unknown tier ${tier}`)
  const paint = paintById(a.paint ?? defaultPaint).id
  const format = config.formats.master
  const root = ensureDir(join(workDir, 'stress'))
  const manifestPath = join(root, 'manifest.json')
  const hash = buildHash()
  const previous = readJson<{ buildHash: string; paint: string; tier: string; pairs: StressPair[] }>(manifestPath)
  if (previous && previous.buildHash === hash && previous.paint === paint && previous.tier === tier && a.force !== 'true' && previous.pairs.every((p) => existsSync(p.before) && existsSync(p.after))) {
    console.log(`reused ${manifestPath}: ${previous.pairs.length} pairs at the ${tier} tier`)
    return 0
  }
  const { anchors } = await sceneAnchors(undefined, paint)
  const session = await RenderSession.open({ budgetMinutes: a.budget !== undefined ? Number(a.budget) : undefined })
  const pairs: StressPair[] = []
  const films: Record<string, unknown> = {}
  try {
    for (const beat of config.quality.stress.beats) {
      const frames = stressFrames(beat)
      const dir = ensureDir(join(root, `${tier}-${paint}`, beat))
      for (const [i, frame] of frames.entries()) {
        const spec: StillSpec = { frame, tier, format, diag: 'beauty', paint }
        await session.renderTo(spec, join(dir, `f${String(i).padStart(5, '0')}.png`))
      }
      const input = ['-framerate', String(config.film.fps), '-start_number', '0', '-i', join(dir, 'f%05d.png'), '-frames:v', String(frames.length)]
      const exported = join(dir, `bitrate-${config.export.bitrateMbps}.mp4`)
      const stressed = join(dir, `bitrate-${config.quality.compressionStressMbps}.mp4`)
      atBitrate(input, config.export.bitrateMbps, exported)
      atBitrate(['-i', exported], config.quality.compressionStressMbps, stressed)
      const pe = probe(exported)
      const ps = probe(stressed)
      if (pe.frames !== frames.length || ps.frames !== frames.length) throw new Error(`the ${beat} stress films hold ${pe.frames} and ${ps.frames} frames, expected ${frames.length}`)
      const mid = Math.floor(frames.length / 2)
      const frame = frames[mid]
      const before = join(dir, 'before.png')
      const after = join(dir, 'after.png')
      const atExport = join(dir, 'at-export.png')
      execFileSync('cp', [join(dir, `f${String(mid).padStart(5, '0')}.png`), before])
      frameOf(exported, mid, atExport)
      frameOf(stressed, mid, after)
      const check = checkFrame(await decode(after))
      if (!check.ok) throw new Error(`the stressed ${beat} frame is blank, flat or invalid`)
      const rects = planCrops(cameraForFrame(frame, format, anchors), format, anchors).map((p) => ({ id: p.id, on: p.on, rect: p.rect }))
      pairs.push({ beat, frame, before, after, rects })
      films[beat] = { frames, exported: { file: exported, mbps: config.export.bitrateMbps, probe: pe }, stressed: { file: stressed, mbps: config.quality.compressionStressMbps, probe: ps }, atExport }
      for (const f of readdirSync(dir).filter((n) => /^f\d{5}\.(png|json)$/.test(n))) rmSync(join(dir, f))
      console.log(`${beat}: frames ${frames[0]} to ${frames[frames.length - 1]}, ${(pe.bytes / 1024).toFixed(0)} KB at ${config.export.bitrateMbps} Mbps, ${(ps.bytes / 1024).toFixed(0)} KB at ${config.quality.compressionStressMbps} Mbps, pair on frame ${frame} with ${rects.length} crops`)
    }
  } finally {
    await session.close()
  }
  writeJson(manifestPath, { buildHash: hash, paint, tier, format: format.id, pairs, films })
  console.log(`wrote ${manifestPath}`)
  return 0
})
