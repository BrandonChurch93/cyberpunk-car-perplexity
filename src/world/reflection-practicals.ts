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
  const cabinet = (parent: THREE.Object3D,name: string,at: Tuple,[w,h]: Size,rgb: Tuple,text: string) => {
    const allowed = config.signage.generic.find(s=>s===text)
    if (!allowed) throw new Error(`Unapproved reflection practical sign: ${text}`)
    const color = new THREE.Color(...rgb)
    const fixture = mount(parent,name,at,[w,h],Math.min(.56,h*.29))
    const face = plate(fixture,'diffusing cabinet face',fixtureOpal(color.clone().multiplyScalar(.40),1),[0,0,.006],w,h)
    const letters = labels(allowed,'World Condensed',[allowed],w/h)
    if (letters) {
      const material = signGlass(letters,color,w,h,true)
      material.transparent = true
      material.blending = THREE.AdditiveBlending
      material.depthWrite = false
      const type = plate(fixture,'lit cabinet lettering',material,[0,0,.013],w,h)
      type.renderOrder = face.renderOrder+1
    }
    return fixture
  }
  const screen = (parent: THREE.Object3D,name: string,at: Tuple,[w,h]: Size,rgb: Tuple,violet: Tuple,phase: number,banded: number) => {
    const mural = billboardMural(w,h,new THREE.Color(...rgb),new THREE.Color(...violet),phase,banded)
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
  const frontage = group(root,'offscreen reflection frontages')
  const rear = group(frontage,'southeast parapet wayfinding')
  rear.rotation.y = heroCityYaw
  for (const [i,x] of [9.80,11.38,13.08].entries()) {
    cabinet(rear,'recessed amber service sign',[x,.56,-9.804],[1.18,.42],[5.5,2.17,.45],['OPEN','24H','PARKING'][i])
    opal(rear,'amber parapet inset glass',[x+.12,.21,-9.807],[.95,.092],[4.25,1.7,.32],1)
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
    cabinet(flank,'stacked east retail box sign',[x,.94,.47],[5.82,1.03],[7.8,3.10,.62],['ARCADE','NOODLES','24H'][i])
  }
  const near = group(frontage,'north deck cyan guidance',[0,0,18.35])
  near.rotation.y = Math.PI
  for (const [i,x] of [-5.1,-1.55,2.4,7.7].entries()) {
    const fixture = [2.12,2.72,3.07,3.48][i]
    block(near,'guardwall sign attachment',[x,.93,-.167],[fixture+.24,.18,.85])
    opal(near,'reflected cyan north guardwall lamp',[x,.93,.288],[fixture,.124],[.16,4.4,7.2],1)
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
    opal(north,'horizontal cyan market fascia',[x,y,.55],[w,.51],[.12,6.7,11.6],1)
  }
  for (const [i,x] of [-9.5,6.4,15.6].entries()) {
    cabinet(north,'market blade wayfinding',[x,12.9+i*1.24,.78],[4.66,1.53],[7.1,2.95,.63],['ARCADE','OPEN','24H'][i])
  }
  return { update, signs: ['OPEN','24H','PARKING','ARCADE','NOODLES'] }
}
