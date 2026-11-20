import * as THREE from 'three'
import { stream } from '../core/random'
import { type Box, Forms, group, streetY, type Tone, type Tuple } from './forms'

interface Plot {
  name: string
  x: number
  z: number
  width: number
  depth: number
  roof: number
  tone: Tone
  profile: 'slab' | 'terrace' | 'shaft'
}

const nearPlots: readonly Plot[] = [
  { name: 'billboard terrace', x: 4.4, z: -56, width: 17, depth: 18, roof: 13.8, tone: 'slate', profile: 'slab' },
  { name: 'southwest exchange', x: -16.3, z: -57, width: 18, depth: 21, roof: 14.1, tone: 'stone', profile: 'terrace' },
  { name: 'west corner slab', x: -37.3, z: -47, width: 16, depth: 18, roof: 21.5, tone: 'graphite', profile: 'slab' },
  { name: 'south avenue tower', x: -51.6, z: -72, width: 20, depth: 22, roof: 48.7, tone: 'slate', profile: 'shaft' },
  { name: 'south lift tower', x: 26.6, z: -63, width: 17, depth: 22, roof: 37.2, tone: 'graphite', profile: 'shaft' },
  { name: 'southeast apartments', x: 49.4, z: -55, width: 20, depth: 21, roof: 20.3, tone: 'stone', profile: 'terrace' },
  { name: 'west market tower', x: -59, z: -20, width: 20, depth: 19, roof: 34, tone: 'slate', profile: 'terrace' },
  { name: 'west high-rise', x: -57, z: 4.8, width: 17, depth: 16, roof: 70, tone: 'graphite', profile: 'shaft' },
  { name: 'west low block', x: -61, z: 27, width: 16, depth: 22, roof: 15, tone: 'stone', profile: 'slab' },
  { name: 'northwest tower', x: -51, z: 55, width: 18, depth: 21, roof: 52, tone: 'slate', profile: 'slab' },
  { name: 'north sign terrace', x: -20.9, z: 57.7, width: 18, depth: 19, roof: 15.2, tone: 'slate', profile: 'slab' },
  { name: 'north central tower', x: 6, z: 58, width: 20, depth: 23, roof: 30, tone: 'graphite', profile: 'shaft' },
  { name: 'north hotel tower', x: 29, z: 50, width: 16, depth: 19, roof: 54, tone: 'stone', profile: 'terrace' },
  { name: 'northeast terrace', x: 51.6, z: 55, width: 18, depth: 21, roof: 19, tone: 'stone', profile: 'terrace' },
  { name: 'east residential tower', x: 60, z: 27, width: 20, depth: 17, roof: 32, tone: 'slate', profile: 'shaft' },
  { name: 'east financial tower', x: 56, z: 4, width: 18, depth: 17, roof: 63, tone: 'graphite', profile: 'shaft' },
  { name: 'east low block', x: 61, z: -21, width: 19, depth: 17, roof: 16, tone: 'stone', profile: 'slab' },
]

const skylinePlots: readonly Plot[] = [
  { name: 'southwest signal tower', x: -35, z: -102, width: 21, depth: 20, roof: 109, tone: 'slate', profile: 'shaft' },
  { name: 'south pinnacle', x: 17, z: -111, width: 22, depth: 29, roof: 133, tone: 'graphite', profile: 'shaft' },
  { name: 'northern court tower', x: -50, z: 112, width: 21, depth: 19, roof: 89, tone: 'stone', profile: 'terrace' },
]

const track = { z: 84, y: 8.5, length: 650, width: 8.8 }

function massing(plot: Plot, add: (tone: Tone, size: Tuple, at: Tuple) => void): void {
  const { x, z, width, depth, roof, tone, profile } = plot
  const rng = stream('world-tower-' + plot.name)
  const podiumTop = Math.max(streetY + 7, Math.min(roof - 11, rng.range(-17, -6)))
  const podiumHeight = podiumTop - streetY
  add(tone, [width, podiumHeight, depth], [x, streetY + podiumHeight / 2, z])
  const mainWidth = width * (profile === 'slab' ? 1 : profile === 'terrace' ? 0.87 : 0.81)
  const mainDepth = depth * (profile === 'slab' ? 1 : 0.85)
  const shiftX = (width - mainWidth) * rng.range(-0.32, 0.32)
  const shiftZ = (depth - mainDepth) * rng.range(-0.3, 0.3)
  const setback = profile === 'slab' ? roof : roof - rng.range(3.5, 13)
  add(tone, [mainWidth, setback - podiumTop, mainDepth], [x + shiftX, (setback + podiumTop) / 2, z + shiftZ])

  const capWidth = mainWidth * (profile === 'slab' ? 1 : profile === 'terrace' ? 0.72 : 0.84)
  const capDepth = mainDepth * (profile === 'slab' ? 1 : 0.73)
  const capX = x + shiftX + (mainWidth - capWidth) * rng.range(-0.38, 0.38)
  const capZ = z + shiftZ + (mainDepth - capDepth) * rng.range(-0.37, 0.37)
  if (setback < roof) add(tone, [capWidth, roof - setback, capDepth], [capX, (roof + setback) / 2, capZ])
  const trim = tone === 'graphite' ? 'slate' : 'graphite'
  add(trim, [capWidth + 0.3, 0.36, capDepth + 0.3], [capX, roof - 0.1, capZ])

  if (profile === 'shaft') {
    const ribHeight = setback - podiumTop - 1.2
    for (const side of [-1, 1]) {
      add(trim, [0.46, ribHeight, mainDepth * 0.76], [
        x + shiftX + side * mainWidth / 2, (setback + podiumTop) / 2, z + shiftZ,
      ])
    }
  } else if (profile === 'terrace') {
    add(trim, [mainWidth + 0.2, 0.36, mainDepth + 0.2], [x + shiftX, setback - 0.1, z + shiftZ])
  }

  const unitHeight = rng.range(0.8, 2.6)
  add(trim, [capWidth * rng.range(0.25, 0.54), unitHeight, capDepth * rng.range(0.23, 0.53)], [
    capX + capWidth * rng.range(-0.19, 0.19), roof + unitHeight / 2 + 0.08, capZ + capDepth * rng.range(-0.19, 0.19),
  ])
}

