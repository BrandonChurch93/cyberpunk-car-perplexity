import * as THREE from 'three'
import { config } from '../config'
import type { FilmLight } from '../core/contract'
import { plate, type Label } from './fixtures'
import { group, heroCityYaw, heroDrainLayout, streetY, type Tuple } from './forms'
import { heroPoint, heroScale as scale, heroSize } from './hero-scale'
import { billboardMural, fixtureOpal, signGlass, towerSurface } from './hero-surfaces'
import type { finishRoof } from './roof-look'

const palette = {
  cyan: [.066, 2.96, 4.31],
  white: [3.85, 4.77, 6.32],
  amber: [5.14, 2.39, .41],
  violet: [1.20, .25, 2.75],
  magenta: [2.43, .054, .90],
  strip: [5.56, 4.08, 2.62],
} as const satisfies Record<string, Tuple>

type Tint = keyof typeof palette
type Source = { id: string; at: Tuple; size: readonly [number, number]; tint: Tint; text?: string; onWall?: boolean; yaw?: number; scale?: number }
type RoofMaterials = ReturnType<typeof finishRoof>['materials']

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
  { id: 'magenta violet tower screen', at: [2.94, 5.61, -29.80], size: [4.99, 6.28], tint: 'magenta', yaw: .066, scale: scale.screen },
  { id: 'magenta upper service ribbon', at: [2.62, 15.79, -30.02], size: [3.22, .37], tint: 'magenta', scale: scale.screen },
  { id: 'cool glass service ribbon', at: [-1.48, 17.39, -31.64], size: [1.58, .53], tint: 'cyan', scale: scale.screen },
  { id: 'amber upper tower cabinet', at: [7.44, 3.79, -30.12], size: [1.11, .72], tint: 'amber', text: '24H', scale: scale.amber },
  { id: 'amber lower tower cabinet', at: [7.46, 2.46, -30.10], size: [1.22, .83], tint: 'amber', text: 'OPEN', scale: scale.amber },
  { id: 'right amber facade sail', at: [13.00, 3.17, -30.20], size: [.30, 3.69], tint: 'amber', scale: scale.rightBlade },
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
  const { heroWall, zinc, stripe, tar } = materials
  const frame = new THREE.MeshStandardMaterial({ color: new THREE.Color(.035,.039,.048), roughness: .54, metalness: .59 })
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
    const k = housing.scale.x
    const light: FilmLight = { id: housing.name, kind: 'area', object: anchor, color: unit,
      intensity: intensity*k*k, size: [size[0]*k,size[1]*k], range: range*k, shadow, beam: false, level: () => 1 }
    lights.set(donor, light)
    return { light, anchor }
  }
  const towers = [
    ['hero left edge tower', -33.25, -75.2, 16.1, 3.3, 78.4, .069, scale.leftEdge],
    ['hero hotel tower', -9.52, -32.25, 3.05, 6.75, 6.14, .127, scale.hotel],
    ['hero parking tower', -9.98, -26.52, .94, 2.43, 5.78, .092, scale.parking],
    ['hero near west garage bay', -7.83, -25.40, 2.78, 4.15, 5.24, .079, scale.westFrontage],
    ['hero bar tower', -6.01, -43.56, 2.80, 5.37, 4.92, .103, scale.bar],
    ['hero violet tower', -1.69, -47.28, 2.08, 4.84, 8.74, .097, 11.7],
    ['hero screen tower', 2.92, -30.01, 6.76, 5.96, 12.59, .106, scale.screen],
    ['hero tower setback glass wing', -1.48, -31.79, 1.88, 4.89, 18.81, .087, scale.screen],
    ['hero amber tower', 7.77, -30.40, 2.74, 5.95, 10.68, .141, scale.amber],
    ['hero right edge tower', 31.69, -73.5, 13.9, 11.8, 91.8, .069, scale.rightEdge],
    ['hero near east garage bay', 7.22, -17.79, 1.88, 3.91, 5.27, .057, scale.eastFrontage],
    ['hero middle west distance', -10.78, -60.0, 2.15, 10.53, 8.41, .083, scale.middleWest],
    ['hero far west distance', -9.99, -83.0, 3.07, 10.63, 13.88, .074, 8.5],
    ['hero middle center distance', -6.54, -65.0, .89, 11.77, 7.78, .084, 9.55],
    ['hero far center distance', -4.76, -94.0, 2.79, 10.63, 14.54, .074, 8.4],
    ['hero middle east distance', 17.27, -56.0, 2.82, 9.15, 8.33, .085, 9],
    ['outer west exchange glass tower', -43.4, -157, 17.9, 15.7, 81.2, .059, 3.6],
    ['outer west bank setback', -75.6, -279, 19.2, 23.6, 119.1, .049, 2.65],
    ['far west communications stack', -98.3, -433, 24.8, 28.4, 184.0, .047, 2.3],
    ['far west narrow crown', -39.6, -337, 10.4, 17.8, 59.2, .045, scale.farWest],
    ['far central west glass tower', -57.9, -346, 12.1, 19.2, 53.2, .050, scale.farCentralWest],
    ['far inner west glass crown', -28.2, -363, 7.8, 17.3, 54.3, .047, 2.62],
    ['far central recessed slab', -12.1, -323, 9.3, 16.1, 51.5, .048, 3.18],
    ['rear middle glass stack', -51.9, -469, 16.5, 25.6, 64.0, .043, 2.25],
    ['outer east hotel glass slab', 37.4, -151, 12.9, 20.7, 79.1, .052, scale.outerEast],
    ['outer east relay shaft', 44.5, -219, 17.1, 19.8, 114.2, .046, 3.18],
    ['far east financial tower', 64.1, -293, 24.1, 26.2, 161.7, .042, 3.15],
    ['far east taper', 111.6, -459, 28.6, 31.8, 221.4, .046, 2.41],
    ['far east desk block', 83.2, -530, 21.7, 28.8, 85.4, .050, 2.02],
    ['outer skyline service stack', 172.1, -615, 39.1, 41.1, 187.8, .047, 1.98],
  ] as const
  const scaledBox = (parent: THREE.Object3D, name: string, at: Tuple, size: Tuple, material: THREE.Material, k: number) =>
    box(parent,name,heroPoint(at,k),heroSize(size,k),material)
  const groundedBox = (parent: THREE.Object3D, name: string, x: number, top: number, z: number, width: number, depth: number, material: THREE.Material, k: number) => {
    const [xx,roofY,zz] = heroPoint([x,top,z],k)
    return box(parent,name,[xx,(roofY+streetY)*.5,zz],[width*k,roofY-streetY,depth*k],material)
  }
  for (const [name, x, faceZ, width, depth, top, level, k] of towers) {
    const distant = faceZ < -50
    const tower = group(city, name + ' volume')
    const shell = towerSurface(name, level, distant)
    groundedBox(tower,name,x,top,faceZ-depth*.5,width,depth,shell,k)
    scaledBox(tower, 'coated coping band', [x,top-.043,faceZ-depth/2], [width+.08,.12,depth+.09], frame,k)
    if (distant || width < 1) continue
    for (const side of [-1,1]) {
      groundedBox(tower,'rainwater jamb',x+side*(width/2-.068),top,faceZ+.021,.092,.092,frame,k)
    }
    if (top > 7) {
      scaledBox(tower, 'roof service machine room', [x+width*.07,top+.34,faceZ-depth*.61], [width*.42,.68, depth*.32], shell,k)
      scaledBox(tower, 'raised inspection access lid', [x+width*.07,top+.70,faceZ-depth*.61], [width*.48,.078,depth*.36], frame,k)
    }
  }
  const upper = towerSurface('hero tower setback roof bay', .094, false)
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
  markerRow('far west thin violet markers',[-35.1,12.4,-336.92],[.69,1.33,.14],3.5,9,[.69,.15,1.82],scale.farWest)
  markerRow('far central cyan stack',[-62.2,11.7,-345.89],[.56,.88,.22],3.5,10,[.076,1.02,1.87],scale.farCentralWest)
  markerRow('middle service cyan squares',[-11.38,2.7,-59.95],[.23,.29,.08],.63,8,[.043,1.12,1.71],scale.middleWest)
  markerRow('east outer glass cyan markers',[35.5,11.8,-150.94],[.48,1.26,.12],2.15,13,[.056,.85,1.59],scale.outerEast)
  box(roof, 'hero full span concrete parapet', [0, .525, -10.025], [29, 1.05, .34], heroWall)
  box(roof, 'hero concrete wall cap', [0, 1.047, -10.02], [29, .048, .377], heroWall)
  box(roof, 'hero full span steel top rail', [0, 1.228, -10.015], [29, .047, .067], zinc)
  box(roof, 'hero steel intermediate rail', [0, 1.145, -10.015], [29, .027, .040], zinc)
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
      const mural = billboardMural(width*k, height*k, color)
      plate(housing, 'animated magenta violet mural', offset(mural.material,-4), [0,0,.002], width,height)
      for (const side of [-1,1]) {
        box(housing, 'LED wall sealed stile', [side*(width*.5+.082),0,-.017], [.164,height+.32,.15], frame)
        box(housing, 'LED wall cast perimeter beam', [0,side*(height*.5+.069),-.021], [width+.328,.138,.17], frame)
      }
      for (const dx of [-.38,.38]) for (const dy of [-.36,0,.36]) {
        box(housing, 'billboard facade tie bracket', [dx*width,dy*height,-.26], [.12,.19,.46], zinc)
      }
      box(housing, 'LED wall lower truss', [0,-height*.5-.182,-.176], [width+.13,.17,.39], frame)
      for (const dx of [-.32,.32]) box(housing, 'LED wall lower seat', [dx*width,-height*.5-.31,-.231], [.165,.34,.51], zinc)
      const { light } = mountLight(housing,'billboard',source.size,color,91,75)
      light.colorAt = mural.colorAt
      light.level = mural.level
      set = mural.set
    } else if (!source.text) {
      const segments = source.onWall ? 1 : Math.round(height / (source.tint === 'cyan' ? .34 : .50))
      const opal = fixtureOpal(color, segments)
      plate(housing, 'weather-sealed opal face', source.scale ? offset(opal,-4) : opal, [0,0,.002], width,height)
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
      const textWidth = width * (exit ? .56 : .98), textHeight = height*.962
      const glyphs = labels(allowed,'World Condensed',rows,textWidth/textHeight)
      if (glyphs) {
        const letters = signGlass(glyphs,color,textWidth,textHeight,allowed==='PARKING')
        plate(housing,`opal lettering ${allowed}`,source.scale ? offset(letters,-5) : letters,[exit ? -.16 : 0,0,.010+setback],textWidth,textHeight)
      }
      if (exit) {
        const led = new THREE.MeshBasicMaterial({ color, toneMapped: false })
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
      const { anchor } = mountLight(housing, x < 0 ? 'doorway' : 'lane separator opal',source.size,color,3.8,15)
      anchor.rotation.x = 1.45
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
