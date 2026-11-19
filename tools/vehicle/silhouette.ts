import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import * as THREE from 'three'
import { config, defaultPaint, paintById } from '../../src/config.ts'
import { createVehicle, type VehicleDetail } from '../../src/vehicle/index.ts'
import { args, ensureDir, repoRoot, workDir } from '../lib/env.ts'

interface ViewSpec {
  id: 'top' | 'side' | 'front' | 'rear'
  file: string
  project(p: THREE.Vector3): [number, number, number]
  projectNormal(n: THREE.Vector3): [number, number, number]
}

const views: ViewSpec[] = [
  {
    id: 'top',
    file: 'view-003.png',
    project: (p) => [-p.z, p.x, p.y],
    projectNormal: (n) => [-n.z, n.x, n.y],
  },
  {
    id: 'side',
    file: 'view-004.png',
    project: (p) => [-p.z, -p.y, p.x],
    projectNormal: (n) => [-n.z, -n.y, n.x],
  },
  {
    id: 'front',
    file: 'view-006.png',
    project: (p) => [p.x, -p.y, p.z],
    projectNormal: (n) => [n.x, -n.y, n.z],
  },
  {
    id: 'rear',
    file: 'view-007.png',
    project: (p) => [-p.x, -p.y, -p.z],
    projectNormal: (n) => [-n.x, -n.y, -n.z],
  },
]

interface MaskData {
  width: number
  height: number
  ink: Uint8Array
  filled: Uint8Array
  x0: number
  x1: number
  y0: number
  y1: number
}

function morphClose5(src: Uint8Array, w: number, h: number): Uint8Array {
  const dil = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const yMin = Math.max(0, y - 2)
    const yMax = Math.min(h - 1, y + 2)
    for (let x = 0; x < w; x++) {
      const xMin = Math.max(0, x - 2)
      const xMax = Math.min(w - 1, x + 2)
      let hit = 0
      for (let yy = yMin; yy <= yMax && !hit; yy++) {
        const row = yy * w
        for (let xx = xMin; xx <= xMax; xx++) {
          if (src[row + xx]) {
            hit = 1
            break
          }
        }
      }
      dil[y * w + x] = hit
    }
  }
  const ero = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < 2 || x >= w - 2 || y < 2 || y >= h - 2) {
        ero[y * w + x] = dil[y * w + x]
        continue
      }
      let all = 1
      for (let yy = y - 2; yy <= y + 2 && all; yy++) {
        const row = yy * w
        for (let xx = x - 2; xx <= x + 2; xx++) {
          if (!dil[row + xx]) {
            all = 0
            break
          }
        }
      }
      ero[y * w + x] = all
    }
  }
  return ero
}

async function loadGrantMask(filePath: string): Promise<MaskData> {
  const { data, info } = await sharp(filePath).greyscale().raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) ink[i] = data[i] < 220 ? 1 : 0
  const closed = morphClose5(ink, w, h)
  const pw = w + 4
  const ph = h + 4
  const outside = new Uint8Array(pw * ph)
  const queue = new Int32Array(pw * ph)
  let head = 0
  let tail = 0
  outside[0] = 1
  queue[tail++] = 0
  while (head < tail) {
    const cur = queue[head++]
    const cx = cur % pw
    const cy = (cur - cx) / pw
    const neighbors = [
      cx > 0 ? cur - 1 : -1,
      cx + 1 < pw ? cur + 1 : -1,
      cy > 0 ? cur - pw : -1,
      cy + 1 < ph ? cur + pw : -1,
    ]
    for (const nb of neighbors) {
      if (nb < 0 || outside[nb]) continue
      const nx = (nb % pw) - 2
      const ny = Math.floor(nb / pw) - 2
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && closed[ny * w + nx]) continue
      outside[nb] = 1
      queue[tail++] = nb
    }
  }
  const filled = new Uint8Array(w * h)
  let x0 = w
  let x1 = 0
  let y0 = h
  let y1 = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = outside[(y + 2) * pw + (x + 2)] ? 0 : 1
      filled[y * w + x] = inside
      if (inside) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return { width: w, height: h, ink, filled, x0, x1, y0, y1 }
}

interface Tri {
  ax: number; ay: number; az: number
  bx: number; by: number; bz: number
  cx: number; cy: number; cz: number
  nx: number; ny: number; nz: number
}