function roofClutter(forms: Forms, near: THREE.Group, name: string, at: Tuple, tank: boolean): void {
  const assembly = group(near, name, at)
  if (tank) {
    for (const x of [-0.6, 0.6]) {
      for (const z of [-0.6, 0.6]) forms.box(assembly, 'tank steel legs', 'graphite', [0.12, 0.8, 0.12], [x, 0.4, z])
    }
    forms.cylinder(assembly, 'water tank', 'slate', [0, 1.87, 0], 2.15, 0.98)
    forms.cylinder(assembly, 'tank shallow cap', 'stone', [0, 2.99, 0], 0.22, 1.04, 0.65)
  } else {
    forms.box(assembly, 'antenna rooftop mount', 'stone', [0.45, 0.22, 0.45], [0, 0.11, 0])
    forms.cylinder(assembly, 'antenna mast', 'slate', [0, 1.76, 0], 3.3, 0.058, 0.039)
    forms.pipe(assembly, 'antenna upper crosspiece', 'slate', [-0.6, 2.88, 0], [0.65, 2.88, 0], 0.035)
    forms.pipe(assembly, 'antenna lower crosspiece', 'graphite', [0, 2.6, -0.52], [0, 2.6, 0.58], 0.029)
  }
}

function panel(
  forms: Forms, parent: THREE.Group, name: string, at: Tuple, width: number, height: number, direction = 0,
): THREE.Group {
  const sign = group(parent, name, at)
  sign.rotation.y = direction
  forms.box(sign, 'structural enclosure', 'graphite', [width + 0.18, height + 0.16, 0.32], [0, 0, 0])
  forms.box(sign, 'blank unlit face', 'chalk', [width, height, 0.04], [0, 0, 0.17])
  return sign
}

function nearCity(forms: Forms, city: THREE.Group): void {
  const near = group(city, 'near city')
  for (const plot of nearPlots) {
    const building = group(near, plot.name)
    massing(plot, (tone, size, at) => forms.box(building, 'building mass', tone, size, at))
  }
  const frontage = group(near, 'billboard and south sign mounts')
  const billboard = panel(forms, frontage, 'billboard', [4, 11.15, -46.77], 9.6, 4.8)
  for (const x of [-3.46, 3.46]) forms.box(billboard, 'facade bracket', 'stone', [0.32, 4.35, 0.52], [x, 0.09, -0.3])
  const red = panel(forms, frontage, 'red sign', [0.3, 15.8, -47.82], 2.3, 1)
  for (const x of [-0.83, 0.83]) forms.box(red, 'roof sign stanchion', 'slate', [0.14, 2, 0.2], [x, -1, 0])

  const cool = group(near, 'cool sign group')
  panel(forms, cool, 'wide cool panel', [-24.4, 11.1, 48.08], 4.4, 1.5, Math.PI)
  panel(forms, cool, 'vertical cool panel', [-14.2, 8.6, 48.08], 1.05, 3.36, Math.PI)
  panel(forms, cool, 'small cool panel', [-42.15, 11.8, 44.38], 2.6, 0.95, Math.PI)
  panel(forms, cool, 'corner cool panel', [-41.88, 8.6, 50.4], 1.5, 2.2, Math.PI / 2)

  const warm = group(near, 'warm sign group')
  panel(forms, warm, 'vertical warm panel', [-40.75, 9.3, -37.88], 0.94, 4.2)
  panel(forms, warm, 'wide warm panel', [-36.5, 5.6, -37.88], 3.1, 1.22)
  panel(forms, warm, 'small warm panel', [-32.4, 2.65, -37.88], 1.6, 0.67)

  roofClutter(forms, near, 'billboard building water tank', [9.7, 13.8, -49.5], true)
  roofClutter(forms, near, 'corner roof aerial', [-42.1, 21.5, -42.7], false)
  roofClutter(forms, near, 'north terrace water tank', [-26.3, 15.2, 54], true)
  roofClutter(forms, near, 'east roof aerial', [59.7, 16, -17], false)
}

