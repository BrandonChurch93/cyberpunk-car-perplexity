import * as THREE from 'three'
import { config } from '../config'
import type { FilmLight } from '../core/contract'
import { deckReflectionTrim, paintBayLine } from './deck-reflection-trim'
import { plate, type Label } from './fixtures'
import { group, heroCityYaw, heroDrainLayout, streetY, type Tuple } from './forms'
import { heroFrontageDistance, heroPoint, heroScale as scale, heroSize } from './hero-scale'
import { billboardMural, fixtureOpal, signGlass, towerSurface, type Facade, type FacadeLayer, type SignSpill } from './hero-surfaces'
import { reflectionPracticalBuilder } from './reflection-practicals'
import type { finishRoof } from './roof-look'

const palette = {
  cyan: [.066, 2.96, 4.31],
  white: [3.85, 4.77, 6.32],
  amber: [5.14, 2.39, .41],
  violet: [1.20, .25, 2.75],
  magenta: [2.43, .054, .90],
  strip: [6.73, 4.17, 2.12],
} as const satisfies Record<string, Tuple>

type Tint = keyof typeof palette
type Source = { id: string; at: Tuple; size: readonly [number, number]; tint: Tint; text?: string; onWall?: boolean; yaw?: number; scale?: number }
type RoofMaterials = ReturnType<typeof finishRoof>['materials']
const screenTowerFront = -30.01
export const heroScreenMount = { at: [2.94,5.09,-29.80], yaw: -.32, scale: scale.screen*.972 } as const
const signRadiance: Readonly<Record<string,number>> = { HOTEL: 4.1, PARKING: 3.0, BAR: 4.2, '24H': 3.4, OPEN: 4.1, EXIT: 2.7 }
const opalRadiance: Readonly<Record<string,number>> = {
  'left cyan facade sail': 2.3, 'left cyan secondary strip': 2.25,
  'cyan garage rise': 2.7, 'cyan garage return': 4.0, 'cyan hotel facade strip': 3.7,
  'violet mid distance blade': 4.8,
  'right amber facade sail': 2.8, 'amber garage rise': 2.65, 'amber garage return': 4.15,
  'left warm parapet strip': 1.7, 'right warm parapet strip': 1.7,
}
const cyanApertures: Readonly<Partial<Record<string,readonly [width: number, gain: number]>>> = {
  'left cyan facade sail': [.83,1.54], 'left cyan secondary strip': [.62,1.48],
  'cyan garage rise': [.69,1.38], 'cyan garage return': [.43,1.60], 'cyan hotel facade strip': [.82,1.56],
}

export const approvedHeroSources = [
  { id: 'left cyan facade sail', at: [-11.76, 6.42, -29.40], size: [.139, 11.05], tint: 'cyan', scale: scale.leftBlade },
  { id: 'left cyan secondary strip', at: [-12.03, 5.56, -29.38], size: [.16, 9.76], tint: 'cyan', scale: scale.leftBlade },
  { id: 'cyan garage rise', at: [-8.88, 3.80, -25.23], size: [.26, 2.67], tint: 'cyan', scale: scale.westFrontage },
  { id: 'cyan garage return', at: [-6.92, 3.61, -25.23], size: [.19, 2.84], tint: 'cyan', scale: scale.westFrontage },
  { id: 'hotel rooftop cabinet', at: [-9.59, 6.95, -32.10], size: [2.65, .98], tint: 'cyan', text: 'HOTEL', scale: scale.hotel },
  { id: 'white parking blade', at: [-9.93, 3.47, -26.35], size: [.78, 4.34], tint: 'white', text: 'PARKING', scale: scale.parking },
  { id: 'cyan hotel facade strip', at: [-8.43, 3.13, -25.23], size: [.07, 4.52], tint: 'cyan', scale: scale.westFrontage },
  { id: 'far cyan bar cabinet', at: [-6.10, 4.01, -43.40], size: [2.57, 1.45], tint: 'cyan', text: 'BAR', scale: scale.bar },
  { id: 'violet mid distance blade', at: [-1.48, 5.38, -31.64], size: [.44, 2.58], tint: 'violet', scale: scale.screen },
  { id: 'magenta violet tower screen', ...heroScreenMount, size: [5.08,5.18], tint: 'magenta' },
  { id: 'magenta upper service ribbon', at: [2.62, 15.79, -30.02], size: [3.22, .37], tint: 'magenta', scale: scale.screen },
  { id: 'cool glass service ribbon', at: [1.20, 16.91, -30.10], size: [1.58, .26], tint: 'cyan', scale: scale.screen },
  { id: 'amber upper tower cabinet', at: [7.44, 3.79, -30.12], size: [1.11, .72], tint: 'amber', text: '24H', scale: scale.amber },
  { id: 'amber lower tower cabinet', at: [7.46, 2.46, -30.10], size: [1.22, .83], tint: 'amber', text: 'OPEN', scale: scale.amber },
  { id: 'right amber facade sail', at: [13.00, 3.17, -30.20], size: [.098, 3.14], tint: 'amber', scale: scale.rightBlade },
  { id: 'amber garage rise', at: [7.24, 3.51, -17.61], size: [.23, 2.64], tint: 'amber', scale: scale.eastFrontage },
  { id: 'amber garage return', at: [7.76, 3.31, -17.61], size: [.12, 2.23], tint: 'amber', scale: scale.eastFrontage },
  { id: 'amber parapet exit', at: [5.45, 1.30, -9.76], size: [1.16, .41], tint: 'amber', text: 'EXIT' },
  { id: 'left warm parapet strip', at: [-5.83, .53, -9.83], size: [.69, .037], tint: 'strip', onWall: true },
  { id: 'right warm parapet strip', at: [5.35, .58, -9.83], size: [.76, .044], tint: 'strip', onWall: true },
] as const satisfies readonly Source[]

