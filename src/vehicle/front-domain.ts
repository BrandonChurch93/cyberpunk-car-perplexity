import * as T from 'three'
import { curve, mix, smooth, type Point, type Surface, vec } from './geometry'

export type UV = readonly [number, number]
type Edge = readonly [UV, UV]

const eyeCrest = curve([[.48, .474], [.58, .512], [.68, .552], [.79, .600], [.889, .649], [.918, .658]])
const eyeLow = curve([[.48, .459], [.58, .462], [.69, .474], [.797, .497], [.865, .564], [.918, .635]])
export const lampWindowLow = eyeLow
export function lampWindow(face: (x: number, y: number, depth: number) => Point, u: number, v: number, depth: number) {
  const x = mix(.495 + .022 * (v - .5) ** 2, .919 - .009 * v, u)
  const top = eyeCrest(x) - .015 * (1 - smooth(x, .535, .601))
    - .0055 * smooth(x, .784, .821) * (1 - smooth(x, .828, .859))
  return face(x, mix(eyeLow(x), top, v), depth - .013 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u))
}

const epsilon = 1e-8
const unique = (values: number[]) => values.sort((a, b) => a - b).filter((n, i, a) => !i || n - a[i - 1] > epsilon)
const segments = (loop: readonly UV[]): Edge[] =>
  loop.flatMap((a, i) => {
    const b = loop[(i + 1) % loop.length]
    return Math.abs(a[0] - b[0]) <= epsilon ? [] : [a[0] < b[0] ? [a, b] as const : [b, a] as const]
  })
const yAt = ([[u0, y0], [u1, y1]]: Edge, u: number) => mix(y0, y1, (u - u0) / (u1 - u0))
const active = (e: Edge, u: number) => u > e[0][0] && u < e[1][0]
const inside = (loop: Edge[], u: number, y: number) =>
  loop.reduce((n, e) => n + Number(active(e, u) && yAt(e, u) < y), 0) % 2 !== 0

export function trimmedFrontSkin(point: Surface, boundary: readonly UV[], holes: readonly (readonly UV[])[],
  columns: readonly number[], stepY: number, side: number): T.BufferGeometry {
  const [outer, ...cut] = [boundary, ...holes].map(segments)
  const all = [outer, ...cut].flat()
  const us = [...columns, ...[boundary, ...holes].flatMap(loop => loop.map(p => p[0]))]
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j]
    const lo = Math.max(a[0][0], b[0][0]), hi = Math.min(a[1][0], b[1][0])
    if (hi - lo < epsilon) continue
    const d0 = yAt(a, lo) - yAt(b, lo), d1 = yAt(a, hi) - yAt(b, hi)
    if (d0 * d1 < 0) us.push(mix(lo, hi, d0 / (d0 - d1)))
  }
  const uValues = unique(us)
  const positions: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = []
  const cache = new Map<string, number>()
  const heights = uValues.map(u => all.filter(e => u >= e[0][0] - epsilon && u <= e[1][0] + epsilon).map(e => yAt(e, u)))
  const vertex = (i: number, y: number) => {
    const key = `${i}:${Math.round(y / epsilon)}`
    const existing = cache.get(key)
    if (existing !== undefined) return existing
    const u = uValues[i], h = .00001
    const du = vec(point(u + h, y)).sub(vec(point(u - h, y)))
    const dy = vec(point(u, y + h)).sub(vec(point(u, y - h)))
    const normal = du.cross(dy).normalize().multiplyScalar(side)
    const p = point(u, y)
    const id = positions.length / 3
    positions.push(...p); normals.push(...normal.toArray()); uv.push(-p[2], y)
    cache.set(key, id)
    return id
  }
  const row = (i: number, lo: number, hi: number) => {
    if (hi - lo < epsilon) return [vertex(i, (lo + hi) / 2)]
    const ys = [lo, hi, ...heights[i].filter(y => y > lo + epsilon && y < hi - epsilon)]
    for (let k = Math.ceil((lo + epsilon) / stepY); k * stepY < hi - epsilon; k++) ys.push(k * stepY)
    return unique(ys).map(y => vertex(i, y))
  }
  const triangle = (a: number, b: number, c: number) => {
    if (a !== b && b !== c && a !== c) indices.push(a, side > 0 ? b : c, side > 0 ? c : b)
  }
  for (let i = 0; i + 1 < uValues.length; i++) {
    const u0 = uValues[i], u1 = uValues[i + 1], mid = (u0 + u1) / 2
    const crossed = all.filter(e => active(e, mid)).sort((a, b) => yAt(a, mid) - yAt(b, mid))
    for (let j = 0; j + 1 < crossed.length; j++) {
      const a = crossed[j], b = crossed[j + 1]
      const lo = yAt(a, mid), hi = yAt(b, mid), y = (lo + hi) / 2
      if (hi - lo < epsilon || !inside(outer, mid, y) || cut.some(h => inside(h, mid, y))) continue
      const left = row(i, yAt(a, u0), yAt(b, u0)), right = row(i + 1, yAt(a, u1), yAt(b, u1))
      let l = 0, r = 0
      while (l + 1 < left.length || r + 1 < right.length) {
        if (r + 1 === right.length || l + 1 < left.length && positions[3 * left[l + 1] + 1] <= positions[3 * right[r + 1] + 1]) {
          triangle(left[l], right[r], left[l + 1]); l++
        } else {
          triangle(left[l], right[r], right[r + 1]); r++
        }
      }
    }
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  return geometry
}
