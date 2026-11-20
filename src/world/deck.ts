import * as THREE from 'three'
import type { DeckSurface } from './contract'
import { type Box, Forms, group, streetY, type Tuple } from './forms'

const west = -29
const east = 29
const south = -19
const north = 19
const slabDepth = 0.28
const ramp = { x0: -24, width: 3.66, topZ: -11.5, endZ: 17.4, endY: -2.71 }
const seam = { z: 3.65, width: 0.05 }
const coreX = 7.6
const coreZ = -16.6

function floors(forms: Forms, roof: THREE.Group): DeckSurface {
  const slab = (name: string, x0: number, x1: number, z0: number, z1: number, y: number, depth = slabDepth) =>
    forms.box(roof, name, 'stone', [x1 - x0, depth, z1 - z0], [(x0 + x1) / 2, y - depth / 2, (z0 + z1) / 2])
  const x1 = ramp.x0 + ramp.width
  const rearEdge = seam.z - seam.width / 2
  const frontEdge = seam.z + seam.width / 2
  const westSlab = slab('west rim slab', west, ramp.x0, south, north, 0)
  const meshes = [
    westSlab,
    slab('ramp approach slab', ramp.x0, x1, south, ramp.topZ, 0),
    slab('ramp end rim', ramp.x0, x1, ramp.endZ, north, 0),
    slab('south slab', x1, east, south, rearEdge, 0),
    slab('north slab', x1, east, frontEdge, north, 0),
  ]
  slab('expansion joint foundation', x1, east, rearEdge, frontEdge, -0.065, slabDepth - 0.065)
  forms.box(roof, 'expansion joint seal', 'graphite', [east - x1, 0.02, seam.width], [(x1 + east) / 2, -0.013, seam.z])
  for (const side of [-1, 1]) {
    forms.box(roof, 'joint nosing', 'slate', [east - x1, 0.003, 0.065], [(x1 + east) / 2, 0.001, seam.z + side * 0.0575])
  }

  const sublevels = group(roof, 'open-sided lower parking levels')
  const decks: Box[] = []
  const support: Box[] = []
  for (let y = ramp.endY; y > streetY + 0.8; y -= 3.15) {
    if (y === ramp.endY) {
    decks.push({ size: [east - west, slabDepth, north - ramp.endZ], at: [0, y - slabDepth / 2, (north + ramp.endZ) / 2] })
      for (const [a, b] of [[west, ramp.x0], [x1, east]]) {
        decks.push({ size: [b - a, slabDepth, ramp.endZ - south], at: [(a + b) / 2, y - slabDepth / 2, (south + ramp.endZ) / 2] })
      }
    } else {
      decks.push({ size: [east - west, slabDepth, north - south], at: [0, y - slabDepth / 2, 0] })
    }
    for (const z of [south + 0.13, north - 0.13]) decks.push({ size: [east - west, 0.58, 0.26], at: [0, y + 0.29, z] })
    for (const x of [west + 0.13, east - 0.13]) decks.push({ size: [0.26, 0.58, north - south - 0.52], at: [x, y + 0.29, 0] })
  }
  for (const x of [-28.5, -19, -9.5, 0, 9.5, 19, 28.5]) {
    for (const z of [-18.5, -9.25, 0, 9.25, 18.5]) {
      support.push({ size: [0.56, -streetY, 0.56], at: [x, streetY / 2, z] })
    }
  }
  forms.boxes(sublevels, 'slabs and edge beams', 'stone', decks)
  forms.boxes(sublevels, 'garage columns', 'slate', support)
  forms.box(sublevels, 'stair shaft to street', 'slate', [7.5, -streetY, 4.8], [coreX, streetY / 2, coreZ])
  return {
    meshes,
    material: westSlab.material,
    bounds: new THREE.Box2(new THREE.Vector2(west, south), new THREE.Vector2(east, north)),
    heightMap: null,
  }
}

