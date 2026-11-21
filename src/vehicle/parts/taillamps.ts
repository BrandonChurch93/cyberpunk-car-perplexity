import type * as THREE from 'three'
import type { SurfaceCurve, SurfaceMap } from '../geom/cuts'
import { MeshBuilder } from '../geom/mesh'
import { bar, holePlane, merge, pocket } from './solid'

/** Light guide section, the depth of the dark lens recess it sits in, and of the slot below. */
export const lampSpec = { guide: 0.012, thick: 0.016, front: 0.005, corner: 0.003, lens: 0.022, slot: 0.05 } as const

/**
 * Tail lamps, left side: a light guide bar along each stroke of the sideways Y, standing on the floor of a dark lens
 * recess, and the dark slot below the lamp. Strokes are the tail's lamp curves; the recess walls continue the paint flange.
 */
export function taillamps(rm: SurfaceMap, strokes: SurfaceCurve[], lens: SurfaceCurve, slot: SurfaceCurve): { guide: THREE.BufferGeometry; housing: THREE.BufferGeometry } {
  const s = lampSpec
  const guide = new MeshBuilder()
  for (const c of strokes) merge(guide, bar(rm, c.p, s.guide, s.thick, s.front, s.corner))
  const housing = new MeshBuilder()
  merge(housing, pocket(rm, lens, holePlane(rm, lens), s.lens))
  merge(housing, pocket(rm, slot, holePlane(rm, slot), s.slot))
  return { guide: guide.geometry(), housing: housing.geometry() }
}