function collectWorldTriangles(root: THREE.Object3D): { tris: Tri[]; bodyBox: THREE.Box3; fullBox: THREE.Box3; meshCount: number } {
  root.updateWorldMatrix(true, true)
  const tris: Tri[] = []
  const fullBox = new THREE.Box3()
  const bodyBox = new THREE.Box3()
  let meshCount = 0
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const vc = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const fn = new THREE.Vector3()

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.visible) return
    const geom = obj.geometry as THREE.BufferGeometry
    const pos = geom.getAttribute('position')
    if (!pos) return
    meshCount++
    let isMirror = false
    let cur: THREE.Object3D | null = obj
    while (cur) {
      if (cur.name.includes('mirror')) {
        isMirror = true
        break
      }
      cur = cur.parent
    }
    const mat = obj.matrixWorld
    for (let i = 0; i < pos.count; i++) {
      va.fromBufferAttribute(pos, i).applyMatrix4(mat)
      fullBox.expandByPoint(va)
      if (!isMirror) bodyBox.expandByPoint(va)
    }
    const index = geom.getIndex()
    const triCount = index ? index.count / 3 : pos.count / 3
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
      va.fromBufferAttribute(pos, i0).applyMatrix4(mat)
      vb.fromBufferAttribute(pos, i1).applyMatrix4(mat)
      vc.fromBufferAttribute(pos, i2).applyMatrix4(mat)
      e1.subVectors(vb, va)
      e2.subVectors(vc, va)
      fn.crossVectors(e1, e2)
      const len = fn.length()
      if (len < 1e-12) continue
      fn.divideScalar(len)
      tris.push({
        ax: va.x, ay: va.y, az: va.z,
        bx: vb.x, by: vb.y, bz: vb.z,
        cx: vc.x, cy: vc.y, cz: vc.z,
        nx: fn.x, ny: fn.y, nz: fn.z,
      })
    }
  })
  return { tris, bodyBox, fullBox, meshCount }
}

function renderOrthoView(
  tris: Tri[],
  spec: ViewSpec,
  mask: MaskData,
): { iou: number; modelMask: Uint8Array; shade: Uint8Array; aspectRatioDiffPct: number } {
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity

  const projected = new Float32Array(tris.length * 10)
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i]
    p.set(t.ax, t.ay, t.az)
    const [au, av, ad] = spec.project(p)
    p.set(t.bx, t.by, t.bz)
    const [bu, bv, bd] = spec.project(p)
    p.set(t.cx, t.cy, t.cz)
    const [cu, cv, cd] = spec.project(p)
    n.set(t.nx, t.ny, t.nz)
    const [nu, nv, nd] = spec.projectNormal(n)
    const light = Math.min(1, Math.max(0.15, 0.25 + 0.55 * Math.abs(nd) + 0.2 * Math.max(0, -nv) + 0.1 * Math.max(0, -nu)))
    const base = i * 10
    projected[base] = au; projected[base + 1] = av; projected[base + 2] = ad
    projected[base + 3] = bu; projected[base + 4] = bv; projected[base + 5] = bd
    projected[base + 6] = cu; projected[base + 7] = cv; projected[base + 8] = cd
    projected[base + 9] = light
    if (au < u0) u0 = au; if (au > u1) u1 = au
    if (bu < u0) u0 = bu; if (bu > u1) u1 = bu
    if (cu < u0) u0 = cu; if (cu > u1) u1 = cu
    if (av < v0) v0 = av; if (av > v1) v1 = av
    if (bv < v0) v0 = bv; if (bv > v1) v1 = bv
    if (cv < v0) v0 = cv; if (cv > v1) v1 = cv
  }

  const w = mask.width
  const h = mask.height
  const gxSpan = Math.max(1, mask.x1 - mask.x0)
  const gySpan = Math.max(1, mask.y1 - mask.y0)
  const uSpan = Math.max(1e-6, u1 - u0)
  const vSpan = Math.max(1e-6, v1 - v0)
  const aspectRatioDiffPct = ((uSpan / vSpan) / (gxSpan / gySpan) - 1) * 100

  const zbuf = new Float32Array(w * h).fill(-Infinity)
  const modelMask = new Uint8Array(w * h)
  const shade = new Uint8Array(w * h).fill(248)

  const scaleX = gxSpan / uSpan
  const scaleY = gySpan / vSpan

  for (let i = 0; i < tris.length; i++) {
    const base = i * 10
    const x0 = mask.x0 + (projected[base] - u0) * scaleX
    const y0 = mask.y0 + (projected[base + 1] - v0) * scaleY
    const z0 = projected[base + 2]
    const x1 = mask.x0 + (projected[base + 3] - u0) * scaleX
    const y1 = mask.y0 + (projected[base + 4] - v0) * scaleY
    const z1 = projected[base + 5]
    const x2 = mask.x0 + (projected[base + 6] - u0) * scaleX
    const y2 = mask.y0 + (projected[base + 7] - v0) * scaleY
    const z2 = projected[base + 8]
    const lum = Math.round(projected[base + 9] * 215)

    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
    const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)))
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
    const maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)))
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    if (Math.abs(area) < 1e-6) continue
    const invArea = 1 / area

    for (let py = minY; py <= maxY; py++) {
      const cy = py + 0.5
      const row = py * w
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5
        const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) * invArea
        if (w0 < -1e-4) continue
        const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) * invArea
        if (w1 < -1e-4) continue
        const w2 = 1 - w0 - w1
        if (w2 < -1e-4) continue
        const z = w0 * z0 + w1 * z1 + w2 * z2
        const idx = row + px
        modelMask[idx] = 1
        if (z > zbuf[idx]) {
          zbuf[idx] = z
          shade[idx] = lum
        }
      }
    }
  }

  let inter = 0
  let union = 0
  for (let i = 0; i < w * h; i++) {
    const a = modelMask[i]
    const b = mask.filled[i]
    if (a & b) inter++
    if (a | b) union++
  }
  return { iou: union > 0 ? inter / union : 0, modelMask, shade, aspectRatioDiffPct }
}

