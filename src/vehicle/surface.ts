import * as THREE from 'three'

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function smootherstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function smin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1)
  return lerp(b, a, h) - k * h * (1 - h)
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k)
}

export function filletAbs(x: number, radius: number): number {
  return Math.sqrt(x * x + radius * radius) - radius
}

export interface PatchRollOptions {
  uMin?: boolean
  uMax?: boolean
  vMin?: boolean
  vMax?: boolean
  bevelRadius?: number
  flangeDepth?: number
  flipWinding?: boolean
  uvScale?: number
}

export function buildRolledPatch(
  nu: number,
  nv: number,
  evalPoint: (u: number, v: number, out: THREE.Vector3) => void,
  opts: PatchRollOptions = {},
): THREE.BufferGeometry {
  const rollUMin = opts.uMin ?? true
  const rollUMax = opts.uMax ?? true
  const rollVMin = opts.vMin ?? true
  const rollVMax = opts.vMax ?? true
  const r = opts.bevelRadius ?? 0.0018
  const flange = opts.flangeDepth ?? 0.0055
  const uvScale = opts.uvScale ?? 2.5

  const uSamples: Array<{ u: number; ring: number; side: -1 | 0 | 1 }> = []
  if (rollUMin) {
    uSamples.push({ u: 0, ring: 3, side: -1 }, { u: 0, ring: 2, side: -1 }, { u: 0, ring: 1, side: -1 })
  }
  for (let i = 0; i <= nu; i++) uSamples.push({ u: i / nu, ring: 0, side: 0 })
  if (rollUMax) {
    uSamples.push({ u: 1, ring: 1, side: 1 }, { u: 1, ring: 2, side: 1 }, { u: 1, ring: 3, side: 1 })
  }

  const vSamples: Array<{ v: number; ring: number; side: -1 | 0 | 1 }> = []
  if (rollVMin) {
    vSamples.push({ v: 0, ring: 3, side: -1 }, { v: 0, ring: 2, side: -1 }, { v: 0, ring: 1, side: -1 })
  }
  for (let j = 0; j <= nv; j++) vSamples.push({ v: j / nv, ring: 0, side: 0 })
  if (rollVMax) {
    vSamples.push({ v: 1, ring: 1, side: 1 }, { v: 1, ring: 2, side: 1 }, { v: 1, ring: 3, side: 1 })
  }

  const baseCols = nu + 1
  const baseRows = nv + 1
  const basePos = new Float32Array(baseCols * baseRows * 3)
  const baseNorm = new Float32Array(baseCols * baseRows * 3)
  const baseTanU = new Float32Array(baseCols * baseRows * 3)
  const baseTanV = new Float32Array(baseCols * baseRows * 3)
  const tmp = new THREE.Vector3()
  const pA = new THREE.Vector3()
  const pB = new THREE.Vector3()
  const dU = new THREE.Vector3()
  const dV = new THREE.Vector3()
  const nrm = new THREE.Vector3()

  for (let j = 0; j < baseRows; j++) {
    const v = j / nv
    for (let i = 0; i < baseCols; i++) {
      const u = i / nu
      evalPoint(u, v, tmp)
      const k = (j * baseCols + i) * 3
      basePos[k] = tmp.x
      basePos[k + 1] = tmp.y
      basePos[k + 2] = tmp.z
    }
  }

  const readBase = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 => {
    const ci = clamp(i, 0, nu)
    const cj = clamp(j, 0, nv)
    const k = (cj * baseCols + ci) * 3
    return out.set(basePos[k], basePos[k + 1], basePos[k + 2])
  }

  const sign = opts.flipWinding ? -1 : 1
  for (let j = 0; j < baseRows; j++) {
    for (let i = 0; i < baseCols; i++) {
      readBase(i + 1, j, pB)
      readBase(i - 1, j, pA)
      dU.subVectors(pB, pA)
      if (dU.lengthSq() < 1e-12) dU.set(1, 0, 0)
      else dU.normalize()

      readBase(i, j + 1, pB)
      readBase(i, j - 1, pA)
      dV.subVectors(pB, pA)
      if (dV.lengthSq() < 1e-12) dV.set(0, 0, 1)
      else dV.normalize()

      nrm.crossVectors(dU, dV).multiplyScalar(sign)
      if (nrm.lengthSq() < 1e-12) nrm.set(0, 1, 0)
      else nrm.normalize()

      const k = (j * baseCols + i) * 3
      baseNorm[k] = nrm.x; baseNorm[k + 1] = nrm.y; baseNorm[k + 2] = nrm.z
      baseTanU[k] = dU.x; baseTanU[k + 1] = dU.y; baseTanU[k + 2] = dU.z
      baseTanV[k] = dV.x; baseTanV[k + 1] = dV.y; baseTanV[k + 2] = dV.z
    }
  }

  const cols = uSamples.length
  const rows = vSamples.length
  const positions = new Float32Array(cols * rows * 3)
  const uvs = new Float32Array(cols * rows * 2)
  const edgeDir = new THREE.Vector3()

  const ringProfile = (ring: number): [number, number] => {
    if (ring === 0) return [0, 0]
    if (ring === 1) return [-0.293 * r, -0.293 * r]
    if (ring === 2) return [0, -r]
    return [0, -(r + flange)]
  }

  const uOffset = rollUMin ? 3 : 0
  const vOffset = rollVMin ? 3 : 0

  for (let rj = 0; rj < rows; rj++) {
    const vs = vSamples[rj]
    const bj = vs.side === -1 ? 0 : vs.side === 1 ? nv : rj - vOffset
    for (let ri = 0; ri < cols; ri++) {
      const us = uSamples[ri]
      const bi = us.side === -1 ? 0 : us.side === 1 ? nu : ri - uOffset
      const bk = (bj * baseCols + bi) * 3
      tmp.set(basePos[bk], basePos[bk + 1], basePos[bk + 2])
      nrm.set(baseNorm[bk], baseNorm[bk + 1], baseNorm[bk + 2])
      dU.set(baseTanU[bk], baseTanU[bk + 1], baseTanU[bk + 2])
      dV.set(baseTanV[bk], baseTanV[bk + 1], baseTanV[bk + 2])

      const maxRing = Math.max(us.ring, vs.ring)
      if (maxRing > 0) {
        edgeDir.set(0, 0, 0)
        if (us.side !== 0) edgeDir.addScaledVector(dU, us.side)
        if (vs.side !== 0) edgeDir.addScaledVector(dV, vs.side)
        if (edgeDir.lengthSq() > 1e-8) edgeDir.normalize()
        const [outShift, downShift] = ringProfile(maxRing)
        tmp.addScaledVector(edgeDir, outShift)
        tmp.addScaledVector(nrm, downShift)
      } else {
        if (rollUMin && bi === 0) tmp.addScaledVector(dU, r)
        if (rollUMax && bi === nu) tmp.addScaledVector(dU, -r)
        if (rollVMin && bj === 0) tmp.addScaledVector(dV, r)
        if (rollVMax && bj === nv) tmp.addScaledVector(dV, -r)
      }

      const outIdx = rj * cols + ri
      positions[outIdx * 3] = tmp.x
      positions[outIdx * 3 + 1] = tmp.y
      positions[outIdx * 3 + 2] = tmp.z
      uvs[outIdx * 2] = (tmp.x + tmp.y * 0.5) * uvScale
      uvs[outIdx * 2 + 1] = (tmp.z + tmp.y * 0.35) * uvScale
    }
  }

  const indices: number[] = []
  for (let rj = 0; rj < rows - 1; rj++) {
    for (let ri = 0; ri < cols - 1; ri++) {
      const a = rj * cols + ri
      const b = a + 1
      const c = a + cols
      const d = c + 1
      if (opts.flipWinding) {
        indices.push(a, c, b, b, c, d)
      } else {
        indices.push(a, b, c, b, d, c)
      }
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  return geom
}

export function mirrorGeometryX(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const geom = src.clone()
  const pos = geom.getAttribute('position')
  for (let i = 0; i < pos.count; i++) pos.setX(i, -pos.getX(i))
  const nrm = geom.getAttribute('normal')
  if (nrm) {
    for (let i = 0; i < nrm.count; i++) nrm.setX(i, -nrm.getX(i))
  }
  const idx = geom.getIndex()
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1)
      const c = idx.getX(i + 2)
      idx.setX(i + 1, c)
      idx.setX(i + 2, b)
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      for (const attr of [pos, nrm, geom.getAttribute('uv')].filter(Boolean) as THREE.BufferAttribute[]) {
        for (let k = 0; k < attr.itemSize; k++) {
          const b = attr.array[(i + 1) * attr.itemSize + k]
          attr.array[(i + 1) * attr.itemSize + k] = attr.array[(i + 2) * attr.itemSize + k]
          attr.array[(i + 2) * attr.itemSize + k] = b
        }
      }
    }
  }
  return geom
}

