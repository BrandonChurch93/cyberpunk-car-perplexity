import * as THREE from 'three'
import { group, heroCityYaw, type Tuple } from './forms'
import { deckHeight } from './roof-look'

const colors = {
  cyan: [.10,3.15,5.11],
  magenta: [5.42,.082,1.62],
  amber: [6.13,2.32,.42],
  ivory: [4.4,3.96,3.33],
} as const satisfies Record<string,Tuple>
type Tint = keyof typeof colors
const windowRadiance: Record<Tint,number> = { cyan: 3.7, magenta: 4.5, amber: 4.0, ivory: 2.25 }
type Run = readonly [fraction: number, y: number, tint: Tint, count: number, w: number, h: number]
type Window = { at: Tuple; size: readonly [number,number]; tint: Tint; gain: number }

const floors: Partial<Record<string,readonly Run[]>> = {
  'hero left edge tower': [[.435,46,'ivory',3,1.44,.69],[.430,74,'cyan',4,1.27,.73],[.462,99,'magenta',2,1.06,.62]],
  'hero near west garage bay': [[-.32,37,'cyan',3,1.16,.81],[.21,56,'ivory',3,1.56,.80],[-.08,68,'cyan',4,1.60,.79]],
  'c9 west dispatch': [[-.01,44,'cyan',3,1.93,1.22]],
  'hero bar tower': [[-.33,41,'magenta',3,1.53,.95]],
  'c9 center exchange stairs': [[-.16,94,'magenta',3,1.44,1.06],[.03,102,'ivory',3,1.38,1.10]],
  'c9 center clock stack': [[-.13,96,'cyan',3,1.39,1.15],[.16,109,'magenta',3,1.61,1.20]],
  'hero tower setback glass wing': [[-.15,48,'cyan',3,1.71,.78],[.22,59,'magenta',2,1.49,1.13]],
  'hero screen tower': [[-.456,69,'magenta',2,1.48,.93],[-.466,88,'cyan',2,1.64,1.12],[.47,62,'magenta',2,1.7,1.25],[.46,79,'ivory',2,1.94,1.31]],
  'hero amber tower': [[.28,43,'amber',4,1.72,.94],[-.20,63,'magenta',3,1.65,1.21],[.24,83,'amber',4,1.81,1.19],[-.16,94,'ivory',3,1.89,1.3]],
  'hero near east garage bay': [[-.31,39,'cyan',3,1.12,.71],[.13,58,'magenta',3,1.47,.96],[-.20,75,'ivory',3,1.48,.81]],
  'hero right edge tower': [[-.448,60,'amber',3,1.58,.87],[-.42,79,'ivory',3,1.80,1.08],[-.32,101,'magenta',3,1.81,1.16]],
  'c9 east narrow stair': [[-.08,86,'cyan',3,1.57,1.22],[.06,103,'cyan',2,1.58,1.35]],
  'c9 east relay court': [[.08,78,'amber',3,1.86,1.37]],
}

export function deckReflectionTrim(frame: THREE.Material, zinc: THREE.Material) {
  const glass = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
  const shell = new THREE.BoxGeometry(1,1,1)
  const opal = new THREE.PlaneGeometry(1,1)
  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()
  const batch = (parent: THREE.Group, name: string, slots: readonly Window[], wall: boolean) => {
    const mounts = new THREE.InstancedMesh(shell,frame,slots.length)
    const beds = new THREE.InstancedMesh(shell,zinc,slots.length)
    const apertures = new THREE.InstancedMesh(opal,glass,slots.length)
    mounts.name = 'sealed metal housings'
    beds.name = 'folded sill mounts'
    apertures.name = name
    for (const [i,{ at: [x,y,z], size: [w,h], tint, gain }] of slots.entries()) {
      const d = wall ? .093 : .39
      const lip = wall ? .013 : .14
      mounts.setMatrixAt(i,matrix.makeScale(w+lip*2,h+lip*2,d).setPosition(x,y,z-d*.5))
      beds.setMatrixAt(i,matrix.makeScale(w+lip*2.3,lip*.74,d*.63).setPosition(x,y-h*.5-lip*.60,z-d*.13))
      apertures.setMatrixAt(i,matrix.makeScale(w,h,1).setPosition(x,y,z+.006))
      const [r,g,b] = wall ? [9.3,7.5,5.45] : colors[tint]
      apertures.setColorAt(i,color.setRGB(r,g,b).multiplyScalar(gain*(wall ? 1 : windowRadiance[tint])))
    }
    parent.add(mounts,beds,apertures)
  }
  const tower = (parent: THREE.Group, name: string, x: number, z: number, width: number) => {
    const rows = floors[name]
    if (!rows) return
    const bank = group(parent,'deck-facing window bands')
    const slots = rows.flatMap(([fraction,y,tint,count,w,h], row) =>
      Array.from({ length: count }, (_,i): Window => ({
        at: [x+width*fraction+(i-(count-1)*.5)*w*1.30,y,z+.265], size: [w,h], tint,
        gain: [.74,1.06,.54,.91][(i+row)%4]!,
      })))
    batch(bank,'recessed lit window apertures',slots,false)
  }
  const parapet = (parent: THREE.Group) => {
    const run = group(parent,'parapet service lighting')
    const lamps = [
      [-9.12,.60,.48,.045,.79],[-7.66,.54,.47,.042,.72],[-3.72,.57,.43,.043,.62],
      [3.82,.56,.43,.044,.65],[7.46,.59,.48,.043,.87],[8.61,.56,.49,.042,.74],
    ] as const
    batch(run,'parapet warm strip lenses',lamps.map(([x,y,w,h,gain]): Window => ({
      at: [x,y,-9.797], size: [w,h], tint: 'ivory', gain,
    })),true)
  }
  return { tower, parapet }
}

export function paintBayLine(parent: THREE.Group, name: string, material: THREE.Material,
  [ax,az]: readonly [number,number], [bx,bz]: readonly [number,number], width: number) {
  const length = Math.hypot(bx-ax,bz-az)
  const segs = Math.ceil(length/.14)
  const dx = (bz-az)/length*width*.5, dz = (ax-bx)/length*width*.5
  const c = Math.cos(heroCityYaw), s = Math.sin(heroCityYaw)
  const points: number[] = [], indices: number[] = []
  for (let i=0;i<=segs;i++) {
    for (const side of [-1,1]) {
      const x = ax+(bx-ax)*(i/segs)+side*dx, z = az+(bz-az)*(i/segs)+side*dz
      points.push(x,deckHeight(x*c+z*s,z*c-x*s)+.003,z)
    }
    if (i>0) {
      const a = (i-1)*2
      indices.push(a,a+2,a+1,a+1,a+2,a+3)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position',new THREE.Float32BufferAttribute(points,3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  const line = new THREE.Mesh(geo,material)
  line.name = name
  parent.add(line)
}
