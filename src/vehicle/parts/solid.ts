import { MeshBuilder } from '../geom/mesh'
import { cross, dot, norm, sub, type V3 } from '../geom/vec'

/**
 * A closed solid swept between rows of equal length: every row is a closed loop, and the last row joins the first.
 * Rows marked sharp get a crease; the others share one normal across both neighbouring strips.
 * The result is wound and shaded outward whatever the order of the rows.
 */
export function solid(rows: V3[][], sharp: boolean[], closedRows = true): MeshBuilder {
  const b = new MeshBuilder()
  const nr = rows.length
  const m = rows[0].length
  const at = (i: number): V3[] => rows[((i % nr) + nr) % nr]
  const strips = closedRows ? nr : nr - 1
  const isSharp = (i: number): boolean => (!closedRows && (i === 0 || i === nr - 1)) || sharp[((i % nr) + nr) % nr]
  const normalAt = (i: number, j: number, s: number): V3 => {
    const r = at(i)
    const dj = sub(r[(j + 1) % m], r[(j - 1 + m) % m])
    const prev = isSharp(i) && i === s + 1 ? s : i - 1
    const next = isSharp(i) && i === s ? s + 1 : i + 1
    const a = isSharp(i) && i === s ? r[j] : at(prev)[j]
    const c = isSharp(i) && i === s + 1 ? r[j] : at(next)[j]
    let n = cross(dj, sub(c, a))
    if (dot(n, n) < 1e-18) {
      const rk = at(i === s ? s + 1 : s)
      n = cross(sub(rk[(j + 1) % m], rk[(j - 1 + m) % m]), sub(c, a))
    }
    return norm(n)
  }
  for (let s = 0; s < strips; s++) {
    const base = b.pos.length / 3
    for (const i of [s, s + 1]) for (let j = 0; j < m; j++) b.vertex(at(i)[j], normalAt(i, j, s), j / m, i / nr)
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m
      b.quad(base + j, base + j1, base + m + j1, base + m + j)
    }
  }
  return orient(b)
}

/** Flips a closed mesh whose signed volume is negative. */
export function orient(b: MeshBuilder): MeshBuilder {
  let v = 0
  const p = (k: number): V3 => [b.pos[3 * k], b.pos[3 * k + 1], b.pos[3 * k + 2]]
  for (let t = 0; t < b.idx.length; t += 3) v += dot(p(b.idx[t]), cross(p(b.idx[t + 1]), p(b.idx[t + 2])))
  if (v >= 0) return b
  for (let t = 0; t < b.idx.length; t += 3) [b.idx[t + 1], b.idx[t + 2]] = [b.idx[t + 2], b.idx[t + 1]]
  for (let k = 0; k < b.nor.length; k++) b.nor[k] = -b.nor[k]
  return b
}

/** Appends one builder's mesh to another. */
export function merge(into: MeshBuilder, from: MeshBuilder): void {
  const base = into.pos.length / 3
  for (let k = 0; k < from.pos.length / 3; k++) into.vertex([from.pos[3 * k], from.pos[3 * k + 1], from.pos[3 * k + 2]], [from.nor[3 * k], from.nor[3 * k + 1], from.nor[3 * k + 2]], from.uv[2 * k], from.uv[2 * k + 1])
  for (const i of from.idx) into.idx.push(base + i)
}
