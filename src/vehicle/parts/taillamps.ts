import * as THREE from 'three'
import { insertAfter, patchMaterial } from '../../materials/patch'
import type { SurfaceCurve, SurfaceMap } from '../geom/cuts'
import { MeshBuilder } from '../geom/mesh'
import { add, cross, dist, dot, lerp3, norm, scale, sub, type V2, type V3 } from '../geom/vec'
import { finish, flat, holePlane, merge, orient, pocket, solid, tailNormal, zipCap, type Plane } from './solid'

/** Light guide section, the depth of the dark lens recess it sits in, and of the slot below. */
export const lampSpec = { guide: 0.012, thick: 0.016, front: 0.005, corner: 0.003, lens: 0.022, slot: 0.05, inset: 0.015 } as const

/** The reflector in the slot: set back behind the paint flange, a slim plate with a rolled edge, a hair inside the slot wall. */
const reflectorSpec = { front: 0.016, thick: 0.005, gap: 0.0015, roll: 0.0012 } as const

/** The inner optic on the recess floor between the guide's runs: slanted cells at an even pitch, each a low rounded block. */
const opticSpec = { every: 2, width: 0.0042, height: 0.004, skew: 0.45, clear: 0.0035, round: 0.0014 } as const

/** Emission across the guide: a hot core along the face centre over `core` half width, `edge` at the face edges, `back` at the rear of the flanks. */
export const glowSpec = { core: 0.0016, edge: 0.04, back: 0.04, cellTop: 0.3, cellFoot: 0.02 } as const

/** The outer lens: clear of the paint flange by `gap`, its face `face` under the skin, `thick` through, edges rolled. */
export const lensSpec = { gap: 0.0016, face: 0.0011, thick: 0.003, round: 0.0009, cols: 8 } as const

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
  const tip = top[top.length - 1].p
  const end = (j: number) => {
    const A = inset(j, s.inset, true)
    const B = inset(j, s.inset, false)
    const C = lerp3(A.p, B.p, 0.5)
    const r = dist(A.p, B.p) / 2
    const k = Math.min(top.length - 1, j + 1)
    const fwd0 = sub(lerp3(top[k].p, bottom[k].p, 0.5), lerp3(top[j].p, bottom[j].p, 0.5))
    const across = norm(sub(A.p, C))
    const fwd = norm(sub(fwd0, scale(across, dot(fwd0, across))))
    return { A, B, C, r, across, fwd, room: dot(sub(tip, C), fwd) - s.guide / 2 - s.inset / 3 }
  }
  let j1 = top.length - 1
  while (j1 > j0 && (dist(top[j1].p, bottom[j1].p) < 2 * s.inset + 0.02 || end(j1).room < end(j1).r)) j1--
  const along: Rim[] = []
  for (let j = j0; j <= j1; j++) along.push(inset(j, s.inset, true))
  const { A, C, r, across, fwd, room } = end(j1)
  const reach = Math.min(r, Math.max(0.3 * r, room))
  const arc: Rim[] = []
  for (let i = 1; i < 12; i++) {
    const t = (Math.PI * i) / 12
    arc.push({ p: add(add(C, scale(across, r * Math.cos(t))), scale(fwd, reach * Math.sin(t))), n: A.n })
  }
  const back: Rim[] = []
  for (let j = j1; j >= j0; j--) back.push(inset(j, s.inset, false))
  const arm = (ps: V3[]): Rim[] => ps.map((p) => ({ p, n: tailNormal(rm, p) }))
  const all = [...arm(upper), ...along, ...arc, ...back, ...arm([...lower].reverse())]
  return { path: all.map((q) => q.p), normals: all.map((q) => q.n) }
}

