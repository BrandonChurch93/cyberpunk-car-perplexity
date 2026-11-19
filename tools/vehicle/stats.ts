import * as THREE from 'three'
import { createVehicle } from '../../src/vehicle/index.ts'
import { config } from '../../src/config.ts'

const detail = (process.argv[2] ?? 'blockout') as 'blockout' | 'full'
const t0 = Date.now()
const v = await createVehicle({ paint: config.paint.candidates[0], detail })
const ms = Date.now() - t0
const rows: Array<[string, number]> = []
let total = 0
v.root.traverse((o) => {
  if (o instanceof THREE.Mesh) {
    const g = o.geometry as THREE.BufferGeometry
    const n = (g.index ? g.index.count : g.getAttribute('position').count) / 3
    total += n
    rows.push([o.name, n])
  }
})
const agg = new Map<string, number>()
for (const [k, n] of rows) agg.set(k.replace(/-(left|right)$/, ''), (agg.get(k.replace(/-(left|right)$/, '')) ?? 0) + n)
for (const [k, n] of [...agg].sort((a, b) => b[1] - a[1])) console.log(k.padEnd(20), n)
const box = new THREE.Box3().setFromObject(v.root)
console.log('total', total, 'ms', ms)
console.log('box', box.min.toArray().map((x) => x.toFixed(4)), box.max.toArray().map((x) => x.toFixed(4)))
