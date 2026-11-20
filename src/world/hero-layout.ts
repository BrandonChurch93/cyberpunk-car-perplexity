import * as THREE from 'three'
import { config } from '../config'
import type { FilmLight } from '../core/contract'
import { labelFace, plate, type Label } from './fixtures'
import { group, heroCityYaw, heroDrainLayout, streetY, type Tuple } from './forms'
import { billboardMural, fixtureOpal, towerSurface } from './hero-surfaces'
import type { finishRoof } from './roof-look'

const palette = {
  cyan: [.055, 2.55, 3.52],
  white: [1.78, 2.19, 2.78],
  amber: [4.72, 2.23, .46],
  violet: [1.20, .25, 2.75],
  magenta: [3.48, .145, 1.46],
  strip: [5.2, 3.9, 2.65],
} as const satisfies Record<string, Tuple>

type Tint = keyof typeof palette
type Source = { id: string; at: Tuple; size: readonly [number, number]; tint: Tint; text?: string; onWall?: boolean }
type RoofMaterials = ReturnType<typeof finishRoof>['materials']

export const approvedHeroSources = [
  { id: 'left cyan facade sail', at: [-11.76, 6.42, -29.40], size: [.139, 11.05], tint: 'cyan' },
  { id: 'left cyan secondary strip', at: [-12.03, 4.72, -29.38], size: [.16, 5.68], tint: 'cyan' },
  { id: 'hotel rooftop cabinet', at: [-9.74, 6.35, -32.10], size: [2.65, .98], tint: 'cyan', text: 'HOTEL' },
  { id: 'white parking blade', at: [-9.90, 2.87, -26.35], size: [.59, 2.58], tint: 'white', text: 'PARKING' },
  { id: 'cyan hotel facade strip', at: [-10.23, 3.18, -32.03], size: [.07, 4.52], tint: 'cyan' },
  { id: 'far cyan bar cabinet', at: [-6.10, 4.01, -43.40], size: [2.57, 1.45], tint: 'cyan', text: 'BAR' },
  { id: 'violet mid distance blade', at: [-1.36, 5.47, -47.00], size: [.64, 3.61], tint: 'violet' },
  { id: 'magenta violet tower screen', at: [2.94, 5.61, -29.80], size: [4.99, 6.28], tint: 'magenta' },
  { id: 'amber upper tower cabinet', at: [7.78, 3.79, -30.12], size: [1.11, .72], tint: 'amber', text: '24H' },
  { id: 'amber lower tower cabinet', at: [7.70, 2.46, -30.10], size: [1.22, .83], tint: 'amber', text: 'OPEN' },
  { id: 'right amber facade sail', at: [13.00, 3.17, -30.20], size: [.30, 3.69], tint: 'amber' },
  { id: 'amber parapet exit', at: [5.45, 1.30, -9.76], size: [1.16, .41], tint: 'amber', text: 'EXIT' },
  { id: 'left warm parapet strip', at: [-5.83, .53, -9.83], size: [.69, .037], tint: 'strip', onWall: true },
  { id: 'right warm parapet strip', at: [5.35, .58, -9.83], size: [.76, .044], tint: 'strip', onWall: true },
] as const satisfies readonly Source[]

export function approvedHeroSourceSurvey(): { id: string; at: Tuple; normal: Tuple; size: readonly [number, number]; rgb: Tuple }[] {
  const up = new THREE.Vector3(0, 1, 0)
  const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(up, heroCityYaw).toArray()
  return approvedHeroSources.map(source => ({
    id: source.id,
    at: new THREE.Vector3(...source.at).applyAxisAngle(up, heroCityYaw).toArray(),
    normal,
    size: source.size,
    rgb: palette[source.tint],
  }))
}