export function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0
  let totalIndices = 0
  for (const g of geoms) {
    const pos = g.getAttribute('position')
    totalVerts += pos.count
    const idx = g.getIndex()
    totalIndices += idx ? idx.count : pos.count
  }

  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const indices = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices)

  let vOffset = 0
  let iOffset = 0
  for (const g of geoms) {
    const pos = g.getAttribute('position')
    let nrm = g.getAttribute('normal')
    if (!nrm) {
      g.computeVertexNormals()
      nrm = g.getAttribute('normal')
    }
    const uv = g.getAttribute('uv')
    const count = pos.count
    for (let i = 0; i < count; i++) {
      const dst3 = (vOffset + i) * 3
      positions[dst3] = pos.getX(i)
      positions[dst3 + 1] = pos.getY(i)
      positions[dst3 + 2] = pos.getZ(i)
      normals[dst3] = nrm.getX(i)
      normals[dst3 + 1] = nrm.getY(i)
      normals[dst3 + 2] = nrm.getZ(i)
      const dst2 = (vOffset + i) * 2
      if (uv) {
        uvs[dst2] = uv.getX(i)
        uvs[dst2 + 1] = uv.getY(i)
      } else {
        uvs[dst2] = (pos.getX(i) + pos.getY(i) * 0.5) * 2.5
        uvs[dst2 + 1] = (pos.getZ(i) + pos.getY(i) * 0.35) * 2.5
      }
    }
    const idx = g.getIndex()
    if (idx) {
      for (let k = 0; k < idx.count; k++) indices[iOffset + k] = idx.getX(k) + vOffset
      iOffset += idx.count
    } else {
      for (let k = 0; k < count; k++) indices[iOffset + k] = k + vOffset
      iOffset += count
    }
    vOffset += count
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  return merged
}

