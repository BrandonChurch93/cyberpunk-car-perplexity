import * as THREE from 'three'

/** Distances past this from a lower edge are all the same to the drip line, in meters. */
export const dripReach = 0.04
/** Two faces meeting sharper than this make a crease the water can hang from. */
const creaseCos = Math.cos(THREE.MathUtils.degToRad(30))
const weldStep = 1e-5
/** Faces wider than this from their longest side, in meters, are too big to be all edge. */
const wideFace = 0.006

export const dripAttribute = 'surfDrip'

interface Faces {
  welded: Int32Array
  count: number
  tris: Int32Array
  normals: Float32Array
  centroids: Float32Array
  world: Float32Array
}

function facesOf(geometry: THREE.BufferGeometry, matrixWorld: THREE.Matrix4): Faces {
  const pos = geometry.getAttribute('position')
  const nrm = geometry.getAttribute('normal')
  const index = geometry.index
  const triCount = index ? index.count / 3 : pos.count / 3
  const world = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrixWorld)
    world[i * 3] = v.x
    world[i * 3 + 1] = v.y
    world[i * 3 + 2] = v.z
  }
  const keys = new Map<string, number>()
  const welded = new Int32Array(pos.count)
  let count = 0
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(world[i * 3] / weldStep)},${Math.round(world[i * 3 + 1] / weldStep)},${Math.round(world[i * 3 + 2] / weldStep)}`
    let id = keys.get(k)
    if (id === undefined) {
      id = count++
      keys.set(k, id)
    }
    welded[i] = id
  }
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld)
  const tris = new Int32Array(triCount * 3)
  const normals = new Float32Array(triCount * 3)
  const centroids = new Float32Array(triCount * 3)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3()
  for (let t = 0; t < triCount; t++) {
    const ia = index ? index.getX(t * 3) : t * 3
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2
    tris[t * 3] = ia
    tris[t * 3 + 1] = ib
    tris[t * 3 + 2] = ic
    a.fromArray(world, ia * 3)
    b.fromArray(world, ib * 3)
    c.fromArray(world, ic * 3)
    n.subVectors(b, a).cross(m.subVectors(c, a))
    if (nrm) {
      m.fromBufferAttribute(nrm, ia).add(v.fromBufferAttribute(nrm, ib)).add(v.fromBufferAttribute(nrm, ic)).applyMatrix3(normalMatrix)
      if (n.dot(m) < 0) n.negate()
    }
    n.normalize()
    normals.set([n.x, n.y, n.z], t * 3)
    centroids.set([(a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3], t * 3)
  }
  return { welded, count, tris, normals, centroids, world }
}

/** True when water on face t runs toward the edge from p to q: the edge faces downhill across the face, not along the fall line. */
function drainsTo(f: Faces, t: number, at: Float64Array, p: number, q: number): boolean {
  const nx = f.normals[t * 3], ny = f.normals[t * 3 + 1], nz = f.normals[t * 3 + 2]
  const gx = nx * ny, gy = -1 + ny * ny, gz = nz * ny
  const slope = Math.hypot(gx, gy, gz)
  if (slope < 0.15 || ny < -0.3) return false
  const ex = at[q * 3] - at[p * 3], ey = at[q * 3 + 1] - at[p * 3 + 1], ez = at[q * 3 + 2] - at[p * 3 + 2]
  let ox = ey * nz - ez * ny, oy = ez * nx - ex * nz, oz = ex * ny - ey * nx
  const ol = Math.hypot(ox, oy, oz)
  if (ol < 1e-12) return false
  const mx = (at[p * 3] + at[q * 3]) / 2 - f.centroids[t * 3], my = (at[p * 3 + 1] + at[q * 3 + 1]) / 2 - f.centroids[t * 3 + 1], mz = (at[p * 3 + 2] + at[q * 3 + 2]) / 2 - f.centroids[t * 3 + 2]
  if (ox * mx + oy * my + oz * mz < 0) {
    ox = -ox
    oy = -oy
    oz = -oz
  }
  return (ox * gx + oy * gy + oz * gz) / (ol * slope) > 0.5
}

/**
 * Per vertex, the distance over the surface to the nearest edge water hangs from: an open border or a sharp crease at the low
 * side of a draining face, where the face beyond turns under or drains back into it. The car rests level when this is built.
 */
export function lowerEdgeDistance(geometry: THREE.BufferGeometry, matrixWorld: THREE.Matrix4): { distance: Float32Array; valid: Uint8Array } {
  const f = facesOf(geometry, matrixWorld)
  const triCount = f.tris.length / 3
  const edgeFaces = new Map<number, number[]>()
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const p = f.welded[f.tris[t * 3 + k]], q = f.welded[f.tris[t * 3 + ((k + 1) % 3)]]
      if (p === q) continue
      const key = Math.min(p, q) * f.count + Math.max(p, q)
      const list = edgeFaces.get(key)
      if (list) list.push(t)
      else edgeFaces.set(key, [t])
    }
  }
  const at = new Float64Array(f.count * 3)
  for (let i = 0; i < f.welded.length; i++) at.set([f.world[i * 3], f.world[i * 3 + 1], f.world[i * 3 + 2]], f.welded[i] * 3)
  const dist = new Float64Array(f.count).fill(dripReach)
  const neighbors: number[][] = Array.from({ length: f.count }, () => [])
  const sources: number[] = []
  for (const [key, faces] of edgeFaces) {
    const p = Math.floor(key / f.count), q = key - p * f.count
    neighbors[p].push(q)
    neighbors[q].push(p)
    let lower = false
    if (faces.length !== 2) lower = faces.some((t) => drainsTo(f, t, at, p, q))
    else {
      const [s, t] = faces
      const cos = f.normals[s * 3] * f.normals[t * 3] + f.normals[s * 3 + 1] * f.normals[t * 3 + 1] + f.normals[s * 3 + 2] * f.normals[t * 3 + 2]
      if (cos < creaseCos) {
        for (const [upper, beyond] of [[s, t], [t, s]]) {
          if (!drainsTo(f, upper, at, p, q)) continue
          if (f.normals[beyond * 3 + 1] < -0.1 || drainsTo(f, beyond, at, p, q)) lower = true
        }
      }
    }
    if (lower) sources.push(p, q)
  }
  for (const s of sources) dist[s] = 0
  // Dijkstra from every lower edge vertex at once over the welded edges; ties settle by index so the field is the same every run.
  const heap: number[] = []
  const less = (i: number, j: number) => dist[heap[i]] < dist[heap[j]] || (dist[heap[i]] === dist[heap[j]] && heap[i] < heap[j])
  const swap = (i: number, j: number) => ([heap[i], heap[j]] = [heap[j], heap[i]])
  const push = (v: number) => {
    heap.push(v)
    for (let i = heap.length - 1; i > 0; ) {
      const up = (i - 1) >> 1
      if (!less(i, up)) break
      swap(i, up)
      i = up
    }
  }
  const pop = (): number => {
    const top = heap[0]
    const last = heap.pop() as number
    if (heap.length > 0) {
      heap[0] = last
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && less(l, m)) m = l
        if (r < heap.length && less(r, m)) m = r
        if (m === i) break
        swap(i, m)
        i = m
      }
    }
    return top
  }
  const done = new Uint8Array(f.count)
  for (const s of new Set(sources)) push(s)
  while (heap.length > 0) {
    const v = pop()
    if (done[v]) continue
    done[v] = 1
    for (const w of neighbors[v]) {
      if (done[w]) continue
      const d = dist[v] + Math.hypot(at[w * 3] - at[v * 3], at[w * 3 + 1] - at[v * 3 + 1], at[w * 3 + 2] - at[v * 3 + 2])
      if (d < dist[w]) {
        dist[w] = d
        push(w)
      }
    }
  }
  const distance = new Float32Array(f.welded.length)
  for (let i = 0; i < distance.length; i++) distance[i] = dist[f.welded[i]]
  // A wide face with every corner on an edge would read as edge all over; its corners carry no drip line instead.
  const valid = new Uint8Array(f.welded.length).fill(1)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m = new THREE.Vector3()
  for (let t = 0; t < triCount; t++) {
    const ia = f.tris[t * 3], ib = f.tris[t * 3 + 1], ic = f.tris[t * 3 + 2]
    if (distance[ia] > 0 || distance[ib] > 0 || distance[ic] > 0) continue
    a.fromArray(f.world, ia * 3)
    b.fromArray(f.world, ib * 3)
    c.fromArray(f.world, ic * 3)
    const area = m.subVectors(b, a).cross(c.clone().sub(a)).length()
    if (area / Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) > wideFace) valid[ia] = valid[ib] = valid[ic] = 0
  }
  return { distance, valid }
}

const cache = new WeakMap<THREE.BufferGeometry, true>()

/** Puts the lower edge distance on the mesh's geometry once; a vec2 so a mesh without it reads as no edge at all. */
export function addDripEdges(mesh: THREE.Mesh): void {
  const geometry = mesh.geometry
  if (cache.has(geometry)) return
  cache.set(geometry, true)
  mesh.updateWorldMatrix(true, false)
  const { distance, valid } = lowerEdgeDistance(geometry, mesh.matrixWorld)
  const data = new Float32Array(distance.length * 2)
  for (let i = 0; i < distance.length; i++) {
    data[i * 2] = distance[i]
    data[i * 2 + 1] = valid[i]
  }
  geometry.setAttribute(dripAttribute, new THREE.BufferAttribute(data, 2))
}
