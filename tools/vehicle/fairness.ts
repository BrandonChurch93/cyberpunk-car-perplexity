// Fairness audit for the painted body at the film cameras.
//
//   npx tsx tools/vehicle/fairness.ts                    ripple table and ripple maps at frames 195 and 360, both formats
//   npx tsx tools/vehicle/fairness.ts --zebra true       also render studio zebra at the same cameras and save a sheet
//   npx tsx tools/vehicle/fairness.ts --base <label>     also stack the saved sheets of an earlier run above this one
//   npx tsx tools/vehicle/fairness.ts --control true     measure a fine 1 m sphere instead of the car: the noise floor
//
// Options: --frames 195,360  --formats master,vertical  --step 10 (mm)  --crease 40 (mm)  --label <name>
//
// Rays are cast through the pixel grid of each film camera against the full-detail vehicle at rest at that frame.
// Every hit on a painted surface keeps its world position and its interpolated shading normal, the normal that the
// zebra and the beauty render see. Each image row (u) and column (v) is cut into runs that stay on one panel and
// do not jump across an occluding edge. Each run is resampled at a fixed arc step h along the surface and the
// ripple is |n(s + h) - 2 n(s) + n(s - h)| / h^2, in 1/m^2. A fair panel scores low; a waviness of amplitude a
// and wavelength L scores about a (2 pi / L)^3. Folds tighter than the crease radius are declared creases and the
// samples within three steps of them are left out, so a crisp character line does not count as ripple.
// The result goes to out/work/vehicle/fairness/<label>/ as table.txt, ripple-<view>.png, ripple.jpg and zebra.jpg.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import * as T from 'three'
import sharp, { type OverlayOptions } from 'sharp'
import { createVehicle } from '../../src/vehicle/index.ts'
import { config, defaultPaint, paintById, type FormatSpec } from '../../src/config.ts'
import { cameraAt } from '../../src/director/shots.ts'
import { stateAt } from '../../src/director/timeline.ts'
import { args, ensureDir, repoRoot, workDir } from '../lib/env.ts'

const a = args()
const frames = (a.frames ?? '195,360').split(',').map(Number)
const formatKeys = (a.formats ?? 'master,vertical').split(',') as Array<'master' | 'vertical'>
const step = Number(a.step ?? 10) / 1000
const creaseRadius = Number(a.crease ?? 40) / 1000
const control = a.control === 'true'
const probes = String(a.probe ?? '').split(';').filter(Boolean).map((x) => x.split(',').map(Number) as [number, number])
const git = (...cmd: string[]) => execFileSync('git', cmd, { cwd: repoRoot, encoding: 'utf8' }).trim()
const dirty = git('status', '--porcelain', '--', 'src/vehicle').length > 0
const label = a.label ?? git('rev-parse', '--short', 'HEAD') + (dirty ? '-local' : '')
const out = ensureDir(join(workDir, 'vehicle', 'fairness', label))

// Panels in the vehicle frame: +Z forward, +X the left side, Y up. Boxes follow the wheel centres so they hold if the
// body is redrawn. A point goes to the first panel whose test passes.
type Panel = { name: string; test: (p: T.Vector3, n: T.Vector3) => boolean }
const loadHubs = async () => {
  try {
    const body = await import('../../src/vehicle/body.ts') as { frontHub?: number; rearHub?: number }
    if (typeof body.frontHub === 'number' && typeof body.rearHub === 'number') return { front: body.frontHub, rear: body.rearHub }
  } catch { /* fall through */ }
  return { front: 1.285, rear: -1.494 }
}
const hub = await loadHubs()
const panels: Panel[] = [
  { name: 'nose and fascia', test: (p, n) => p.z > hub.front + 0.42 && n.z > 0.45 },
  { name: 'bonnet', test: (p, n) => Math.abs(p.x) < 0.5 && p.z > hub.front - 0.55 && n.y > 0.5 },
  { name: 'front wing top', test: (p, n) => p.z > hub.front - 0.75 && n.y > 0.5 },
  { name: 'front wing side', test: (p, n) => p.z > hub.front - 0.6 && p.y > 0.3 && Math.abs(n.x) > 0.3 },
  { name: 'roof and pillars', test: (p) => p.y > 0.98 && p.z > hub.rear + 0.55 },
  { name: 'door', test: (p, n) => p.z > hub.rear + 0.55 && p.y > 0.3 && Math.abs(n.x) > 0.3 },
  { name: 'sill', test: (p) => p.y <= 0.3 && p.z > hub.rear + 0.4 && p.z < hub.front - 0.4 },
  { name: 'rear deck', test: (p, n) => p.z <= hub.rear + 0.55 && n.y > 0.5 },
  { name: 'tail', test: (p, n) => p.z < hub.rear - 0.35 && n.z < -0.45 },
  { name: 'haunch', test: (p) => p.z <= hub.rear + 0.55 },
]
const panelOf = (p: T.Vector3, n: T.Vector3): number => {
  const i = panels.findIndex((panel) => panel.test(p, n))
  return i < 0 ? panels.length : i
}
const panelName = (i: number, x: number) => i >= panels.length ? 'other' : panels[i].name + (/roof|bonnet|deck|nose|tail/.test(panels[i].name) ? '' : x >= 0 ? ' L' : ' R')

