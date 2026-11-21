import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { config } from '../config'
import { stream } from '../core/random'
import { plate, type Label } from './fixtures'
import { group, streetY, type Tuple } from './forms'
import { billboardMural, towerSurface, type Facade, type FacadeLayer, type ScreenReflection, type SignSpill } from './hero-surfaces'
import { northSector } from './north-claims'
import { reflectionPracticalBuilder } from './reflection-practicals'

type Plot = { name: string; x: number; z: number; w: number; d: number; roof: number; facade: Facade; level: number }
type Size = readonly [number, number]

const featured = [
  { x: -50, z: 112, w: 21, d: 19 },
  { x: -31, z: 125, w: 12.6, d: 14.2 },
]

const keyPlots: readonly Plot[] = [
  { name: 'north cyan arcade tower', x: -16, z: 145, w: 17, d: 20, roof: 96, facade: 'curtain', level: .085 },
  { name: 'north media slab', x: -76, z: 228, w: 64, d: 30, roof: 172, facade: 'banded', level: .07 },
  { name: 'north amber hotel', x: -103, z: 172, w: 19, d: 22, roof: 122, facade: 'hotel', level: .10 },
  { name: 'northeast glass exchange', x: 46, z: 132, w: 24, d: 22, roof: 118, facade: 'curtain', level: .075 },
  { name: 'east rail hotel', x: 118, z: 58, w: 22, d: 26, roof: 104, facade: 'hotel', level: .09 },
]

const palette = {
  cyan: [.18, 8.2, 12.2],
  amber: [7.0, 3.05, .66],
  violet: [2.6, .5, 7.4],
  magenta: [6.6, .42, 2.9],
  strip: [8.3, 6.7, 4.9],
} as const satisfies Record<string, Tuple>

function overlaps(a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }, gap: number) {
  return Math.abs(a.x-b.x) < (a.w+b.w)/2+gap && Math.abs(a.z-b.z) < (a.d+b.d)/2+gap
}

function inSector(x: number, z: number, reach: number, inner: number) {
  if (Math.hypot(x,z)-reach < inner) return false
  const azimuth = Math.atan2(x,z)*180/Math.PI
  return azimuth > northSector.from+1 && azimuth < northSector.to-1
}

const ignitionEye = [2, -5.4] as const
const sightlines = [
  { from: -22.5, to: -13.5, depth: 214 },
  { from: -34, to: -28.5, depth: 160 },
] as const

function blocksSightline(plot: { x: number; z: number; w: number; d: number }) {
  const headings = [-1,1].flatMap(sx => [-1,1].map(sz =>
    Math.atan2(plot.x+sx*plot.w*.5-ignitionEye[0],plot.z+sz*plot.d*.5-ignitionEye[1])*180/Math.PI))
  const near = Math.hypot(plot.x-ignitionEye[0],plot.z-ignitionEye[1])-Math.hypot(plot.w,plot.d)*.5
  return sightlines.some(s => near < s.depth && Math.max(...headings) > s.from && Math.min(...headings) < s.to)
}

function layoutPlots(): Plot[] {
  const plots: Plot[] = [...keyPlots]
  const families: Facade[] = ['curtain','banded','concrete','hotel']
  for (const ring of [
    { tag: 'middle', step: 36, first: 108, last: 292, minW: 14, maxW: 28, minRoof: 26, maxRoof: 128, skip: .26 },
    { tag: 'outer', step: 62, first: 320, last: 640, minW: 22, maxW: 46, minRoof: 70, maxRoof: 230, skip: .30 },
    { tag: 'far', step: 92, first: 690, last: 1260, minW: 30, maxW: 64, minRoof: 110, maxRoof: 330, skip: .36 },
  ]) {
    const count = Math.ceil(ring.last/ring.step)
    for (let row = -count; row <= count; row++) {
      for (let column = -count; column <= count; column++) {
        const rng = stream(`world/north/${ring.tag}/${row}/${column}`)
        const x = (column+.41)*ring.step+rng.range(-.2,.2)*ring.step
        const z = (row+.17)*ring.step+rng.range(-.2,.2)*ring.step
        const distance = Math.hypot(x,z)
        const w = rng.range(ring.minW,ring.maxW), d = rng.range(ring.minW,ring.maxW)
        if (distance > ring.last || rng.next() < ring.skip) continue
        if (!inSector(x,z,Math.hypot(w,d)*.5,ring.first)) continue
        const plot = { x, z, w, d }
        if ([...featured,...plots].some(p => overlaps(p,plot,ring.tag === 'middle' ? 6 : 10))) continue
        if (Math.abs(z-84) < d/2+7 || blocksSightline(plot)) continue
        const roof = ring.minRoof+(ring.maxRoof-ring.minRoof)*rng.next()**1.4
        plots.push({ name: `north ${ring.tag} tower ${row}:${column}`, ...plot, roof, facade: rng.pick(families), level: rng.range(.055,.11) })
      }
    }
  }
  return plots
}

