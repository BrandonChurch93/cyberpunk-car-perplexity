import type * as THREE from 'three'
import type { SurfaceCurve, SurfaceMap } from '../geom/cuts'
import { MeshBuilder } from '../geom/mesh'
import { add, norm, scale, sub, type V3 } from '../geom/vec'
import { lampSlot } from '../body/tail'
import { bar, merge } from './solid'

/** Light guide section and the dark floor of its recess. */
export const lampSpec = { guide: 0.014, thick: 0.01, front: 0.004, corner: 0.003, floor: 0.018, floorThick: 0.004 } as const

/**
 * Tail lamps, left side: a light guide bar along each stroke of the sideways Y, set into the paint's slot, and a dark
 * floor behind each slot. Strokes are the tail's lamp curves; the slot walls are the paint flange.
 */
export function taillamps(rm: SurfaceMap, strokes: SurfaceCurve[]): { guide: THREE.BufferGeometry; housing: THREE.BufferGeometry } {
  const s = lampSpec
  const guide = new MeshBuilder()
  const housing = new MeshBuilder()
  for (const c of strokes) {
    merge(guide, bar(rm, c.p, s.guide, s.thick, s.front, s.corner))
    merge(housing, bar(rm, extend(c.p, lampSlot + 0.006), 2 * lampSlot + 0.016, s.floorThick, s.floor, 0.0015))
  }
  return { guide: guide.geometry(), housing: housing.geometry() }
}

function extend(p: V3[], d: number): V3[] {
  const a = norm(sub(p[0], p[1]))
  const b = norm(sub(p[p.length - 1], p[p.length - 2]))
  return [add(p[0], scale(a, d)), ...p, add(p[p.length - 1], scale(b, d))]
}
