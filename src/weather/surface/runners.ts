import * as THREE from 'three'
import { config } from '../../config'
import type { CameraState } from '../../core/lens'
import { layers } from '../../core/contract'
import { hash01, stream } from '../../core/random'
import { beatById } from '../../director/timeline'
import type { VehicleModule } from '../../vehicle'
import { capHeight } from './beads'
import { capTemplate } from './drop-geometry'
import type { ExtraImpact } from './ripples'

const gravity = 9.81
const paint = beatById('paint')
const wheel = beatById('wheel')
/** The hero rivulet lets go three seconds into the paint beat, at the macro frame. */
const breakLoose = config.film.macroFrameSeconds
/** Drips leave the wheel arch lip at these times, in the wheel beat. */
export const archDrips = [wheel.start + 1.2, wheel.start + 2.9, wheel.start + 4.1]
const pendantGrowSeconds = 1.4
const pathStep = 0.002
const pathSteps = 160

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
}

function closestOnTriangle(p: THREE.Vector3, t: Tri, out: THREE.Vector3): void {
  new THREE.Triangle(t.a, t.b, t.c).closestPointToPoint(p, out)
}

/** The hero rivulet on the paint, the wheel arch drips and the slow drips off lower edges. */
export class Runners {
  readonly group = new THREE.Group()
  private readonly path: THREE.Vector3[] = []
  private readonly pathNormals: THREE.Vector3[] = []
  private readonly runner: THREE.Mesh
  private readonly trail: THREE.Mesh
  private readonly trailBeads: THREE.InstancedMesh
  private readonly trailBeadAt: number[] = []
  readonly drips: Drip[] = []
  private readonly dripMesh: THREE.InstancedMesh
  private active = false