/** The guide bar: a rounded section with a finely split face, each row carrying its emission weight in uv x, mean 1 seen square on. */
function glowBar(path: V3[], normals: V3[], height: number, thick: number, depth: number, corner: number): MeshBuilder {
  const g = glowSpec
  const sec: Array<[number, number]> = []
  const k = 4
  const nf = 12
  const hw = height / 2 - corner
  const ht = thick / 2 - corner
  const arc = (cx: number, cy: number, a0: number): void => {
    for (let i = 0; i <= k; i++) {
      const a = a0 + (Math.PI / 2) * (i / k)
      sec.push([cx + corner * Math.cos(a), cy + corner * Math.sin(a)])
    }
  }
  arc(hw, ht, 0)
  for (let i = 1; i < nf; i++) sec.push([hw - (2 * hw * i) / nf, thick / 2])
  arc(-hw, ht, Math.PI / 2)
  arc(-hw, -ht, Math.PI)
  arc(hw, -ht, Math.PI * 1.5)
  const lateral = (x: number): number => g.edge + (1 - g.edge) * Math.exp(-((x / g.core) ** 2))
  const front = sec.filter(([, d]) => d > ht - 1e-9)
  let sum = 0
  let len = 0
  for (let i = 1; i < front.length; i++) {
    const w = Math.abs(front[i][0] - front[i - 1][0])
    sum += (w * (lateral(front[i][0]) + lateral(front[i - 1][0]))) / 2
    len += w
  }
  const base = len / sum
  const glow = sec.map(([x, d]) => base * lateral(Math.max(-hw, Math.min(hw, x))) * (g.back + (1 - g.back) * ((d + thick / 2) / thick) ** 2))
  const frames = path.map((p, j) => {
    const n = normals[j]
    const t = sub(path[Math.min(path.length - 1, j + 1)], path[Math.max(0, j - 1)])
    return { p, n, h: norm(cross(n, t)) }
  })
  const rows = sec.map(([x, d]) => frames.map((f) => add(add(f.p, scale(f.h, x)), scale(f.n, -(depth + thick / 2) + d))))
  const b = solid(rows, sec.map(() => false), true, false)
  const m = path.length
  const nr = sec.length
  let v = 0
  for (let st = 0; st < nr; st++) for (const i of [st, st + 1]) for (let j = 0; j < m; j++) b.uv[2 * v++] = glow[i % nr]
  for (let e = 0; e < 2; e++) {
    b.uv[2 * v++] = base * g.edge * g.back
    for (let i = 0; i < nr; i++) b.uv[2 * v++] = glow[i]
  }
  return b
}

/** Clear outer lens over the wrapped recess: a slab under the skin, short of the paint flange all round, rolled at the edge. */
function lensShell(top: Rim[], bottom: Rim[]): MeshBuilder {
  const l = lensSpec
  const keep = top.map((q, j) => j).filter((j) => dist(top[j].p, bottom[j].p) > 2 * l.gap + 2.2 * l.round)
  const f0 = l.face
  const f1 = l.face + l.thick
  const r = l.round
  const rows: V3[][] = []
  const at = (j: number, side: 0 | 1, x: number, d: number, c?: number): V3 => {
    const a = top[j]
    const b = bottom[j]
    const across = norm(sub(b.p, a.p))
    const A = add(a.p, scale(across, l.gap))
    const B = sub(b.p, scale(across, l.gap))
    const W = dist(A, B)
    const u = c === undefined ? (side === 0 ? x / W : 1 - x / W) : (r + ((W - 2 * r) * c) / l.cols) / W
    const n = norm(lerp3(a.n, b.n, u))
    return add(lerp3(A, B, u), scale(n, -d))
  }
  const spec: Array<(j: number) => V3> = []
  for (let c = 0; c <= l.cols; c++) spec.push((j) => at(j, 0, 0, f0, c))
  const corner = (side: 0 | 1, cd: number, a0: number, a1: number): void => {
    for (let i = 0; i <= 3; i++) {
      const a = a0 + ((a1 - a0) * i) / 3
      const x = r - r * Math.cos(a)
      const d = cd + r * Math.sin(a)
      spec.push((j) => at(j, side, x, d))
    }
  }
  corner(1, f0 + r, -Math.PI / 2 + Math.PI / 6, 0)
  corner(1, f1 - r, 0, Math.PI / 2 - Math.PI / 6)
  for (let c = l.cols; c >= 0; c--) spec.push((j) => at(j, 0, 0, f1, c))
  corner(0, f1 - r, Math.PI / 2 - Math.PI / 6, 0)
  corner(0, f0 + r, 0, -Math.PI / 2 + Math.PI / 6)
  for (const p of spec) rows.push(keep.map((j) => p(j)))
  return solid(rows, rows.map(() => false), true, false)
}

