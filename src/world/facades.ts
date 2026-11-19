import * as THREE from 'three'
import { stream, streamSeed } from '../core/random'
import { insertAfter, patchMaterial } from '../materials/patch'
import { mesh } from './fixtures'
import type { Tuple } from './forms'

const shell = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
const roomWall = shell.clone()
patchMaterial(roomWall, {
  id: 'recessed room bounce',
  apply(shader) {
    shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', 'varying vec2 vRoomUv;')
    shader.vertexShader = insertAfter(shader.vertexShader, '#include <project_vertex>', 'vRoomUv = uv;')
    shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', 'varying vec2 vRoomUv;')
    shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <color_fragment>', /* glsl */ `
      float ceilingBounce = pow(clamp(vRoomUv.y,0.0,1.0),1.77);
      float wallBounce = 1.0-.34*pow(abs(vRoomUv.x-.5)*2.0,2.0);
      diffuseColor.rgb *= wallBounce*(.36+.64*ceilingBounce);
    `)
  },
})
const glazing = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(.055, .11, .17), roughness: .19, metalness: .25, transparent: true, opacity: .115, depthWrite: false })
const cube = new THREE.BoxGeometry()
const quad = new THREE.PlaneGeometry()
const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b)
const palette = [c(.62, .78, 1), c(1, .71, .43), c(.88, .91, .87), c(.62, .86, .82)]

type Piece = { at: Tuple; size: Tuple; turn: number; color: THREE.Color; roll?: number }
type DetailLevel = 'near' | 'middle' | 'far'

function flush(parent: THREE.Object3D, name: string, items: Piece[], plane = false, material: THREE.Material = shell): void {
  if (items.length === 0) return
  const instances = new THREE.InstancedMesh(plane ? quad : cube, material, items.length)
  const m = new THREE.Matrix4()
  const sized = new THREE.Matrix4()
  const tilt = new THREE.Matrix4()
  items.forEach(({ at, size, turn, color, roll }, i) => {
    m.makeRotationY(turn)
    if (roll) m.multiply(tilt.makeRotationZ(roll))
    m.multiply(sized.makeScale(...size)).setPosition(...at)
    instances.setMatrixAt(i, m)
    if (material === shell || material === roomWall) instances.setColorAt(i, color)
  })
  instances.instanceMatrix.needsUpdate = true
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  instances.computeBoundingSphere()
  mesh(parent, instances, name, [0, 0, 0], false)
}

function wideFacade(tone: number, level: DetailLevel): THREE.Material {
  const tint = level === 'far' ? c(.025, .046, .077) : level === 'middle' ? c(.012, .025, .05) : c(.006, .014, .029)
  tint.multiplyScalar(.72 + 1.1*tone)
  const mat = new THREE.MeshBasicMaterial({ color: tint, toneMapped: false })
  patchMaterial(mat, {
    id: `world-tower-${level}`,
    uniforms: { towerSeed: { value: streamSeed('world/city/facade') / 4294967296 * 53 }, towerDepth: { value: level === 'far' ? .21 : level === 'middle' ? .84 : .33 } },
    defines: { ['CITY_' + level.toUpperCase()]: 1 },
    apply(shader) {
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', 'varying vec2 vTowerGrid; flat varying vec3 vTowerOrigin; flat varying float vTowerWall;')
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <project_vertex>', /* glsl */ `
        mat4 towerModel = modelMatrix;
        #ifdef USE_INSTANCING
          towerModel = towerModel * instanceMatrix;
        #endif
        vec3 towerDims = vec3(length(towerModel[0].xyz), length(towerModel[1].xyz), length(towerModel[2].xyz));
        vTowerGrid = vec2(mix(position.x*towerDims.x,position.z*towerDims.z,abs(normal.x)),position.y*towerDims.y);
        vTowerOrigin = towerModel[3].xyz + vec3(normal.x*13.0,normal.y*3.0,normal.z*7.0);
        vTowerWall = (1.0-abs(normal.y)) * step(6.0,towerDims.y) * step(4.0,mix(towerDims.x,towerDims.z,abs(normal.x)));
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', /* glsl */ `
        varying vec2 vTowerGrid; flat varying vec3 vTowerOrigin; flat varying float vTowerWall;
        uniform float towerSeed, towerDepth;
        float buildingHash(vec2 p) { vec3 q = fract(vec3(p.xyx + towerSeed) * .1031); q += dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
      `)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <color_fragment>', /* glsl */ `
        float facadeId = buildingHash(vTowerOrigin.xz + vec2(vTowerOrigin.y));
        float style = buildingHash(vTowerOrigin.zx * .37);
        vec2 coord = vTowerGrid / vec2(mix(1.48, 2.38, style), mix(3.32, 4.44, facadeId)) + vec2(.5, .5);
        vec2 cell = floor(coord);
        vec2 field = fract(coord);
        float district = buildingHash(floor(vTowerOrigin.xz/68.0));
        float groupVal = buildingHash(vec2(floor((cell.x+facadeId*3.0)/mix(2.0,5.0,style)),floor(cell.y*.68)) + vTowerOrigin.xz*1.67);
        float value = buildingHash(cell + vTowerOrigin.xz*2.38);
        float blockOut = buildingHash(vec2(floor(cell.x*.29), floor(cell.y*.25)) + vTowerOrigin.zx);
        float on = step(.28+.39*facadeId+.06*district, groupVal*.66+value*.34) * step(.13+style*.23, blockOut);
        float fit = buildingHash(cell.yx + vTowerOrigin.zx*1.33 + 17.0);
        float groupOffset = buildingHash(vec2(cell.y,floor(cell.x*.33)) + vTowerOrigin.zx*.71);
        vec2 offset = (vec2(fit, groupOffset)-.5)*vec2(.19,.115);
        vec2 edge = abs(field-.5-offset);
        vec2 width = mix(vec2(.22,.18), vec2(.40,.33), vec2(fit*.53+style*.47,value*.48+style*.52));
        vec2 footprint = fwidth(coord);
        vec2 softness = max(footprint*.54,vec2(.015));
        vec2 mask = 1.0-smoothstep(width-softness,width+softness,edge);
        float readable = 1.0-smoothstep(.23,.59,max(footprint.x,footprint.y));
        float glazingSplit = 1.0-.75*(1.0-smoothstep(.018,.048,abs(field.x-.5+offset.x*.8)))*step(.43, fit);
        float windows = mask.x*mask.y*glazingSplit;
        float blindBand = smoothstep(.57,.72,field.y+fit*.16)*step(.50,fit)*step(.26,style);
        float softStripes = mix(.76,1.26,style)*mix(.80,1.1,smoothstep(.0,.20,edge.x));
        vec3 cool = mix(vec3(.28,.52,.78),vec3(.64,.82,1.0),blockOut);
        vec3 amber = mix(vec3(.72,.48,.29),vec3(1.0,.84,.61),groupVal);
        vec3 glass = mix(cool, amber, smoothstep(.36,.77,groupVal));
        float roomBounce = mix(.37,.96,smoothstep(-.01,.32, field.y-.5))*mix(.54,1.0,1.0-edge.x);
        float fixture = exp(-((field.x-.37-fit*.24)*(field.x-.37-fit*.24)*45.0 + (field.y-.66-offset.y)*(field.y-.66-offset.y)*760.0)) * step(.64,groupOffset);
        float bright = exp2(mix(-3.70, 1.48, value))*mix(.65,1.12,blockOut)*(roomBounce+fixture*1.4)*(1.0-blindBand*.71);
        #ifdef CITY_NEAR
          bright *= 1.0 - smoothstep(-10.0, 1.0, vTowerOrigin.y + vTowerGrid.y);
        #endif
        float horizon = 1.0-smoothstep(42.0,128.0,vTowerOrigin.y+vTowerGrid.y);
        diffuseColor.rgb *= (.68 + .23*horizon + .32*facadeId) * mix(1.0,softStripes,vTowerWall*.64);
        vec3 distantWash = mix(vec3(.015,.026,.044),vec3(.029,.041,.058),district);
        diffuseColor.rgb += vTowerWall*towerDepth*mix(distantWash,glass*windows*bright*on,readable);
      `)
    },
  })
  return mat
}

function retone(city: THREE.Group): void {
  const byTone = new Map<string, THREE.Material>()
  for (const [ancestor, level] of [['near city', 'near'], ['middle city', 'middle'], ['far skyline', 'far']] as const) {
    city.getObjectByName(ancestor)?.traverse(o => {
      if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial) || !o.name.startsWith('building mass') && !o.name.startsWith('tower masses')) return
      const tone = o.material.color.r
      const id = `${tone}/${level}`
      let material = byTone.get(id)
      if (!material) { material = wideFacade(tone, level); byTone.set(id, material) }
      o.material = material
    })
  }
}

function roomedTower(building: THREE.Object3D, signBounds: THREE.Box3[]): void {
  const pieces: Piece[] = [], backs: Piece[] = [], interiors: Piece[] = [], panes: Piece[] = []
  const masses = building.children.filter(o => o.name === 'building mass' && o.scale.y > 8.1 && Math.min(o.scale.x, o.scale.z) > 7)
  if (!masses.length) return
  const base = stream(`world/city/tower/${building.name}`)
  const cool = base.next()
  const residential = base.next() > .55
  const height = residential ? base.range(3.29, 3.62) : base.range(3.89, 4.32)
  const module = residential ? base.range(1.56, 1.89) : base.range(1.55, 2.05)
  const wall = c(.008, .016, .029).multiplyScalar(base.range(.76, 1.27))
  const metal = c(.019, .029, .044).multiplyScalar(base.range(.7, 1.4))
  const buildingUse = base.range(.23, .82)
  const isHero = Math.abs(masses[0].position.z) > 40
  const candidates = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((turn, k) => ({ turn, k, view: -masses[0].position.x*Math.sin(turn)-masses[0].position.z*Math.cos(turn) })).sort((a,b) => b.view-a.view)
  for (const [m, volume] of masses.entries()) {
    for (const { turn, k } of candidates.slice(0, isHero ? 2 : 1)) {
      const rng = stream(`world/city/tower/${building.name}/${m}/${k}`)
      const side = k % 2 === 1
      const sizeX = side ? volume.scale.z : volume.scale.x
      const sizeN = side ? volume.scale.x : volume.scale.z
      const foot = volume.position.y - volume.scale.y / 2
      const top = volume.position.y + volume.scale.y / 2
      const bottom = Math.max(foot + .42, -5.2 + (rng.next() - .5) * 2.28)
      const levels = Math.floor((top - bottom - .32) / height)
      const count = Math.floor((sizeX-1.15) / module)
      const style = rng.range(.83, 1.11)
      const depth = residential ? rng.range(.98, 1.27) : rng.range(.74, 1.08)
      const x0 = -count * module / 2
      if (levels <= 0 || count <= 0) continue
      const ox = volume.position.x, oz = volume.position.z
      const d = sizeN/2
      const s = Math.sin(turn), co = Math.cos(turn)
      const world = (x: number, y: number, z: number): Tuple => [ox+x*co+(d+z)*s, y, oz-x*s+(d+z)*co]
      const put = (target: Piece[], x: number, y: number, z: number, w: number, h: number, dep: number, color: THREE.Color) => {
        target.push({ at: world(x, y, z), size: [w, h, dep], turn, color })
      }
      const facadeH = levels * height
      for (const x of [x0-.31, -x0+.31]) put(pieces, x, bottom+facadeH/2, depth/2, .62, facadeH, depth, wall)
      const party = rng.range(.18, .48)
      for (let j=0; j<levels; j++) {
        const yy = bottom + j*height
        const floor = stream(`world/city/tower/${building.name}/${m}/${k}/floor/${j}`)
        const stripColor = metal.clone().multiplyScalar(floor.range(.62, 1.23))
        const band = height * (residential ? .38 : .3) * style
        const windowH = height-band-.15
        const use = THREE.MathUtils.clamp(buildingUse + floor.range(-.32,.29), .08, .93)
        put(pieces, 0, yy+band*.43, depth/2, -2*x0, band, depth, stripColor)
        let sequence = 0, fill = 0
        for (let i=0; i<count; i++) {
          const xx = x0 + (i+.5)*module
          const pp = world(xx, yy+band+windowH*.52, .29)
          const position = new THREE.Vector3(...pp)
          if (signBounds.some(b => b.containsPoint(position))) continue
          const bay = stream(`world/city/tower/${building.name}/${m}/${k}/floor/${j}/bay/${i}`)
          if (sequence-- <= 0) { sequence = floor.int(5)+1; fill = floor.next() }
          const occupied = fill*.59+bay.next()*.41 > 1-use && bay.next() > party*.53
          const opening = yy+band*.93+windowH*.5
          const tint = palette[fill < .32 ? 2 : fill < .66 ? 0 : (cool < .53 ? 1 : 3)].clone()
          const luminous = occupied ? 2 ** bay.range(-3.2,.76) : bay.range(.005, .022)
          const inner = tint.clone().multiplyScalar(luminous*.58)
          const reveal = tint.clone().multiplyScalar(luminous*.15+.012)
          put(backs, xx, opening, .038, module*.98, windowH, 1, inner)
          const post = bay.range(.11, .34)
          put(pieces, xx-module*.5+.055, opening, depth/2, post, windowH, depth, reveal)
          if (i === count-1) put(pieces, xx+module*.5-.055, opening, depth/2, post, windowH, depth, reveal)
          put(pieces, xx, opening+windowH*.46, depth*.54, module-.11, .13, depth*.81, reveal)
          if (bay.next() < .72) put(pieces, xx+module*bay.range(-.21,.21), opening, depth+.014, bay.range(.035,.08), windowH, .07, metal)
          if (bay.next() < .37) put(pieces, xx, opening+windowH*bay.range(-.31,.20), depth*.99, module-.14, .046, .09, metal)
          if (occupied && bay.next() < .8) {
            const furniture = tint.clone().multiplyScalar(luminous*.19+.016)
            put(pieces, xx+bay.range(-.34,.36), opening-windowH*.32, bay.range(.25,.62)*depth, bay.range(.3,.66), bay.range(.22,.55), .24, furniture)
            const lampX = xx+bay.range(-.35,.35), lampZ = depth*bay.range(.22,.62), lampWidth = bay.range(.26,.72)
            const lampY = opening+windowH*bay.range(.30,.405)
            put(pieces, lampX, lampY+.09, lampZ, lampWidth+.05, .10, .18, metal)
            put(pieces, lampX, lampY+.038, lampZ, lampWidth, .033, .157, tint.clone().multiplyScalar(luminous*1.87+.17))
          }
          if (bay.next() > .65) {
            const blindHeight = windowH * bay.range(.12, .55)
            const blind = inner.clone().multiplyScalar(bay.range(.31,.82)).add(c(.012, .016, .022))
            const closedWidth = bay.next() > .60 ? module*bay.range(.40,.73) : module*.89
            const blindX = xx + (module*.89-closedWidth)*.5*(bay.next()>.5?-1:1)
            put(interiors, blindX, opening+windowH*.5-blindHeight*.5, depth*.74, closedWidth, blindHeight, 1, blind)
            if (windowH > 1.9 && bay.next() < .41) {
              const sill = blind.clone().multiplyScalar(.33)
              for (let l=1;l<=4;l++) put(interiors, blindX, opening+windowH*.5-blindHeight*l/5, depth*.76, closedWidth, .019, 1, sill)
            }
          }
          if (bay.next() < .14) put(panes, xx, opening, depth+.024, module*.92, windowH, 1, metal)
          if (residential && j % 3 !== 0 && i % 4 === 1 && bay.next() < .8) {
            const rail = metal.clone().multiplyScalar(1.25)
            put(pieces, xx, yy+band*.9, depth+.35, module*1.45, .13, .73, metal)
            put(pieces, xx, yy+band*.9+.88, depth+.72, module*1.45, .043, .049, rail)
            for (const shift of [-.6,-.2,.24,.63]) put(pieces, xx+shift*module, yy+band*.9+.47, depth+.72, .045, .83, .04, metal)
            if (bay.next() > .5) put(pieces, xx+.33, yy+band*.91+.28, depth+.23, .72, .46, .26, c(.045,.052,.056))
          }
        }
      }
      if (m===0 && rng.next()>.46 && levels >= 3) {
        const x = x0-.56
        for (let j=0; j<levels; j++) {
          const yy = bottom+j*height
          put(pieces, x, yy+.14, depth+.58, .89, .14, 1.04, wall)
          put(pieces, x-.44, yy+height*.5, depth+.97, .054, height+.25, .052, metal)
          put(pieces, x+.42, yy+height*.5, depth+.97, .054, height+.25, .052, metal)
          for (let r=0;r<13;r++) put(pieces, x, yy+.39+r*.26, depth+.97, .84, .045, .037, metal)
          put(pieces, x, yy+1.1, depth+1.04, .96, .047, .059, metal)
        }
      }
      if (m===0 && rng.next()<.6) {
        const x = -x0+.27
        put(pieces, x, bottom+facadeH*.5, depth+.066, .089, facadeH, .104, metal)
        for (let j=0;j<levels;j++) put(pieces, x, bottom+j*height+.23, depth+.055, .165, .078, .147, wall)
      }
    }
  }
  flush(building, 'solid mullions, slotted balconies, room contents and escape rails', pieces)
  flush(building, 'recessed room walls with ceiling bounce', backs, true, roomWall)
  flush(building, 'occluding roller shades, blinds and panel joints', interiors, true)
  flush(building, 'selected recessed glazing', panes, true, glazing)
}

function middleHardware(middle: THREE.Object3D): void {
  const body = new THREE.Vector3(), size = new THREE.Vector3(), matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion()
  const facadeHardware = (items: Piece[], id: string, p: THREE.Vector3, d: THREE.Vector3) => {
    const distance = Math.hypot(p.x,p.z)
    if (distance>230 || d.x<10 || d.z<10 || d.y<20 || p.y+d.y/2<9) return
    const r=stream(`world/city/utility-rack/${id}`)
    if (r.next()>.84) return
    const turn = Math.abs(p.z)>.75*Math.abs(p.x) ? (p.z>0 ? Math.PI : 0) : (p.x>0 ? -Math.PI/2 : Math.PI/2)
    const co=Math.cos(turn), s=Math.sin(turn), along=Math.abs(co)>.5?d.x:d.z
    const face=Math.abs(co)>.5?d.z/2:d.x/2
    const position = (x:number,y:number,z:number):Tuple=>[p.x+x*co+(face+z)*s,y,p.z-x*s+(face+z)*co]
    const color = c(.025,.041,.057).multiplyScalar(r.range(.60,1.65))
    const dark = color.clone().multiplyScalar(.45)
    const bright = color.clone().multiplyScalar(1.62)
    const add = (x:number,y:number,z:number,w:number,h:number,depth:number,tint:THREE.Color=color, roll?:number) => items.push({at:position(x,y,z),size:[w,h,depth],turn,color:tint,roll})
    const top = p.y+d.y/2-.5
    const base = Math.max(-3,p.y-d.y/2+1.2), floorH=r.range(3.15,4.23)
    if (top-base<9) return
    const rack = r.range(-.40,-.31)*along
    const style = r.int(3)
    add(rack-.48,(top+base)/2,.14,.117,top-base,.13)
    add(-rack+.22,(top+base)/2,.12,.076,top-base,.085,dark)
    if (style!==1) {
      add(rack+.62,(top+base)/2,.88,.089,top-base,.094,bright)
      add(rack-1.23,(top+base)/2,.88,.089,top-base,.094,bright)
    }
    for (let j=0; base+(j+1)*floorH<top;j++) {
      const y=base+j*floorH
      const at = rack + (j%2===0 ? .12 : -.14)
      add(rack-.47,y,.15,.245,.095,.24,bright)
      if(style!==1) {
        add(at,y,.59,2.01,.11,1.31)
        add(at,y+.91,1.21,2.02,.033,.056,bright)
        for(const u of [-.91,-.34,.31,.89]) add(at+u,y+.47,1.2,.05,.89,.045)
        const rise=floorH*.52, run=1.36, slant=(j%2===0?1:-1)*Math.atan2(rise,run)
        add(at,y+rise*.5,.59,Math.hypot(run,rise),.13,.16,bright,slant)
        add(at,y+rise*.5,1.13,Math.hypot(run,rise),.095,.092,color,slant)
        for(let n=1;n<8;n++) add(at+(j%2===0?1:-1)*(n/8-.5)*run,y+rise*n/8,.86,.28,.047,.58,dark)
      }
      const stalls = Math.floor(along/4.8)
      for(let i=0;i<stalls;i++) if(r.next()>(style===1?.31:.61)) {
        const x=(i-(stalls-1)*.5)*(along/stalls)+r.range(-.45,.45)
        const out = style===1 ? .39:.22
        if(style===1) {
          add(x,y,.44,2.22,.16,.91)
          add(x,y+.94,.89,2.18,.062,.044,bright)
          for (const u of [-1.02,-.46,.37,.99]) add(x+u,y+.48,.89,.044,.88,.045)
        }
        add(x+.25,y+.42,out,.76,.53,.37,bright)
        for(const v of [-.11,.0,.11]) add(x+.25,y+.42+v,out+.196,.64,.034,.025,dark)
        add(x+.55,y+.18,out-.05,.05,.32,.077)
      }
    }
  }
  for (const block of middle.children) {
    const items: Piece[]=[]
    for(const m of block.children) {
      if(m instanceof THREE.InstancedMesh) {
        for(let i=0;i<m.count;i++) {
          m.getMatrixAt(i,matrix)
          matrix.decompose(body,rotation,size)
          facadeHardware(items,`${block.name}/${m.name}/${i}`,body,size)
        }
      } else if (m.name==='building mass') {
        facadeHardware(items,`${block.name}/${block.children.indexOf(m)}`,m.position,m.scale)
      }
    }
    flush(block,'zoned middle-distance fire stairs, gutters and condenser racks',items)
  }
}

export function detailFacades(city: THREE.Group): void {
  retone(city)
  const near = city.getObjectByName('near city')!
  city.updateMatrixWorld(true)
  const protectedSigns: THREE.Box3[] = []
  city.traverse(o => {
    if (!(o instanceof THREE.Group)) return
    if (o.children.some(child => child.name === 'structural enclosure' || child.name === 'cabinet back')) protectedSigns.push(new THREE.Box3().setFromObject(o).expandByScalar(.61))
  })
  for (const building of near.children) if (building instanceof THREE.Group) roomedTower(building, protectedSigns)
  middleHardware(city.getObjectByName('middle city')!)
}
