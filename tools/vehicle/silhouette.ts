import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import * as T from 'three'
import sharp from 'sharp'
import { createVehicle, type VehicleOptions } from '../../src/vehicle/index.ts'
import { defaultPaint, paintById } from '../../src/config.ts'
import { args, ensureDir, repoRoot, workDir } from '../lib/env.ts'

type Camera = (x: number, y: number, z: number) => [number, number, number]
const views: Array<{ name: string; drawing: string; camera: Camera }> = [
  { name: 'top', drawing: 'view-003.png', camera: (x, y, z) => [-z, x, y] },
  { name: 'left', drawing: 'view-004.png', camera: (x, y, z) => [-z, -y, x] },
  { name: 'front', drawing: 'view-006.png', camera: (x, y, z) => [x, -y, z] },
  { name: 'rear', drawing: 'view-007.png', camera: (x, y, z) => [-x, -y, -z] },
]

function bbox(bits: Uint8Array, w: number, h: number): [number, number, number, number] {
  let x0 = w, y0 = h, x1 = 0, y1 = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (bits[y * w + x] === 0) continue
    x0 = Math.min(x, x0); y0 = Math.min(y, y0)
    x1 = Math.max(x, x1); y1 = Math.max(y, y1)
  }
  return [x0, y0, x1, y1]
}

function morph(bits: Uint8Array, w: number, h: number, radius: number, erode = false): Uint8Array {
  const out = new Uint8Array(bits.length)
  for (let y = radius; y < h - radius; y++) for (let x = radius; x < w - radius; x++) {
    let value = erode ? 1 : 0
    for (let j = -radius; j <= radius; j++) for (let i = -radius; i <= radius; i++) {
      if (i * i + j * j > (radius + .33) ** 2) continue
      const n = bits[(y + j) * w + x + i]
      value = erode ? value & n : value | n
    }
    out[y * w + x] = value
  }
  return out
}

function floodOutline(bits: Uint8Array, w: number, h: number): Uint8Array {
  const barrier = morph(bits, w, h, 2)
  const seen = new Uint8Array(w * h)
  const queue = new Uint32Array(w * h)
  let head = 0, tail = 1
  seen[0] = 1
  const visit = (k: number) => {
    if (!(barrier[k] || seen[k])) { queue[tail++] = k; seen[k] = 1 }
  }
  while (head < tail) {
    const k = queue[head++]
    const x = k % w
    if (x > 0) visit(k - 1)
    if (x < w - 1) visit(k + 1)
    if (k >= w) visit(k - w)
    if (k < w * (h - 1)) visit(k + w)
  }
  return morph(seen.map((n) => 1 - n), w, h, 2, true)
}

async function reference(path: string) {
  const { data, info: { width: w, height: h } } = await sharp(path).flatten({ background: '#fff' }).greyscale()
    .resize({ width: 1000, withoutEnlargement: true }).extend({ top: 8, bottom: 8, left: 8, right: 8, background: '#fff' })
    .raw().toBuffer({ resolveWithObject: true })
  const lines = Uint8Array.from(data, (n) => n < 198 ? 1 : 0)
  return { lines, w, h, filled: floodOutline(lines, w, h) }
}

