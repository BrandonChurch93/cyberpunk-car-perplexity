import * as THREE from 'three'
import { config } from '../config'
import { plate, type Label } from './fixtures'
import { group, heroCityYaw, streetY, type Tuple } from './forms'
import { billboardMural, fixtureOpal, signGlass } from './hero-surfaces'

type Size = readonly [number, number]

export function reflectionPracticalBuilder(labels: Label, metal: THREE.Material, zinc: THREE.Material) {
  const block = (parent: THREE.Object3D, name: string, at: Tuple, size: Tuple, mat = metal) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size),mat)
    mesh.name = name
    mesh.position.set(...at)
    parent.add(mesh)
    return mesh
  }
  const mount = (parent: THREE.Object3D, name: string, at: Tuple, [w,h]: Size, depth: number) => {
    const fixture = group(parent,name,at)
    const trim = Math.min(h*.13,w*.10,1.04)
    block(fixture,'sealed metal housing',[0,0,-depth*.5],[w+2*trim,h+2*trim,depth])
    for (const x of [-.36,.36]) {
      block(fixture,'fixture mounting cleat',[w*x,-h*.23,-depth-.06],[Math.max(.04,w*.062),Math.max(.042,h*.12),depth*.36+.12],zinc)
    }
    return fixture
  }
  const opal = (parent: THREE.Object3D,name: string,at: Tuple,[w,h]: Size,rgb: Tuple,segments: number) => {
    const depth = Math.min(w*.11,h*.25,.45)
    const fixture = mount(parent,name,at,[w,h],depth)
    plate(fixture,'sealed opal aperture',fixtureOpal(new THREE.Color(...rgb),segments),[0,0,.004],w,h)
    return fixture
  }
  const cabinet = (parent: THREE.Object3D,name: string,at: Tuple,[w,h]: Size,rgb: Tuple,text: string, vertical = false, radiance = 1, diffusion = .40) => {
    const allowed = config.signage.generic.find(s=>s===text)
    if (!allowed) throw new Error(`Unapproved reflection practical sign: ${text}`)
    const color = new THREE.Color(...rgb)
    const fixture = mount(parent,name,at,[w,h],Math.min(.56,h*.29))
    const face = plate(fixture,'diffusing cabinet face',fixtureOpal(color.clone().multiplyScalar(diffusion*Math.sqrt(radiance)),1),[0,0,.006],w,h)
    const letters = labels(allowed,'World Condensed',vertical ? [...allowed] : [allowed],w/h)
    if (letters) {
      const material = signGlass(letters,color,w,h,true,radiance)
      material.transparent = true
      material.blending = THREE.AdditiveBlending
      material.depthWrite = false
      const type = plate(fixture,'lit cabinet lettering',material,[0,0,.013],w,h)
      type.renderOrder = face.renderOrder+1
    }
    return fixture
  }
  const screen = (parent: THREE.Object3D,name: string,at: Tuple,[w,h]: Size,rgb: Tuple,violet: Tuple,phase: number,banded: number) => {
    const mural = billboardMural(w,h,new THREE.Color(...rgb),{ violet: new THREE.Color(...violet), offset: phase, banded })
    const depth = Math.min(1.30,w*.045)
    const fixture = mount(parent,name,at,[w,h],depth)
    plate(fixture,'animated magenta violet tiles',mural.material,[0,0,.025],w,h)
    for (const x of [-.462,.462]) {
      block(fixture,'screen waterproof perimeter rail',[w*x,h*.512,-depth*.18],[w*.102,h*.024,depth],zinc)
      block(fixture,'screen maintenance lower seat',[w*x,-h*.527,-depth*.6],[w*.085,h*.061,depth*1.7])
    }
    return mural.set
  }
  return { block, cabinet, opal, screen }
}