// Triangle soup with a bounding volume hierarchy, built once from the vehicle at the frame.
class Soup {
  pos: Float32Array
  nrm: Float32Array
  painted: Uint8Array
  owner: Int32Array
  names: string[]
  count: number
  private nodeMin: Float32Array
  private nodeMax: Float32Array
  private nodeA: Int32Array
  private nodeB: Int32Array
  private order: Int32Array
  private nodes = 0

  constructor(tris: Array<{ pos: Float32Array; nrm: Float32Array; painted: Uint8Array; name: string }>) {
    this.count = tris.reduce((s, m) => s + m.pos.length / 9, 0)
    this.pos = new Float32Array(this.count * 9)
    this.nrm = new Float32Array(this.count * 9)
    this.painted = new Uint8Array(this.count)
    this.owner = new Int32Array(this.count)
    this.names = []
    let k = 0
    for (const m of tris) {
      this.pos.set(m.pos, k * 9)
      this.nrm.set(m.nrm, k * 9)
      this.painted.set(m.painted, k)
      this.owner.fill(this.names.length, k, k + m.pos.length / 9)
      this.names.push(m.name)
      k += m.pos.length / 9
    }
    const cap = 2 * this.count + 1
    this.nodeMin = new Float32Array(cap * 3)
    this.nodeMax = new Float32Array(cap * 3)
    this.nodeA = new Int32Array(cap)
    this.nodeB = new Int32Array(cap)
    this.order = new Int32Array(this.count)
    for (let i = 0; i < this.count; i++) this.order[i] = i
    const centre = new Float32Array(this.count * 3)
    for (let i = 0; i < this.count; i++) for (let c = 0; c < 3; c++) {
      centre[i * 3 + c] = (this.pos[i * 9 + c] + this.pos[i * 9 + 3 + c] + this.pos[i * 9 + 6 + c]) / 3
    }
    this.build(0, this.count, centre)
  }