/** The quarter seam's end at the lamp's front tip: the channel's upper 4.5 mm runs open into the lamp gap, a dark return closes it below, past its 11 mm walls. */
export const seamSpec = { t: [-0.214, -0.226, -0.951] as V3, half: 0.0026, top: 0.0045, depth: 0.0125, thick: 0.0014, round: 0.0015 } as const

function seamReturn(tip: Rim): MeshBuilder {
  const q = seamSpec
  const t = norm(sub(q.t, scale(tip.n, dot(q.t, tip.n))))
  const w = norm(cross(tip.n, t))
  const f: Plane = { o: tip.p, ex: w, ey: tip.n, ez: t }
  const outline: V2[] = [[-q.half, -q.top], [-q.half, -q.depth], [q.half, -q.depth], [q.half, -q.top]]
  return flat(f, roundedRect(outline, q.round), [], 0, q.thick)
}

/** The guide and optic emit by the weight each vertex carries: a hot core falling to deep red at the edges and flanks. */
export function lampGlow(material: THREE.Material): void {
  patchMaterial(material, {
    id: 'tail lamp glow',
    apply(shader) {
      shader.vertexShader = 'attribute float tailGlow;\nvarying float tailGlowV;\n' + insertAfter(shader.vertexShader, '#include <begin_vertex>', 'tailGlowV = tailGlow;')
      shader.fragmentShader = 'varying float tailGlowV;\n' + insertAfter(shader.fragmentShader, '#include <emissivemap_fragment>', 'totalEmissiveRadiance *= tailGlowV;')
    },
  })
}

/** Each vertex's weight from uv x; held, scaled so the area seen from behind keeps the mean 1 the flat guide emitted. */
function glowing(b: MeshBuilder, held = false): THREE.BufferGeometry {
  const g = finish(b)
  const uv = g.getAttribute('uv')
  const w = new Float32Array(uv.count)
  for (let i = 0; i < uv.count; i++) w[i] = uv.getX(i)
  if (held) {
    const pos = g.getAttribute('position')
    const ix = g.getIndex()
    const n = ix ? ix.count : pos.count
    const at = (t: number): number => (ix ? ix.getX(t) : t)
    const a = new THREE.Vector3()
    const e = new THREE.Vector3()
    const f = new THREE.Vector3()
    let area = 0
    let sum = 0
    for (let t = 0; t + 2 < n; t += 3) {
      const [i, j, k] = [at(t), at(t + 1), at(t + 2)]
      a.fromBufferAttribute(pos, i)
      e.fromBufferAttribute(pos, j).sub(a)
      f.fromBufferAttribute(pos, k).sub(a)
      const s = Math.max(0, -e.cross(f).z) / 2
      area += s
      sum += (s * (w[i] + w[j] + w[k])) / 3
    }
    if (sum > 0) for (let i = 0; i < w.length; i++) w[i] *= area / sum
  }
  g.setAttribute('tailGlow', new THREE.BufferAttribute(w, 1))
  return g
}

/**
 * Tail lamps, left side: a light guide bar along each stroke of the sideways Y, standing on the floor of a dark lens
 * recess, and the dark slot below the lamp. Strokes are the tail's lamp curves; the recess walls continue the paint flange.
 * With the corner hole given, the lens runs round the corner in one recess and the Y's arms join round its front tip;
 * strokes are then the stem, the upper and the lower arm.
 */
export function taillamps(rm: SurfaceMap, strokes: SurfaceCurve[], lens: SurfaceCurve, slot: SurfaceCurve, wrap?: LampWrap): { guide: THREE.BufferGeometry; housing: THREE.BufferGeometry; reflector: THREE.BufferGeometry; optic: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const s = lampSpec
  const guide = new MeshBuilder()
  const housing = new MeshBuilder()
  const inner = new MeshBuilder()
  const cover = new MeshBuilder()
  const onTail = (path: V3[]): V3[] => path.map((p) => tailNormal(rm, p))
  if (wrap) {
    const [stem, upper, lower] = strokes
    const { top, bottom } = stations(rm, lens, wrap)
    merge(guide, glowBar(stem.p, onTail(stem.p), s.guide, s.thick, s.front, s.corner))
    const g = wrapGuide(rm, upper.p, lower.p, top, bottom)
    merge(guide, glowBar(g.path, g.normals, s.guide, s.thick, s.front, s.corner))
    merge(housing, wrapHousing(top, bottom, s.lens))
    merge(inner, optic(top, bottom, s.lens))
    merge(cover, lensShell(top, bottom))
    merge(housing, seamReturn(top[top.length - 1]))
  } else {
    for (const c of strokes) merge(guide, glowBar(c.p, onTail(c.p), s.guide, s.thick, s.front, s.corner))
    merge(housing, pocket(rm, lens, holePlane(rm, lens), s.lens))
  }
  merge(housing, pocket(rm, slot, holePlane(rm, slot), s.slot))
  return { guide: glowing(guide, true), housing: finish(housing), reflector: finish(reflector(rm, slot)), optic: glowing(inner), lens: finish(cover) }
}

