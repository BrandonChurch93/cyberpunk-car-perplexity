import * as THREE from 'three'
import type { Tuple } from './forms'
import { plate } from './fixtures'
import { paintSign, signFace, signText, type SignArt } from './sign-faces'

type Box = (parent: THREE.Object3D, name: string, at: Tuple, size: Tuple, material: THREE.Material) => THREE.Mesh
type Dress = { art: SignArt; radiance: number; cells?: readonly [number, number] }

export const heroSignArt: Readonly<Record<string, Dress>> = {
  'hotel rooftop cabinet': { radiance: 8.0, art: {
    name: 'VAPOR SILL HOTEL', width: 2.03, height: .66, style: 'channel', seed: 3.1,
    lines: [
      { text: 'VAPOR SILL', font: 'World Condensed', weight: 500, height: .46, y: .36, x: .575, track: .05, dead: [6] },
      { text: 'HOTEL', font: 'World Condensed', weight: 400, height: .27, y: .79, x: .575, track: .62, gain: .9 },
    ],
    marks: [{ kind: 'sill', x: .105, y: .52, size: .56, gain: .9 }],
    raceways: [[.40, .20, .95, .035], [.81, .30, .86, .025]],
  } },
  'white parking blade': { radiance: 6.4, art: {
    name: 'PARKING', width: .61, height: 2.42, style: 'lightbox', seed: 7.4, panel: .004, water: .07,
    lines: [{ text: 'PARKING', font: 'World Condensed', weight: 700, height: .125, y: .52, vertical: true, wide: 1.9 }],
  } },
  'far cyan bar cabinet': { radiance: 7.6, art: {
    name: 'SALT MOTH', width: 1.98, height: 1.11, style: 'neon', seed: 5.7,
    lines: [
      { text: 'SALT MOTH', font: 'World Round', weight: 400, height: .27, y: .40, x: .615, track: .06 },
      { text: 'BAR', font: 'World Round', weight: 700, height: .20, y: .73, x: .615, track: .55, gain: .9 },
    ],
    marks: [{ kind: 'moth', x: .115, y: .50, size: .44, gain: .95 }],
    raceways: [[.43, .27, .94, .05], [.75, .46, .74, .04]],
  } },
  'amber upper tower cabinet': { radiance: 6.0, cells: [96, 62], art: {
    name: 'ORBITAL DINER', width: 1.11, height: .72, style: 'module', seed: 9.2,
    lines: [
      { text: 'ORBITAL', font: 'World Pixel', weight: 800, height: .40, y: .30, track: .02 },
      { text: 'DINER', font: 'World Pixel', weight: 800, height: .40, y: .72, track: .16, dim: [1] },
    ],
  } },
  'amber lower tower cabinet': { radiance: 6.9, art: {
    name: 'OPEN', width: 1.22, height: .83, style: 'channel', seed: 11.6,
    lines: [
      { text: 'OPEN', font: 'World Round', weight: 600, height: .46, y: .40, track: .08 },
      { text: '24H', font: 'World Round', weight: 300, height: .19, y: .80, track: .45, gain: .86 },
    ],
  } },
}

export const heroSignSize: Readonly<Record<string, readonly [number, number]>> = Object.fromEntries(
  Object.entries(heroSignArt).map(([id, { art }]) => [id, [art.width, art.height]]))

export function dressHeroSign(housing: THREE.Object3D, id: string, tint: THREE.Color, setback: number, box: Box,
  frame: THREE.Material, zinc: THREE.Material, offset: (m: THREE.ShaderMaterial) => THREE.ShaderMaterial): string | null {
  const dress = heroSignArt[id]
  if (!dress) return null
  const { art } = dress
  const name = signText(art)
  const w = art.width, h = art.height
  const maps = paintSign(art)
  if (maps) {
    const face = plate(housing, `opal lettering ${name}`, offset(signFace(art, maps, tint, dress.radiance, dress.cells)), [0, 0, .010 + setback], w, h)
    face.renderOrder = 2
  }
  if (id === 'hotel rooftop cabinet') {
    for (const x of [-.43, -.15, .15, .43]) {
      box(housing, 'rooftop frame steel leg', [x * w, -h * .5 - .06, -.10], [.022, .12, .022], frame)
      box(housing, 'rooftop frame raked strut', [x * w + .03, -h * .5 - .05, -.16], [.014, .13, .014], zinc).rotation.z = .55
    }
    box(housing, 'catwalk grating', [0, -h * .5 - .021, .035], [w * .96, .008, .07], zinc)
    for (const x of [-.47, -.235, 0, .235, .47]) box(housing, 'catwalk rail stanchion', [x * w, -h * .5 + .012, .066], [.006, .066, .006], zinc)
    box(housing, 'catwalk handrail', [0, -h * .5 + .045, .066], [w * .96, .006, .006], zinc)
    box(housing, 'top chord channel', [0, h * .5 + .028, -.05], [w + .05, .024, .05], frame)
    box(housing, 'feed conduit drop', [-.40 * w, -h * .5 - .06, -.045], [.008, .12, .008], zinc)
  } else if (id === 'white parking blade') {
    for (const y of [.40, -.40]) {
      box(housing, 'blade shear arm', [-.12 * w, y * h, -.20], [.05, .05, .30], zinc)
      box(housing, 'blade wall plate', [-.12 * w, y * h, -.34], [.10, .14, .02], frame)
    }
    box(housing, 'blade weather cap', [0, h * .5 + .03, 0], [w + .09, .022, .26], frame)
    box(housing, 'blade drip sill', [0, -h * .5 - .025, .01], [w + .05, .016, .22], frame)
    box(housing, 'blade feed conduit', [.30 * w, -h * .5 - .35, -.12], [.016, .66, .016], zinc)
    box(housing, 'blade service hatch', [w * .5 + .004, -.25 * h, -.07], [.006, .18, .10], zinc)
  } else if (id === 'far cyan bar cabinet') {
    box(housing, 'neon transformer box', [.43 * w, -.42 * h, .012 + setback], [.12, .08, .03], zinc)
    box(housing, 'transformer feed cable', [.43 * w, -.5 * h - .05, -.01], [.006, .10, .006], frame)
    box(housing, 'backer hood', [0, h * .5 + .018, .01], [w + .04, .016, .12], frame)
  } else if (id === 'amber upper tower cabinet' || id === 'amber lower tower cabinet') {
    box(housing, 'cabinet rain hood', [0, h * .5 + .02, .02], [w + .06, .018, .14], frame)
    for (const x of [-.3, .3]) box(housing, 'cabinet hanger rod', [x * w, h * .5 + .09, -.05], [.008, .14, .008], zinc)
    box(housing, 'cabinet feed conduit', [.46 * w, -h * .5 - .07, -.06], [.01, .14, .01], zinc)
  }
  return name
}