  private build(start: number, end: number, centre: Float32Array): number {
    const node = this.nodes++
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    const clo = [Infinity, Infinity, Infinity], chi = [-Infinity, -Infinity, -Infinity]
    for (let i = start; i < end; i++) {
      const t = this.order[i]
      for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) {
        const x = this.pos[t * 9 + v * 3 + c]
        if (x < lo[c]) lo[c] = x
        if (x > hi[c]) hi[c] = x
      }
      for (let c = 0; c < 3; c++) {
        const x = centre[t * 3 + c]
        if (x < clo[c]) clo[c] = x
        if (x > chi[c]) chi[c] = x
      }
    }
    for (let c = 0; c < 3; c++) { this.nodeMin[node * 3 + c] = lo[c]; this.nodeMax[node * 3 + c] = hi[c] }
    const n = end - start
    const axis = [0, 1, 2].reduce((best, c) => chi[c] - clo[c] > chi[best] - clo[best] ? c : best, 0)
    if (n <= 4 || chi[axis] - clo[axis] < 1e-7) {
      this.nodeA[node] = -1 - start
      this.nodeB[node] = n
      return node
    }
    const mid = (start + end) >> 1
    this.select(start, end - 1, mid, axis, centre)
    this.nodeA[node] = this.build(start, mid, centre)
    this.nodeB[node] = this.build(mid, end, centre)
    return node
  }

  private select(lo: number, hi: number, k: number, axis: number, centre: Float32Array): void {
    const o = this.order
    while (hi > lo) {
      const pivot = centre[o[(lo + hi) >> 1] * 3 + axis]
      let i = lo, j = hi
      while (i <= j) {
        while (centre[o[i] * 3 + axis] < pivot) i++
        while (centre[o[j] * 3 + axis] > pivot) j--
        if (i <= j) { const t = o[i]; o[i] = o[j]; o[j] = t; i++; j-- }
      }
      if (k <= j) hi = j
      else if (k >= i) lo = i
      else return
    }
  }

  // Nearest hit along the ray: [distance, triangle, u, v] or null.
  hit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): [number, number, number, number] | null {
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz
    let best = Infinity, bestTri = -1, bu = 0, bv = 0
    const stack = new Int32Array(128)
    let sp = 0
    stack[sp++] = 0
    while (sp > 0) {
      const node = stack[--sp]
      let t0 = 0, t1 = best
      for (let c = 0; c < 3; c++) {
        const o = c === 0 ? ox : c === 1 ? oy : oz
        const inv = c === 0 ? ix : c === 1 ? iy : iz
        let ta = (this.nodeMin[node * 3 + c] - o) * inv
        let tb = (this.nodeMax[node * 3 + c] - o) * inv
        if (ta > tb) { const t = ta; ta = tb; tb = t }
        if (ta > t0) t0 = ta
        if (tb < t1) t1 = tb
        if (t0 > t1) break
      }
      if (t0 > t1) continue
      const first = this.nodeA[node]
      if (first < 0) {
        const s = -1 - first
        for (let i = s; i < s + this.nodeB[node]; i++) {
          const t = this.order[i], p = this.pos, b = t * 9
          const e1x = p[b + 3] - p[b], e1y = p[b + 4] - p[b + 1], e1z = p[b + 5] - p[b + 2]
          const e2x = p[b + 6] - p[b], e2y = p[b + 7] - p[b + 1], e2z = p[b + 8] - p[b + 2]
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
          const det = e1x * px + e1y * py + e1z * pz
          if (Math.abs(det) < 1e-14) continue
          const inv = 1 / det
          const sx = ox - p[b], sy = oy - p[b + 1], sz = oz - p[b + 2]
          const u = (sx * px + sy * py + sz * pz) * inv
          if (u < 0 || u > 1) continue
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x
          const v = (dx * qx + dy * qy + dz * qz) * inv
          if (v < 0 || u + v > 1) continue
          const d = (e2x * qx + e2y * qy + e2z * qz) * inv
          if (d > 1e-5 && d < best) { best = d; bestTri = t; bu = u; bv = v }
        }
      } else if (sp < 126) {
        stack[sp++] = this.nodeA[node]
        stack[sp++] = this.nodeB[node]
      }
    }
    return bestTri < 0 ? null : [best, bestTri, bu, bv]
  }
}

const visible = (o: T.Object3D | null): boolean => !o || (o.visible && visible(o.parent))
const isSeeThrough = (m: T.Material) => (m.transparent && m.opacity < 0.5) || m.blending === T.AdditiveBlending || (m.transparent && !m.depthWrite)

