import type * as THREE from 'three'
import type { SurfaceCurve, SurfaceMap } from '../geom/cuts'
import { MeshBuilder } from '../geom/mesh'
import { add, cross, dist, dot, lerp3, norm, scale, sub, type V3 } from '../geom/vec'
import { bar, barOn, holePlane, merge, pocket, solid, tailNormal } from './solid'

/** Light guide section, the depth of the dark lens recess it sits in, and of the slot below. */
export const lampSpec = { guide: 0.012, thick: 0.016, front: 0.005, corner: 0.003, lens: 0.022, slot: 0.05, inset: 0.015 } as const

/** The reflector in the slot: set back behind the paint flange, a slim plate with a rolled edge, a hair inside the slot wall. */
const reflectorSpec = { front: 0.016, thick: 0.005, gap: 0.0015, roll: 0.0012 } as const

/** The lamp's corner hole on the main skin and the map it lies on; its stretch along the skin's rear edge is open. */
export interface LampWrap {
  map: SurfaceMap
  curve: SurfaceCurve
}

interface Rim {
  p: V3
  n: V3
}

const wallT = 0.003
const flange = 0.012
const step = 0.008

function skinNormal(map: SurfaceMap, u: number, v: number, p: V3): V3 {
  const h = 1e-4
  const S = map.S
  const n = norm(cross(sub(S(Math.min(1, u + h), v), S(Math.max(0, u - h), v)), sub(S(u, Math.min(1, v + h)), S(u, Math.max(0, v - h)))))
  return dot(n, [p[0], 0, p[2] + 1.9]) < 0 ? scale(n, -1) : n
}

/** The run of a closed loop's points off an edge, in order, with the edge points either end. */
function run(n: number, onEdge: (i: number) => boolean): number[] {
  let start = 0
  while (!(onEdge(start) && !onEdge((start + 1) % n))) start = (start + 1) % n
  const out = [start]
  for (let k = 1; k <= n; k++) {
    out.push((start + k) % n)
    if (onEdge((start + k) % n)) break
  }
  return out
}

function resample(chain: Rim[], count: number): Rim[] {
  const s = [0]
  for (let i = 1; i < chain.length; i++) s.push(s[i - 1] + dist(chain[i - 1].p, chain[i].p))
  const total = s[s.length - 1]
  const out: Rim[] = []
  let i = 0
  for (let j = 0; j <= count; j++) {
    const t = (total * j) / count
    while (i < chain.length - 2 && s[i + 1] < t) i++
    const f = s[i + 1] > s[i] ? Math.min(1, Math.max(0, (t - s[i]) / (s[i + 1] - s[i]))) : 0
    out.push({ p: lerp3(chain[i].p, chain[i + 1].p, f), n: norm(lerp3(chain[i].n, chain[i + 1].n, f)) })
  }
  return out
}

const length = (c: Rim[]): number => c.reduce((a, q, i) => (i ? a + dist(c[i - 1].p, q.p) : 0), 0)

/** Top and bottom edges of the wrapped lamp from the inner end on the tail round the corner to the front tip, as stations. */
function stations(rm: SurfaceMap, lens: SurfaceCurve, wrap: LampWrap): { top: Rim[]; bottom: Rim[] } {
  const rear = run(lens.p.length, (i) => lens.uv[i][0] < 1e-4).map((i): Rim => ({ p: lens.p[i], n: tailNormal(rm, lens.p[i]) }))
  if (rear[0].p[1] < rear[rear.length - 1].p[1]) rear.reverse()
  const wc = wrap.curve
  const side = run(wc.p.length, (i) => wc.uv[i][0] > 1 - 1e-4).map((i): Rim => ({ p: wc.p[i], n: skinNormal(wrap.map, wc.uv[i][0], wc.uv[i][1], wc.p[i]) }))
  if (side[0].p[1] > side[side.length - 1].p[1]) side.reverse()
  const inner = Math.min(...rear.map((q) => Math.abs(q.p[0])))
  const end = rear.map((q, i) => i).filter((i) => Math.abs(rear[i].p[0]) < inner + 0.003)
  const y = end.reduce((a, i) => a + rear[i].p[1], 0) / end.length
  const mid = end.reduce((a, i) => (Math.abs(rear[i].p[1] - y) < Math.abs(rear[a].p[1] - y) ? i : a), end[0])
  let tip = 0
  for (let i = 0; i < side.length; i++) if (side[i].p[2] > side[tip].p[2]) tip = i
  const rearTop = rear.slice(0, mid + 1).reverse()
  const rearBottom = rear.slice(mid)
  const sideTop = side.slice(tip).reverse()
  const sideBottom = side.slice(0, tip + 1)
  const seam = (a: Rim, b: Rim): Rim => ({ p: lerp3(a.p, b.p, 0.5), n: norm(add(a.n, b.n)) })
  const n1 = Math.ceil(Math.max(length(rearTop), length(rearBottom)) / step)
  const n2 = Math.ceil(Math.max(length(sideTop), length(sideBottom)) / step)
  const rt = resample(rearTop, n1)
  const rb = resample(rearBottom, n1)
  const st = resample(sideTop, n2)
  const sb = resample(sideBottom, n2)
  rt[n1] = seam(rt[n1], st[0])
  rb[n1] = seam(rb[n1], sb[0])
  return { top: soften([...rt, ...st.slice(1)]), bottom: soften([...rb, ...sb.slice(1)]) }
}

