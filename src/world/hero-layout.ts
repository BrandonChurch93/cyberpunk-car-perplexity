import * as THREE from 'three'
import { config } from '../config'
import { labelFace, type Label } from './fixtures'
import { group, heroCityYaw, streetY, type Tuple } from './forms'

const gray = (n: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(n, n, n), toneMapped: false })
const palette = {
  cyan: [.055, 1.92, 3.00],
  white: [.98, 1.29, 1.49],
  amber: [3.48, 1.42, .24],
  violet: [1.06, .20, 2.32],
  magenta: [3.52, .19, 1.96],
  strip: [2.55, 1.80, 1.04],
} as const satisfies Record<string, Tuple>

type Tint = keyof typeof palette
type Source = { id: string; at: Tuple; size: readonly [number, number]; tint: Tint; text?: string; onWall?: boolean }

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

export function addApprovedHeroLayout(parent: THREE.Object3D, labels: Label): { root: THREE.Group; signs: string[] } {
  const root = group(parent, 'approved hero layout')
  root.rotation.y = heroCityYaw
  const city = group(root, 'hero tower layout')
  const roof = group(root, 'hero parapet and near deck layout')
  const wall = gray(.18), metal = gray(.09), inset = gray(.024), concrete = gray(.25)
  const signs: string[] = []
  const box = (parent: THREE.Object3D, name: string, at: Tuple, size: Tuple, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
    mesh.name = name
    mesh.position.set(...at)
    parent.add(mesh)
    return mesh
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
    box(city, name, [x, (streetY + top) / 2, faceZ - depth / 2], [width, top - streetY, depth], gray(level))
  }
  box(roof, 'hero full span concrete parapet', [0, .39, -10.025], [29, .78, .34], wall)
  box(roof, 'hero full span steel top rail', [0, 1.014, -10.015], [29, .053, .067], metal)
  for (let i = -6; i <= 6; i++) box(roof, 'hero rail post', [i * 2.35, .889, -10.015], [.057, .236, .057], metal)
  for (const source of approvedHeroSources as readonly Source[]) {
    const [x, y, z] = source.at
    const [width, height] = source.size
    const parent = source.onWall || source.id === 'amber parapet exit' ? roof : city
    const housing = group(parent, source.id, source.at)
    box(housing, 'layout casing', [0, 0, -.081], [width + .09, height + .09, .16], inset)
    const color = new THREE.Color(...palette[source.tint])
    if (source.id === 'magenta violet tower screen') {
      for (let i = 0; i < 8; i++) {
        const section = color.clone().lerp(new THREE.Color(.76, .13, 3.48), i / 7)
        box(housing, 'layout billboard color bay', [width * ((i + .5) / 8 - .5), 0, 0], [width / 8, height, .012], new THREE.MeshBasicMaterial({ color: section, toneMapped: false }))
      }
    } else if (!source.text) {
      box(housing, 'layout luminous face', [0, 0, 0], [width, height, .012], new THREE.MeshBasicMaterial({ color, toneMapped: false }))
    }
    if (source.id === 'amber parapet exit') {
      for (const dx of [-.39, .39]) box(roof, 'layout exit anchor', [x + dx, .96, z - .23], [.073, .41, .12], metal)
    }
    if (source.text) {
      const allowed = config.signage.generic.find(text => text === source.text)
      if (!allowed) throw new Error(`Unapproved hero layout sign: ${source.text}`)
      const rows = allowed === 'PARKING' ? [...allowed] : [allowed]
      box(housing, 'layout translucent sign face', [0, 0, 0], [width, height, .012], new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(.028), toneMapped: false }))
      labelFace(housing, allowed, [0, 0, .009], [width * .92, height * .91], labels, color, 'World Condensed', rows)
      signs.push(allowed)
    }
  }
  box(roof, 'hero near bay line', [.48, .0018, 3.06], [.113, .0036, 2.85], concrete).rotation.y = .342
  box(roof, 'hero near drain rim', [.82, .0032, 3.82], [.53, .0064, .24], metal).rotation.y = -.08
  box(roof, 'hero near drain slot placeholder', [.82, .0064, 3.82], [.46, .0016, .185], inset).rotation.y = -.08
  return { root, signs }
}