async function soupAt(timeSeconds: number) {
  const car = await createVehicle({ paint: paintById(defaultPaint), detail: 'full' })
  const s = stateAt(timeSeconds)
  car.update({ timeSeconds, lampStage: s.lampStage, engine: s.engine, vibration: s.vibration })
  car.root.updateMatrixWorld(true)
  let paint: T.Material | null = null
  car.root.traverse((o) => {
    const mesh = o as T.Mesh
    if (!paint && mesh.isMesh && /body panel/i.test(mesh.name)) paint = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  })
  const toLocal = car.root.matrixWorld.clone().invert()
  const tris: Array<{ pos: Float32Array; nrm: Float32Array; painted: Uint8Array; name: string }> = []
  const normalMatrix = new T.Matrix3()
  const v = new T.Vector3(), nv = new T.Vector3()
  car.root.traverse((o) => {
    const mesh = o as T.Mesh
    if (!mesh.isMesh || !visible(mesh)) return
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    if (isSeeThrough(material)) return
    const g = mesh.geometry as T.BufferGeometry
    const position = g.attributes.position
    if (!position) return
    if (!g.attributes.normal) g.computeVertexNormals()
    const normal = g.attributes.normal
    const index = g.index
    const triCount = (index ? index.count : position.count) / 3
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const paintedTri = new Uint8Array(triCount).fill(materials.length === 1 && materials[0] === paint ? 1 : 0)
    for (const group of materials.length > 1 ? g.groups : []) {
      if (materials[group.materialIndex ?? 0] !== paint) continue
      paintedTri.fill(1, Math.floor(group.start / 3), Math.min(triCount, Math.floor((group.start + group.count) / 3)))
    }
    const instanced = mesh as T.InstancedMesh
    const matrices: T.Matrix4[] = []
    if (instanced.isInstancedMesh) {
      for (let i = 0; i < instanced.count; i++) {
        const m = new T.Matrix4()
        instanced.getMatrixAt(i, m)
        matrices.push(m.premultiply(mesh.matrixWorld).premultiply(toLocal))
      }
    } else matrices.push(mesh.matrixWorld.clone().premultiply(toLocal))
    for (const m of matrices) {
      normalMatrix.getNormalMatrix(m)
      const pos = new Float32Array(triCount * 9), nrm = new Float32Array(triCount * 9)
      for (let t = 0; t < triCount; t++) for (let c = 0; c < 3; c++) {
        const i = index ? index.getX(t * 3 + c) : t * 3 + c
        v.fromBufferAttribute(position, i).applyMatrix4(m)
        nv.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize()
        pos.set([v.x, v.y, v.z], t * 9 + c * 3)
        nrm.set([nv.x, nv.y, nv.z], t * 9 + c * 3)
      }
      tris.push({ pos, nrm, painted: paintedTri, name: mesh.name })
    }
  })
  if (control) {
    // Noise floor: a 1 m sphere tessellated about as finely as the body, standing where the car stands. Its true
    // ripple is 1 per m2, so anything above that in its rows is sampling and facet noise.
    const g = new T.SphereGeometry(1, 720, 360).toNonIndexed()
    g.translate(0, 0.62, 0)
    tris.length = 0
    const count = g.attributes.position.count / 3
    tris.push({ pos: Float32Array.from(g.attributes.position.array), nrm: Float32Array.from(g.attributes.normal.array), painted: new Uint8Array(count).fill(1), name: 'control sphere' })
  }
  return { soup: new Soup(tris), anchors: car.anchors, toLocal }
}

type Stat = { sum: number; n: number; values: number[]; worst: number; at: [number, number] }
const newStat = (): Stat => ({ sum: 0, n: 0, values: [], worst: 0, at: [0, 0] })

