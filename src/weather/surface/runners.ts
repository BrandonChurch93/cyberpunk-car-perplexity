import * as THREE from 'three'
import { config, type FormatSpec } from '../../config'
import type { CameraState } from '../../core/lens'
import { circleScale } from '../../core/bokeh/pupil'
import { layers } from '../../core/contract'
import { hash01, stream } from '../../core/random'
import { cameraAt } from '../../director/shots'
import { beatById } from '../../director/timeline'
import type { VehicleModule } from '../../vehicle'
import { capHeight } from './beads'
import { capTemplate } from './drop-geometry'
import type { ExtraImpact } from './ripples'

const gravity = 9.81
const paint = beatById('paint')
const wheel = beatById('wheel')
/** The hero rivulet lets go a little before the macro frame, so it is running there with its neck and bead line behind it. */
const breakLoose = config.film.macroFrameSeconds - 1.2

/** Distance the hero rivulet has run by time t, before it meets the end of its path. It sits until it lets go, then slips in short surges, as runners on wax do. */
export function rivuletTravel(t: number): number {
  const age = t - breakLoose
  if (age <= 0 || t > paint.end + 6) return 0
  const speed = 0.05
  const ramp = Math.min(age, 0.6)
  const base = 0.5 * (speed / 0.6) * ramp * ramp + speed * Math.max(0, age - 0.6)
  const surge = 0.0025 * Math.sin(age * 9) * Math.min(1, age)
  return Math.max(0, base + surge)
}
/** Drips leave the wheel arch lip at these times, in the wheel beat. */
export const archDrips = [wheel.start + 1.2, wheel.start + 2.9, wheel.start + 4.1]
const pendantGrowSeconds = 1.4
/** A drop leaving a lip carries the water that gathered along it, so it is larger than a drop hanging off a flat edge. */
const dripRadius = 0.0038
/** Arch drips seen from farther than this grow with the distance, up to the cap, so one still reads as a drop on a long lens. */
const dripReadDistance = 1.4
const dripGrowCap = 1.7
/** The arch drips hang, fall and ripple only inside this window, which the pendant growth and the wheel beat fit in. */
const archWindow = { start: archDrips[0] - pendantGrowSeconds - 0.2, end: wheel.end + 1 }
const pathStep = 0.002
const pathSteps = 160
const trailAcross = 9
/** Behind the head the trail stays a continuous neck this long, then pinches off into a line of small drops, as it does on wax. */
const trailNeck = 0.02

interface Tri {
  a: THREE.Vector3
  b: THREE.Vector3
  c: THREE.Vector3
  n: THREE.Vector3
}

export interface Drip {
  /** The lip point the drop hangs from, in world space. */
  at: THREE.Vector3
  /** Release time in seconds. Repeats every `period` when `period` is set. */
  release: number
  period: number
  floorY: number
  radius: number
}

function closestOnTriangle(p: THREE.Vector3, t: Tri, out: THREE.Vector3): void {
  new THREE.Triangle(t.a, t.b, t.c).closestPointToPoint(p, out)
}

/** The hero rivulet on the paint, the wheel arch drips and the slow drips off lower edges. */
export class Runners {
  readonly group = new THREE.Group()
  private readonly path: THREE.Vector3[] = []
  private readonly pathNormals: THREE.Vector3[] = []
  private readonly runner: THREE.InstancedMesh
  private readonly trail: THREE.Mesh
  private readonly trailBeads: THREE.InstancedMesh
  private readonly trailBeadAt: number[] = []
  readonly drips: Drip[] = []
  private arch: Drip[] | null = null
  private armed = false
  private readonly lower: Array<{ p: THREE.Vector3; n: THREE.Vector3 }> = []
  private readonly dripMesh: THREE.InstancedMesh
  private active = false