/** Normals averaged along the chain over `reach`, so offsets behind the corner fold turn without folding over. */
function soften(c: Rim[], reach = 0.04): Rim[] {
  const s = [0]
  for (let i = 1; i < c.length; i++) s.push(s[i - 1] + dist(c[i - 1].p, c[i].p))
  return c.map((q, i) => {
    let n: V3 = [0, 0, 0]
    for (let k = 0; k < c.length; k++) {
      const d = Math.abs(s[k] - s[i]) / reach
      if (d < 1) n = add(n, scale(c[k].n, (1 - d * d) * (1 - d * d)))
    }
    return { p: q.p, n: norm(n) }
  })
}

/** The recess behind the wrapped lens: a wall down from the paint flange all round, and a floor following the skin. */
function wrapHousing(top: Rim[], bottom: Rim[], depth: number): MeshBuilder {
  const m = top.length
  const centre = (j: number): V3 => lerp3(top[j].p, bottom[j].p, 0.5)
  const loop: Array<{ r: Rim; to: V3 }> = []
  for (let j = 0; j < m; j++) loop.push({ r: top[j], to: dist(top[j].p, bottom[j].p) > 1e-4 ? bottom[j].p : centre(j ? m - 2 : 1) })
  for (let j = m - 2; j >= 1; j--) loop.push({ r: bottom[j], to: top[j].p })
  const k = loop.length
  const rows: V3[][] = [[], [], [], []]
  for (let i = 0; i < k; i++) {
    const { r, to } = loop[i]
    const t = sub(loop[(i + 1) % k].r.p, loop[(i - 1 + k) % k].r.p)
    let h = norm(cross(r.n, t))
    if (dot(h, sub(to, r.p)) < 0) h = scale(h, -1)
    const q = (inward: number, d: number): V3 => add(add(r.p, scale(h, inward)), scale(r.n, -d))
    rows[0].push(q(0.001, flange))
    rows[1].push(q(0.001, depth + wallT))
    rows[2].push(q(-wallT, depth + wallT))
    rows[3].push(q(-wallT, flange))
  }
  const b = solid(rows, [true, true, true, true], true, true)
  const cols = 6
  const first = top.findIndex((q, j) => dist(q.p, bottom[j].p) > 0.002)
  let last = m - 1
  while (last > first && dist(top[last].p, bottom[last].p) <= 0.002) last--
  const sec: V3[][] = []
  for (let c = 0; c <= cols; c++) sec.push([])
  for (let c = cols; c >= 0; c--) sec.push([])
  for (let j = first; j <= last; j++) {
    for (let c = 0; c <= cols; c++) {
      const f = c / cols
      const p = lerp3(top[j].p, bottom[j].p, f)
      const n = norm(lerp3(top[j].n, bottom[j].n, f))
      sec[c].push(add(p, scale(n, -depth)))
      sec[2 * cols + 1 - c].push(add(p, scale(n, -(depth + wallT))))
    }
  }
  merge(b, solid(sec, sec.map(() => true), true, false))
  return b
}

