export type V3 = [number, number, number]
export type V2 = [number, number]

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z]
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
export const addScaled = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2])
export const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export function norm(a: V3): V3 {
  const l = len(a)
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Rotates `a` around the unit axis `k` by `angle` (Rodrigues). */
export function rotate(a: V3, k: V3, angle: number): V3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const kxa = cross(k, a)
  const kda = dot(k, a) * (1 - c)
  return [a[0] * c + kxa[0] * s + k[0] * kda, a[1] * c + kxa[1] * s + k[1] * kda, a[2] * c + kxa[2] * s + k[2] * kda]
}

/** Any unit vector perpendicular to `n`. */
export function perpendicular(n: V3): V3 {
  const a: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  return norm(cross(n, a))
}
