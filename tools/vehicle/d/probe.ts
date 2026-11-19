import * as T from 'three'
import { paintById, defaultPaint } from '../../../src/config'
import { createVehicle } from '../../../src/vehicle'
const car = await createVehicle({ paint: paintById(defaultPaint), detail: (process.argv[2] ?? 'blockout') as 'blockout' })
const name = process.argv[3], axis = Number(process.argv[4]), lim = Number(process.argv[5])
const p = new T.Vector3()
const pts: number[][] = []
car.root.updateMatrixWorld(true)
car.root.traverse((n) => {
  if (!(n instanceof T.Mesh) || n.name !== name) return
  const a = n.geometry.getAttribute('position')
  for (let i = 0; i < a.count; i++) { p.fromBufferAttribute(a, i).applyMatrix4(n.matrixWorld); if (Math.abs(p.getComponent(axis)) > lim) pts.push(p.toArray()) }
})
pts.sort((a, b) => Math.abs(b[axis]) - Math.abs(a[axis]))
for (const q of pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 25)) === 0)) console.log(q.map((x) => x.toFixed(3)).join(' '))
console.log(pts.length)