export function approvedHeroSourceSurvey(): { id: string; at: Tuple; normal: Tuple; size: readonly [number, number]; rgb: Tuple; scale: number }[] {
  const up = new THREE.Vector3(0, 1, 0)
  return (approvedHeroSources as readonly Source[]).map(source => ({
    id: source.id,
    at: new THREE.Vector3(...heroPoint(source.at,source.scale ?? 1)).applyAxisAngle(up, heroCityYaw).toArray(),
    normal: new THREE.Vector3(0, 0, 1).applyAxisAngle(up, heroCityYaw + (source.yaw ?? 0)).toArray(),
    size: [source.size[0]*(source.scale ?? 1),source.size[1]*(source.scale ?? 1)],
    rgb: palette[source.tint],
    scale: source.scale ?? 1,
  }))
}

export function addApprovedHeroLayout(parent: THREE.Object3D, labels: Label, materials: RoofMaterials) {
  const root = group(parent, 'approved hero layout')
  root.rotation.y = heroCityYaw
  const city = group(root, 'hero tower layout')
  const roof = group(root, 'hero parapet and near deck layout')
  const { heroWall, zinc, heroStripe, tar } = materials
  const frame = new THREE.MeshStandardMaterial({ color: new THREE.Color(.035,.039,.048), roughness: .54, metalness: .59 })
  const oxidizedAluminum = new THREE.MeshStandardMaterial({ color: new THREE.Color(.033,.038,.041), roughness: .61, metalness: .38 })
  const charcoalConcrete = new THREE.MeshStandardMaterial({ color: new THREE.Color(.054,.052,.049), roughness: .83, metalness: .06 })
  const glass = new THREE.MeshStandardMaterial({ color: new THREE.Color(.025,.027,.039), roughness: .33, metalness: .22 })
  const distantGlass = glass.clone()
  const offset = <T extends THREE.Material>(mat: T, units: number): T => {
    mat.polygonOffset = true
    mat.polygonOffsetFactor = -1
    mat.polygonOffsetUnits = units
    return mat
  }
  offset(distantGlass,-2)
  const lights = new Map<string, FilmLight>()
  const signs: string[] = []
  const practical = reflectionPracticalBuilder(labels, frame, zinc)
  const deckTrim = deckReflectionTrim(frame,zinc)
  const animation: ((time: number) => void)[] = []
  const survey = approvedHeroSourceSurvey()
  const screen = survey.find(source => source.id === 'magenta violet tower screen')!
  const screenReflection = { point: new THREE.Vector3(...screen.at), normal: new THREE.Vector3(...screen.normal), size: new THREE.Vector2(...screen.size) }
  const washes = [
    ['left edge','left cyan facade sail'],
    ['hotel tower','hotel rooftop cabinet'],
    ['parking tower','white parking blade'],
    ['west garage','cyan garage rise'],
    ['bar tower','far cyan bar cabinet'],
    ['setback','violet mid distance blade'],
    ['screen tower','magenta violet tower screen'],
    ['amber tower','amber upper tower cabinet'],
    ['right edge','right amber facade sail'],
    ['east garage','amber garage rise'],
  ] as const
  const spillAt = (name: string): SignSpill[] => {
    const key = washes.find(([fragment]) => name.includes(fragment))?.[1]
    const amber = key === 'amber upper tower cabinet'
    return survey.filter(source => source.id === key || amber && source.id === 'amber lower tower cabinet').map(entry => {
      const color = new THREE.Color(...entry.rgb)
      color.multiplyScalar((amber ? 1.65 : .68)/Math.max(color.r,color.g,color.b))
      return { point: new THREE.Vector3(...entry.at), size: new THREE.Vector2(...entry.size), color }
    })
  }
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
    const k = housing.scale.x
    const light: FilmLight = { id: housing.name, kind: 'area', object: anchor, color: unit,
      intensity: intensity*k*k, size: [size[0]*k,size[1]*k], range: range*k, shadow, beam: false, level: () => 1 }
    lights.set(donor, light)
    return { light, anchor }
  }
  const infill = [
    ['c9 west dispatch', -114.4, -615, 13.8, 31, 65, .060, 1.02],
    ['c9 west stepped roof', -126.1, -808, 13.4, 29, 134, .067, 1],
    ['c9 west telephone exchange', -146.4, -985, 16.9, 34, 119, .049, 1],
    ['c9 center kiln tower', -88.8, -682, 9.8, 23, 91, .070, 1],
    ['c9 center fluted offices', -58.7, -807, 11.6, 31, 120, .074, 1],
    ['c9 center upper lift', -89.6, -1060, 15.7, 37, 140, .057, 1],
    ['c9 center communications', -43.0, -768, 10.8, 38, 105, .077, 1],
    ['c9 center distant crown', -18.2, -926, 10.2, 35, 151, .065, 1],
    ['c9 east narrow stair', 127.6, -435, 10.5, 22, 82, .079, 1.28],
    ['c9 east relay court', 198.1, -586, 14.4, 38, 112, .070, 1.02],
    ['c9 east glass exchange', 235.7, -784, 18.0, 48, 153, .070, 1],
    ['c9 east lit switchyard', 271.8, -1033, 15.4, 36, 148, .058, 1],
    ['c9 center exchange stairs', -53.8, -639, 10.1, 22, 106, .057, 1],
    ['c9 center clock stack', -36.4, -654, 12.1, 24, 112, .065, 1],
  ] as const
  const towers = [
    ['hero left edge tower', -33.25, -75.2, 16.1, 3.3, 99.8, .069, scale.leftEdge],
    ['hero hotel tower', -9.67, -32.25, 3.15, 3.90, 6.52, .127, scale.hotel],
    ['hero parking tower', -9.98, -26.52, .94, 2.43, 5.78, .092, scale.parking],
    ['hero near west garage bay', -7.83, -25.40, 2.78, 4.15, 5.07, .079, scale.westFrontage],
    ['hero bar tower', -6.01, -43.56, 2.80, 5.37, 4.92, .103, scale.bar],
    ['hero violet tower', -1.69, -47.28, 2.08, 4.84, 8.74, .097, 11.7],
    ['hero screen tower', 2.92, screenTowerFront, 6.76, 5.96, 12.59, .106, scale.screen],
    ['hero tower setback glass wing', -1.29, -31.79, 1.34, 3.67, 6.16, .087, scale.screen],
    ['hero amber tower', 7.77, -30.40, 2.74, 5.95, 10.68, .141, scale.amber],
    ['hero right edge tower', 32.82, -73.5, 11.64, 11.8, 91.8, .069, scale.rightEdge],
    ['hero near east garage bay', 7.22, -17.79, 1.88, 3.91, 5.27, .057, scale.eastFrontage],
    ['hero middle west distance', -10.91, -60.0, 1.48, 7.24, 9.14, .080, scale.middleWest],
    ['hero far west distance', -9.10, -83.0, 2.15, 7.90, 13.76, .068, 8.73],
    ['hero middle center distance', -6.54, -65.0, 1.20, 8.17, 8.23, .080, 9.55],
    ['hero far center distance', -5.11, -94.0, 2.02, 7.56, 13.11, .064, 8.4],
    ['hero middle east distance', 17.27, -56.0, 2.82, 9.15, 8.33, .085, 9.34],
    ['outer west exchange glass tower', -43.4, -157, 17.9, 15.7, 21.30, .059, 3.84],
    ['outer west bank setback', -75.6, -279, 19.2, 23.6, 33.21, .049, 2.65],
    ['far west communications stack', -98.3, -433, 24.8, 28.4, 45.77, .047, 2.3],
    ['far west narrow crown', -42.15, -337, 7.6, 15.3, 41.24, .044, scale.farWest],
    ['far central west glass tower', -57.9, -346, 10.8, 17.7, 42.35, .047, scale.farCentralWest],
    ['far inner west glass crown', -25.63, -363, 7.12, 15.9, 42.4, .045, 2.62],
    ['far central recessed slab', -8.89, -323, 7.35, 15.0, 43.1, .045, 3.18],
    ['rear middle glass stack', -51.9, -469, 12.9, 23.1, 58.9, .040, 2.25],
    ['outer east hotel glass slab', 37.4, -151, 12.9, 20.7, 79.1, .052, scale.outerEast],
    ['outer east relay shaft', 44.5, -219, 17.1, 19.8, 114.2, .046, 3.18],
    ['far east financial tower', 64.1, -293, 24.1, 26.2, 161.7, .042, 3.15],
    ['far east taper', 111.6, -459, 28.6, 31.8, 221.4, .046, 2.41],
    ['far east desk block', 83.2, -530, 21.7, 28.8, 85.4, .050, 2.02],
    ['outer skyline service stack', 172.1, -615, 39.1, 41.1, 187.8, .047, 1.98],
    ...infill,
  ] as const
  const scaledBox = (parent: THREE.Object3D, name: string, at: Tuple, size: Tuple, material: THREE.Material, k: number) =>
    box(parent,name,heroPoint(at,k),heroSize(size,k),material)
  const groundedBox = (parent: THREE.Object3D, name: string, x: number, top: number, z: number, width: number, depth: number, material: THREE.Material, k: number) => {
    const [xx,roofY,zz] = heroPoint([x,top,z],k)
    return box(parent,name,[xx,(roofY+streetY)*.5,zz],[width*k,roofY-streetY,depth*k],material)
  }
  const facadeOf = (name: string, n: number): Facade => /hotel|amber tower/.test(name) ? 'hotel' :
    /screen|glass|left edge/.test(name) ? 'curtain' : /parking|garage|service/.test(name) ? 'concrete' :
      (['banded','curtain','concrete'] as const)[n%3]!
  const edgeCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(.047,3.1,5.4), toneMapped: false })
  const edgePink = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.30,.066,.91), toneMapped: false })
  const edgeRust = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.13,.54,.13), toneMapped: false })
  const crownCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(.17,1.03,1.57), toneMapped: false })
  const crownViolet = new THREE.MeshBasicMaterial({ color: new THREE.Color(.62,.27,1.36), toneMapped: false })
  const safetyRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.1,.052,.079), toneMapped: false })
  const towerBladeWords = new Map([[5,'24H'],[12,'HOTEL'],[14,'OPEN'],[19,'BAR'],[21,'KARAOKE']])
  const centerAccent = new THREE.Color(1.68,.14,.76)
  const centerOpal = new THREE.MeshBasicMaterial({ color: centerAccent, toneMapped: false })
  for (const [index,[name, x, faceZ, width, depth, top, level, k]] of towers.entries()) {
    const z = faceZ-depth*.5
    const tower = group(city, name + ' volume')
    const [wx,wy,wz] = heroPoint([x,top,z],k)
    const w = width*k, d = depth*k
    const distance = heroFrontageDistance(wx,wz+d*.5)
    const layer: FacadeLayer = distance < 620 ? 'near' : distance < 840 ? 'middle' : 'far'
    const facade = facadeOf(name,index)
    const shell = towerSurface(name, level, facade, screenReflection, spillAt(name),layer)
    groundedBox(tower,name,x,top,z,width,depth,shell,k)
    deckTrim.tower(tower,name,wx,wz+d*.5,w)
    box(tower,'folded coping band',[wx,wy-.52,wz],[w+.28,1.5,d+.28],frame)
    if (w > 9 && index !== 6) {
      const px = w*.5, pz = wz+d*.5
      const sides = index % 3 === 0 ? [-1,1] : [index%2===0 ? 1 : -1]
      const count = facade === 'concrete' ? 3 : 5
      const depth = facade === 'concrete' ? .62 : .43
      const material = facade === 'concrete' ? charcoalConcrete : oxidizedAluminum
      const fins = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material,sides.length*count)
      const transform = new THREE.Matrix4()
      fins.name = 'extruded curtain wall fins'
      let slot = 0
      for (const side of sides) for (let i=0;i<count;i++) {
        const length = (wy-streetY)*(.69+.071*((i+index)%4))
        const width = facade === 'concrete' ? .72 : .34+.057*(i%3)
        transform.makeScale(width,length,depth)
        transform.setPosition(wx+side*(px-Math.min(w*.20,1.05+i*1.36)),wy-.81-length*.5,pz+depth*.22)
        fins.setMatrixAt(slot++,transform)
      }
      fins.instanceMatrix.needsUpdate = true
      fins.computeBoundingBox()
      tower.add(fins)
    }
    if (faceZ >= -50 && width >= 1) {
      for (const side of [-1,1]) groundedBox(tower,'rainwater jamb',x+side*(width/2-.068),top,faceZ+.021,.092,.092,frame,k)
    }
    if (index !== 1 && index !== 2 && wy > 62 && w > 10) {
      const stepped = [11,12,20].includes(index)
      const flat = [13,14,21].includes(index)
      const crownH = stepped ? 6.7 : flat ? 1.42 : index%4===0 ? 7.3 : index%3===0 ? 4.9 : 2.55
      const crownW = w*(flat ? .86 : .52)
      box(tower,'setback service penthouse',[wx+w*.08,wy+crownH*.5,wz-d*.14],[crownW,crownH,d*.48],shell)
      box(tower,'penthouse coping',[wx+w*.08,wy+crownH,wz-d*.14],[crownW+.37,.47,d*.50],frame)
      if (stepped) {
        box(tower,'upper crown step',[wx-w*.02,wy+crownH+1.55,wz-d*.18],[w*.29,3.10,d*.29],shell)
        box(tower,'upper crown coping',[wx-w*.02,wy+crownH+3.1,wz-d*.18],[w*.30,.34,d*.30],frame)
      }
      if ([5,11,13,18,19,21,23,26].includes(index)) {
        const px = wx-w*.27, pz = wz-d*.09
        const hatch = index%2===0 ? 3.4 : 5.3
        box(tower,'offset concrete roof shaft',[px,wy+hatch*.5,pz],[w*.195,hatch,d*.37],charcoalConcrete)
        box(tower,'shaft angled overrun cap',[px,wy+hatch+.28,pz],[w*.206,.57,d*.39],oxidizedAluminum)
        for (const dx of [-.27,0,.27]) {
          box(tower,'shielded red crown lens',[px+w*.195*dx,wy+hatch*.74,pz+d*.188],[.49,.28,.16],safetyRed)
        }
      }
      if ([5,12,13,14,18,19,20,22,23].includes(index)) {
        const crown = group(tower,'lit setback cornice',[wx+w*.08,wy+crownH*.74,wz+d*.104])
        box(crown,'louvred top band backing',[0,0,0],[w*.482,.82,.38],frame)
        for (const lx of [-.16,-.054,.054,.16]) {
          box(crown,'recessed crown opal',[w*lx,0,.21],[w*.096,.44,.09],index%3===1 ? crownViolet : crownCyan)
        }
      }
      if ([5,11,12,14,18,19,21,22,27].includes(index)) {
        const py = wy+crownH, arm = flat ? 2.26 : [5,19].includes(index) ? 11.9 : crownH*.67+3.0
        box(tower,'rooftop riser mast',[wx+w*.07,py+arm*.5,wz-d*.10],[.32,arm,.32],frame)
        box(tower,'rooftop mast crossbar',[wx+w*.07,py+arm*.71,wz-d*.10],[arm*.51,.13,.12],zinc)
        box(tower,'mast obstruction lens',[wx+w*.07,py+arm,wz-d*.10],[.52,.46,.52],safetyRed)
      }
      for (const side of [-1,1]) {
        const px = wx+side*w*.27
        box(tower,'roof condenser bank',[px,wy+1.15,wz+d*.23],[Math.min(4.6,w*.21),2.3,Math.min(3.4,d*.21)],frame)
        box(tower,'condenser top cowls',[px,wy+2.45,wz+d*.23],[Math.min(4.9,w*.23),.3,Math.min(3.7,d*.23)],zinc)
        if (wy > 100) {
          const py = wy+crownH
          const mastX = wx+w*(.08+side*.235)
          box(tower,'aviation beacon mount',[mastX,py+1.25,wz-d*.14],[.23,2.5,.23],frame)
          box(tower,'aviation beacon lens',[mastX,py+2.53,wz-d*.14],[.69,.40,.69],safetyRed)
        }
      }
    }
    const addRail = (id: string, px: number, py: number, pz: number, length: number, face: THREE.Material, edge: boolean, breadth: number) => {
      box(tower,id+' carrier',[px,py,pz],[breadth+.43,length+.71,.64],frame)
      box(tower,id,[px,py,pz+.35],[breadth,length,.11],face)
      if (edge) box(tower,id+' return',[px+breadth*.5+.25,py,pz],[.12,length,.47],face)
    }
    if (index === 0) {
      const pz = wz+d*.5
      for (const [fraction,breadth] of [[.405,.66],[.485,.83]]) {
        addRail('full height cyan cornice',wx+w*fraction,(wy+streetY)*.5,pz,wy-streetY-.92,edgeCyan,true,breadth)
      }
      const base = 77, crownW = 9.4
      box(tower,'left upper service setback',[wx+w*.5+crownW*.19,(wy+base)*.5,wz-d*.04],[crownW,wy-base,d*.73],shell)
      box(tower,'left wing folded floor lip',[wx+w*.5+crownW*.19,base-.28,wz-d*.04],[crownW+.2,.56,d*.75],frame)
      practical.cabinet(tower,'west vertical tailor blade',[wx+w*.5+crownW*.50,87.0,wz+d*.325+.64],
        [2.76,14.6],[1.12,7.85,11.4],'TAILOR',true,2.85,.12)
      signs.push('TAILOR')
      for (const [side, length, radiance] of [[-.35,147,24],[-.09,216,31],[.22,191,28]]) {
        const x = wx+side*w
        practical.opal(tower,'upper cyan facade lightwell',[x,156+length*.5,pz+.48],[2.16,length],[.06,radiance*.67,radiance],13)
        practical.opal(tower,'pale cyan lightwell core',[x+.69,156+length*.5,pz+.57],[.30,length*.97],[6.8,23,31],13)
      }
      animation.push(practical.screen(tower,'west violet media blade',[wx+.381*w,188,pz+.63],[5.45,60],
        [10.2,.32,3.39],[1.91,.45,11.7],1.04,.78))
    } else if (index === 6) {
      const pz = wz+d*.50
      const riser = group(tower,'billboard upper media riser')
      const [wingX,wingZ] = [wx-w*.63,pz-7.2]
      const bridge = group(riser,'screen tower upper service skybridge',[49,332,pz-.50])
      box(bridge,'skybridge structural shell',[0,0,-12.5],[208,25.6,25.0],shell)
      box(bridge,'bridge observation gallery glazing frame',[-90,-.6,.28],[25.5,16.4,.56],frame)
      for (const [row,y] of [-5.8,-.2,5.4].entries()) {
        for (const [col,x] of [-98.6,-90,-81.4].entries()) {
          if ((row+col*2)%4===2) continue
          practical.opal(bridge,'high bridge window bay',[x,y,.79],[5.5,3.45],
            row===0 ? [3.3,2.15,1.28] : [.58,2.72,4.13],1)
        }
      }
      practical.cabinet(bridge,'high bridge service sign',[-76,9.3,.78],[15.2,3.45],[7.3,3.15,.69],'24H')
      box(riser,'skybridge east abutment',[148,332,pz+6.0],[15,25.6,20.3],shell)
      box(riser,'upper advertising wing',[wingX,438,wingZ],[w*.82,214,14.4],shell)
      const media = group(riser,'upper reflection accents',[wingX,438,pz+.21])
      box(media,'folded service panel',[-9,-53,-.04],[38,14,.43],frame)
      for (const [i,x] of [-22,-15.2,-8.4,5.2].entries()) {
        practical.opal(media,'upper warm gallery window',[x,-53,.28],[4.25,3.2],
          i===2 ? [.65,2.10,3.8] : [5.7,3.4,1.58],1)
      }
      practical.cabinet(media,'upper cyan tenant blade',[12,-83,.41],[3.1,20],[.20,5.1,8.2],'OPEN',true)
      practical.cabinet(media,'upper amber tenant blade',[-21,-19,.41],[3.4,17.5],[7.0,3.0,.73],'24H',true)
      practical.opal(media,'upper cyan cornice line',[-10,18,.28],[13.8,1.98],[.13,4.8,8.7],1)
      practical.opal(media,'upper magenta switchboard',[13,58,.35],[7.7,5.2],[7.9,.27,3.55],2)
      practical.cabinet(media,'upper magenta tenant blade',[-16,78,.41],[3.5,15.8],[7.9,.41,4.55],'BAR',true)
      for (const [ladder,width] of [[.447,.49],[.473,.67]]) {
        for (let j=0;j<8;j++) {
          addRail('recessed red-orange tower tracer',wx+w*ladder,wy-(wy-streetY)*.35-j*5.4,pz,3.10,edgeRust,false,width)
        }
      }
    } else if (index === 9) {
      const pz = wz+d*.5
      for (const [j, floor] of [.591,.617,.637,.687,.740,.793,.859,.894,.922].entries()) {
        const ribbon = j%3 === 0
        const n = ribbon ? 3 : 4+(j%3)
        for (let i=0;i<n;i++) {
          const cx = wx+(i-(n-1)*.5)*7.5+(j%2 ? .12 : -.12)*w
          practical.opal(tower,'warm tower service floor',[cx,wy*floor,pz+.38],[ribbon ? 7.26 : 5.1,ribbon ? 2.7 : 3.3],
            j%3 === 1 ? [19,12.4,5.6] : [24,9.1,1.9],1)
        }
      }
      practical.cabinet(tower,'high amber rooftop wayfinding',[wx-10,wy*.817,pz+.67],[20,8.0],[28,10.2,2.4],'24H')
      practical.cabinet(tower,'high amber hotel wayfinding',[wx+5,wy*.979,pz+.66],[30,5.2],[22,11.1,3.9],'HOTEL')
    } else if ([7,11,20,24,26].includes(index)) {
      const litH = (wy-streetY)*.49
      addRail('recessed facade edge tracer',wx+w*(index%2 ? -.44 : .45),streetY+litH*.98,wz+d*.5,litH,
        index%3===0 || index===7 ? edgePink : edgeCyan,false,index===7 ? .31 : .45)
    }
    if ([5,11,12,13,14,15,19,20,21,22,23,24].includes(index)) {
      const pz = wz+d*.5
      const word = config.signage.generic.find(text => text === towerBladeWords.get(index))
      const tone = index%3===0 ? centerOpal : crownCyan
      const bx = wx+w*(index%2===0 ? -.36 : .33)
      const by = wy-(wy-streetY)*.41
      const length = Math.min(15.8,(wy-streetY)*.21)
      addRail('sectional lift service spine',bx,by+length*.24,pz,length,tone,false,index%2===0 ? .62 : .84)
      if (word) {
        const signH = word.length>=5 ? 13.8 : 8.7
        const signW = 2.66
        const axial = wx+w*(index%2===0 ? .28 : -.24)
        const cabinet = group(tower,'vertical tenant LED cabinet',[axial,by-6.7,pz+.35])
        box(cabinet,'anodised cabinet back',[0,0,0],[signW+.48,signH+.52,.64],frame)
        for (const yy of [-signH*.38,signH*.38]) box(cabinet,'cabinet shear arm',[0,yy,-.22],[1.27,.27,.87],zinc)
        const glyphs = labels(word,'World Condensed',[...word],signW/signH)
        plate(cabinet,'vertical magenta LED opal',glyphs ? signGlass(glyphs,centerAccent,signW,signH,true,3.4) : centerOpal,
          [0,0,.34],signW,signH)
        signs.push(word)
      }
    }
    if (index === 3 || index === 4 || index === 11) {
      const pz = wz+d*.50+.58
      if (index === 3) {
        practical.cabinet(tower,'west cyan arcade shopfront',[wx+w*.363,8.7,pz],[6.68,2.48],[.18,8.2,12.2],'ARCADE',false,3.1)
        signs.push('ARCADE')
      } else if (index === 11) {
        practical.cabinet(tower,'middle cyan noodle shopfront',[wx-w*.031,12.6,pz],[7.62,3.12],[.25,8.6,13.9],'NOODLES',false,3.3)
        signs.push('NOODLES')
      } else {
        practical.cabinet(tower,'low magenta bar shopfront',[wx-w*.322,10.7,pz],[4.88,2.27],[10.3,.35,4.84],'BAR',false,2.4)
        signs.push('BAR')
      }
    }
    if (index === 8 || index === 9) {
      const pz = wz + d*.5
      for (const [n, dx] of [-.44,.36].entries()) {
        const length = index===8 ? 3.7 : 6.3
        const base = index===8 ? wy*.47 : 52
        for (let i = 0; i < 4; i++) addRail('stacked service opal',wx+w*dx,base+i*(length+1.10),pz,
          length,n===0 ? crownCyan : edgeRust,false,index===8 ? .61 : .82)
      }
    }
    if (index === 8) deckTrim.eastOffices(tower,wx,wz+d*.5)
    if (index === 8 || index === 9 || index === 10) {
      const pz = wz+d*.5
      const markers = index === 8 ? [[-.372,69.3],[-.372,74.5],[-.371,80.1],[.248,59.8],[.247,67.4]]
        : index === 9 ? [[-.429,59.1],[-.409,72.4],[-.428,89.5],[-.442,98.1]]
        : [[.224,52.2],[.227,58.6],[.151,68.3],[.125,74.1]]
      for (const [j,[fraction,y]] of markers.entries()) {
        practical.opal(tower,'east facade service marker',[wx+w*fraction,y,pz+.116],
          [j%2===0 ? .54 : .37,j%3===0 ? .43 : .33],j%3===0 ? [7.15,2.86,.83] : [8.3,.19,.115],1)
      }
    }
    if (index === 10) {
      const px = wx-w*.14, pz = wz+d*.50+.50
      practical.cabinet(tower,'stacked amber arcade cabinet',[px,wy-11.4,pz],[5.67,1.94],[5.42,2.73,.72],'ARCADE',false,3.8)
      practical.cabinet(tower,'stacked amber noodle cabinet',[px,wy-7.0,pz],[5.53,1.53],[5.07,3.13,1.16],'NOODLES',false,3.5)
      practical.cabinet(tower,'east violet vertical sauna blade',[wx+w*.37,36.4,pz],[1.55,14.0],[2.8,.54,4.6],'SAUNA',true,2.75)
      practical.opal(tower,'east cold stair tracer',[wx-w*.39,27.7,pz],[.81,21.6],[.16,5.7,9.4],7)
      practical.cabinet(tower,'east amber upper office cabinet',[wx+w*.145,47.3,pz],[3.7,2.02],[3.85,1.98,.51],'24H',false,3.15)
      signs.push('SAUNA')
    }
    if (name.startsWith('c9 ')) {
      const pz = wz+d*.5
      const step = name.includes('stepped') || name.includes('communications') || name.includes('relay')
      const upperW = w*(step ? .48 : .73)
      const upperH = step ? 6.4 : 2.7
      box(tower,'narrow rooftop volume',[wx-w*.10,wy+upperH*.5,wz-d*.09],[upperW,upperH,d*.58],shell)
      box(tower,'metal coping to narrow rooftop',[wx-w*.10,wy+upperH,wz-d*.09],[upperW+.22,.44,d*.59],zinc)
      if (name.includes('communications') || name.includes('telephone') || name.includes('relay')) {
        box(tower,'steel rooftop signal mast',[wx-w*.13,wy+upperH+3.9,wz-d*.09],[.32,7.8,.32],frame)
        box(tower,'rooftop signal obstruction lens',[wx-w*.13,wy+upperH+7.8,wz-d*.09],[.51,.34,.51],safetyRed)
      }
      if (name === 'c9 west stepped roof' || name === 'c9 center fluted offices' || name === 'c9 east relay court') {
        const cool = name !== 'c9 west stepped roof'
        practical.opal(tower,'small stepped cornice lens',[wx-w*.1,wy-.92,pz+.56],[w*.59,1.12],cool ? [.12,2.1,3.3] : [2.95,1.83,.73],3)
      }
      if (name === 'c9 center kiln tower') {
        practical.cabinet(tower,'small cyan center lift sign',[wx-w*.12,67.4,pz+.58],[3.91,2.50],[.08,3.2,5.7],'OPEN',false,3.3)
      } else if (name === 'c9 center fluted offices') {
        practical.cabinet(tower,'thin magenta tenant mast',[wx+w*.29,94.2,pz+.54],[1.62,12.6],[4.45,.30,1.65],'BAR',true,3.9)
        practical.opal(tower,'amber clock floor slot',[wx+w*.17,103.6,pz+.60],[4.28,1.12],[11.9,6.3,1.03],2)
      } else if (name === 'c9 center clock stack') {
        practical.opal(tower,'small cyan mechanical floor datum',[wx+w*.07,73.2,pz+.61],[6.89,1.06],[.15,3.5,5.4],3)
      }
    }
  }
  const upper = towerSurface('hero tower setback roof bay', .094, 'curtain', screenReflection, spillAt('setback'))
  scaledBox(city, 'screen tower setback service bay', [2.60,14.94,-32.38], [4.63,4.71,4.42], upper,scale.screen)
  scaledBox(city, 'service bay folded roof edge', [2.60,17.30,-32.38], [4.70,.11,4.49], frame,scale.screen)
  const railTop = 12.14
  groundedBox(city,'west facade double blade pylon',-11.90,railTop,-29.74,.60,.51,frame,scale.leftBlade)
  for (const y of [1.4,4.4,7.4,10.4]) scaledBox(city,'west facade blade cross brace',[-11.9,y,-29.51],[.58,.12,.26],zinc,scale.leftBlade)
  groundedBox(city,'east amber strip support',13.00,5.24,-30.48,.49,.43,frame,scale.rightBlade)
  const markerRow = (name: string, start: Tuple, size: Tuple, pitch: number, count: number, color: Tuple, k: number) => {
    const light = new THREE.MeshBasicMaterial({ color: new THREE.Color(...color), toneMapped: false })
    const row = new THREE.InstancedMesh(new THREE.BoxGeometry(...heroSize(size,k)),light,count)
    const m = new THREE.Matrix4()
    row.name = name
    for (let i=0;i<count;i++) row.setMatrixAt(i,m.makeTranslation(...heroPoint([start[0],start[1]+pitch*i,start[2]],k)))
    row.instanceMatrix.needsUpdate = true
    city.add(row)
  }
  markerRow('screen tower inset red service markers',[6.03,1.38,-29.972],[.119,.123,.050],.56,19,[2.06,.074,.092],scale.screen)
  markerRow('screen tower secondary red service markers',[.22,2.85,-29.971],[.091,.13,.047],.72,12,[1.32,.039,.17],scale.screen)
  markerRow('west tower inset cyan dots',[-11.63,1.21,-29.486],[.073,.091,.043],.42,21,[.048,1.07,1.86],scale.leftBlade)
  markerRow('far west thin violet markers',[-38.84,11.1,-336.92],[.60,1.11,.14],3.18,8,[.69,.15,1.82],scale.farWest)
  markerRow('far central cyan stack',[-62.2,11.7,-345.89],[.56,.88,.22],3.5,10,[.076,1.02,1.87],scale.farCentralWest)
  markerRow('middle service cyan squares',[-11.38,2.7,-59.95],[.23,.29,.08],.63,8,[.043,1.12,1.71],scale.middleWest)
  markerRow('east outer glass cyan markers',[35.5,11.8,-150.94],[.48,1.26,.12],2.15,13,[.056,.85,1.59],scale.outerEast)
  box(roof, 'hero full span concrete parapet', [0, .525, -10.025], [29, 1.05, .34], heroWall)
  box(roof, 'hero concrete wall cap', [0, 1.047, -10.02], [29, .048, .377], heroWall)
  box(roof, 'hero full span steel top rail', [0, 1.228, -10.015], [29, .034, .052], zinc)
  box(roof, 'hero steel intermediate rail', [0, 1.145, -10.015], [29, .020, .032], zinc)
  deckTrim.parapet(roof)
  for (let i = -6; i <= 6; i++) {
    box(roof, 'hero rail post', [i * 2.35, 1.149, -10.015], [.057, .178, .057], zinc)
    box(roof, 'hero steel post mounting plate', [i * 2.35, 1.075, -10.015], [.125,.016,.112], zinc)
  }
  for (const source of approvedHeroSources as readonly Source[]) {
    const [x, , z] = source.at
    const [width, height] = source.size
    const parent = source.onWall || source.id === 'amber parapet exit' ? roof : city
    const k = source.scale ?? 1
    const housing = group(parent, source.id, heroPoint(source.at,k))
    housing.scale.setScalar(k)
    housing.rotation.y = source.yaw ?? 0
    const lip = Math.min(width, height, .07) * .67
    const setback = source.scale ? .038 : 0
    box(housing, 'folded weatherproof cabinet', [0, 0, -.081-setback], [width + 2*lip, height + 2*lip, .16+setback], frame)
    const color = new THREE.Color(...palette[source.tint])
    if (source.id === 'magenta violet tower screen') {
      const mural = billboardMural(width*k, height*k, color, { travel: .166, laps: 2, picture: true })
      plate(housing, 'animated magenta violet mural', offset(mural.material,-4), [0,0,.002], width,height)
      const wallZ = heroPoint([0,0,screenTowerFront],scale.screen)[2]
      const yaw = housing.rotation.y
      const wallAt = (x: number) => ((wallZ-housing.position.z)/k + Math.sin(yaw)*x)/Math.cos(yaw)
      for (const side of [-1,1]) {
        const jamb = side*(width*.5+.095)
        const back = Math.min(-.2,wallAt(jamb)-.055)
        box(housing, 'LED wall sealed stile', [jamb,0,-.024], [.19,height+.40,.20], charcoalConcrete)
        box(housing, 'LED wall weather return', [jamb,0,back*.5], [.14,height+.28,-back], oxidizedAluminum)
        box(housing, 'LED wall cast perimeter beam', [0,side*(height*.5+.096),-.028], [width+.38,.192,.22], charcoalConcrete)
      }
      for (const dx of [-.39,-.13,.13,.39]) for (const dy of [-.36,0,.36]) {
        const x = dx*width
        const back = Math.min(-.25,wallAt(x)-.085)
        box(housing, 'billboard facade tie bracket', [x,dy*height,back*.5-.04], [.16,.22,-back], oxidizedAluminum)
        box(housing, 'billboard facade tie plate', [x,dy*height,back], [.27,.36,.126], charcoalConcrete)
      }
      box(housing, 'LED wall lower truss', [0,-height*.5-.182,-.176], [width+.13,.17,.39], frame)
      for (const dx of [-.32,.32]) box(housing, 'LED wall lower seat', [dx*width,-height*.5-.31,-.231], [.165,.34,.51], zinc)
      const { light } = mountLight(housing,'billboard',source.size,color,91,75)
      light.colorAt = mural.colorAt
      light.level = mural.level
      animation.push(mural.set)
    } else if (!source.text) {
      const segments = source.onWall ? 1 : Math.round(height / (source.tint === 'cyan' ? .34 : .50))
      const shape = cyanApertures[source.id]
      const gain = (opalRadiance[source.id] ?? 1)*(shape?.[1] ?? 1)
      const opal = fixtureOpal(color.clone().multiplyScalar(gain),segments,shape!==undefined)
      plate(housing, 'weather-sealed opal face', source.scale ? offset(opal,-4) : opal, [0,0,.002], width*(shape?.[0] ?? 1),height)
      if (!source.onWall) for (const fraction of [-.40,-.17,.17,.40]) {
        const horizontal = width > height
        box(housing, 'opal rail standoff', [horizontal ? fraction*width : 0,horizontal ? 0 : fraction*height,-.184],
          [horizontal ? .17 : Math.max(width*.79,.081),horizontal ? height*.8 : .14,.27], zinc)
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
      plate(housing, 'recessed sign face', source.scale ? distantGlass : glass, [0,0,.002],width,height)
      const exit = allowed === 'EXIT'
      const radiance = signRadiance[allowed] ?? 1
      const textWidth = width * (exit ? .56 : .98), textHeight = height*.962
      const glyphs = labels(allowed,'World Condensed',rows,textWidth/textHeight)
      if (glyphs) {
        const letters = signGlass(glyphs,color,textWidth,textHeight,allowed==='PARKING',radiance)
        plate(housing,`opal lettering ${allowed}`,source.scale ? offset(letters,-5) : letters,[exit ? -.16 : 0,0,.010+setback],textWidth,textHeight)
      }
      if (exit) {
        const led = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(radiance), toneMapped: false })
        box(housing, 'wayfinding arrow stem', [.293,.0,.012], [.244,.026,.005], led)
        for (const dir of [-1,1]) box(housing, 'wayfinding arrow head', [.386,dir*.038,.012], [.108,.025,.005],led).rotation.z = -dir*Math.PI/4
      } else if (allowed === 'HOTEL') {
        for (const dir of [-1,1]) box(housing, 'rooftop sign pedestal', [dir*width*.34,-.637,-.25], [.13,.42,.32], zinc)
      } else {
        for (const dir of [-1,1]) box(housing, 'facade sign mount cleat', [dir*width*.34,-height*.24,-.195], [.10,.11,.30], zinc)
      }
      signs.push(allowed)
    }
    if (source.id === 'cyan garage rise') mountLight(housing,'east parking canopy fascia',source.size,color,46,66,true)
    if (source.id === 'amber garage rise') mountLight(housing,'red deck marker',source.size,color,28,56)
    if (source.onWall) {
      const left = x < 0
      const { anchor } = mountLight(housing, left ? 'doorway' : 'lane separator opal',source.size,color,left ? 8.4 : 8.8,15)
      anchor.rotation.x = left ? .98 : .89
      for (const side of [-1,1]) box(housing, 'sealed parapet light end bracket', [side*(width/2+.012),0,-.022], [.045,height+.037,.15], zinc)
    }
  }
  paintBayLine(roof,'hero near bay line',heroStripe,[.021,1.718],[.946,4.365],.113)
  paintBayLine(roof,'west bay edge marking',heroStripe,[-2.74,3.78],[-1.76,2.41],.095)
  paintBayLine(roof,'west bay edge continuation',heroStripe,[-1.67,2.27],[-1.44,1.95],.095)
  const drain = group(roof,'hero near drain grate',[heroDrainLayout[0],0,heroDrainLayout[1]])
  drain.rotation.y = -.08
  for (const x of [-.253,.253]) box(drain,'iron grate end rim',[x,.0041,0],[.025,.0082,.24],zinc)
  for (const z of [-.111,.111]) box(drain,'iron grate side rim',[0,.0041,z],[.50,.0082,.018],zinc)
  box(drain,'recessed slot bed',[0,.0007,0],[.50,.0014,.22],tar)
  for (let i=0;i<21;i++) box(drain,'iron drainage bar',[(i-10)*.0234,.0059,0],[.010,.0047,.211],zinc)
  return { root, signs, lights, set: (time: number) => animation.forEach(update => update(time)) }
}