export function addApprovedHeroLayout(parent: THREE.Object3D, labels: Label, materials: RoofMaterials) {
  const root = group(parent, 'approved hero layout')
  root.rotation.y = heroCityYaw
  const city = group(root, 'hero tower layout')
  const roof = group(root, 'hero parapet and near deck layout')
  const { parapet, zinc, stripe, tar } = materials
  const frame = new THREE.MeshStandardMaterial({ color: new THREE.Color(.035,.039,.048), roughness: .54, metalness: .59 })
  const glass = new THREE.MeshStandardMaterial({ color: new THREE.Color(.025,.027,.039), roughness: .33, metalness: .22 })
  const lights = new Map<string, FilmLight>()
  const signs: string[] = []
  let set = (_time: number) => {}
  const box = (parent: THREE.Object3D, name: string, at: Tuple, size: Tuple, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
    mesh.name = name
    mesh.position.set(...at)
    parent.add(mesh)
    return mesh
  }
  const mountLight = (housing: THREE.Group, donor: string, size: readonly [number, number], color: THREE.Color, intensity: number, range: number, shadow = false) => {
    const anchor = group(housing, 'area emitter origin', [0,0,.043])
    const unit = color.clone().multiplyScalar(1 / Math.max(color.r, color.g, color.b))
    const light: FilmLight = { id: housing.name, kind: 'area', object: anchor, color: unit, intensity, size: [...size], range, shadow, beam: false, level: () => 1 }
    lights.set(donor, light)
    return { light, anchor }
  }
  const towers = [
    ['hero left edge tower', -14.86, -29.55, 7.63, 8.21, 20.0, .098],
    ['hero hotel tower', -9.52, -32.25, 3.05, 6.75, 5.86, .127],
    ['hero parking tower', -9.96, -26.52, .66, 2.43, 4.48, .16],
    ['hero bar tower', -6.01, -43.56, 2.80, 5.37, 4.92, .103],
    ['hero violet tower', -1.69, -47.28, 2.08, 4.84, 8.74, .097],
    ['hero screen tower', 2.92, -30.01, 6.76, 5.96, 12.59, .106],
    ['hero amber tower', 7.77, -30.40, 2.74, 5.95, 10.68, .141],
    ['hero right edge tower', 15.43, -30.41, 5.56, 4.8, 18.93, .093],
    ['hero middle west distance', -10.78, -60.0, 2.15, 10.53, 8.41, .083],
    ['hero far west distance', -9.99, -83.0, 3.07, 10.63, 13.88, .074],
    ['hero middle center distance', -6.54, -65.0, .89, 11.77, 7.78, .084],
    ['hero far center distance', -4.76, -94.0, 2.79, 10.63, 14.54, .074],
    ['hero middle east distance', 17.27, -56.0, 2.82, 9.15, 8.33, .085],
  ] as const
  for (const [name, x, faceZ, width, depth, top, level] of towers) {
    const distant = faceZ < -50
    const tower = group(city, name + ' volume')
    const shell = towerSurface(name, level, distant)
    box(tower, name, [x, (streetY + top) / 2, faceZ - depth / 2], [width, top - streetY, depth], shell)
    box(tower, 'coated coping band', [x,top-.043,faceZ-depth/2], [width+.08,.12,depth+.09], frame)
    if (distant || width < 1) continue
    for (const side of [-1,1]) {
      box(tower, 'rainwater jamb', [x+side*(width/2-.068), (top-2.2)/2, faceZ + .021], [.092, top+2.20, .092], frame)
    }
    if (top > 7) {
      box(tower, 'roof service machine room', [x+width*.07,top+.34,faceZ-depth*.61], [width*.42,.68, depth*.32], shell)
      box(tower, 'raised inspection access lid', [x+width*.07,top+.70,faceZ-depth*.61], [width*.48,.078,depth*.36], frame)
    }
  }
  box(roof, 'hero full span concrete parapet', [0, .39, -10.025], [29, .78, .34], parapet)
  box(roof, 'hero concrete wall cap', [0, .767, -10.02], [29, .042, .377], parapet)
  box(roof, 'hero full span steel top rail', [0, 1.014, -10.015], [29, .053, .067], zinc)
  box(roof, 'hero steel intermediate rail', [0, .876, -10.015], [29, .027, .040], zinc)
  for (let i = -6; i <= 6; i++) {
    box(roof, 'hero rail post', [i * 2.35, .889, -10.015], [.057, .236, .057], zinc)
    box(roof, 'hero steel post mounting plate', [i * 2.35, .792, -10.015], [.125,.016,.112], zinc)
  }
  for (const source of approvedHeroSources as readonly Source[]) {
    const [x, y, z] = source.at
    const [width, height] = source.size
    const parent = source.onWall || source.id === 'amber parapet exit' ? roof : city
    const housing = group(parent, source.id, source.at)
    const lip = Math.min(width, height, .07) * .67
    box(housing, 'folded weatherproof cabinet', [0, 0, -.081], [width + 2*lip, height + 2*lip, .16], frame)
    const color = new THREE.Color(...palette[source.tint])
    if (source.id === 'magenta violet tower screen') {
      const mural = billboardMural(width, height)
      plate(housing, 'animated magenta violet mural', mural.material, [0,0,.002], width,height)
      for (const dx of [-.38,.38]) for (const dy of [-.36,0,.36]) {
        box(housing, 'billboard facade tie bracket', [dx*width,dy*height,-.19], [.12,.19,.30], zinc)
      }
      const { light } = mountLight(housing,'billboard',source.size,color,188,75)
      light.colorAt = mural.colorAt
      light.level = mural.level
      set = mural.set
    } else if (!source.text) {
      const segments = source.onWall ? 1 : Math.round(height / (source.tint === 'cyan' ? .34 : .50))
      plate(housing, 'weather-sealed opal face', fixtureOpal(color, segments), [0,0,.002], width,height)
      if (!source.onWall) for (const fraction of [-.40,-.17,.17,.40]) {
        box(housing, 'opal rail standoff', [0,fraction*height,-.184], [Math.max(width*.79,.081),.14,.27], zinc)
      }
    }
    if (source.id === 'amber parapet exit') {
      for (const dx of [-.39, .39]) {
        box(roof, 'steel wayfinding upright', [x + dx, .98, z - .23], [.073, .41, .12], zinc)
        box(housing, 'exit housing mount heel', [dx, -.11, -.16], [.12,.12,.26], frame)
      }
    }
    if (source.text) {
      const allowed = config.signage.generic.find(text => text === source.text)
      if (!allowed) throw new Error(`Unapproved hero layout sign: ${source.text}`)
      const rows = allowed === 'PARKING' ? [...allowed] : [allowed]
      plate(housing, 'recessed sign face', glass, [0,0,.002],width,height)
      const exit = allowed === 'EXIT'
      labelFace(housing, allowed, [exit ? -.16 : 0, 0, .009], [width * (exit ? .53 : .92), height * .91], labels, color, 'World Condensed', rows)
      if (exit) {
        const led = new THREE.MeshBasicMaterial({ color, toneMapped: false })
        box(housing, 'wayfinding arrow stem', [.293,.0,.012], [.244,.026,.005], led)
        for (const dir of [-1,1]) box(housing, 'wayfinding arrow head', [.386,dir*.038,.012], [.108,.025,.005],led).rotation.z = -dir*Math.PI/4
      } else if (allowed === 'HOTEL') {
        for (const dir of [-1,1]) box(housing, 'rooftop sign pedestal', [dir*width*.34,-height*.53,-.25], [.13,.23,.32], zinc)
      } else {
        for (const dir of [-1,1]) box(housing, 'facade sign mount cleat', [dir*width*.34,-height*.24,-.195], [.10,.11,.30], zinc)
      }
      signs.push(allowed)
    }
    if (source.id === 'left cyan facade sail') mountLight(housing,'east parking canopy fascia',source.size,color,67,66,true)
    if (source.id === 'right amber facade sail') mountLight(housing,'red deck marker',source.size,color,94,63)
    if (source.onWall) {
      const { anchor } = mountLight(housing, x < 0 ? 'doorway' : 'lane separator opal',source.size,color,7.2,18)
      anchor.rotation.x = .51
      for (const side of [-1,1]) box(housing, 'sealed parapet light end bracket', [side*(width/2+.012),0,-.022], [.045,height+.037,.15], zinc)
    }
  }
  box(roof, 'hero near bay line', [.48, .0014, 3.06], [.113, .0028, 2.85], stripe).rotation.y = .342
  const drain = group(roof,'hero near drain grate',[heroDrainLayout[0],0,heroDrainLayout[1]])
  drain.rotation.y = -.08
  for (const x of [-.253,.253]) box(drain,'iron grate end rim',[x,.0041,0],[.025,.0082,.24],zinc)
  for (const z of [-.111,.111]) box(drain,'iron grate side rim',[0,.0041,z],[.50,.0082,.018],zinc)
  box(drain,'recessed slot bed',[0,.0007,0],[.50,.0014,.22],tar)
  for (let i=0;i<21;i++) box(drain,'iron drainage bar',[(i-10)*.0234,.0059,0],[.010,.0047,.211],zinc)
  return { root, signs, lights, set }
}
