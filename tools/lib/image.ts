import sharp from 'sharp'

export interface Raw {
  width: number
  height: number
  data: Buffer
}

export async function decode(png: Buffer | string): Promise<Raw> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

export async function encode(raw: Raw): Promise<Buffer> {
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer()
}

export interface FrameCheck {
  width: number
  height: number
  flat: boolean
  blank: boolean
  invalidPixels: number
  mean: number
  ok: boolean
}

export function checkFrame(raw: Raw): FrameCheck {
  const { data } = raw
  let min = 255
  let max = 0
  let sum = 0
  let invalid = 0
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (r === 255 && g === 0 && b === 255) invalid++
    const lo = Math.min(r, g, b)
    const hi = Math.max(r, g, b)
    if (lo < min) min = lo
    if (hi > max) max = hi
    sum += r + g + b
  }
  const mean = sum / data.length
  const flat = max - min <= 2
  const blank = max <= 4
  return { width: raw.width, height: raw.height, flat, blank, invalidPixels: invalid, mean, ok: !flat && !blank && invalid === 0 }
}

export function identical(a: Raw, b: Raw): { same: boolean; differing: number; maxDelta: number } {
  if (a.width !== b.width || a.height !== b.height) return { same: false, differing: -1, maxDelta: 255 }
  let differing = 0
  let maxDelta = 0
  for (let i = 0; i < a.data.length; i += 3) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]))
    if (d > 0) differing++
    if (d > maxDelta) maxDelta = d
  }
  return { same: differing === 0, differing, maxDelta }
}

function luma(raw: Raw): Float64Array {
  const out = new Float64Array(raw.width * raw.height)
  for (let i = 0, j = 0; i < raw.data.length; i += 3, j++) {
    out[j] = 0.2126 * raw.data[i] + 0.7152 * raw.data[i + 1] + 0.0722 * raw.data[i + 2]
  }
  return out
}

export function meanAbsDiff(a: Raw, b: Raw): number {
  let sum = 0
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i] - b.data[i])
  return sum / a.data.length
}

export function ssim(a: Raw, b: Raw): number {
  const w = a.width
  const h = a.height
  const x = luma(a)
  const y = luma(b)
  const size = 8
  const c1 = (0.01 * 255) ** 2
  const c2 = (0.03 * 255) ** 2
  let total = 0
  let windows = 0
  for (let wy = 0; wy + size <= h; wy += 4) {
    for (let wx = 0; wx + size <= w; wx += 4) {
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0
      for (let j = 0; j < size; j++) {
        const row = (wy + j) * w + wx
        for (let i = 0; i < size; i++) {
          const p = x[row + i]
          const q = y[row + i]
          sx += p; sy += q; sxx += p * p; syy += q * q; sxy += p * q
        }
      }
      const n = size * size
      const mx = sx / n
      const my = sy / n
      const vx = sxx / n - mx * mx
      const vy = syy / n - my * my
      const cov = sxy / n - mx * my
      total += ((2 * mx * my + c1) * (2 * cov + c2)) / ((mx * mx + my * my + c1) * (vx + vy + c2))
      windows++
    }
  }
  return total / windows
}