const built = new Map<number, Awaited<ReturnType<typeof soupAt>>>()
async function measure(frame: number, key: 'master' | 'vertical') {
  const format: FormatSpec = config.formats[key]
  const time = frame / config.film.fps
  if (!built.has(frame)) built.set(frame, await soupAt(time))
  const { soup, anchors, toLocal } = built.get(frame)!
  const cam = cameraAt(time, format, anchors, time)
  const origin = cam.position.clone().applyMatrix4(toLocal)
  const q = cam.quaternion.clone().premultiply(new T.Quaternion().setFromRotationMatrix(toLocal))
  const halfW = cam.sensorWidthMm / 2 / cam.focalMm
  const halfH = halfW * format.height / format.width
  // Stride so that neighbouring samples sit about a third of a step apart at the subject.
  const centreHit = soup.hit(origin.x, origin.y, origin.z, ...new T.Vector3(0, 0, -1).applyQuaternion(q).toArray() as [number, number, number])
  const subject = centreHit ? centreHit[0] : origin.length()
  const pixel = subject * 2 * halfW / format.width
  const stride = Math.max(1, Math.floor(step / 3 / pixel))
  const W = Math.floor(format.width / stride), H = Math.floor(format.height / stride)
  const P = new Float32Array(W * H * 3), N = new Float32Array(W * H * 3), D = new Float32Array(W * H * 3)
  const panel = new Int16Array(W * H).fill(-1)
  const shade = new Uint8Array(W * H)
  const dir = new T.Vector3(), n = new T.Vector3(), p = new T.Vector3()
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = (x + 0.5) * stride, py = (y + 0.5) * stride
    dir.set((px / format.width * 2 - 1) * halfW, (1 - py / format.height * 2) * halfH, -1).applyQuaternion(q).normalize()
    const h = soup.hit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z)
    if (!h) continue
    const [t, tri, u, v] = h
    const b = tri * 9, w = 1 - u - v
    n.set(
      soup.nrm[b] * w + soup.nrm[b + 3] * u + soup.nrm[b + 6] * v,
      soup.nrm[b + 1] * w + soup.nrm[b + 4] * u + soup.nrm[b + 7] * v,
      soup.nrm[b + 2] * w + soup.nrm[b + 5] * u + soup.nrm[b + 8] * v,
    ).normalize()
    if (n.dot(dir) > 0) n.negate()
    p.copy(origin).addScaledVector(dir, t)
    const k = y * W + x
    shade[k] = Math.round(40 + 180 * Math.max(0, -n.dot(dir)))
    if (!soup.painted[tri]) continue
    P.set([p.x, p.y, p.z], k * 3)
    N.set([n.x, n.y, n.z], k * 3)
    D.set([dir.x, dir.y, dir.z], k * 3)
    panel[k] = panelOf(p, n)
  }
  // --probe 900,600;1200,500 prints the mesh under native pixels, to check what the mask counts as paint.
  for (const spot of probes) {
    const [px, py] = spot
    dir.set((px / format.width * 2 - 1) * halfW, (1 - py / format.height * 2) * halfH, -1).applyQuaternion(q).normalize()
    const h = soup.hit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z)
    console.log(`probe ${frame}-${key} ${px},${py}: ${h ? `${soup.names[soup.owner[h[1]]]}${soup.painted[h[1]] ? ' (paint)' : ''} at ${(h[0]).toFixed(2)} m, local ${origin.clone().addScaledVector(dir, h[0]).toArray().map((x) => x.toFixed(2)).join(" ")}` : 'nothing'}`)
  }
  const stats = new Map<string, { u: Stat; v: Stat }>()
  const heat = new Float32Array(W * H)
  const kink = 1 / creaseRadius
  const walk = (keys: number[], dirName: 'u' | 'v') => {
    let run: number[] = []
    const flush = () => {
      if (run.length >= 4) resample(run, dirName)
      run = []
    }
    for (const k of keys) {
      if (panel[k] < 0) { flush(); continue }
      if (run.length) {
        const j = run[run.length - 1]
        const gap = Math.hypot(P[k * 3] - P[j * 3], P[k * 3 + 1] - P[j * 3 + 1], P[k * 3 + 2] - P[j * 3 + 2])
        const along = Math.hypot(P[k * 3] - origin.x, P[k * 3 + 1] - origin.y, P[k * 3 + 2] - origin.z) * 2 * halfW / format.width * stride
        const facing = Math.max(0.15, -(N[k * 3] * D[k * 3] + N[k * 3 + 1] * D[k * 3 + 1] + N[k * 3 + 2] * D[k * 3 + 2]))
        if (panel[k] !== panel[j] || gap > 3 * along / facing) flush()
      }
      run.push(k)
    }
    flush()
  }
  const resample = (run: number[], dirName: 'u' | 'v') => {
    const s = [0]
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1] * 3, b = run[i] * 3
      s.push(s[i - 1] + Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]))
    }
    const length = s[s.length - 1]
    const m = Math.floor(length / step)
    if (m < 3) return
    const normals: T.Vector3[] = [], owners: number[] = []
    let j = 0
    for (let i = 0; i <= m; i++) {
      const at = i * step
      while (j < run.length - 2 && s[j + 1] < at) j++
      const f = s[j + 1] > s[j] ? (at - s[j]) / (s[j + 1] - s[j]) : 0
      const a = run[j] * 3, b = run[j + 1] * 3
      normals.push(new T.Vector3(N[a] + (N[b] - N[a]) * f, N[a + 1] + (N[b + 1] - N[a + 1]) * f, N[a + 2] + (N[b + 2] - N[a + 2]) * f).normalize())
      owners.push(f < 0.5 ? run[j] : run[j + 1])
    }
    const crease = new Uint8Array(m + 1)
    for (let i = 0; i < m; i++) {
      if (normals[i].angleTo(normals[i + 1]) / step > kink) for (let d = -3; d <= 4; d++) if (i + d >= 0 && i + d <= m) crease[i + d] = 1
    }
    const name = panelName(panel[run[0]], P[run[0] * 3])
    const entry = stats.get(name) ?? { u: newStat(), v: newStat() }
    stats.set(name, entry)
    const stat = entry[dirName]
    const d2 = new T.Vector3()
    const rs = new Float32Array(m + 1).fill(-1)
    for (let i = 1; i < m; i++) {
      if (crease[i]) continue
      d2.copy(normals[i + 1]).addScaledVector(normals[i], -2).add(normals[i - 1])
      const r = d2.length() / (step * step)
      rs[i] = r
      stat.sum += r * r
      stat.n++
      stat.values.push(r)
      const k = owners[i]
      if (r > stat.worst) { stat.worst = r; stat.at = [(k % W + 0.5) * stride, (Math.floor(k / W) + 0.5) * stride] }
    }
    // Paint every sample of the run with the value of its nearest resampled station so the map has no stripes.
    for (let i = 0; i < run.length; i++) {
      const r = rs[Math.min(m, Math.max(0, Math.round(s[i] / step)))]
      const k = run[i]
      if (r < 0) { if (heat[k] === 0) heat[k] = -1; continue }
      heat[k] = Math.max(heat[k], r)
    }
  }
  for (let y = 0; y < H; y++) walk(Array.from({ length: W }, (_, x) => y * W + x), 'u')
  for (let x = 0; x < W; x++) walk(Array.from({ length: H }, (_, y) => y * W + x), 'v')

  // Ripple map: clay shading for unpainted parts, painted samples tinted from green (fair) through yellow to red
  // (1000 1/m^2 and up), blue where a declared crease or a run end leaves the paint unmeasured.
  const rgb = Buffer.alloc(W * H * 3)
  for (let k = 0; k < W * H; k++) {
    const g = shade[k]
    if (panel[k] < 0) { rgb[k * 3] = rgb[k * 3 + 1] = rgb[k * 3 + 2] = g; continue }
    // Painted but not measured (declared crease, run end or run too short): blue.
    if (heat[k] <= 0) { rgb[k * 3] = Math.round(g * 0.35); rgb[k * 3 + 1] = Math.round(g * 0.35 + 60); rgb[k * 3 + 2] = Math.round(g * 0.35 + 165); continue }
    const t = Math.min(1, Math.log10(1 + heat[k]) / 3)
    rgb[k * 3] = Math.round(g * 0.35 + 255 * Math.min(1, 2 * t) * 0.65)
    rgb[k * 3 + 1] = Math.round(g * 0.35 + 255 * Math.min(1, 2 - 2 * t) * 0.65)
    rgb[k * 3 + 2] = Math.round(g * 0.35)
  }
  const view = `${frame}-${key}`
  await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).resize(format.width, format.height, { kernel: 'nearest' }).png().toFile(join(out, `ripple-${view}.png`))
  return { view, stride, stats, format }
}

