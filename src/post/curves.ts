export const EXPOSURE = 1.75
export const WHITE_POINT = 59.5
export const SCENE_CEILING = 3500
export const BLACK_FLOOR = 0.0012
export const HIGHLIGHT_DESATURATION = 0.80

export type ToneCurveName = 'cinemaLogShoulder' | 'rationalToeShoulder' | 'standardShoulder'

export const CHOSEN_TONE_CURVE: ToneCurveName = 'cinemaLogShoulder'

export const TONE_CURVE_IDS: Record<ToneCurveName, number> = {
  cinemaLogShoulder: 0,
  rationalToeShoulder: 1,
  standardShoulder: 2,
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function cinemaLogShoulder(x: number): number {
  const v = Math.max(0, x)
  const toe = (v * (v + 0.006)) / (v + 0.055)
  const l = Math.log2(1 + toe * 3.4)
  const lw = Math.log2(1 + WHITE_POINT * 3.4)
  const s = (l * (1 + l / (lw * 1.25))) / (l + 2.35)
  const sw = (lw * (1 + lw / (lw * 1.25))) / (lw + 2.35)
  return BLACK_FLOOR + (1 - BLACK_FLOOR) * clamp01(s / sw)
}

function rationalRaw(x: number): number {
  const a = 0.12
  const b = 0.34
  const c = 0.16
  const d = 0.24
  const e = 0.014
  const f = 0.32
  return (x * (a * x + c * b) + d * e) / (x * (a * x + b) + d * f) - e / f
}

export function rationalToeShoulder(x: number): number {
  const v = Math.max(0, x)
  const mapped = clamp01(rationalRaw(v) / rationalRaw(52))
  return BLACK_FLOOR + (1 - BLACK_FLOOR) * mapped
}

export function standardShoulder(x: number): number {
  const v = Math.max(0, x)
  const mapped = clamp01((v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14))
  return BLACK_FLOOR + (1 - BLACK_FLOOR) * mapped
}

export const candidateToneCurves: Record<ToneCurveName, (x: number) => number> = {
  cinemaLogShoulder,
  rationalToeShoulder,
  standardShoulder,
}

export function toneMapRgb(
  r: number,
  g: number,
  b: number,
  curveName: ToneCurveName = CHOSEN_TONE_CURVE,
): [number, number, number] {
  const curve = candidateToneCurves[curveName]
  const sr = Math.max(0, r)
  const sg = Math.max(0, g)
  const sb = Math.max(0, b)
  const luma = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb
  const peak = Math.max(sr, sg, sb)
  const crosstalk = 0.03 * smoothstep(1.0, 20.0, peak)
  const cr = sr + (luma - sr) * crosstalk
  const cg = sg + (luma - sg) * crosstalk
  const cb = sb + (luma - sb) * crosstalk
  const mr = curve(cr)
  const mg = curve(cg)
  const mb = curve(cb)
  const core = curve(luma * 0.32 + peak * 0.68)
  const desat = HIGHLIGHT_DESATURATION * smoothstep(1.8, 28.0, peak)
  return [
    mr + (core - mr) * desat,
    mg + (core - mg) * desat,
    mb + (core - mb) * desat,
  ]
}

export function srgbEncodeChannel(c: number): number {
  const v = clamp01(c)
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

export function srgbEncodeRgb(rgb: readonly [number, number, number]): [number, number, number] {
  return [srgbEncodeChannel(rgb[0]), srgbEncodeChannel(rgb[1]), srgbEncodeChannel(rgb[2])]
}