  /** `start` is where the rivulet waits on the panel: in the macro frame, at the depth the focus pull lands on. */
  constructor(vehicle: VehicleModule, private readonly material: THREE.Material, plain: THREE.Material, start: THREE.Vector3) {
    this.group.name = 'surface water runners'
    vehicle.root.updateMatrixWorld(true)
    const beadMats = new Set(vehicle.surfaces.filter((s) => s.wetness === 'beads' && !s.material.transparent).map((s) => s.material))
    const tris: Tri[] = []
    const lower: Array<{ p: THREE.Vector3; n: THREE.Vector3 }> = []
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
        if (nrm.y < -0.55 && v.y > 0.12) lower.push({ p: v.clone(), n: nrm.clone() })
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
        if (n.y < 0.15) continue
        tris.push({ a, b, c, n })
      }
    })
    this.tracePath(tris, start)
    this.runner = new THREE.Mesh(capTemplate(100, 9, 22), this.material)
    this.runner.layers.set(layers.cameraOnly)
    this.runner.matrixAutoUpdate = false
    this.runner.frustumCulled = false
    this.trail = new THREE.Mesh(this.trailGeometry(), plain)
    this.trail.layers.set(layers.cameraOnly)
    this.trail.frustumCulled = false
    const random = stream('surface trail beads')
    const beadCount = 90
    this.trailBeads = new THREE.InstancedMesh(capTemplate(100, 4, 10), this.material, beadCount)
    this.trailBeads.layers.set(layers.cameraOnly)
    this.trailBeads.frustumCulled = false
    const m = new THREE.Matrix4()
    const stations = Array.from({ length: beadCount }, () => random.range(0.004, 1) * Math.max(0, this.path.length - 1) * pathStep).sort((a, b) => a - b)
    for (let i = 0; i < beadCount && this.path.length > 1; i++) {
      const s = stations[i]
      const at = this.pointAt(s)
      const side = this.sideAt(s)
      const n = this.normalAt(s)
      const r = random.range(0.00012, 0.0003)
      const offset = random.range(-1, 1) * 0.0011
      const p = at.clone().addScaledVector(side, offset)
      const down = new THREE.Vector3().crossVectors(n, side)
      m.makeBasis(down.multiplyScalar(r), n.clone().multiplyScalar(capHeight(r, 100)), side.clone().multiplyScalar(r)).setPosition(p)
      this.trailBeads.setMatrixAt(i, m)
      this.trailBeadAt.push(s)
    }
    this.group.add(this.runner, this.trail, this.trailBeads)
    this.findDrips(lower, vehicle)
    this.dripMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 18, 12), plain, this.drips.length)
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
    const width = 0.0011
    const height = 0.00022
    const across = 5
    for (let i = 0; i < this.path.length; i++) {
      const s = i * pathStep
      const p = this.path[i]
      const n = this.pathNormals[i]
      const side = this.sideAt(s)
      for (let k = 0; k < across; k++) {
        const u = (k / (across - 1)) * 2 - 1
        const h = height * Math.sqrt(Math.max(0, 1 - u * u))
        positions.push(p.x + side.x * u * width + n.x * h, p.y + side.y * u * width + n.y * h, p.z + side.z * u * width + n.z * h)
        const tilt = n.clone().addScaledVector(side, u * 0.5).normalize()
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

  private findDrips(lower: Array<{ p: THREE.Vector3; n: THREE.Vector3 }>, vehicle: VehicleModule): void {
    const w = vehicle.anchors.wheel
    const arch = lower.filter((c) => Math.abs(c.p.z - w.position.z) < 0.5 && c.p.y > w.position.y + 0.15 && c.p.x > w.position.x - 0.12)
    const floorY = 0
    for (const [i, release] of archDrips.entries()) {
      const targetZ = w.position.z + [-0.34, 0.33, -0.27][i]
      let best: THREE.Vector3 | null = null
      let score = Infinity
      for (const c of arch) {
        const s = Math.abs(c.p.z - targetZ) * 3 - c.p.x
        if (s < score) {
          score = s
          best = c.p
        }
      }
      if (best) this.drips.push({ at: best.clone().add(new THREE.Vector3(0, -0.0005, 0)), release, period: 0, floorY })
    }
    const random = stream('surface edge drips')
    const pool = lower.filter((c) => c.p.y < 0.75 && c.p.y > 0.2)
    for (let i = 0; i < 14 && pool.length > 0; i++) {
      const c = pool[random.int(pool.length)]
      const period = config.film.durationSeconds / (5 + random.int(9))
      this.drips.push({ at: c.p.clone(), release: random.range(0, period), period, floorY })
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
    const full = 0.0021
    if (age < 0) {
      const grow = THREE.MathUtils.smoothstep(age, -pendantGrowSeconds, 0)
      return { radius: 0.0004 + (full - 0.0004) * grow, fall: 0, stretch: 1 + 0.35 * grow }
    }
    const fall = 0.5 * gravity * age * age
    const height = d.at.y - d.floorY
    if (fall > height) return { radius: 0.0004, fall: 0, stretch: 1 }
    return { radius: full, fall, stretch: 1 + Math.min(0.25, age * 0.8) }
  }

  impacts(t0: number, t1: number): ExtraImpact[] {
    const out: ExtraImpact[] = []
    for (const d of this.drips) {
      const height = d.at.y - d.floorY
      const fallTime = Math.sqrt((2 * height) / gravity)
      const first = d.period > 0 ? Math.floor((t0 - fallTime - d.release) / d.period) : 0
      const last = d.period > 0 ? Math.floor((t1 - fallTime - d.release) / d.period) : 0
      for (let k = first; k <= last; k++) {
        const hit = d.release + k * d.period + fallTime
        if (hit >= t0 && hit <= t1) out.push({ x: d.at.x, z: d.at.z, timeSeconds: hit, diameter: 0.0042 })
      }
    }
    return out
  }

  beginFrame(camera: CameraState): void {
    const near = this.path.length > 0 && camera.position.distanceTo(this.path[0]) < 1.5
    this.active = near
    this.runner.visible = near
    this.trail.visible = near
    this.trailBeads.visible = near
  }

  /** Distance traveled along the path at time t. It sits until it lets go, then slips in short surges, as runners on wax do. */
  travel(t: number): number {
    const age = t - breakLoose
    if (age <= 0 || t > paint.end + 6) return 0
    const speed = 0.03
    const ramp = Math.min(age, 0.6)
    const base = 0.5 * (speed / 0.6) * ramp * ramp + speed * Math.max(0, age - 0.6)
    const surge = 0.0025 * Math.sin(age * 9) * Math.min(1, age)
    return Math.max(0, Math.min(base + surge, (this.path.length - 1) * pathStep))
  }

  beginSample(t: number): void {
    const m = new THREE.Matrix4()
    if (this.active && this.path.length > 1) {
      const s = this.travel(t)
      const grow = 1 + 0.25 * THREE.MathUtils.smoothstep(t, paint.start, breakLoose)
      const r = 0.0024 * grow
      const p = this.pointAt(s)
      const n = this.normalAt(s)
      const down = this.downAt(s)
      const side = new THREE.Vector3().crossVectors(down, n).normalize()
      const moving = s > 0 ? 1.45 : 1.1
      p.addScaledVector(down, -r * (moving - 1) * 0.5)
      m.makeBasis(down.clone().multiplyScalar(r * moving), n.clone().multiplyScalar(capHeight(r, 100)), side.multiplyScalar(r)).setPosition(p)
      this.runner.matrix.copy(m)
      this.runner.matrixWorldNeedsUpdate = true
      const steps = Math.floor(s / pathStep)
      this.trail.geometry.setDrawRange(0, Math.max(0, steps - 1) * 4 * 6)
      let beads = 0
      for (let i = 0; i < this.trailBeadAt.length; i++) if (this.trailBeadAt[i] < s - 0.004) beads = i + 1
      this.trailBeads.count = beads
    }
    for (let i = 0; i < this.drips.length; i++) {
      const d = this.drips[i]
      const st = this.dripState(d, t)
      const center = d.at.clone()
      center.y -= st.radius * st.stretch + st.fall
      m.makeScale(st.radius, st.radius * st.stretch, st.radius).setPosition(center)
      this.dripMesh.setMatrixAt(i, m)
    }
    this.dripMesh.instanceMatrix.needsUpdate = true
  }
}