const pct = (values: number[], q: number) => {
  if (!values.length) return 0
  const sorted = Float64Array.from(values).sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}
const rms = (s: Stat) => s.n ? Math.sqrt(s.sum / s.n) : 0
const f0 = (x: number) => x.toFixed(0).padStart(7)

const lines: string[] = [
  `fairness ${label}  step ${(step * 1000).toFixed(0)} mm  crease radius ${(creaseRadius * 1000).toFixed(0)} mm  unit 1/m^2  (RMS of |n(s+h) - 2n(s) + n(s-h)| / h^2 along image rows u and columns v)`,
  `${'view'.padEnd(13)}${'panel'.padEnd(20)}${'samples'.padStart(8)}${'u rms'.padStart(7)}${'v rms'.padStart(7)}${'p95'.padStart(7)}${'worst'.padStart(7)}  at native px`,
]
const results = []
for (const frame of frames) for (const key of formatKeys) {
  const r = await measure(frame, key)
  results.push(r)
  const names = [...r.stats.keys()].sort()
  for (const name of names) {
    const { u, v } = r.stats.get(name)!
    if (u.n + v.n < 50) continue
    const all = u.values.concat(v.values)
    const worst = u.worst >= v.worst ? u : v
    lines.push(`${r.view.padEnd(13)}${name.padEnd(20)}${String(u.n + v.n).padStart(8)}${f0(rms(u))}${f0(rms(v))}${f0(pct(all, 0.95))}${f0(worst.worst)}  ${worst.at.map((n) => n.toFixed(0)).join(',')}`)
  }
}
writeFileSync(join(out, 'table.txt'), lines.join('\n') + '\n')
console.log(lines.join('\n'))

