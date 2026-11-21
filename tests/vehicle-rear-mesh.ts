import * as THREE from 'three'

/** Share of triangles whose winding agrees with the mean of their stored vertex normals. */
export function windingAgreement(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const idx = g.getIndex()!
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const m = new THREE.Vector3()
  let good = 0
  let total = 0
  for (let i = 0; i < idx.count; i += 3) {
    const [ia, ib, ic] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)]
    a.fromBufferAttribute(pos, ia)
    b.fromBufferAttribute(pos, ib)
    c.fromBufferAttribute(pos, ic)
    n.subVectors(b, a).cross(c.clone().sub(a))
    if (n.lengthSq() < 1e-16) continue
    m.set(0, 0, 0)
    for (const k of [ia, ib, ic]) m.add(new THREE.Vector3().fromBufferAttribute(nor, k))
    total++
    if (n.dot(m) > 0) good++
  }
  return good / total
}

/** Edges used by exactly one triangle after welding coincident points, ignoring those on the centre line. */
export function openEdges(g: THREE.BufferGeometry, seamX?: number): number {
  const pos = g.getAttribute('position')
  const idx = g.getIndex()!
  const key = (i: number): string => `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`
  const count = new Map<string, number>()
  const xs = new Map<string, number>()
  for (let i = 0; i < idx.count; i += 3) {
    const k = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)]
    for (let e = 0; e < 3; e++) {
      const p = key(k[e])
      const q = key(k[(e + 1) % 3])
      if (p === q) continue
      const id = p < q ? `${p}|${q}` : `${q}|${p}`
      count.set(id, (count.get(id) ?? 0) + 1)
      xs.set(id, Math.max(Math.abs(pos.getX(k[e])), Math.abs(pos.getX(k[(e + 1) % 3]))))
    }
  }
  let open = 0
  for (const [id, c] of count) if (c === 1 && !(seamX !== undefined && xs.get(id)! <= seamX)) open++
  return open
}