function edges(forms: Forms, roof: THREE.Group): void {
  const concreteHeight = 0.61
  const topOfRail = 1.07
  const walls = group(roof, 'four-sided concrete parapet and steel rail')
  for (const [name, x, z, length, turn] of [
    ['south', 0, south + 0.16, east - west, 0],
    ['north', 0, north - 0.16, east - west, 0],
    ['west', west + 0.16, 0, north - south - 0.64, Math.PI / 2],
    ['east', east - 0.16, 0, north - south - 0.64, Math.PI / 2],
  ] as const) {
    const wall = group(walls, name, [x, 0, z])
    wall.rotation.y = turn
    forms.box(wall, 'solid concrete', 'stone', [length, concreteHeight, 0.32], [0, concreteHeight / 2, 0])
    forms.box(wall, 'steel top rail', 'slate', [length, 0.055, 0.052], [0, topOfRail - 0.0275, 0])
    forms.box(wall, 'steel intermediate rail', 'slate', [length, 0.036, 0.034], [0, 0.8, 0])
    const spans = Math.ceil(length / 2.8)
    const posts: Box[] = []
    const piers: Box[] = []
    for (let i = 0; i <= spans; i++) {
      const at = (i / spans - 0.5) * (length - 0.14)
      posts.push({ size: [0.048, topOfRail - concreteHeight, 0.048], at: [at, (topOfRail + concreteHeight) / 2, 0] })
      posts.push({ size: [0.13, 0.012, 0.13], at: [at, concreteHeight + 0.006, 0] })
      if (i % 3 === 0) piers.push({ size: [0.36, concreteHeight, 0.43], at: [at, concreteHeight / 2, 0] })
    }
    forms.boxes(wall, 'bolted steel posts', 'slate', posts)
    forms.boxes(wall, 'concrete piers', 'stone', piers)
  }
}

function stripePattern(forms: Forms, roof: THREE.Group): void {
  const grid = group(roof, 'bay grid')
  grid.rotation.y = THREE.MathUtils.degToRad(12)
  const stallWidth = 2.5
  const stallDepth = 5
  const aisle = 6.95
  const stripeWidth = 0.102
  const thickness = 0.003
  const offset = -stallDepth / 2
  const strips: Box[] = []
  const wheelStops: Box[] = []
  for (const end of [offset, offset + stallDepth + aisle]) {
    for (let i = -6; i <= 8; i++) {
      const setback = end > 0 && i === 1 ? 1.8 : 0
      strips.push({ size: [stripeWidth, thickness, stallDepth - setback], at: [i * stallWidth, thickness / 2, end + setback / 2] })
      if (i < 8 && (end < 0 || i < 6)) {
        const z = end + (end < 0 ? -1.9 : 1.9)
        wheelStops.push({ size: [1.65, 0.1, 0.15], at: [(i + 0.5) * stallWidth, 0.05, z] })
      }
    }
    strips.push({ size: [14 * stallWidth, thickness, stripeWidth], at: [stallWidth, thickness / 2, end + (end < 0 ? -1 : 1) * stallDepth / 2] })
  }
  forms.boxes(grid, 'parking bay stripes', 'chalk', strips)
  forms.boxes(grid, 'wheel stops', 'slate', wheelStops.filter(({ at: [x, , z] }) => Math.hypot(x, z) > 9.5))

  const arrow = (x: number, z: number, angle: number): void => {
    const marking = group(grid, 'directional arrow', [x, 0.006, z])
    marking.rotation.y = angle
    forms.surface(marking, 'arrow paint', 'chalk', [
      [-0.105, 0, -0.95], [0.105, 0, -0.95], [0.105, 0, 0.26], [0.4, 0, 0.26], [0, 0, 1.04],
      [-0.4, 0, 0.26], [-0.105, 0, 0.26],
    ], [0, 6, 2, 0, 2, 1, 5, 4, 3])
  }
  arrow(-1, 4.55, -Math.PI / 2)
  arrow(3.75, 6.35, Math.PI / 2)
}

function foregroundStop(forms: Forms, roof: THREE.Group): void {
  const stop = group(roof, 'foreground wheel stop', [3.025, 0, 4])
  stop.rotation.y = THREE.MathUtils.degToRad(18)
  const crest = 0.102
  const rings = [
    [0.17, 0, 0.075],
    [0.158, 0.022, 0.073],
    [0.116, crest, 0.048],
  ] as const
  const vertices = rings.flatMap(([x, y, z]): Tuple[] => [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]])
  const faces = [0, 2, 1, 0, 3, 2, 8, 9, 10, 8, 10, 11]
  for (const a of [0, 4]) for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    faces.push(a + i, a + j, a + j + 4, a + i, a + j + 4, a + i + 4)
  }
  forms.surface(stop, 'precast concrete stop', 'slate', vertices, faces)
  for (const x of [-0.075, 0.075]) forms.cylinder(stop, 'steel anchor washer', 'graphite', [x, crest, 0], 0.004, 0.018)
}

function drain(forms: Forms, roof: THREE.Group, x: number, z: number, width = 0.2): void {
  const grate = group(roof, 'drain grate', [x, 0, z])
  forms.box(grate, 'iron rim', 'slate', [width, 0.007, 0.2], [0, 0.0035, 0])
  forms.box(grate, 'slot bed', 'graphite', [width - 0.024, 0.001, 0.176], [0, 0.007, 0])
  const count = Math.floor(width / 0.026)
  forms.boxes(grate, 'drain grate bars', 'slate', Array.from({ length: count }, (_, i) => ({
    size: [0.008, 0.002, 0.176],
    at: [((i + 0.5) / count - 0.5) * (width - 0.025), 0.0085, 0],
  })))
}