export function addNorthSkyline(parent: THREE.Object3D, labels: Label) {
  const root = group(parent,'north skyline')
  const frame = new THREE.MeshStandardMaterial({ color: new THREE.Color(.035,.039,.048), roughness: .54, metalness: .59 })
  const zinc = new THREE.MeshStandardMaterial({ color: new THREE.Color(.13,.15,.17), metalness: .68, roughness: .53 })
  const practical = reflectionPracticalBuilder(labels,frame,zinc)
  const signs: string[] = []
  const animation: ((time: number) => void)[] = []
  const word = (text: string) => {
    const allowed = config.signage.generic.find(s => s === text)
    if (!allowed) throw new Error(`Unapproved north sign: ${text}`)
    signs.push(allowed)
    return allowed
  }

  const court = parent.getObjectByName('northern court tower')!
  court.updateWorldMatrix(true,false)
  const courtWall = court.children.find(o => o.name === 'building mass' && o.scale.y > 12 && o.position.y-o.scale.y*.5 < 18 && o.position.y+o.scale.y*.5 > 64)
    ?? court.children.filter(o => o.name === 'building mass').sort((a,b) => b.scale.y-a.scale.y)[0]!
  const wallBottom = courtWall.position.y-courtWall.scale.y*.5, wallTop = courtWall.position.y+courtWall.scale.y*.5
  const wallFront = courtWall.position.z-courtWall.scale.z*.5
  const wallEast = courtWall.position.x+courtWall.scale.x*.5
  const lightwellX = courtWall.position.x-7.2
  const ledLeft = lightwellX+2.7, ledRight = wallEast-1.1
  const ledBottom = Math.max(wallBottom+3,21), ledTop = Math.min(wallTop-4,62)
  const led: Size = [ledRight-ledLeft, ledTop-ledBottom]
  const ledAt: Tuple = [(ledLeft+ledRight)*.5, (ledBottom+ledTop)*.5, wallFront-.05]

  const media = (host: THREE.Object3D, name: string, at: Tuple, [w,h]: Size, magenta: Tuple, violet: Tuple, profile: { offset: number; relief?: number; banded?: number; travel?: number }) => {
    const fixture = group(host,name,at)
    fixture.rotation.y = Math.PI
    const mural = billboardMural(w,h,new THREE.Color(...magenta),{ violet: new THREE.Color(...violet), ...profile })
    const depth = Math.min(1.3,w*.05)
    practical.block(fixture,'media cabinet sealed housing',[0,0,-depth*.5],[w+.9,h+.9,depth])
    plate(fixture,'animated magenta violet media tiles',mural.material,[0,0,.03],w,h)
    for (const side of [-1,1]) {
      practical.block(fixture,'media facade cast stile',[side*(w*.5+.28),0,.05],[.36,h+1.1,.34])
      practical.block(fixture,'media facade perimeter beam',[0,side*(h*.5+.30),.05],[w+1.1,.36,.34])
    }
    for (const dy of [-.36,0,.36]) for (const dx of [-.3,.3]) {
      practical.block(fixture,'media facade tie bracket',[dx*w,dy*h,-depth-.2],[.3,.4,.42],zinc)
    }
    practical.block(fixture,'media facade maintenance gantry',[0,-h*.5-.9,.45],[w+.6,.16,1.0],zinc)
    animation.push(mural.set)
    return mural
  }
  const courtMural = media(court,'northern court media facade',[ledAt[0]-court.position.x,ledAt[1]-court.position.y,ledAt[2]-court.position.z],led,
    palette.magenta,[1.75,.52,8.4],{ offset: 2.35, relief: 1.7, travel: .13, banded: .22 })

  const slab = keyPlots[1]!
  const slabFront = slab.z-slab.d*.5
  const slabMedia: Size = [26,74]
  const slabAt: Tuple = [slab.x+slab.w*.5-17,52,slabFront-.05]
  media(root,'north slab violet media blade',slabAt,slabMedia,[3.6,.32,3.1],[1.6,.42,9.6],{ offset: 4.1, banded: .62, travel: .12 })

  const screen: ScreenReflection = { point: new THREE.Vector3(...ledAt), normal: new THREE.Vector3(0,0,-1), size: new THREE.Vector2(...led), picture: courtMural.picture, spill: new THREE.Color(.42,.034,.286) }
  const spills: SignSpill[] = [
    { point: new THREE.Vector3(...ledAt), size: new THREE.Vector2(...led), color: new THREE.Color(.62,.05,.42) },
    { point: new THREE.Vector3(...slabAt), size: new THREE.Vector2(...slabMedia), color: new THREE.Color(.34,.07,.62) },
  ]

  const plots = layoutPlots()
  const shells = new Map<string, { material: THREE.MeshStandardMaterial; parts: THREE.BufferGeometry[] }>()
  const trims = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.1,.052,.079), toneMapped: false })
  const crownCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(.17,1.6,2.5), toneMapped: false })
  const crownViolet = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1,.32,2.3), toneMapped: false })
  const crownAmber = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4,1.5,.32), toneMapped: false })
  const piece = (material: THREE.Material, size: Tuple, at: Tuple) => {
    const geometry = new THREE.BoxGeometry(...size).translate(...at)
    const list = trims.get(material)
    if (list) list.push(geometry)
    else trims.set(material,[geometry])
  }
  const shellOf = (plot: Plot) => {
    const distance = Math.hypot(plot.x,plot.z)
    const layer: FacadeLayer = distance < 620 ? 'near' : distance < 840 ? 'middle' : 'far'
    const band = distance < 200 ? 150 : distance < 320 ? 250 : distance < 620 ? 470 : distance < 840 ? 730 : 1050
    const key = `${plot.facade} ${band}`
    let shell = shells.get(key)
    if (!shell) {
      shell = { material: towerSurface(`north ${key}`,.082,plot.facade,screen,spills,layer,band), parts: [] }
      shells.set(key,shell)
    }
    return shell
  }
  for (const [index,plot] of plots.entries()) {
    const shell = shellOf(plot)
    const height = plot.roof-streetY
    shell.parts.push(new THREE.BoxGeometry(plot.w,height,plot.d).translate(plot.x,streetY+height*.5,plot.z))
    piece(frame,[plot.w+.4,1.2,plot.d+.4],[plot.x,plot.roof-.4,plot.z])
    const rng = stream(`world/north/crown/${plot.name}`)
    if (plot.roof > 60) {
      const cw = plot.w*rng.range(.42,.7), cd = plot.d*rng.range(.4,.66), ch = rng.range(3,9)
      const cx = plot.x+plot.w*rng.range(-.14,.14), cz = plot.z+plot.d*rng.range(-.12,.12)
      shell.parts.push(new THREE.BoxGeometry(cw,ch,cd).translate(cx,plot.roof+ch*.5,cz))
      piece(frame,[cw+.3,.45,cd+.3],[cx,plot.roof+ch,cz])
      const cornice = index%5 === 0 ? crownViolet : index%5 === 2 ? crownAmber : index%5 === 3 ? crownCyan : null
      if (cornice) piece(cornice,[cw*.86,.62,.14],[cx,plot.roof+ch*.62,cz-cd*.5-.08])
      if (plot.roof > 96) {
        const mast = rng.range(5,16)
        piece(frame,[.4,mast,.4],[cx,plot.roof+ch+mast*.5,cz])
        piece(red,[.8,.6,.8],[cx,plot.roof+ch+mast+.3,cz])
        for (const side of [-1,1]) piece(red,[.7,.5,.7],[plot.x+side*plot.w*.42,plot.roof+.55,plot.z-plot.d*.42])
      }
    }
  }
  const towers = group(root,'north tower ranks')
  for (const [key,{ material, parts }] of shells) {
    const merged = mergeGeometries(parts)!
    parts.forEach(p => p.dispose())
    const mesh = new THREE.Mesh(merged,material)
    mesh.name = `north tower shells ${key}`
    towers.add(mesh)
  }
  for (const [material,parts] of trims) {
    const merged = mergeGeometries(parts)!
    parts.forEach(p => p.dispose())
    const mesh = new THREE.Mesh(merged,material)
    mesh.name = material === red ? 'north obstruction lenses' : material === frame ? 'north roof copings and masts' : 'north crown cornice opals'
    towers.add(mesh)
  }

  const face = (plot: Plot) => plot.z-plot.d*.5
  const onFace = (plot: Plot, name: string) => {
    const g = group(root,name,[0,0,face(plot)-.05])
    g.rotation.y = Math.PI
    return g
  }
  const cyan = keyPlots[0]!
  const cyanFace = onFace(cyan,'north cyan arcade frontage')
  const fx = (x: number) => -x
  practical.cabinet(cyanFace,'north cyan vertical parking blade',[fx(cyan.x-5.6),31,.55],[3.1,17.5],palette.cyan,word('PARKING'),true,3.1,.22)
  practical.cabinet(cyanFace,'north cyan arcade cabinet',[fx(cyan.x+.6),17.4,.5],[7.2,2.5],palette.cyan,word('ARCADE'),false,3.2)
  practical.cabinet(cyanFace,'north cyan rooftop hotel cabinet',[fx(cyan.x),cyan.roof+3.4,.4],[11.5,3.7],[.16,6.6,10.2],word('HOTEL'),false,3.4)
  for (const x of [-7.9,7.7]) practical.opal(cyanFace,'north cyan full height lightwell',[fx(cyan.x+x),34,.45],[.75,58],[.08,4.4,6.8],18)
  for (const [i,y] of [44.5,52,59.5].entries()) practical.opal(cyanFace,'north cyan floor datum',[fx(cyan.x+1.2),y,.4],[9.5-i*1.4,.42],[.1,3.3,5.4],1)

  const amber = keyPlots[2]!
  const amberFace = onFace(amber,'north amber hotel frontage')
  practical.cabinet(amberFace,'north amber 24h cabinet',[fx(amber.x+5.6),58,.55],[6.6,3.2],palette.amber,word('24H'),false,3.4)
  practical.cabinet(amberFace,'north amber open cabinet',[fx(amber.x+5.4),52.6,.55],[6.9,2.7],palette.amber,word('OPEN'),false,3.2)
  practical.cabinet(amberFace,'north amber vertical noodle blade',[fx(amber.x+8.2),36,.5],[2.3,13.5],[6.4,2.6,.5],word('NOODLES'),true,3.1)
  practical.cabinet(amberFace,'north amber rooftop hotel cabinet',[fx(amber.x),amber.roof+3.2,.4],[13,3.6],[7.6,3.6,.9],word('HOTEL'),false,3.6)
  for (const [i,y] of [66,74,82,90].entries()) practical.opal(amberFace,'north warm hotel floor run',[fx(amber.x+(i%2 ? -2 : 3)),y,.35],[11,.9],[6.2,3.4,1.2],1)

  const glass = keyPlots[3]!
  const glassFace = onFace(glass,'northeast exchange frontage')
  practical.cabinet(glassFace,'northeast violet bar blade',[fx(glass.x-8),42,.5],[2.6,12],palette.violet,word('BAR'),true,3)
  practical.cabinet(glassFace,'northeast cyan karaoke cabinet',[fx(glass.x+3),26,.5],[9.4,2.8],palette.cyan,word('KARAOKE'),false,3)
  for (const x of [-10.6,10.6]) practical.opal(glassFace,'northeast pink edge tracer',[fx(glass.x+x),70,.45],[.5,70],[5.2,.2,2.2],14)

  const rail = keyPlots[4]!
  const railFace = group(root,'east rail hotel frontage',[rail.x-rail.w*.5-.05,0,rail.z])
  railFace.rotation.y = -Math.PI/2
  practical.cabinet(railFace,'east amber pharmacy cabinet',[0,30,.5],[11,2.9],palette.amber,word('PHARMACY'),false,3.2)
  practical.cabinet(railFace,'east cyan sauna blade',[7.5,52,.5],[2.6,13],palette.cyan,word('SAUNA'),true,3)
  practical.opal(railFace,'east magenta crown band',[0,rail.roof-3,.4],[16,1.1],palette.magenta,1)

  const north = parent.getObjectByName('four-sided concrete parapet and steel rail')!
  const strips = (wallName: string, at: readonly number[]) => {
    const wall = north.getObjectByName(wallName)!
    const inset = group(wall,`${wallName} parapet warm inset strips`,[0,0,-.17])
    inset.rotation.y = Math.PI
    for (const x of at) practical.opal(inset,'warm white parapet inset glass',[x,.36,.01],[.86,.05],palette.strip,1)
  }
  strips('north',[11,14.6,18.2,21.8,25.4,-10.2,-14.2,-18.4,-22.6])
  strips('east',[-13.5,-8.2,-2.6,3.2,9,14.4])

  root.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return
    o.castShadow = false
    o.receiveShadow = false
  })
  north.traverse(o => {
    if (o instanceof THREE.Mesh && o.parent?.name.endsWith('parapet warm inset strips')) o.castShadow = false
  })
  const district = new THREE.Vector2(ledAt[0]*.6+slabAt[0]*.4,ledAt[2]*.6+slabAt[2]*.4)
  return { root, signs: [...new Set(signs)], district, set: (time: number) => animation.forEach(update => update(time)) }
}