async function main(): Promise<void> {
  const a = args()
  const detail = (a.detail === 'full' ? 'full' : 'blockout') as VehicleDetail
  const viewsDir = a.views ?? join(repoRoot, 'reference', 'cache', 'vehicle', 'views')
  const outDir = ensureDir(join(workDir, 'vehicle-silhouette'))

  const vehicle = await createVehicle({ paint: paintById(defaultPaint), detail })
  const { tris, bodyBox, fullBox, meshCount } = collectWorldTriangles(vehicle.root)
  const bodySize = bodyBox.getSize(new THREE.Vector3())
  const fullSize = fullBox.getSize(new THREE.Vector3())

  console.log(`detail: ${detail}, meshes: ${meshCount}, triangles: ${tris.length}`)
  console.log(`full bbox (m): length=${fullSize.z.toFixed(4)}, widthWithMirrors=${fullSize.x.toFixed(4)}, height=${fullSize.y.toFixed(4)}, minY=${fullBox.min.y.toFixed(4)}`)
  console.log(`body bbox (m): length=${bodySize.z.toFixed(4)}, widthNoMirrors=${bodySize.x.toFixed(4)}, height=${bodySize.y.toFixed(4)}`)

  const summaryImages: Buffer[] = []
  const results: Record<string, number> = {}

  for (const spec of views) {
    const filePath = join(viewsDir, spec.file)
    if (!existsSync(filePath)) throw new Error(`missing reference drawing ${filePath}`)
    const mask = await loadGrantMask(filePath)
    const { iou, modelMask, shade, aspectRatioDiffPct } = renderOrthoView(tris, spec, mask)
    results[spec.id] = iou
    console.log(`${spec.id.padEnd(5)} IoU = ${iou.toFixed(4)}  (aspect diff ${aspectRatioDiffPct >= 0 ? '+' : ''}${aspectRatioDiffPct.toFixed(2)}%)`)

    const w = mask.width
    const h = mask.height
    const overlayRgb = new Uint8Array(w * h * 3)
    const diffRgb = new Uint8Array(w * h * 3)
    for (let i = 0; i < w * h; i++) {
      const s = shade[i]
      const m = modelMask[i]
      const g = mask.filled[i]
      const ink = mask.ink[i]
      const o = i * 3
      if (ink) {
        overlayRgb[o] = 220
        overlayRgb[o + 1] = 35
        overlayRgb[o + 2] = 45
      } else if (m) {
        overlayRgb[o] = s
        overlayRgb[o + 1] = Math.min(255, s + 6)
        overlayRgb[o + 2] = Math.min(255, s + 14)
      } else {
        overlayRgb[o] = 248
        overlayRgb[o + 1] = 248
        overlayRgb[o + 2] = 250
      }

      if (m && g) {
        diffRgb[o] = 56; diffRgb[o + 1] = 178; diffRgb[o + 2] = 96
      } else if (m && !g) {
        diffRgb[o] = 48; diffRgb[o + 1] = 116; diffRgb[o + 2] = 228
      } else if (!m && g) {
        diffRgb[o] = 226; diffRgb[o + 1] = 64; diffRgb[o + 2] = 132
      } else {
        diffRgb[o] = 245; diffRgb[o + 1] = 246; diffRgb[o + 2] = 248
      }
    }

    const overlayBuf = await sharp(overlayRgb, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
    const diffBuf = await sharp(diffRgb, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
    writeFileSync(join(outDir, `overlay-${spec.id}.png`), overlayBuf)
    writeFileSync(join(outDir, `diff-${spec.id}.png`), diffBuf)

    const thumb = await sharp(overlayBuf).resize(960, 480, { fit: 'contain', background: { r: 248, g: 248, b: 250 } }).png().toBuffer()
    summaryImages.push(thumb)
  }

  const sheet = await sharp({
    create: { width: 1920, height: 960, channels: 3, background: { r: 248, g: 248, b: 250 } },
  })
    .composite([
      { input: summaryImages[0], left: 0, top: 0 },
      { input: summaryImages[1], left: 960, top: 0 },
      { input: summaryImages[2], left: 0, top: 480 },
      { input: summaryImages[3], left: 960, top: 480 },
    ])
    .png()
    .toBuffer()
  writeFileSync(join(outDir, 'summary-overlay.png'), sheet)
}

void main()