export function buildProfileTube(
  spine: ReadonlyArray<[number, number, number]>,
  section: ReadonlyArray<[number, number]>,
  upHint: [number, number, number] = [0, 1, 0],
  closed = false,
  capEnds = true,
): THREE.BufferGeometry {
  const nPts = spine.length
  const nSec = section.length
  const ringCount = closed ? nPts + 1 : nPts
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const up = new THREE.Vector3(...upHint).normalize()
  const cur = new THREE.Vector3()
  const prev = new THREE.Vector3()
  const next = new THREE.Vector3()
  const tan = new THREE.Vector3()
  const right = new THREE.Vector3()
  const binorm = new THREE.Vector3()

  let arcLen = 0
  for (let i = 0; i < ringCount; i++) {
    const idx = i % nPts
    const p = spine[idx]
    cur.set(p[0], p[1], p[2])
    if (i > 0) {
      const pp = spine[(i - 1) % nPts]
      arcLen += cur.distanceTo(prev.set(pp[0], pp[1], pp[2]))
    }
    const pPrev = spine[closed ? (idx - 1 + nPts) % nPts : Math.max(0, idx - 1)]
    const pNext = spine[closed ? (idx + 1) % nPts : Math.min(nPts - 1, idx + 1)]
    prev.set(pPrev[0], pPrev[1], pPrev[2])
    next.set(pNext[0], pNext[1], pNext[2])
    tan.subVectors(next, prev)
    if (tan.lengthSq() < 1e-10) tan.set(0, 0, 1)
    else tan.normalize()
    right.crossVectors(up, tan)
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
    else right.normalize()
    binorm.crossVectors(tan, right).normalize()

    for (let j = 0; j <= nSec; j++) {
      const [sx, sy] = section[j % nSec]
      positions.push(
        cur.x + right.x * sx + binorm.x * sy,
        cur.y + right.y * sx + binorm.y * sy,
        cur.z + right.z * sx + binorm.z * sy,
      )
      uvs.push(arcLen * 4, j / nSec)
    }
  }

  const stride = nSec + 1
  for (let i = 0; i < ringCount - 1; i++) {
    for (let j = 0; j < nSec; j++) {
      const a = i * stride + j
      const b = a + 1
      const c = a + stride
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }

  if (!closed && capEnds) {
    for (const [endIdx, flip] of [[0, false], [ringCount - 1, true]] as Array<[number, boolean]>) {
      const centerIdx = positions.length / 3
      const ep = spine[endIdx]
      positions.push(ep[0], ep[1], ep[2])
      uvs.push(0.5, 0.5)
      for (let j = 0; j < nSec; j++) {
        const a = endIdx * stride + j
        const b = endIdx * stride + j + 1
        if (flip) indices.push(centerIdx, a, b)
        else indices.push(centerIdx, b, a)
      }
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  return geom
}

export function makeMesh(geom: THREE.BufferGeometry, mat: THREE.Material, name: string, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geom, mat)
  m.name = name
  m.castShadow = shadow
  m.receiveShadow = true
  return m
}