function roundedRect(pts: V2[], rad: number): V2[] {
  const out: V2[] = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n]
    const p = pts[i]
    const c = pts[(i + 1) % n]
    const ia = norm([p[0] - a[0], p[1] - a[1], 0])
    const oc = norm([c[0] - p[0], c[1] - p[1], 0])
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(ia, oc))))
    const d = rad * Math.tan(turn / 2)
    const t0: V2 = [p[0] - ia[0] * d, p[1] - ia[1] * d]
    const t1: V2 = [p[0] + oc[0] * d, p[1] + oc[1] * d]
    for (let k = 0; k <= 4; k++) {
      const f = k / 4
      const q0: V2 = [t0[0] + (p[0] - t0[0]) * f, t0[1] + (p[1] - t0[1]) * f]
      const q1: V2 = [p[0] + (t1[0] - p[0]) * f, p[1] + (t1[1] - p[1]) * f]
      out.push([q0[0] + (q1[0] - q0[0]) * f, q0[1] + (q1[1] - q0[1]) * f])
    }
  }
  return out
}

/** Light cells on the recess floor between the guide's upper and lower runs, set back the full lens depth behind the guide face. */
function optic(top: Rim[], bottom: Rim[], depth: number): MeshBuilder {
  const o = opticSpec
  const s = lampSpec
  const b = new MeshBuilder()
  const edge = s.inset + s.guide / 2 + o.clear
  for (let j = 1; j < top.length - 1; j += o.every) {
    const T = top[j]
    const B = bottom[j]
    const w = dist(T.p, B.p)
    const half = w / 2 - edge
    if (half < 0.004) continue
    const n = norm(lerp3(T.n, B.n, 0.5))
    const d0 = sub(B.p, T.p)
    const across = norm(sub(d0, scale(n, dot(d0, n))))
    const along = norm(cross(across, n))
    const c = lerp3(T.p, B.p, 0.5)
    const f: Plane = { o: add(c, scale(n, -depth - 0.0005)), ex: along, ey: across, ez: n }
    const hw = o.width / 2
    const k = -o.skew * half
    const outline: V2[] = [[-hw - k, -half], [hw - k, -half], [hw + k, half], [-hw + k, half]]
    const cell = flat(f, roundedRect(outline, o.round), [], 0, o.height + 0.0005)
    for (let v = 0; v < cell.pos.length / 3; v++) {
      const up = dot(sub([cell.pos[3 * v], cell.pos[3 * v + 1], cell.pos[3 * v + 2]], f.o), n) / (o.height + 0.0005)
      cell.uv[2 * v] = glowSpec.cellFoot + (glowSpec.cellTop - glowSpec.cellFoot) * up * up
    }
    merge(b, cell)
  }
  return b
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
  const s0 = r.front
  const s1 = r.front + r.thick
  const rows: V3[][] = []
  const k = 3
  for (let i = 0; i <= k; i++) {
    const a = (Math.PI / 2) * (i / k)
    rows.push(ring(r.gap + r.roll * (1 - Math.sin(a)), s0 + r.roll * (1 - Math.cos(a))))
  }
  for (let i = 1; i <= k; i++) {
    const a = (Math.PI / 2) * (i / k)
    rows.push(ring(r.gap + r.roll * (1 - Math.cos(a)), s1 - r.roll * (1 - Math.sin(a))))
  }
  const b = solid(rows, rows.map(() => false), false)
  const front = frame.map((e) => e.nn)
  zipCap(b, rows[0], front)
  zipCap(b, rows[rows.length - 1], front.map((n) => scale(n, -1)))
  return orient(b)
}