function projected(root: T.Object3D, camera: Camera, w: number, h: number, dimensions: [number, number, number, number]) {
  const meshes: Array<{ p: Float32Array; normals: Float32Array; indices: Uint32Array | Uint16Array | null }> = []
  const point = new T.Vector3(), normal = new T.Vector3(), matrix = new T.Matrix3()
  let x0 = Number.POSITIVE_INFINITY, x1 = Number.NEGATIVE_INFINITY, y0 = x0, y1 = x1
  let triangles = 0
  root.updateMatrixWorld(true)
  root.traverse((obj) => {
    if (!(obj instanceof T.Mesh)) return
    const positions = obj.geometry.getAttribute('position')
    const norms = obj.geometry.getAttribute('normal')
    const p = new Float32Array(positions.count * 3), normals = new Float32Array(p.length)
    matrix.getNormalMatrix(obj.matrixWorld)
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(obj.matrixWorld)
      const q = camera(point.x, point.y, point.z)
      p.set(q, i * 3)
      x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0])
      y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1])
      normal.fromBufferAttribute(norms, i).applyNormalMatrix(matrix)
      normals.set(camera(normal.x, normal.y, normal.z), i * 3)
    }
    const indices = obj.geometry.index?.array ?? null
    triangles += (indices?.length ?? positions.count) / 3
    meshes.push({ p, normals, indices })
  })
  const output = new Uint8Array(w * h)
  const shaded = new Uint8Array(w * h).fill(244)
  const depth = new Float32Array(w * h).fill(Number.NEGATIVE_INFINITY)
  const [u0, v0, u1, v1] = dimensions
  const scaleX = (u1 - u0) / (x1 - x0), scaleY = (v1 - v0) / (y1 - y0)
  for (const { p, normals, indices } of meshes) {
    const length = indices?.length ?? p.length / 3
    for (let i = 0; i < p.length; i += 3) {
      p[i] = u0 + (p[i] - x0) * scaleX
      p[i + 1] = v0 + (p[i + 1] - y0) * scaleY
    }
    for (let t = 0; t < length; t += 3) {
      const a = 3 * (indices?.[t] ?? t), b = 3 * (indices?.[t + 1] ?? (t + 1)), c = 3 * (indices?.[t + 2] ?? (t + 2))
      const ax = p[a], ay = p[a + 1], bx = p[b], by = p[b + 1], cx = p[c], cy = p[c + 1]
      const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if (Math.abs(denominator) < 1e-8) continue
      const firstX = Math.max(0, Math.ceil(Math.min(ax, bx, cx)))
      const lastX = Math.min(w - 1, Math.floor(Math.max(ax, bx, cx)))
      const firstY = Math.max(0, Math.ceil(Math.min(ay, by, cy)))
      const lastY = Math.min(h - 1, Math.floor(Math.max(ay, by, cy)))
      for (let y = firstY; y <= lastY; y++) for (let x = firstX; x <= lastX; x++) {
        const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator
        const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator
        const q = 1 - u - v
        if (u < -.00001 || v < -.00001 || q < -.00001) continue
        const index = y * w + x
        output[index] = 1
        const z = p[a + 2] * u + p[b + 2] * v + p[c + 2] * q
        if (z < depth[index]) continue
        depth[index] = z
        const l = (n: number) => normals[n] * -.37 + normals[n + 1] * -.51 + normals[n + 2] * .72
        shaded[index] = Math.round(104 + Math.max(0, l(a) * u + l(b) * v + l(c) * q) * 111)
      }
    }
  }
  return { output, shaded, triangles }
}

async function png(file: string, raw: Uint8Array, width: number, height: number, channels: 1 | 3) {
  await sharp(raw, { raw: { width, height, channels } }).png().toFile(file)
}

async function main() {
  const params = args()
  const drawings = resolve(params.drawings ?? join(repoRoot, 'reference/cache/vehicle/views'))
  const out = ensureDir(resolve(params.out ?? join(workDir, 'vehicle/silhouettes')))
  const detail: VehicleOptions['detail'] = params.detail === 'full' ? 'full' : 'blockout'
  const car = await createVehicle({ paint: paintById(defaultPaint), detail })
  for (const view of views) {
    const path = join(drawings, view.drawing)
    if (!existsSync(path)) throw new Error(`Missing ${path}. Pass the folder with the cropped grant views through --drawings.`)
    const ref = await reference(path)
    const projectedView = projected(car.root, view.camera, ref.w, ref.h, bbox(ref.filled, ref.w, ref.h))
    const { output, shaded, triangles } = projectedView
    let intersection = 0, union = 0, onlyVehicle = 0, onlyDrawing = 0
    const overlay = new Uint8Array(ref.filled.length * 3)
    for (let i = 0; i < ref.filled.length; i++) {
      const a = output[i], b = ref.filled[i]
      intersection += a & b
      union += a | b
      onlyVehicle += a & (1 - b)
      onlyDrawing += b & (1 - a)
      const s = shaded[i]
      const p = a ? b ? [s, s, s] : [s - 45, s, s + 35] : b ? [248, 182, 172] : [245, 245, 245]
      if (ref.lines[i]) { p[0] = Math.min(210, p[0]); p[1] *= .46; p[2] *= .44 }
      overlay.set(p, i * 3)
    }
    await Promise.all([
      png(join(out, `${view.name}-overlay.png`), overlay, ref.w, ref.h, 3),
      png(join(out, `${view.name}-model.png`), shaded, ref.w, ref.h, 1),
      png(join(out, `${view.name}-drawing.png`), ref.filled.map((n) => 255 * n), ref.w, ref.h, 1),
    ])
    console.log(`${detail} ${view.name}: ${(intersection / union).toFixed(4)} IoU, ${onlyVehicle} vehicle-only pixels, ${onlyDrawing} drawing-only pixels, ${triangles} triangles`)
  }
}

void main().catch((cause: unknown) => { console.error(cause); process.exitCode = 1 })
