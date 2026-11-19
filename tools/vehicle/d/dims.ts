import * as T from 'three'
import { paintById, defaultPaint } from '../../../src/config'
import { createVehicle } from '../../../src/vehicle'

const detail = (process.argv[2] ?? 'blockout') as 'blockout' | 'full'
const car = await createVehicle({ paint: paintById(defaultPaint), detail })
const box = (o: T.Object3D, skip = false) => {
  const b = new T.Box3(), p = new T.Vector3()
  o.updateWorldMatrix(true, true)
  o.traverse((n) => {
    if (!(n instanceof T.Mesh) || (skip && n.parent?.name === 'door mirrors')) return
    const a = n.geometry.getAttribute('position')
    for (let i = 0; i < a.count; i++) b.expandByPoint(p.fromBufferAttribute(a, i).applyMatrix4(n.matrixWorld))
  })
  return b
}
const f = (v: T.Vector3) => v.toArray().map((x) => x.toFixed(4)).join(' ')
const whole = box(car.root), body = box(car.root.getObjectByName('sprung assembly')!, true)
console.log('whole', f(whole.min), '|', f(whole.max), 'size', f(whole.getSize(new T.Vector3())))
console.log('sprung w/o mirrors', f(body.min), '|', f(body.max), 'size', f(body.getSize(new T.Vector3())))
let tris = 0
car.root.traverse((o) => { if (o instanceof T.Mesh) tris += (o.geometry.index?.count ?? 0) / 3 })
console.log('triangles', tris)
for (const [k, a] of Object.entries(car.anchors)) console.log(k, f(a.position), f(a.normal), a.radius)
const rows: Array<[string, number, number, number]> = []
car.root.traverse((n) => {
  if (!(n instanceof T.Mesh)) return
  const b = box(n)
  rows.push([n.name, b.max.z, b.min.z, Math.max(Math.abs(b.max.x), Math.abs(b.min.x))])
})
rows.sort((a, b) => b[1] - a[1])
for (const r of rows.slice(0, 6)) console.log('max z', r[0], r[1].toFixed(4))
rows.sort((a, b) => b[3] - a[3])
for (const r of rows.slice(0, 8)) console.log('max |x|', r[0], r[3].toFixed(4))