  /** `start` is where the rivulet waits on the panel, the point the macro focus rests on. */
  constructor(private readonly vehicle: VehicleModule, private readonly material: THREE.Material, plain: THREE.Material, start: THREE.Vector3, private readonly format: FormatSpec) {
    this.group.name = 'surface water runners'
    vehicle.root.updateMatrixWorld(true)
    const beadMats = new Set(vehicle.surfaces.filter((s) => s.wetness === 'beads' && !s.material.transparent).map((s) => s.material))
    const tris: Tri[] = []
    const lower = this.lower
    const v = new THREE.Vector3()
    const nrm = new THREE.Vector3()
    vehicle.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || Array.isArray(mesh.material) || (mesh as THREE.InstancedMesh).isInstancedMesh) return
      const g = mesh.geometry
      const pos = g.getAttribute('position')
      const nor = g.getAttribute('normal')
      if (!pos || !nor) return
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
      for (let i = 0; i < pos.count; i += 3) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
        nrm.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize()
        if (nrm.y < -0.2 && v.y > 0.02) lower.push({ p: v.clone(), n: nrm.clone() })
      }
      if (!beadMats.has(mesh.material)) return
      const index = g.index
      const count = index ? index.count : pos.count
      for (let k = 0; k < count; k += 3) {
        const ia = index ? index.getX(k) : k
        const ib = index ? index.getX(k + 1) : k + 1
        const ic = index ? index.getX(k + 2) : k + 2
        const a = new THREE.Vector3().fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld)
        if (a.distanceTo(start) > 0.4) continue
        const b = new THREE.Vector3().fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld)
        const c = new THREE.Vector3().fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld)
        const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a))
        if (n.lengthSq() < 1e-16) continue
        n.normalize()
        if (n.y < -0.3) continue
        tris.push({ a, b, c, n })
      }
    })
    this.tracePath(tris, start)
    // Instanced like every other drop: the lens shader shares one program variant across all of them.
    this.runner = new THREE.InstancedMesh(capTemplate(100, 9, 22), this.material, 1)
    this.runner.layers.set(layers.cameraOnly)
    this.runner.frustumCulled = false
    this.trail = new THREE.Mesh(this.trailGeometry(), plain)
    this.trail.layers.set(layers.cameraOnly)
    this.trail.frustumCulled = false
    const random = stream('surface trail beads')
    const length = Math.max(0, this.path.length - 1) * pathStep
    const stations: number[] = []
    for (let at = trailNeck * 0.5; at < length && stations.length < 220; at += random.range(0.0026, 0.0048)) stations.push(at)
    this.trailBeads = new THREE.InstancedMesh(capTemplate(100, 5, 12), this.material, Math.max(1, stations.length))
    this.trailBeads.layers.set(layers.cameraOnly)
    this.trailBeads.frustumCulled = false
    this.trailBeads.count = 0
    const m = new THREE.Matrix4()
    for (let i = 0; i < stations.length && this.path.length > 1; i++) {
      const s = stations[i]
      const at = this.pointAt(s)
      const side = this.sideAt(s)
      const n = this.normalAt(s)
      const r = random.range(0.0008, 0.0013)
      const offset = random.range(-1, 1) * 0.0005
      const p = at.clone().addScaledVector(side, offset)
      const down = new THREE.Vector3().crossVectors(n, side)
      m.makeBasis(down.multiplyScalar(r), n.clone().multiplyScalar(capHeight(r, 100)), side.clone().multiplyScalar(r)).setPosition(p)
      this.trailBeads.setMatrixAt(i, m)
      this.trailBeadAt.push(s)
    }
    this.group.add(this.runner, this.trail, this.trailBeads)
    this.findEdgeDrips()
    this.dripMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 18, 12), plain, this.drips.length + archDrips.length)
    this.dripMesh.layers.set(layers.cameraOnly)
    this.dripMesh.frustumCulled = false
    this.group.add(this.dripMesh)
  }

  private tracePath(tris: Tri[], start: THREE.Vector3): void {
    if (tris.length === 0) return
    const project = (p: THREE.Vector3): { p: THREE.Vector3; n: THREE.Vector3 } => {
      let best = Infinity
      const out = new THREE.Vector3()
      const q = new THREE.Vector3()
      let n = tris[0].n
      for (const t of tris) {
        closestOnTriangle(p, t, q)
        const d = q.distanceToSquared(p)
        if (d < best) {
          best = d
          out.copy(q)
          n = t.n
        }
      }
      return { p: out, n: n.clone() }
    }
    let { p, n } = project(start)
    const g = new THREE.Vector3(0, -1, 0)
    for (let i = 0; i < pathSteps; i++) {
      this.path.push(p.clone())
      this.pathNormals.push(n.clone())
      const down = g.clone().addScaledVector(n, -g.dot(n))
      if (down.lengthSq() < 1e-8) break
      down.normalize()
      const side = new THREE.Vector3().crossVectors(n, down).normalize()
      const wander = 0.35 * Math.sin(i * 0.21 + 1.3) * Math.sin(i * 0.057) + 0.25 * (hash01(i >> 3, 77) - 0.5)
      const step = down.multiplyScalar(pathStep).addScaledVector(side, wander * pathStep)
      const next = project(p.clone().add(step))
      if (next.p.distanceTo(p) < pathStep * 0.2) break
      p = next.p
      n = next.n
    }
  }

  /** The path as `count` points with their distance along it in w, and a sphere around all of them. */
  track(count: number): { points: THREE.Vector4[]; center: THREE.Vector3; radius: number } {
    const length = Math.max(0, (this.path.length - 1) * pathStep)
    const points = Array.from({ length: count }, (_, i) => {
      const s = (length * i) / (count - 1)
      const p = this.path.length > 0 ? this.pointAt(s) : new THREE.Vector3()
      return new THREE.Vector4(p.x, p.y, p.z, this.path.length > 1 ? s : 1e9)
    })
    const box = new THREE.Box3().setFromPoints(points.map((p) => new THREE.Vector3(p.x, p.y, p.z)))
    const center = box.getCenter(new THREE.Vector3())
    return { points, center, radius: box.getSize(new THREE.Vector3()).length() / 2 + 0.02 }
  }

  /** Distance from p to the stretch of path already swept by time t. */
  sweptDistance(p: THREE.Vector3, t: number): number {
    const s = this.travel(t)
    if (s <= 0 || this.path.length < 2) return Infinity
    const last = Math.min(this.path.length - 1, Math.ceil(s / pathStep))
    const seg = new THREE.Line3()
    const q = new THREE.Vector3()
    let best = Infinity
    for (let i = 0; i < last; i++) {
      seg.set(this.path[i], this.path[i + 1])
      seg.closestPointToPoint(p, true, q)
      best = Math.min(best, q.distanceTo(p))
    }
    return best
  }

  private pointAt(s: number): THREE.Vector3 {
    const f = THREE.MathUtils.clamp(s / pathStep, 0, this.path.length - 1.001)
    const i = Math.floor(f)
    return this.path[i].clone().lerp(this.path[Math.min(i + 1, this.path.length - 1)], f - i)
  }

  private normalAt(s: number): THREE.Vector3 {
    const i = THREE.MathUtils.clamp(Math.round(s / pathStep), 0, this.path.length - 1)
    return this.pathNormals[i].clone()
  }

  private downAt(s: number): THREE.Vector3 {
    const i = THREE.MathUtils.clamp(Math.floor(s / pathStep), 0, this.path.length - 2)
    return this.path[i + 1].clone().sub(this.path[i]).normalize()
  }

  private sideAt(s: number): THREE.Vector3 {
    return new THREE.Vector3().crossVectors(this.normalAt(s), this.downAt(s)).normalize()
  }

  private trailGeometry(): THREE.BufferGeometry {
    const positions: number[] = []
    const normals: number[] = []
    const index: number[] = []
    const width = 0.0024
    const height = 0.0010
    const across = trailAcross
    for (let i = 0; i < this.path.length; i++) {
      const s = i * pathStep
      const p = this.path[i]
      const n = this.pathNormals[i]
      const side = this.sideAt(s)
      for (let k = 0; k < across; k++) {
        const u = (k / (across - 1)) * 2 - 1
        const h = height * Math.sqrt(Math.max(0, 1 - u * u))
        positions.push(p.x + side.x * u * width + n.x * h, p.y + side.y * u * width + n.y * h, p.z + side.z * u * width + n.z * h)
        const tilt = n.clone().multiplyScalar(width * Math.sqrt(Math.max(0.02, 1 - u * u))).addScaledVector(side, u * height).normalize()
        normals.push(tilt.x, tilt.y, tilt.z)
      }
    }
    for (let i = 0; i + 1 < this.path.length; i++) {
      for (let k = 0; k + 1 < across; k++) {
        const a = i * across + k
        const b = (i + 1) * across + k
        index.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    g.setIndex(index)
    return g
  }

  /**
   * Each arch drip is placed for this format's wheel insert as it booms down, in frame where it leaves and where it lands:
   * the first leaves the upper arch lip, the second an arch lip or the outer rim flange, the third lands on the deck in front
   * of the contact patch when the deck is in frame. Placing them needs the full vehicle raycast, so it runs only in the wheel beat.
   */
  private findArchDrips(): Drip[] {
    const out: Drip[] = []
    const w = this.vehicle.anchors.wheel.position
    const tire = w.y
    const reachOf = (p: THREE.Vector3) => Math.hypot(p.y - w.y, p.z - w.z)
    const films = new Map<number, THREE.PerspectiveCamera>()
    const film = (t: number) => {
      const key = Math.round(t * 1000)
      let f = films.get(key)
      if (!f) {
        const state = cameraAt(t, this.format, this.vehicle.anchors)
        f = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan(state.sensorWidthMm / (this.format.width / this.format.height) / 2 / state.focalMm)), this.format.width / this.format.height, 0.01, 30)
        f.position.copy(state.position)
        f.quaternion.copy(state.quaternion)
        f.updateMatrixWorld(true)
        films.set(key, f)
      }
      return f
    }
    const blur = (q: THREE.Vector3, t: number) => {
      const state = cameraAt(t, this.format, this.vehicle.anchors)
      const depth = q.clone().sub(state.position).dot(new THREE.Vector3(0, 0, -1).applyQuaternion(state.quaternion))
      return circleScale(state, this.format.width) * Math.abs(1 / state.focusDistance - 1 / depth)
    }
    const ndc = new THREE.Vector3()
    const project = (q: THREE.Vector3, t: number) => ndc.copy(q).project(film(t))
    const inFrame = (q: THREE.Vector3, t: number, margin = 0.88) => {
      project(q, t)
      return Math.abs(ndc.x) < margin && Math.abs(ndc.y) < margin && ndc.z < 1
    }
    const near = this.nearWheel(w)
    const ray = new THREE.Raycaster()
    const seen = (q: THREE.Vector3, t: number) => {
      const f = film(t)
      const d = q.clone().sub(f.position)
      const length = d.length()
      ray.set(f.position, d.normalize())
      ray.far = length + 0.01
      const hit = ray.intersectObject(near, true)[0]
      return !hit || hit.distance > length - 0.006
    }
    const down = new THREE.Vector3(0, -1, 0)
    const floorBelow = (p: THREE.Vector3) => {
      ray.set(p.clone().setY(p.y - 0.006), down)
      ray.far = p.y
      const hit = ray.intersectObject(near, true)[0]
      return hit ? hit.point.y : 0
    }
    const fallTime = (height: number) => Math.sqrt((2 * Math.max(0, height)) / gravity)
    type Role = 'lip' | 'lipOrFlange' | 'deck'
    const cells = new Set<string>()
    const pool = this.lower.filter((c) => {
      if (Math.abs(c.p.z - w.z) > 0.5 || c.p.x < w.x - 0.12 || c.p.y > w.y + 0.45) return false
      const key = `${Math.round(c.p.x / 0.015)},${Math.round(c.p.y / 0.015)},${Math.round(c.p.z / 0.015)}`
      if (cells.has(key)) return false
      cells.add(key)
      return true
    })
    const place = (release: number, role: Role): Drip | null => {
      const rows: Array<{ p: THREE.Vector3; score: number }> = []
      for (const c of pool) {
        const reach = reachOf(c.p)
        const lip = reach > tire + 0.02 && reach < tire + 0.3
        const flange = c.p.x > w.x + 0.02 && reach > 0.2 && reach < tire - 0.02
        const tread = reach > tire - 0.004 && reach < tire + 0.02 && c.p.y < w.y - 0.05
        if (role === 'lip' && !(lip && c.p.y > w.y)) continue
        if (role === 'lipOrFlange' && !(lip || flange)) continue
        if (role === 'deck' && !(lip || tread)) continue
        if (out.some((d) => d.at.distanceTo(c.p) < 0.02)) continue
        if (!inFrame(c.p, release - 0.3, 0.85) || !inFrame(c.p, release, 0.85) || blur(c.p, release) > 3) continue
        project(c.p, release)
        rows.push({ p: c.p, score: -Math.abs(ndc.x) - Math.abs(ndc.y) + (lip ? 1 : 0) + (lip && c.p.z > w.z ? 0.3 : 0) })
      }
      rows.sort((x, y) => y.score - x.score)
      let best: { drip: Drip; score: number } | null = null
      let tries = 0
      for (const { p, score } of rows) {
        if (tries++ > 80) break
        if (best && score + 2.3 < best.score) break
        const floor = floorBelow(p)
        const height = p.y - floor
        if (height < 0.015) continue
        const land = new THREE.Vector3(p.x, floor + 0.004, p.z)
        const landing = release + fallTime(height)
        if (!inFrame(land, landing, 0.85) || (role === 'deck' && floor === 0 && !inFrame(land, landing + 0.15, 0.85))) continue
        if (blur(land, landing) > 3) continue
        project(land, landing)
        const total = score - 0.5 * Math.max(Math.abs(ndc.x), Math.abs(ndc.y)) + (role === 'deck' && floor === 0 ? 2 : 0) + Math.min(height, 0.3)
        if (best && total <= best.score) continue
        if (!seen(p.clone().setY(p.y - 0.004), release) || !seen(land, landing)) continue
        if (!best || total > best.score) {
          const grow = THREE.MathUtils.clamp(film(release).position.distanceTo(p) / dripReadDistance, 1, dripGrowCap)
          best = { drip: { at: p.clone().setY(p.y - 0.0005), release, period: 0, floorY: floor, radius: dripRadius * grow }, score: total }
        }
      }
      return best?.drip ?? null
    }
    const roles: Role[] = ['lip', 'lipOrFlange', 'deck']
    archDrips.forEach((release, i) => {
      const drip = place(release, roles[i]) ?? place(release, 'lipOrFlange')
      if (drip) out.push(drip)
    })
    return out
  }

  /** The vehicle triangles around the wheel, so the drip search raycasts a few thousand faces instead of the whole car. */
  private nearWheel(w: THREE.Vector3): THREE.Group {
    const box = new THREE.Box3(new THREE.Vector3(w.x - 0.4, -0.05, w.z - 0.9), new THREE.Vector3(w.x + 0.6, w.y + 1, w.z + 0.9))
    const bySide = new Map<THREE.Side, number[]>()
    const tri = new THREE.Box3()
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    this.vehicle.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || Array.isArray(mesh.material) || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.visible) return
      const pos = mesh.geometry.getAttribute('position')
      if (!pos) return
      const index = mesh.geometry.index
      const count = index ? index.count : pos.count
      let out = bySide.get(mesh.material.side)
      if (!out) bySide.set(mesh.material.side, (out = []))
      for (let k = 0; k < count; k += 3) {
        a.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(mesh.matrixWorld)
        b.fromBufferAttribute(pos, index ? index.getX(k + 1) : k + 1).applyMatrix4(mesh.matrixWorld)
        c.fromBufferAttribute(pos, index ? index.getX(k + 2) : k + 2).applyMatrix4(mesh.matrixWorld)
        if (!tri.setFromPoints([a, b, c]).intersectsBox(box)) continue
        out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
      }
    })
    const group = new THREE.Group()
    for (const [side, xyz] of bySide) {
      if (xyz.length === 0) continue
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(xyz, 3))
      group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side })))
    }
    group.updateMatrixWorld(true)
    return group
  }

  private findEdgeDrips(): void {
    const random = stream('surface edge drips')
    const pool = this.lower.filter((c) => c.n.y < -0.55 && c.p.y < 0.75 && c.p.y > 0.2)
    for (let i = 0; i < 14 && pool.length > 0; i++) {
      const c = pool[random.int(pool.length)]
      const period = config.film.durationSeconds / (5 + random.int(9))
      this.drips.push({ at: c.p.clone(), release: random.range(0, period), period, floorY: 0, radius: dripRadius })
    }
  }

  /** Size and drop of one drip at time t: hanging radius, fall distance and whether it is in the air. */
  private dripState(d: Drip, t: number): { radius: number; fall: number; stretch: number } {
    let age: number
    if (d.period > 0) {
      age = (((t - d.release) % d.period) + d.period) % d.period
      age = age > d.period - pendantGrowSeconds ? age - d.period : age
    } else {
      age = t - d.release
    }
    const full = d.radius
    if (age < 0) {
      const grow = THREE.MathUtils.smoothstep(age, -pendantGrowSeconds, 0)
      return { radius: 0.0004 + (full - 0.0004) * grow, fall: 0, stretch: 1 + 0.35 * grow }
    }
    const fall = 0.5 * gravity * age * age
    const height = d.at.y - d.floorY
    if (fall > height) return { radius: 0.0004, fall: 0, stretch: 1 }
    return { radius: full, fall, stretch: 1 + Math.min(0.25, age * 0.8) }
  }

  private allDrips(): Drip[] {
    return this.armed && this.arch ? this.drips.concat(this.arch) : this.drips
  }

  impacts(t0: number, t1: number): ExtraImpact[] {
    const out: ExtraImpact[] = []
    for (const d of this.allDrips()) {
      if (d.floorY > 0) continue
      const height = d.at.y - d.floorY
      const fallTime = Math.sqrt((2 * height) / gravity)
      const first = d.period > 0 ? Math.floor((t0 - fallTime - d.release) / d.period) : 0
      const last = d.period > 0 ? Math.floor((t1 - fallTime - d.release) / d.period) : 0
      for (let k = first; k <= last; k++) {
        const hit = d.release + k * d.period + fallTime
        if (hit >= t0 && hit <= t1) out.push({ x: d.at.x, z: d.at.z, timeSeconds: hit, diameter: 2 * d.radius })
      }
    }
    return out
  }

  beginFrame(camera: CameraState, t: number): void {
    this.armed = t > archWindow.start && t < archWindow.end
    if (this.armed && !this.arch) this.arch = this.findArchDrips()
    const near = this.path.length > 0 && camera.position.distanceTo(this.path[0]) < 1.5
    this.active = near
    this.runner.visible = near
    this.trail.visible = near
    this.trailBeads.visible = near
  }

  /** Distance traveled along the path at time t. */
  travel(t: number): number {
    return Math.min(rivuletTravel(t), Math.max(0, (this.path.length - 1) * pathStep))
  }

  beginSample(t: number): void {
    const m = new THREE.Matrix4()
    if (this.active && this.path.length > 1) {
      const s = this.travel(t)
      const grow = 1 + 0.25 * THREE.MathUtils.smoothstep(t, paint.start, breakLoose)
      const r = 0.0032 * grow
      const p = this.pointAt(s)
      const n = this.normalAt(s)
      const down = this.downAt(s)
      const side = new THREE.Vector3().crossVectors(down, n).normalize()
      const moving = s > 0 ? 1.6 : 1.1
      p.addScaledVector(down, -r * (moving - 1) * 0.5)
      m.makeBasis(down.clone().multiplyScalar(r * moving), n.clone().multiplyScalar(capHeight(r, 100)), side.multiplyScalar(r)).setPosition(p)
      this.runner.setMatrixAt(0, m)
      this.runner.instanceMatrix.needsUpdate = true
      const steps = Math.floor(s / pathStep)
      const from = Math.max(0, Math.floor((s - trailNeck) / pathStep))
      this.trail.geometry.setDrawRange(from * (trailAcross - 1) * 6, Math.max(0, steps - 1 - from) * (trailAcross - 1) * 6)
      let beads = 0
      for (let i = 0; i < this.trailBeadAt.length; i++) if (this.trailBeadAt[i] < s - trailNeck) beads = i + 1
      this.trailBeads.count = beads
    }
    const drips = this.allDrips()
    for (let i = 0; i < this.dripMesh.count; i++) {
      const d = drips[i]
      if (!d) {
        this.dripMesh.setMatrixAt(i, m.makeScale(0, 0, 0))
        continue
      }
      const st = this.dripState(d, t)
      const center = d.at.clone()
      center.y -= st.radius * st.stretch + st.fall
      m.makeScale(st.radius, st.radius * st.stretch, st.radius).setPosition(center)
      this.dripMesh.setMatrixAt(i, m)
    }
    this.dripMesh.instanceMatrix.needsUpdate = true
  }
}
