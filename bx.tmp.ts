import * as T from 'three'
import { config } from './src/config'
import { createVehicle } from './src/vehicle'
const v = await createVehicle({ paint: config.paint.candidates[0], detail: 'blockout' })
v.root.updateWorldMatrix(true, true)
const all = new T.Box3(); const per: Record<string, T.Box3> = {}
v.root.traverse((o) => { if (!(o instanceof T.Mesh) || o.name.startsWith('mirror')) return; const b = new T.Box3().setFromObject(o); all.union(b); per[o.name] = b })
console.log('all', all.min.toArray().map((x) => x.toFixed(4)), all.max.toArray().map((x) => x.toFixed(4)))
for (const [k, b] of Object.entries(per)) if (b.min.z < -2.474 || b.max.z > 2.47 || b.min.y < 0.0005 || b.max.y > 1.159 || Math.abs(b.min.x) > 1.015) console.log(k, b.min.toArray().map((x) => x.toFixed(4)), b.max.toArray().map((x) => x.toFixed(4)))
