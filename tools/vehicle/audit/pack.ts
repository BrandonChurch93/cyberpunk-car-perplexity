import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import sharp, { type Sharp } from 'sharp'
import { config, defaultPaint } from '../../../src/config.ts'
import { args, buildHash, ensureDir, repoRoot, workDir } from '../../lib/env.ts'
import type { StillRecord } from '../../lib/render.ts'

const a = args()
const label = a.label
if (!label || !/^[\w.-]+$/.test(label)) throw new Error('Use --label with the matching fairness run label')
const out = ensureDir(join(workDir, 'vehicle', 'audit-packs', label))
const fairness = join(workDir, 'vehicle', 'fairness', label)
const studio = join(workDir, 'vehicle', 'studio-audit')
const { width, height, id } = config.formats.master
const maxEdge = config.critics.maxImageLongEdgePx
const views = ['beauty', 'clay', 'zebra'] as const
const required = [195, 1060, 0]
const frames = (a.frames ?? required.join(',')).split(',').map(Number)
if (frames.some((frame) => !required.includes(frame)) || new Set(frames).size !== frames.length) {
  throw new Error('Use a nonempty subset of frames 195,1060,0')
}
const hash = buildHash()
const run = JSON.parse(await readFile(join(fairness, 'run.json'), 'utf8'))
if (run.buildHash !== hash || run.detail !== 'full' || run.raysPerNativePixel !== 4 || run.control || !run.formatKeys.includes('master') ||
    frames.some((frame) => !run.frames.includes(frame))) throw new Error('The pack requires a matching full-detail, four-ray fairness run at each requested frame')
const boxes: Record<string, [number, number, number, number]> = JSON.parse(await readFile(join(fairness, 'vehicle-boxes.json'), 'utf8'))

async function plainPng(input: Sharp, name: string): Promise<void> {
  const png = await input.png().toBuffer()
  const chunks = [png.subarray(0, 8)]
  for (let i = 8; i + 12 <= png.length;) {
    const end = i + png.readUInt32BE(i) + 12
    if (!(png[i + 4] & 0x20)) chunks.push(png.subarray(i, end))
    i = end
  }
  await writeFile(join(out, name), Buffer.concat(chunks))
}

const records: StillRecord[] = []
const crops: Record<number, { left: number; top: number; width: number; height: number }> = {}
for (const frame of frames) {
  for (const view of views) {
    const raw = join(studio, `f${String(frame).padStart(5, '0')}-${id}-review-${view}-${defaultPaint}-full`)
    const record: StillRecord = JSON.parse(await readFile(raw + '.json', 'utf8'))
    if (record.buildHash !== hash || record.frame !== frame || record.diagnostic !== view || record.width !== width || record.height !== height ||
        record.format !== id || record.tier !== 'review' || record.detail !== 'full' || record.samples !== config.tiers.review.samplesPerFrame ||
        record.paint !== defaultPaint || record.nonFinitePixels !== 0 || !record.check.ok) throw new Error(`Invalid review still: ${raw}`)
    records.push(record)
    await plainPng(sharp(raw + '.png').resize({ width: maxEdge, kernel: 'lanczos3' }), `f${frame}-${view}.png`)
    if (view === 'zebra') {
      const box = boxes[`${frame}-master`]
      if (!box) throw new Error(`Missing fairness vehicle bounds for frame ${frame}`)
      const [x0, y0, x1, y1] = box
      const w = Math.min(maxEdge, x1 - x0), h = Math.min(maxEdge, y1 - y0)
      const crop = { left: Math.floor((x1 + x0 - w) / 2), top: Math.floor((y1 + y0 - h) / 2), width: w, height: h }
      crops[frame] = crop
      await plainPng(sharp(raw + '.png').extract(crop), `f${frame}-zebra-crop.png`)
    }
  }
}

const approved = join(repoRoot, 'reference', 'approved', 'hero.jpg')
if (frames.includes(195)) {
  await writeFile(join(out, 'approved-hero.jpg'), await readFile(approved))
  const tileWidth = Math.floor(maxEdge / 2), tileHeight = Math.round(tileWidth * height / width)
  const headline = ['Approved reference', 'Vehicle alone: beauty', 'Vehicle alone: clay', 'Vehicle alone: zebra']
  const layers = []
  for (const [i, file] of [approved, ...views.map((view) => join(out, `f195-${view}.png`))].entries()) {
    const left = i % 2 * tileWidth, top = Math.floor(i / 2) * (tileHeight + 24)
    const tile = await sharp(file).resize(tileWidth, tileHeight, { fit: 'contain', background: '#151a23' }).png().toBuffer()
    const title = Buffer.from(`<svg width="${tileWidth}" height="24"><text x="12" y="17" fill="#ddd" font-family="sans-serif" font-size="15">${headline[i]}</text></svg>`)
    layers.push({ input: title, top, left }, { input: tile, top: top + 24, left })
  }
  await plainPng(sharp({ create: { width: tileWidth * 2, height: (tileHeight + 24) * 2, channels: 3, background: '#151a23' } }).composite(layers), 'hero-comparison.png')
}
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
await writeFile(join(out, 'capture.json'), JSON.stringify({ sha, label, studio: true, crops, records }, null, 2) + '\n')
console.log(out)