function outerCity(forms: Forms, city: THREE.Group): void {
  const tones = ['graphite', 'slate', 'stone'] as const
  const profiles = ['terrace', 'shaft', 'slab'] as const
  for (const layer of [
    { name: 'middle city', step: 37, first: 73, last: 279, minWidth: 13, maxWidth: 27, minRoof: 14, maxRoof: 110, skip: 0.33 },
    { name: 'far skyline', step: 68, first: 287, last: 716, minWidth: 23, maxWidth: 52, minRoof: 30, maxRoof: 195, skip: 0.46 },
  ]) {
    const ring = group(city, layer.name)
    if (layer.name === 'middle city') {
      for (const plot of skylinePlots) {
        const building = group(ring, plot.name)
        massing(plot, (tone, size, at) => forms.box(building, 'building mass', tone, size, at))
      }
    }
    const count = Math.ceil(layer.last / layer.step)
    const batches = new Map<string, { cell: THREE.Group; byTone: Map<Tone, Box[]> }>()
    for (let row = -count; row <= count; row++) {
      for (let column = -count; column <= count; column++) {
        const name = layer.name + '-' + row + '-' + column
        const rng = stream('world-plot-' + name)
        const x = (column + 0.28) * layer.step + rng.range(-3.4, 3.4)
        const z = (row - 0.33) * layer.step + rng.range(-3.4, 3.4)
        const distance = Math.hypot(x, z)
        if (distance < layer.first || distance > layer.last || rng.next() < layer.skip) continue
        const width = rng.range(layer.minWidth, layer.maxWidth)
        const depth = rng.range(layer.minWidth, layer.maxWidth)
        if (layer.name === 'middle city') {
          if (Math.abs(z - track.z) < (track.width + depth) / 2 + 2.5) continue
          if ([...nearPlots, ...skylinePlots].some((p) => Math.abs(p.x - x) < (p.width + width) / 2 + 5 &&
            Math.abs(p.z - z) < (p.depth + depth) / 2 + 5)) continue
        } else if (distance < 307 && distance - Math.hypot(width, depth) / 2 < 278) {
          continue
        }
        const roof = layer.minRoof + (layer.maxRoof - layer.minRoof) * (rng.next() ** 1.5)
        const cluster = Math.floor(row / 4) + ':' + Math.floor(column / 4)
        let batch = batches.get(cluster)
        if (!batch) {
          batch = { cell: group(ring, 'tower blocks ' + cluster), byTone: new Map<Tone, Box[]>() }
          batches.set(cluster, batch)
        }
        massing({ name, x, z, width, depth, roof, tone: rng.pick(tones), profile: rng.pick(profiles) }, (tone, size, at) => {
          const data = batch.byTone.get(tone)
          if (data) data.push({ size, at })
          else batch.byTone.set(tone, [{ size, at }])
        })
      }
    }
    for (const { cell, byTone } of batches.values()) {
      for (const [tone, data] of byTone) forms.boxes(cell, 'tower masses ' + tone, tone, data)
    }
  }
}

function streetAndGuideway(forms: Forms, city: THREE.Group): void {
  const ground = group(city, 'street level')
  forms.box(ground, 'continuous ground', 'slate', [2200, 0.85, 2200], [0, streetY - 0.425, 0])
  for (const x of [-44, 42]) forms.box(ground, 'cross street', 'graphite', [13.5, 0.02, 450], [x, streetY + 0.01, 0])
  for (const z of [-33.5, 31.5]) forms.box(ground, 'street at garage', 'graphite', [450, 0.022, 13.5], [0, streetY + 0.01, z])

  const line = group(city, 'elevated railway', [0, track.y, track.z])
  forms.box(line, 'concrete guideway', 'stone', [track.length, 0.72, track.width], [0, -0.36, 0])
  for (const z of [-4.18, 4.18]) forms.box(line, 'edge girder', 'slate', [track.length, 0.86, 0.28], [0, 0.16, z])
  for (const z of [-2.64, -1.205, 1.205, 2.64]) forms.box(line, 'steel rail', 'graphite', [track.length, 0.15, 0.075], [0, 0.14, z])
  const supports: Box[] = []
  const bearings: Box[] = []
  for (let i = -12; i <= 13; i++) {
    const x = i * 25 - 12.5
    const drop = track.y - streetY
    supports.push({ size: [1.65, drop - 0.65, 2.25], at: [x, -(drop + 0.65) / 2, 0] })
    bearings.push({ size: [2.2, 0.88, 7.25], at: [x, -1.11, 0] })
  }
  forms.boxes(line, 'guideway piers', 'stone', supports)
  forms.boxes(line, 'pier heads', 'slate', bearings)
}

export function buildCity(forms: Forms, city: THREE.Group): void {
  streetAndGuideway(forms, city)
  nearCity(forms, city)
  outerCity(forms, city)
}