function rampAndControl(forms: Forms, roof: THREE.Group): void {
  const access = group(roof, 'drive-down ramp and control island')
  const x0 = ramp.x0
  const x1 = x0 + ramp.width
  const z0 = ramp.topZ
  const profile = [
    [z0, 0], [z0 + 1.4, -0.07], [ramp.endZ - 2.2, ramp.endY + 0.16], [ramp.endZ, ramp.endY],
  ] as const
  for (let i = 1; i < profile.length; i++) {
    const [a, low] = profile[i - 1]
    const [b, high] = profile[i]
    const slab = (
      name: string, tone: 'stone' | 'slate', left: number, right: number, top: number, thickness: number,
    ): void => {
      const vertices: Tuple[] = [
        [left, low + top, a], [left, high + top, b], [right, high + top, b], [right, low + top, a],
        [left, low + top - thickness, a], [left, high + top - thickness, b],
        [right, high + top - thickness, b], [right, low + top - thickness, a],
      ]
      forms.surface(access, name, tone, vertices, [
        0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
      ])
    }
    slab('sloping drive surface', 'slate', x0, x1, 0, slabDepth)
    slab('west ramp kerb', 'stone', x0 - 0.23, x0, 0.15, 0.25)
    slab('east ramp kerb', 'stone', x1, x1 + 0.23, 0.15, 0.25)
  }
  for (const x of [x0 - 0.23, x1 + 0.23]) {
    forms.box(access, 'ramp guard wall', 'stone', [0.21, 0.75, ramp.endZ - ramp.topZ], [x, 0.375, (ramp.endZ + ramp.topZ) / 2])
  }
  forms.box(access, 'lower drive connection', 'slate', [ramp.width, slabDepth, north - ramp.endZ], [
    (x0 + x1) / 2, ramp.endY - slabDepth / 2, (north + ramp.endZ) / 2,
  ])
  forms.box(access, 'protected control island', 'stone', [0.68, 0.15, 3.8], [x0 - 0.34, 0.075, z0 - 2.15])
  forms.box(access, 'barrier drive housing', 'slate', [0.32, 1.05, 0.42], [x0 - 0.26, 0.68, z0 - 1.05])
  forms.box(access, 'closed barrier arm', 'chalk', [3.5, 0.1, 0.045], [x0 + 1.48, 1.08, z0 - 1.04])
  forms.box(access, 'barrier arm underside', 'graphite', [3.5, 0.022, 0.043], [x0 + 1.48, 1.024, z0 - 1.04])
  forms.box(access, 'pay station pedestal', 'slate', [0.15, 0.85, 0.19], [x0 - 0.36, 0.56, z0 - 2.48])
  forms.box(access, 'pay station body', 'slate', [0.29, 0.57, 0.36], [x0 - 0.36, 1.15, z0 - 2.48])
  forms.box(access, 'pay station display', 'graphite', [0.024, 0.21, 0.26], [x0 - 0.21, 1.25, z0 - 2.48])
  forms.box(access, 'pay station card reader', 'chalk', [0.039, 0.072, 0.15], [x0 - 0.205, 1.045, z0 - 2.48])
  for (const z of [z0 - 3.6, z0 - 1.72]) forms.cylinder(access, 'island bollard', 'slate', [x0 - 0.35, 0.58, z], 0.86, 0.065)
  drain(forms, access, (x0 + x1) / 2, z0 - 0.42, ramp.width)
}

