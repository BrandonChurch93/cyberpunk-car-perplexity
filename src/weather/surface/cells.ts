import * as THREE from 'three'
import { layers } from '../../core/contract'
import { stream } from '../../core/random'
import type { VehicleModule } from '../../vehicle'
import { capHeight } from './beads'
import { capTemplate } from './drop-geometry'

const pixel = 0.00025
const reachLimit = 0.3

interface Cell {
  center: THREE.Vector2
  apothem: number
}

/**
 * Water held by the perforated grille at the detail anchor. The plate has no wetness class of its own, so its open cells are
 * found by drawing its top faces into a bitmap, and drops are set into a share of them: a drop bridging a downhill corner,
 * and small beads on the nodes where three bars meet. No drop spans a whole cell, as a cell is wider than water can bridge.
 */
export class CellDrops {
  readonly group = new THREE.Group()
  private readonly anchor: THREE.Vector3

  constructor(vehicle: VehicleModule, lens: THREE.Material) {
    this.group.name = 'surface water grille cells'
    this.group.visible = false
    const { position, normal } = vehicle.anchors.detail
    this.anchor = position.clone()
    vehicle.root.updateMatrixWorld(true)
    const plate = this.plateMesh(vehicle, normal.clone().normalize())
    if (!plate) return
    // The anchor sits near the plate, not on its wet face: water stands on the top face, in that face's own plane.
    const n = this.topFace(plate, normal.clone().normalize())
    const along = new THREE.Vector3(0, 0, -1).addScaledVector(n, n.z).normalize()
    const across = along.clone().cross(n)
    const { cells, pitch, corner } = this.findCells(plate, n, along, across)
    if (cells.length === 0) return
    const downhill = new THREE.Vector3(0, -1, 0).addScaledVector(n, n.y)
    const down2 = new THREE.Vector2(downhill.dot(along), downhill.dot(across))
    if (down2.lengthSq() > 1e-10) down2.normalize()
    const random = stream('surface grille cell drops')
    const world = (q: THREE.Vector2, lift: number) => this.anchor.clone().addScaledVector(along, q.x).addScaledVector(across, q.y).addScaledVector(n, lift)
    const m = new THREE.Matrix4()
    const corners: THREE.Matrix4[] = []
    const nodes: THREE.Matrix4[] = []
    const seenNodes = new Set<string>()
    const seenBars = new Set<string>()
    const bar = Math.max(pitch - 2 * cells[0].apothem, 0.0004)
    const basis = (q: THREE.Vector2, lift: number, r: number, h: number) => m.clone().makeBasis(along.clone().multiplyScalar(r), n.clone().multiplyScalar(h), across.clone().multiplyScalar(r)).setPosition(world(q, lift))
    for (const cell of cells) {
      const radius = (2 * cell.apothem) / Math.sqrt(3)
      const roll = random.next()
      if (roll < 0.22) {
        const ranked = Array.from({ length: 6 }, (_, k) => corner + (k * Math.PI) / 3)
          .map((a) => ({ a, d: Math.cos(a) * down2.x + Math.sin(a) * down2.y + random.range(-0.6, 0.6) }))
          .sort((x, y) => y.d - x.d)
        const a = ranked[0].a
        const r = random.range(0.0011, 0.0019)
        const q = cell.center.clone().add(new THREE.Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(radius - 0.55 * r))
        corners.push(basis(q, -0.0003, r, capHeight(r, 100)))
      }
      for (let k = 0; k < 6; k++) {
        const a = corner + (k * Math.PI) / 3
        const q = cell.center.clone().add(new THREE.Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(pitch / Math.sqrt(3)))
        const key = `${Math.round(q.x / 0.001)},${Math.round(q.y / 0.001)}`
        if (seenNodes.has(key)) continue
        seenNodes.add(key)
        if (random.next() > 0.5) continue
        const r = random.range(0.0007, 0.0011)
        nodes.push(basis(q, 0, r, capHeight(r, 100)))
      }
      for (let k = 0; k < 6; k++) {
        const a = corner + Math.PI / 6 + (k * Math.PI) / 3
        const dir = new THREE.Vector2(Math.cos(a), Math.sin(a))
        const mid = cell.center.clone().addScaledVector(dir, pitch / 2)
        const key = `${Math.round(mid.x / 0.001)},${Math.round(mid.y / 0.001)}`
        if (seenBars.has(key)) continue
        seenBars.add(key)
        const tangent = new THREE.Vector2(-dir.y, dir.x)
        for (let j = Math.floor(random.range(0, 2.6)); j > 0; j--) {
          const r = Math.min(random.range(0.0005, 0.0009), 0.6 * bar)
          const q = mid.clone().addScaledVector(tangent, random.range(-0.4, 0.4) * radius).addScaledVector(dir, random.range(-0.25, 0.25) * bar)
          nodes.push(basis(q, 0, r, capHeight(r, 100)))
        }
      }
    }
    const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, list: THREE.Matrix4[]) => {
      if (list.length === 0) return
      const mesh = new THREE.InstancedMesh(geometry, material, list.length)
      list.forEach((x, i) => mesh.setMatrixAt(i, x))
      mesh.layers.set(layers.cameraOnly)
      mesh.frustumCulled = false
      this.group.add(mesh)
    }
    instanced(capTemplate(100, 8, 20), lens, corners)
    instanced(capTemplate(100, 5, 12), lens, nodes)
  }

  /** Shown only while the lens is close enough to resolve the cells. */
  beginFrame(cameraPosition: THREE.Vector3): void {
    this.group.visible = this.group.children.length > 0 && cameraPosition.distanceTo(this.anchor) < 1.4
  }

  private plateMesh(vehicle: VehicleModule, n: THREE.Vector3): THREE.Mesh | null {
    const ray = new THREE.Raycaster(this.anchor.clone().addScaledVector(n, 0.02), n.clone().negate(), 0, 0.04)
    const hit = ray.intersectObject(vehicle.root, true)[0]
    return hit ? (hit.object as THREE.Mesh) : null
  }

  private topFace(mesh: THREE.Mesh, near: THREE.Vector3): THREE.Vector3 {
    const pos = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.index
    const count = index ? index.count : pos.count
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const face = new THREE.Vector3()
    const sum = new THREE.Vector3()
    const lifts: Array<{ at: THREE.Vector3; area: number; lift: number }> = []
    for (let k = 0; k < count; k += 3) {
      a.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(mesh.matrixWorld)
      if (a.distanceTo(this.anchor) > reachLimit) continue
      b.fromBufferAttribute(pos, index ? index.getX(k + 1) : k + 1).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(pos, index ? index.getX(k + 2) : k + 2).applyMatrix4(mesh.matrixWorld)
      face.crossVectors(b.clone().sub(a), c.clone().sub(a))
      const area = face.length()
      if (area < 1e-16 || face.dot(near) < 0.95 * area) continue
      sum.add(face)
      lifts.push({ at: a.clone().sub(this.anchor), area, lift: 0 })
    }
    if (lifts.length === 0) return near
    const n = sum.normalize()
    for (const l of lifts) l.lift = l.at.dot(n)
    lifts.sort((x, y) => x.lift - y.lift)
    const total = lifts.reduce((t, l) => t + l.area, 0)
    let acc = 0
    const middle = lifts.find((l) => (acc += l.area) >= total / 2) ?? lifts[0]
    this.anchor.addScaledVector(n, middle.lift)
    return n
  }

  private findCells(mesh: THREE.Mesh, n: THREE.Vector3, along: THREE.Vector3, across: THREE.Vector3): { cells: Cell[]; pitch: number; corner: number } {
    const pos = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.index
    const count = index ? index.count : pos.count
    const tris: number[] = []
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const face = new THREE.Vector3()
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity
    for (let k = 0; k < count; k += 3) {
      a.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(mesh.matrixWorld)
      if (a.distanceTo(this.anchor) > reachLimit) continue
      b.fromBufferAttribute(pos, index ? index.getX(k + 1) : k + 1).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(pos, index ? index.getX(k + 2) : k + 2).applyMatrix4(mesh.matrixWorld)
      face.crossVectors(b.clone().sub(a), c.clone().sub(a))
      if (face.lengthSq() < 1e-16 || Math.abs(face.normalize().dot(n)) < 0.95) continue
      if (Math.abs(a.clone().sub(this.anchor).dot(n)) > 0.001) continue
      for (const p of [a, b, c]) {
        const d = p.clone().sub(this.anchor)
        const u = d.dot(along)
        const v = d.dot(across)
        tris.push(u, v)
        minU = Math.min(minU, u)
        maxU = Math.max(maxU, u)
        minV = Math.min(minV, v)
        maxV = Math.max(maxV, v)
      }
    }
    if (tris.length === 0) return { cells: [], pitch: 0, corner: 0 }
    const w = Math.ceil((maxU - minU) / pixel) + 3
    const h = Math.ceil((maxV - minV) / pixel) + 3
    const solid = new Uint8Array(w * h)
    const px = (u: number) => (u - minU) / pixel + 1
    const py = (v: number) => (v - minV) / pixel + 1
    for (let i = 0; i < tris.length; i += 6) {
      const x0 = px(tris[i]), y0 = py(tris[i + 1]), x1 = px(tris[i + 2]), y1 = py(tris[i + 3]), x2 = px(tris[i + 4]), y2 = py(tris[i + 5])
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
      if (Math.abs(area) < 1e-9) continue
      for (let y = Math.max(0, Math.floor(Math.min(y0, y1, y2))); y <= Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2))); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(x0, x1, x2))); x <= Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2))); x++) {
          const sx = x + 0.5, sy = y + 0.5
          const e0 = ((x1 - x0) * (sy - y0) - (sx - x0) * (y1 - y0)) / area
          const e1 = ((x2 - x1) * (sy - y1) - (sx - x1) * (y2 - y1)) / area
          const e2 = ((x0 - x2) * (sy - y2) - (sx - x2) * (y0 - y2)) / area
          if (e0 >= -0.02 && e1 >= -0.02 && e2 >= -0.02) solid[y * w + x] = 1
        }
      }
    }
    const label = new Int32Array(w * h).fill(-1)
    const found: Array<{ u: number; v: number; area: number; far: number; farX: number; farY: number }> = []
    const queue = new Int32Array(w * h)
    for (let start = 0; start < w * h; start++) {
      if (solid[start] || label[start] >= 0) continue
      let head = 0, tail = 0, sumX = 0, sumY = 0, touches = false
      const pixels: number[] = []
      queue[tail++] = start
      label[start] = found.length
      while (head < tail) {
        const i = queue[head++]
        const x = i % w, y = (i - x) / w
        pixels.push(i)
        sumX += x
        sumY += y
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j < 0 || solid[j] || label[j] >= 0) continue
          label[j] = found.length
          queue[tail++] = j
        }
      }
      const cx = sumX / pixels.length, cy = sumY / pixels.length
      let far = 0, farX = 0, farY = 0
      for (const i of pixels) {
        const x = (i % w) - cx, y = Math.floor(i / w) - cy
        const d = x * x + y * y
        if (d > far) {
          far = d
          farX = x
          farY = y
        }
      }
      found.push({ u: (cx + 0.5 - 1) * pixel + minU, v: (cy + 0.5 - 1) * pixel + minV, area: touches ? -1 : pixels.length, far, farX, farY })
    }
    const sizes = found.filter((f) => f.area > 0).map((f) => f.area).sort((x, y) => x - y)
    if (sizes.length < 7) return { cells: [], pitch: 0, corner: 0 }
    const median = sizes[sizes.length >> 1]
    const holes = found.filter((f) => f.area > 0.6 * median && f.area < 1.4 * median)
    const apothem = Math.sqrt((median * pixel * pixel) / (2 * Math.sqrt(3)))
    let pitch = Infinity
    for (let i = 1; i < holes.length; i++) pitch = Math.min(pitch, Math.hypot(holes[i].u - holes[0].u, holes[i].v - holes[0].v))
    let sx = 0, sy = 0
    for (const f of holes) {
      const angle = 6 * Math.atan2(f.farY, f.farX)
      sx += Math.cos(angle)
      sy += Math.sin(angle)
    }
    const corner = Math.atan2(sy, sx) / 6
    return { cells: holes.map((f) => ({ center: new THREE.Vector2(f.u, f.v), apothem })), pitch, corner }
  }
}
