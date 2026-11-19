import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { openViewer, outDir } from './viewer.ts'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const cache = `${repo}reference/cache/vehicle/views`

const views = [
  { id: 'top', file: 'view-003.png', target: 0.95 },
  { id: 'side', file: 'view-004.png', target: 0.95 },
  { id: 'front', file: 'view-006.png', target: 0.93 },
  { id: 'rear', file: 'view-007.png', target: 0.93 },
] as const

interface Mask {
  w: number
  h: number
  data: Uint8Array
}

function cross(m: Mask, grow: boolean): Mask {
  const out = new Uint8Array(m.data)
  const { w, h, data } = m
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const n = [x > 0 ? data[i - 1] : 0, x < w - 1 ? data[i + 1] : 0, y > 0 ? data[i - w] : 0, y < h - 1 ? data[i + w] : 0]
      if (grow) out[i] = data[i] | n[0] | n[1] | n[2] | n[3]
      else out[i] = data[i] & n[0] & n[1] & n[2] & n[3]
    }
  }
  return { w, h, data: out }
}

/** Fills a line drawing into a solid outline: close small breaks, flood the outside, open again. */
function fillDrawing(lines: Mask, close = 4): Mask {
  const pad = 20
  const w = lines.w + 2 * pad
  const h = lines.h + 2 * pad
  let m: Mask = { w, h, data: new Uint8Array(w * h) }
  for (let y = 0; y < lines.h; y++) for (let x = 0; x < lines.w; x++) m.data[(y + pad) * w + x + pad] = lines.data[y * lines.w + x]
  for (let i = 0; i < close; i++) m = cross(m, true)
  const outside = new Uint8Array(w * h)
  const stack = [0]
  outside[0] = 1
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    const y = (i - x) / w
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
    for (const j of next) {
      if (j >= 0 && !outside[j] && !m.data[j]) {
        outside[j] = 1
        stack.push(j)
      }
    }
  }
  let f: Mask = { w, h, data: outside.map((o) => (o ? 0 : 1)) }
  for (let i = 0; i < close; i++) f = cross(f, false)
  const out = new Uint8Array(lines.w * lines.h)
  for (let y = 0; y < lines.h; y++) for (let x = 0; x < lines.w; x++) out[y * lines.w + x] = f.data[(y + pad) * w + x + pad]
  return { w: lines.w, h: lines.h, data: out }
}

function bbox(m: Mask): [number, number, number, number] {
  let x0 = m.w
  let y0 = m.h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (m.data[y * m.w + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return [x0, y0, x1, y1]
}

async function gray(buf: Buffer | string): Promise<{ w: number; h: number; px: Uint8Array }> {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true })
  return { w: info.width, h: info.height, px: new Uint8Array(data.buffer, data.byteOffset, data.length) }
}

/** Samples `src` inside its box `sb` onto the box `db` of a w x h grid, nearest neighbour. */
function remap(src: Mask, sb: number[], w: number, h: number, db: number[]): Mask {
  const out = new Uint8Array(w * h)
  const sx = (sb[2] - sb[0] + 1) / (db[2] - db[0] + 1)
  const sy = (sb[3] - sb[1] + 1) / (db[3] - db[1] + 1)
  for (let y = db[1]; y <= db[3]; y++) {
    const yy = Math.min(src.h - 1, Math.floor(sb[1] + (y - db[1] + 0.5) * sy))
    for (let x = db[0]; x <= db[2]; x++) {
      const xx = Math.min(src.w - 1, Math.floor(sb[0] + (x - db[0] + 0.5) * sx))
      out[y * w + x] = src.data[yy * src.w + xx]
    }
  }
  return { w, h, data: out }
}

const args = process.argv.slice(2)
const detail = (args.includes('--full') ? 'full' : 'blockout') as 'blockout' | 'full'
mkdirSync(outDir, { recursive: true })
for (const v of views) if (!existsSync(`${cache}/${v.file}`)) throw new Error(`missing ${cache}/${v.file}, see reference/vehicle/VIEWS.md`)
const viewer = await openViewer(detail)
const results: Record<string, number> = {}
for (const v of views) {
  const d = await gray(`${cache}/${v.file}`)
  const lines: Mask = { w: d.w, h: d.h, data: d.px.map((p) => (p < 128 ? 1 : 0)) }
  const fill = fillDrawing(lines)
  const png = await viewer.shoot({ view: v.id, mode: 'mask', width: d.w, height: d.h })
  const r = await gray(png)
  const model: Mask = { w: r.w, h: r.h, data: r.px.map((p) => (p > 127 ? 1 : 0)) }
  const mb = bbox(model)
  const fb = bbox(fill)
  const drawn = remap(fill, fb, r.w, r.h, mb)
  const ink = remap(lines, fb, r.w, r.h, mb)
  let inter = 0
  let union = 0
  const diff = Buffer.alloc(r.w * r.h * 3)
  for (let i = 0; i < r.w * r.h; i++) {
    const a = model.data[i]
    const b = drawn.data[i]
    if (a && b) inter++
    if (a || b) union++
    diff[i * 3] = a && !b ? 255 : a && b ? 200 : 0
    diff[i * 3 + 1] = a && b ? 200 : 0
    diff[i * 3 + 2] = b && !a ? 255 : a && b ? 200 : 0
  }
  results[v.id] = inter / union
  await sharp(diff, { raw: { width: r.w, height: r.h, channels: 3 } }).png().toFile(`${outDir}/sil-${v.id}.png`)
  const clay = await gray(await viewer.shoot({ view: v.id, mode: 'clay', width: d.w, height: d.h }))
  const over = Buffer.alloc(r.w * r.h * 3)
  for (let i = 0; i < r.w * r.h; i++) {
    const g = clay.px[i]
    if (ink.data[i]) {
      over[i * 3] = 255
      over[i * 3 + 1] = 30
      over[i * 3 + 2] = 30
    } else over[i * 3] = over[i * 3 + 1] = over[i * 3 + 2] = g
  }
  await sharp(over, { raw: { width: r.w, height: r.h, channels: 3 } }).png().toFile(`${outDir}/overlay-${v.id}.png`)
}
await viewer.close()
for (const v of views) console.log(`${v.id.padEnd(6)} IoU ${results[v.id].toFixed(4)}  target ${v.target}  ${results[v.id] >= v.target ? 'ok' : 'below'}`)
writeFileSync(`${outDir}/silhouette.json`, JSON.stringify(results, null, 2))
