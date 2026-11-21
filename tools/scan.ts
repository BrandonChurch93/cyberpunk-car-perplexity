import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { formatById, frameCount } from '../src/config.ts'
import { grabCanvas } from './lib/browser.ts'
import { args, config, ensureDir, readJson, workDir, writeJson } from './lib/env.ts'
import { decode } from './lib/image.ts'
import { RenderSession, runTool } from './lib/render.ts'
import { every, flags, lumaStats, merge, parseFrames, scaledSize, shard, shotOf, shrinkPage, type ScanFile, type ScanFrame } from './lib/scan.ts'

const defaultWidth = 240
const defaultJump = 0.3

function report(scan: ScanFile, path: string): void {
  console.log(`${scan.frames.length} frames at ${scan.width} x ${scan.height}, ${scan.tier}, build ${scan.buildHash}: ${scan.flagged.length} flagged`)
  for (const f of scan.flagged) console.log(`FLAG ${f.frame} (${f.shot}): ${f.reasons.join('; ')}`)
  console.log(`wrote ${path}`)
}

function mergeFiles(list: string, out: string | undefined): number {
  const paths = list.split(',').flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((n) => /^scan-.*\.json$/.test(n) && !n.includes('merged')).map((n) => join(p, n)) : [p]))
  const files = paths.map((p) => {
    const f = readJson<ScanFile>(p)
    if (!f) throw new Error(`cannot read ${p}`)
    return f
  })
  const merged = merge(files)
  const path = out ?? join(ensureDir(join(workDir, 'scan')), `scan-${merged.format}-${merged.width}-${merged.tier}-merged.json`)
  writeJson(path, merged)
  console.log(`merged ${paths.map((p) => basename(p)).join(', ')}`)
  report(merged, path)
  return merged.flagged.length > 0 ? 2 : 0
}

void runTool(async () => {
  const a = args()
  if (a.merge) return mergeFiles(a.merge, a.out)
  const base = formatById(a.format ?? config.formats.master.id)
  const { width, height } = scaledSize(base, Number(a.width ?? defaultWidth))
  const tier = a.tier ?? 'draft'
  const paint = a.paint ?? config.paint.locked ?? config.paint.candidates[0].id
  const detail = a.detail ?? 'full'
  const jump = Number(a.jump ?? defaultJump)
  const selected = shard(every(parseFrames(a.frames, frameCount), Number(a.every ?? 1)), a.shard)
  const tag = a.shard ? `-${a.shard.replace('/', 'of')}` : ''
  const dir = ensureDir(join(workDir, 'scan'))
  const frameDir = ensureDir(join(dir, `frames-${base.id}-${width}-${tier}`))
  const path = a.out ?? join(dir, `scan-${base.id}-${width}-${tier}${tag}.json`)
  const session = await RenderSession.open({ budgetMinutes: 0 })
  try {
    const previous = existsSync(path) ? readJson<ScanFile>(path) : null
    const keep = previous && previous.buildHash === session.buildHash && previous.width === width && previous.tier === tier && previous.paint === paint && previous.detail === detail
    const scan: ScanFile = { buildHash: session.buildHash, format: base.id, width, height, tier, detail, paint, jump, frames: keep ? previous.frames : [], flagged: [] }
    const done = new Set(scan.frames.map((f) => f.frame))
    const todo = selected.filter((f) => !done.has(f))
    console.log(`scan ${selected.length} frames (${todo.length} to render) at ${width} x ${height}, ${tier}, ${detail}, ${paint}`)
    const page = await session.freshPage(base, 'beauty', paint, detail === 'blockout' ? 'blockout' : 'full')
    await shrinkPage(page, base, width)
    for (const frame of todo) {
      const t0 = Date.now()
      await page.evaluate(([f, t]) => window.showcase!.beginFrame(f as number, t as string), [frame, tier] as const)
      const begin = (Date.now() - t0) / 1000
      const nonFinite = await page.evaluate(async () => {
        await window.showcase!.addSamples(1e9)
        await window.showcase!.finishFrame()
        return window.showcase!.nonFinitePixels()
      })
      const png = await grabCanvas(page, session.rawHarness)
      const raw = await decode(png)
      if (raw.width !== width || raw.height !== height) throw new Error(`frame ${frame} came back ${raw.width} x ${raw.height}, expected ${width} x ${height}`)
      writeFileSync(join(frameDir, `${String(frame).padStart(4, '0')}.png`), png)
      const stats = lumaStats(raw.data)
      const entry: ScanFrame = { frame, shot: shotOf(frame / config.film.fps, config.beats), ...stats, nonFinite, begin, seconds: (Date.now() - t0) / 1000 }
      scan.frames.push(entry)
      scan.frames.sort((x, y) => x.frame - y.frame)
      scan.flagged = flags(scan.frames, jump)
      writeJson(path, scan)
      console.log(`${frame} ${entry.shot}: mean ${entry.mean.toFixed(1)} p50 ${entry.p50} p99 ${entry.p99} non-finite ${nonFinite} (${entry.seconds.toFixed(1)} s, begin ${begin.toFixed(1)} s)`)
    }
    scan.flagged = flags(scan.frames, jump)
    writeJson(path, scan)
    report(scan, path)
    return scan.flagged.length > 0 ? 2 : 0
  } finally {
    await session.close()
  }
})