export function addReflectionFrontages(root: THREE.Object3D, labels: Label) {
  const zinc = new THREE.MeshStandardMaterial({ color: new THREE.Color(.13,.15,.17), metalness: .68, roughness: .53 })
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(.026,.032,.044), metalness: .42, roughness: .61 })
  const masonry = new THREE.MeshStandardMaterial({ color: new THREE.Color(.091,.088,.086), roughness: .91 })
  const spandrel = new THREE.MeshStandardMaterial({ color: new THREE.Color(.044,.060,.068), roughness: .49, metalness: .23 })
  const { block, cabinet, opal, screen } = reflectionPracticalBuilder(labels,metal,zinc)
  const deckCore = root.getObjectByName('stair and lift core')!
  const stair = group(deckCore,'southeast stair and lift reflection frontage')
  const wetStone = new THREE.MeshStandardMaterial({ color: new THREE.Color(.118,.074,.044),
    emissive: new THREE.Color(.12,.044,.018), emissiveIntensity: .33, roughness: .28, metalness: .23 })
  const landingCeiling = new THREE.MeshBasicMaterial({ color: new THREE.Color(6.35,4.59,2.76), toneMapped: false })
  const stairGlass = new THREE.MeshBasicMaterial({ color: new THREE.Color(.068,.089,.096),
    transparent: true, opacity: .23, depthWrite: false })
  block(stair,'wet stair frontage plinth',[.82,.21,2.43],[5.16,.42,.28],wetStone)
  block(stair,'amber sign folded wall rail',[.83,1.14,2.44],[4.64,.55,.23],zinc)
  cabinet(stair,'amber stair entrance sign',[.83,1.14,2.68],[4.31,.44],[7.9,2.80,.41],'STAIRS',false,2.3,.38)
  block(stair,'violet lens recessed wall rail',[.75,1.77,2.41],[5.11,.43,.20],spandrel)
  for (const [x,w] of [[-.96,1.48],[.69,1.46],[2.35,1.51]]) {
    opal(stair,'violet stair dado lens',[x,1.77,2.56],[w,.29],[3.38,.30,8.90],3)
  }
  block(stair,'violet stair entrance jamb rail',[-3.48,1.38,2.42],[.42,2.23,.22],spandrel)
  opal(stair,'violet stair entrance jamb lens',[-3.48,1.38,2.59],[.29,2.03],[3.42,.27,8.50],5)
  block(stair,'amber stair entrance jamb rail',[-1.93,1.21,2.42],[.41,1.82,.22],zinc)
  opal(stair,'amber stair entrance jamb lens',[-1.93,1.21,2.59],[.26,1.58],[6.74,2.69,.71],5)
  opal(stair,'low warm stair threshold lens',[.84,.29,2.60],[3.62,.14],[6.3,2.85,.72],5)
  block(stair,'cyan service fascia wall rail',[.84,2.50,2.42],[4.33,.25,.23],zinc)
  opal(stair,'cyan service fascia strip',[.84,2.50,2.58],[4.14,.17],[.10,5.40,8.85],5)
  const tower = group(stair,'glazed upper stair landings',[0,3.54,0])
  block(tower,'stair continuation back wall',[0,3.40,-2.05],[7.34,6.80,.24],masonry)
  for (const x of [-3.53,3.53]) block(tower,'stair continuation concrete return',[x,3.40,.04],[.28,6.80,4.26],masonry)
  for (const y of [.13,3.43,6.73]) block(tower,'stair landing bearing slab',[0,y,.05],[7.48,.26,4.60],wetStone)
  block(tower,'lift drum with dark landing doors',[2.58,3.40,.42],[1.58,6.56,2.65],spandrel)
  for (const [floor,y] of [1.76,5.06].entries()) {
    block(tower,'warm landing light return',[-.65,y,.20],[4.10,2.34,.17],wetStone)
    for (const x of [-2.49,-.55,1.37]) {
      block(tower,'ceiling light spill on plaster',[x,y+.82,1.28],[1.43,.62,.10],landingCeiling)
      const ceiling = plate(tower,'occupied stair ceiling optic',landingCeiling,[x,y+1.17,1.36],1.24,.86)
      ceiling.rotation.x = Math.PI*.5
    }
    const treadGroup = group(tower,'visible stair flight',[-.77,y-.95,1.47])
    for (let i=0;i<9;i++) block(treadGroup,'stair tread',[(-4+i)*.33,.15*i,0],[.345,.084,1.08],zinc)
    block(treadGroup,'diagonal landing handrail',[0,1.05,.56],[3.18,.063,.063],zinc).rotation.z = .42
    for (const x of [-3.34,-1.86,-.37,1.18,2.57,3.33]) {
      block(tower,'stair glazing aluminum mullion',[x,y,2.287],[.075,2.88,.17],metal)
    }
    plate(tower,'stair landing tinted glazing',stairGlass,[-.34,y,2.355],6.02,2.80)
    opal(tower,'warm glazing transom band',[-.70,y+.76,2.368],[4.73,.20],floor===0 ? [6.7,3.42,1.08] : [6.6,4.65,2.75],5)
  }
  block(tower,'tall cyan lens support jamb',[3.28,3.56,2.36],[.38,5.90,.28],zinc)
  opal(tower,'cyan stair return tracer',[3.28,3.56,2.55],[.21,5.62],[.24,8.3,12.0],6)
  const frontage = group(root,'offscreen reflection frontages')
  const rear = group(frontage,'southeast parapet wayfinding')
  rear.rotation.y = heroCityYaw
  for (const [i,x] of [9.80,11.38,13.08].entries()) {
    cabinet(rear,'recessed amber service sign',[x,.56,-9.804],[1.18,.42],[5.5,2.17,.45],['OPEN','24H','PARKING'][i],false,2.65)
    opal(rear,'warm white parapet inset glass',[x+.12,.21,-9.807],[.95,.092],[8.3,6.7,4.9],1)
  }
  const flank = group(frontage,'east quarter street frontage',[65,0,-42])
  flank.rotation.y = Math.atan2(-flank.position.x,-flank.position.z)
  block(flank,'brick retail and office wing',[0,(streetY+32)*.5,-10],[27,32-streetY,20],masonry)
  block(flank,'dark glazed upper bays',[0,16.1,.05],[24,24.1,.18],spandrel)
  for (let row=0;row<7;row++) {
    const y = 5.8+row*3.45
    block(flank,'floor recess sill',[0,y-1.24,.20],[24.7,.25,.42],zinc)
    for (let col=0;col<9;col++) {
      if ((row*7+col*3)%11 >= 6) continue
      const x = (col-4)*2.59
      opal(flank,'warm office glazing',[x,y,.24],[1.85,1.90],row%3 ? [4.8,2.76,1.1] : [7.1,5.1,3.65],3)
    }
  }
  for (const [i,x] of [-8.1,0,8.4].entries()) {
    block(flank,'retail sign receiver plate',[x,.94,.088],[5.96,1.14,.21],zinc)
    cabinet(flank,'stacked east retail box sign',[x,.94,.47],[5.82,1.03],[7.8,3.10,.62],['ARCADE','NOODLES','24H'][i],false,2.8)
  }
  const northWall = root.getObjectByName('four-sided concrete parapet and steel rail')!.getObjectByName('north')!
  const near = group(northWall,'north deck cyan guidance',[0,0,-.13])
  near.rotation.y = Math.PI
  for (const [i,x] of [-5.1,-1.55,2.4,7.7].entries()) {
    const fixture = [2.12,2.72,3.07,3.48][i]
    block(near,'guardwall sign attachment',[x,.89,.082],[fixture+.24,.214,.226])
    for (const dx of [-.37,.37]) {
      block(near,'guardwall sign anchored saddle',[x+fixture*dx,.699,.039],[.122,.424,.169],zinc)
      block(near,'guardwall saddle footing',[x+fixture*dx,.547,-.045],[.185,.138,.204])
    }
    opal(near,'reflected cyan north guardwall lamp',[x,.89,.206],[fixture,.091],[.16,3.24,5.68],1)
  }
  const north = group(frontage,'northwest market media elevation',[-50,0,42])
  north.rotation.y = Math.atan2(-north.position.x,-north.position.z)
  block(north,'market media podium',[0,(streetY+51)*.5,-5.25],[41,51-streetY,10.5],masonry)
  block(north,'seamed metal upper cladding',[0,34.65,.09],[38,31.4,.28],spandrel)
  block(north,'folded podium coping',[0,50.98,-5.25],[41.4,.33,10.87],zinc)
  for (const x of [-19,-12.6,0,12.6,19]) block(north,'aluminum structural jamb',[x,30,.29],[.23,40,.38],zinc)
  for (const [j,y] of [8.4,11.5,15.6,47.7].entries()) {
    for (const [i,x] of [-15,-9,-3,3,9,15].entries()) {
      if ((j*7+i*5)%9 > 4) continue
      opal(north,'recessed market window bay',[x,y,.48],[4.02,1.55],j===3 ? [1.4,2.9,5.5] : [5.7,3.94,2.53],2)
    }
  }
  const update = screen(north,'northwest animated LED wall',[-.8,24.8,1.37],[30,17.4],[7.6,.48,3.15],[1.87,.65,9.4],.84,.84)
  for (const [x,y,w] of [[-9,8.32,17.8],[9.4,10.19,16.7],[-6,42.2,17]]) {
    block(north,'recessed market fascia spandrel',[x,y,.13],[w+.54,.94,.32],spandrel)
    opal(north,'horizontal cyan market fascia',[x,y,.39],[w,.27],[.12,4.97,8.8],1)
  }
  for (const [i,x] of [-9.5,6.4,15.6].entries()) {
    const y = 12.9+i*1.24
    block(north,'market blade receiver plate',[x,y,.15],[4.94,1.78,.36],zinc)
    cabinet(north,'market blade wayfinding',[x,y,.67],[4.66,1.53],[7.1,2.95,.63],['ARCADE','OPEN','24H'][i])
  }
  return { update, signs: ['OPEN','24H','PARKING','ARCADE','NOODLES','STAIRS'] }
}