// Sheets: one row per frame, master then tall, scaled to a common height.
async function sheet(files: string[], name: string, caption: string) {
  const rowH = 540
  const tiles = await Promise.all(files.map(async (f) => {
    const img = sharp(f)
    const meta = await img.metadata()
    const w = Math.round((meta.width ?? 1) * rowH / (meta.height ?? 1))
    return { input: await img.resize(w, rowH).toBuffer(), w }
  }))
  const perRow = formatKeys.length
  const rows = Math.ceil(tiles.length / perRow)
  const rowW = Math.max(...Array.from({ length: rows }, (_, r) => tiles.slice(r * perRow, r * perRow + perRow).reduce((s, t) => s + t.w, 0)))
  const composite: OverlayOptions[] = []
  tiles.forEach((t, i) => {
    const r = Math.floor(i / perRow)
    const left = tiles.slice(r * perRow, i).reduce((s, x) => s + x.w, 0)
    composite.push({ input: t.input, left, top: 28 + r * rowH })
  })
  const text = `<svg width="${rowW}" height="28"><text x="8" y="20" font-family="sans-serif" font-size="18" fill="#ddd">${caption}</text></svg>`
  composite.push({ input: Buffer.from(text), left: 0, top: 0 })
  await sharp({ create: { width: rowW, height: 28 + rows * rowH, channels: 3, background: '#111' } }).composite(composite).jpeg({ quality: 88 }).toFile(join(out, name))
}
await sheet(results.map((r) => join(out, `ripple-${r.view}.png`)), 'ripple.jpg', `${label} ripple, green fair, red 1000 per m2, rows ${results.map((r) => r.view).join(' ')}`)

if (a.zebra === 'true') {
  const files: string[] = []
  for (const key of formatKeys) {
    const id = config.formats[key].id
    execFileSync('npx', ['tsx', 'tools/vehicle/stills.ts', '--studio', 'true', '--detail', 'full', '--format', id, '--frames', frames.join(','), '--diags', 'zebra'], { cwd: repoRoot, stdio: 'inherit' })
  }
  for (const frame of frames) for (const key of formatKeys) {
    const id = config.formats[key].id
    const src = join(workDir, 'vehicle', 'studio', `f${String(frame).padStart(5, '0')}-${id}-draft-zebra-${defaultPaint}-full.png`)
    const dst = join(out, `zebra-${frame}-${key}.png`)
    writeFileSync(dst, readFileSync(src))
    files.push(dst)
  }
  await sheet(files, 'zebra.jpg', `${label} studio zebra, rows ${frames.join(' ')}, master then tall`)
}

if (a.base) {
  const base = join(workDir, 'vehicle', 'fairness', a.base)
  for (const name of ['zebra.jpg', 'ripple.jpg']) {
    if (!existsSync(join(base, name)) || !existsSync(join(out, name))) continue
    const top = await sharp(join(base, name)).toBuffer({ resolveWithObject: true })
    const bottom = await sharp(join(out, name)).toBuffer({ resolveWithObject: true })
    const w = Math.max(top.info.width, bottom.info.width)
    await sharp({ create: { width: w, height: top.info.height + bottom.info.height, channels: 3, background: '#111' } })
      .composite([{ input: top.data, raw: top.info, left: 0, top: 0 }, { input: bottom.data, raw: bottom.info, left: 0, top: top.info.height }])
      .jpeg({ quality: 88 }).toFile(join(out, `${a.base}-vs-${name}`))
  }
}
console.log(`wrote ${out}`)