function coreAndServices(forms: Forms, roof: THREE.Group): void {
  const core = group(roof, 'stair and lift core', [coreX, 0, coreZ])
  forms.box(core, 'rear wall', 'stone', [7.5, 3.45, 0.28], [0, 1.725, -2.25])
  for (const x of [-3.61, 3.61]) forms.box(core, 'return wall', 'stone', [0.28, 3.45, 4.53], [x, 1.725, 0])
  forms.box(core, 'north left pier', 'stone', [0.5, 3.45, 0.28], [-3.5, 1.725, 2.25])
  forms.box(core, 'north right wall', 'stone', [5.96, 3.45, 0.28], [0.77, 1.725, 2.25])
  forms.box(core, 'lintel', 'stone', [1.04, 1.35, 0.28], [-2.73, 2.775, 2.25])
  forms.box(core, 'roof and coping', 'slate', [7.68, 0.2, 4.95], [0, 3.51, 0])
  forms.box(core, 'recessed doorway back', 'graphite', [1.36, 2.28, 0.14], [-2.73, 1.14, 1.37])
  forms.box(core, 'threshold', 'slate', [1.04, 0.016, 0.92], [-2.73, 0.008, 1.95])
  forms.box(core, 'blank wayfinding plate', 'chalk', [0.84, 0.24, 0.04], [-2.73, 2.48, 2.41])
  forms.box(core, 'door light housing', 'slate', [0.43, 0.11, 0.11], [-2.73, 2.05, 2.28])
  forms.box(core, 'lift overrun', 'stone', [2.62, 0.58, 2.25], [1.7, 3.9, -0.7])
  forms.box(core, 'wall junction box', 'slate', [0.27, 0.34, 0.16], [-1.62, 1.3, 2.47])
  forms.pipe(core, 'wall conduit', 'slate', [-1.62, 0.17, 2.44], [-1.62, 3.05, 2.44], 0.018)
  forms.pipe(core, 'return conduit', 'slate', [-1.62, 3.05, 2.44], [-3.3, 3.05, 2.44], 0.018)
  forms.pipe(core, 'security camera bracket', 'slate', [-3.38, 3.03, 2.38], [-3.38, 3.03, 2.69], 0.034)
  const camera = forms.box(core, 'security camera body', 'chalk', [0.13, 0.12, 0.24], [-3.38, 3.03, 2.73])
  camera.rotation.set(0.28, -0.55, 0)

  for (const [x, z, turn] of [[-15.2, 1.2, 0.12], [-26.3, 5.4, 0], [-26.3, 2.1, 0], [-26.3, 14.1, 0], [21.4, -15.5, 0], [24.2, -3.6, 0], [24.8, 8.4, 0], [13.2, 15.4, 0.55], [0.6, 16.2, 0.28], [-19.8, 11.5, 0]]) {
    const pole = group(roof, 'deck light pole', [x, 0, z])
    pole.rotation.y = turn
    forms.box(pole, 'pole concrete plinth', 'stone', [0.39, 0.16, 0.39], [0, 0.08, 0])
    forms.box(pole, 'pole base plate', 'slate', [0.24, 0.026, 0.24], [0, 0.173, 0])
    forms.cylinder(pole, 'tapered steel post', 'slate', [0, 2.37, 0], 4.4, 0.072, 0.046)
    forms.box(pole, 'luminaire cross arm', 'slate', [0.81, 0.065, 0.066], [0, 4.56, 0])
    for (const side of [-1, 1]) {
      forms.box(pole, 'opaque lamp head', 'slate', [0.41, 0.09, 0.24], [side * 0.48, 4.586, 0])
      forms.box(pole, 'unlit lamp diffuser', 'chalk', [0.31, 0.015, 0.16], [side * 0.49, 4.5425, 0])
    }
  }

  const plant = group(roof, 'rooftop mechanical plant', [22.2, 0, 14.7])
  forms.box(plant, 'plant raised housekeeping pad', 'stone', [4.8, 0.14, 3.55], [0, 0.07, 0])
  forms.box(plant, 'air handler', 'slate', [2.16, 1.15, 1.45], [-0.8, 0.78, 0.38])
  forms.box(plant, 'vent frame', 'graphite', [1.84, 0.72, 0.055], [-0.8, 0.82, -0.37])
  forms.boxes(plant, 'vent louvres', 'stone', Array.from({ length: 7 }, (_, i) => ({
    size: [1.76, 0.04, 0.05], at: [-0.8, 0.53 + i * 0.094, -0.402],
  })))
  forms.box(plant, 'short rectangular duct', 'stone', [1.6, 0.48, 0.61], [1.04, 0.8, 0.38])
  forms.box(plant, 'duct curb', 'slate', [0.61, 0.74, 0.61], [1.55, 0.51, 0.38])
  forms.cylinder(plant, 'roof vent riser', 'slate', [-1.65, 0.68, -1.08], 1.08, 0.16)
  forms.cylinder(plant, 'roof vent cap', 'stone', [-1.65, 1.24, -1.08], 0.09, 0.25)
}

export function buildDeck(forms: Forms, roof: THREE.Group): DeckSurface {
  const deck = floors(forms, roof)
  edges(forms, roof)
  stripePattern(forms, roof)
  foregroundStop(forms, roof)
  for (const [x, z] of [[-1.7, 3.4], [1.75, 2.6], [-12.5, -15.7], [15.45, 11.4], [20.1, -14.6]]) drain(forms, roof, x, z)
  drain(forms, roof, 0.4, -3.95, 1.5)
  rampAndControl(forms, roof)
  coreAndServices(forms, roof)
  return deck
}