/** One guide round the wrapped lamp: up the upper arm, along the top inside the corner, round the tip, back along the bottom. */
function wrapGuide(rm: SurfaceMap, upper: V3[], lower: V3[], top: Rim[], bottom: Rim[]): { path: V3[]; normals: V3[] } {
  const s = lampSpec
  const inset = (j: number, d: number, fromTop: boolean): Rim => {
    const a = fromTop ? top[j] : bottom[j]
    const b = fromTop ? bottom[j] : top[j]
    const w = dist(a.p, b.p)
    const f = Math.min(0.5, d / w)
    return { p: lerp3(a.p, b.p, f), n: norm(lerp3(a.n, b.n, f)) }
  }
  const startX = Math.abs(upper[upper.length - 1][0]) + 0.004
  let j0 = 0
  while (j0 < top.length && Math.abs(top[j0].p[0]) < startX) j0++
  let j1 = top.length - 1
  while (j1 > j0 && dist(top[j1].p, bottom[j1].p) < 2 * s.inset + 0.02) j1--
  const along: Rim[] = []
  for (let j = j0; j <= j1; j++) along.push(inset(j, s.inset, true))
  const A = along[along.length - 1]
  const B = inset(j1, s.inset, false)
  const C = lerp3(A.p, B.p, 0.5)
  const r = dist(A.p, B.p) / 2
  const fwd0 = sub(lerp3(top[Math.min(top.length - 1, j1 + 1)].p, bottom[Math.min(top.length - 1, j1 + 1)].p, 0.5), lerp3(top[j1].p, bottom[j1].p, 0.5))
  const across = norm(sub(A.p, C))
  const fwd = norm(sub(fwd0, scale(across, dot(fwd0, across))))
  const arc: Rim[] = []
  for (let i = 1; i < 12; i++) {
    const t = (Math.PI * i) / 12
    arc.push({ p: add(add(C, scale(across, r * Math.cos(t))), scale(fwd, r * Math.sin(t))), n: A.n })
  }
  const back: Rim[] = []
  for (let j = j1; j >= j0; j--) back.push(inset(j, s.inset, false))
  const arm = (ps: V3[]): Rim[] => ps.map((p) => ({ p, n: tailNormal(rm, p) }))
  const all = [...arm(upper), ...along, ...arc, ...back, ...arm([...lower].reverse())]
  return { path: all.map((q) => q.p), normals: all.map((q) => q.n) }
}

/**
 * Tail lamps, left side: a light guide bar along each stroke of the sideways Y, standing on the floor of a dark lens
 * recess, and the dark slot below the lamp. Strokes are the tail's lamp curves; the recess walls continue the paint flange.
 * With the corner hole given, the lens runs round the corner in one recess and the Y's arms join round its front tip;
 * strokes are then the stem, the upper and the lower arm.
 */
export function taillamps(rm: SurfaceMap, strokes: SurfaceCurve[], lens: SurfaceCurve, slot: SurfaceCurve, wrap?: LampWrap): { guide: THREE.BufferGeometry; housing: THREE.BufferGeometry; reflector: THREE.BufferGeometry } {
  const s = lampSpec
  const guide = new MeshBuilder()
  const housing = new MeshBuilder()
  if (wrap) {
    const [stem, upper, lower] = strokes
    const { top, bottom } = stations(rm, lens, wrap)
    merge(guide, bar(rm, stem.p, s.guide, s.thick, s.front, s.corner))
    const g = wrapGuide(rm, upper.p, lower.p, top, bottom)
    merge(guide, barOn(g.path, g.normals, s.guide, s.thick, s.front, s.corner))
    merge(housing, wrapHousing(top, bottom, s.lens))
  } else {
    for (const c of strokes) merge(guide, bar(rm, c.p, s.guide, s.thick, s.front, s.corner))
    merge(housing, pocket(rm, lens, holePlane(rm, lens), s.lens))
  }
  merge(housing, pocket(rm, slot, holePlane(rm, slot), s.slot))
  return { guide: guide.geometry(), housing: housing.geometry(), reflector: reflector(rm, slot).geometry() }
}

/** A slim plate set into the slot, following the tail behind its outline, every edge rolled. */
function reflector(rm: SurfaceMap, slot: SurfaceCurve): MeshBuilder {
  const r = reflectorSpec
  const pts = slot.p
  const m = pts.length
  const centre = pts.reduce<V3>((a, p) => add(a, scale(p, 1 / m)), [0, 0, 0])
  const frame = pts.map((p, j) => {
    const nn = tailNormal(rm, p)
    const t = sub(pts[(j + 1) % m], pts[(j - 1 + m) % m])
    let h = norm(cross(nn, t))
    if (dot(sub(centre, p), h) < 0) h = scale(h, -1)
    return { p, nn, h }
  })
  const ring = (inward: number, depth: number): V3[] => frame.map((e) => add(add(e.p, scale(e.h, inward)), scale(e.nn, -depth)))
  const mid = (depth: number): V3[] => {
    const c = ring(r.gap + r.roll, depth).reduce<V3>((a, p) => add(a, scale(p, 1 / m)), [0, 0, 0])
    return frame.map(() => c)
  }
  const s0 = r.front
  const s1 = r.front + r.thick
  const rows: V3[][] = [mid(s0)]
  const sharp: boolean[] = [true]
  const k = 3
  for (let i = 0; i <= k; i++) {
    const a = (Math.PI / 2) * (i / k)
    rows.push(ring(r.gap + r.roll * (1 - Math.sin(a)), s0 + r.roll * (1 - Math.cos(a))))
    sharp.push(false)
  }
  for (let i = 0; i <= k; i++) {
    const a = (Math.PI / 2) * (i / k)
    rows.push(ring(r.gap + r.roll * (1 - Math.cos(a)), s1 - r.roll * (1 - Math.sin(a))))
    sharp.push(false)
  }
  rows.push(mid(s1))
  sharp.push(true)
  return solid(rows, sharp)
}
