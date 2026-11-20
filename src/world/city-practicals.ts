import * as THREE from 'three'
import { config } from '../config'
import { stream, streamSeed } from '../core/random'
import { insertAfter, patchMaterial } from '../materials/patch'
import { block, labelFace, mesh, plate, type Label } from './fixtures'
import { group, type Tuple } from './forms'

const tau = Math.PI * 2
const duration = config.film.durationSeconds
const gray = (r: number, g: number, b: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false })
const black = gray(.007, .013, .024)
const trim = gray(.02, .036, .057)
const steel = gray(.038, .055, .067)
const washedSign = gray(.087, .129, .171)
patchMaterial(washedSign, {
  id: 'weathered lightbox diffuser',
  uniforms: { cabinetSeed: { value: streamSeed('world/city/sign-faces') / 4294967296 * 31 } },
  apply(shader) {
    shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', 'varying vec2 vCabinetUv; flat varying float vCabinetPhase;')
    shader.vertexShader = insertAfter(shader.vertexShader, '#include <project_vertex>', 'vCabinetUv=uv; vCabinetPhase=dot(modelMatrix[3].xz,vec2(.31,.53));')
    shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', 'varying vec2 vCabinetUv; flat varying float vCabinetPhase; uniform float cabinetSeed;')
    shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <color_fragment>', /* glsl */ `
      float rustX = vCabinetUv.x*19.0+cabinetSeed+vCabinetPhase;
      float rust = fract(sin(floor(rustX)*31.77)*43758.54);
      float streak = smoothstep(.76,.96,rust)*(1.0-smoothstep(.07,.31,abs(fract(rustX)-.5)));
      float gasket = smoothstep(.02,.15,vCabinetUv.y)*smoothstep(.02,.1,1.0-vCabinetUv.y);
      diffuseColor.rgb *= (.41+.68*gasket)*(1.0-.36*streak*(1.0-smoothstep(.0,.68,vCabinetUv.y)));
    `)
  },
})
const cheap = (parent: THREE.Object3D, name: string, material: THREE.Material, at: Tuple, size: Tuple): THREE.Mesh => {
  const o = block(parent, name, material, at, size)
  o.castShadow = false
  o.receiveShadow = false
  return o
}

function rod(parent: THREE.Object3D, from: Tuple, to: Tuple, radius: number, material: THREE.Material): THREE.Mesh {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), d = b.clone().sub(a)
  const center = a.lerp(b, .5)
  const node = mesh(parent, new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, d.length(), 7, 1), material), 'supported pipe or bar', center.toArray(), false)
  node.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d.normalize())
  return node
}

function mountedText(city: THREE.Group, labels: Label, signs: string[]): void {
  const registry = [...config.signage.generic, ...config.signage.invented.filter(s => ['VAPOR SILL HOTEL', 'SHUTTER HUSH CLUB', 'BRINESCALE SUSHI'].includes(s))]
  const add = (fixture: THREE.Object3D, allowed: string, type: 'led' | 'lightbox' | 'paint', w: number, h: number, color: THREE.Color, rows?: readonly string[], standoff = 0) => {
    const text = registry.find(s => s === allowed)
    if (!text) throw new Error(`Unapproved sign text: ${allowed}`)
    if (rows && rows.join(' ') !== text) throw new Error(`Malformed sign rows: ${text}`)
    signs.push(text)
    fixture.getObjectByName('blank unlit face')?.removeFromParent()
    const surface = type === 'led' ? black : type === 'lightbox' ? washedSign : gray(.035, .055, .066)
    plate(fixture, `${type} sign face`, surface, [0, 0, .184], w, h)
    for (const x of [-w*.41,w*.41]) {
      cheap(fixture, 'blade to facade steel cleat', trim, [x, h*.24, -.26-standoff*.5], [.074, .075, .61+standoff])
      cheap(fixture, 'blade to facade lower cleat', trim, [x, -h*.24, -.25-standoff*.5], [.074, .059, .61+standoff])
    }
    const font = type === 'led' ? 'World Condensed' : type === 'lightbox' ? 'World Round' : 'World Condensed'
    if (type === 'lightbox') {
      cheap(fixture, 'lightbox lower gasket', black, [0,-h*.47,.194], [w,.048,.051])
      cheap(fixture, 'lightbox upper weather hood', trim, [0,h*.47,.208], [w+.07,.062,.16])
      for (const x of [-w*.44,w*.44]) cheap(fixture, 'lightbox drain slot', black, [x,-h*.43,.190], [.081,.012,.018])
    } else if (type === 'paint') {
      rod(fixture, [-w*.28,h*.5,.07], [-w*.28,h*.63,.33], .021, steel)
      const light = cheap(fixture, 'sign picture lamp', gray(.72,.76,.64), [-w*.28,h*.61,.33], [.27,.054,.08])
      light.rotation.x = .62
    }
    const vertical = h > 2*w && text.length >= 5
    labelFace(fixture, text, [0,0,.194], vertical ? [h*.93,w*.96] : [w*.96,h*.93], labels, color, font, rows, vertical ? -Math.PI/2 : 0)
  }

  const install = (key: string, text: string, type: 'led' | 'lightbox' | 'paint', w: number, h: number, color: THREE.Color) => add(city.getObjectByName(key)!, text, type, w, h, color)
  install('vertical cool panel', '24H', 'led', 1.05, 3.36, new THREE.Color(.64, 1.2, 2.3))
  install('small cool panel', 'TAILOR', 'lightbox', 2.6, .95, new THREE.Color(.83, 1.42, 1.5))
  install('corner cool panel', 'OPEN', 'lightbox', 1.5, 2.2, new THREE.Color(.58, 1.64, 2.04))
  install('vertical warm panel', 'SAUNA', 'paint', .94, 4.2, new THREE.Color(.61, .49, .36))
  install('small warm panel', 'NOODLES', 'led', 1.6, .67, new THREE.Color(1.91, 1.29, .81))

  const signsRoot = group(city, 'supported commercial blade signs')
  for (const spec of [
    { text: 'VAPOR SILL HOTEL', lines: ['VAPOR SILL','HOTEL'], tower: 'south lift tower', x: 27.1, y: 24.72, rot: 0, w: 5.9, h: 2.1, type: 'lightbox', col: [.86,1.95,2.38] },
    { text: 'SHUTTER HUSH CLUB', lines: ['SHUTTER','HUSH CLUB'], tower: 'southwest exchange', x: -18.0, y: 9.8, rot: 0, w: 4.65, h: 1.78, type: 'led', col: [1.32,1.84,2.7] },
    { text: 'BRINESCALE SUSHI', lines: ['BRINESCALE','SUSHI'], tower: 'north sign terrace', x: -27.04, y: 9.89, rot: Math.PI, w: 3.48, h: 1.9, type: 'lightbox', col: [2.55,1.55,.89], standoff: .46 },
    { text: 'PHARMACY', tower: 'northwest tower', x: -47.0, y: 17.1, rot: Math.PI, w: 4.78, h: 1.08, type: 'led', col: [.73,1.85,2.01] },
    { text: 'KARAOKE', tower: 'north central tower', x: .70, y: 15.5, rot: Math.PI, w: 2.75, h: 1.13, type: 'paint', col: [.35,.49,.57] },
    { text: 'PARKING', tower: 'billboard terrace', x: 3.2, y: 14.52, rot: 0, w: 4.26, h: .91, type: 'led', col: [.84,1.69,2.25] },
    { text: 'EXIT', tower: 'southwest signal tower', x: -35, y: 41.7, rot: 0, w: 2.8, h: .90, type: 'led', col: [.71,1.14,1.72] },
    { text: 'HOTEL', tower: 'west corner slab', x: -35.8, y: 15.85, rot: 0, w: 3.35, h: .82, type: 'led', col: [.60,1.56,1.93], standoff: .46 },
  ] as const) {
    const tower = city.getObjectByName(spec.tower)!
    const atRoof = spec.text === 'PARKING'
    const wall = tower.children.filter(o => o.name === 'building mass' && o.scale.y > 3 && o.scale.x > spec.w+.3 &&
      (atRoof || Math.abs(o.position.y-spec.y) < (o.scale.y-spec.h*.72)*.5))
      .sort((a,b)=>atRoof ? b.position.y+b.scale.y*.5-a.position.y-a.scale.y*.5 : b.scale.x-a.scale.x)[0]
    if (!wall) continue
    const outward = Math.cos(spec.rot)
    const x = THREE.MathUtils.clamp(spec.x, wall.position.x-(wall.scale.x-spec.w)*.5+.13, wall.position.x+(wall.scale.x-spec.w)*.5-.13)
    const standoff = spec.standoff ?? 0
    const z = wall.position.z + outward*(wall.scale.z/2+(atRoof ? -.44 : .51)+standoff)
    const fixture = group(signsRoot, spec.text, [x,spec.y,z])
    fixture.rotation.y = spec.rot
    cheap(fixture, 'cabinet back', black, [0,0,0], [spec.w+.09,spec.h+.1,.24])
    for (const x of [-spec.w*.32,spec.w*.32]) {
      cheap(fixture, 'steel sign frame', trim, [x, atRoof ? -.60 : 0, -.35], [.088, atRoof ? 1.46 : spec.h+.12, .13])
      cheap(fixture, 'steel sign frame brace', steel, [x, atRoof ? -.84 : 0, -.77-standoff*.5], [.07, .085, .82+standoff])
    }
    add(fixture, spec.text, spec.type, spec.w, spec.h, new THREE.Color(...spec.col), 'lines' in spec ? spec.lines : undefined, standoff)
  }

  const red = city.getObjectByName('red sign')!
  red.getObjectByName('lettering BAR')?.removeFromParent()
  labelFace(red,'BAR',[0,0,.193],[2.11,.86],labels,new THREE.Color(.48,.014,.024))
  const shoulder = gray(9.4, 1.18, 1.36)
  const core = gray(17, 7.1, 7.45)
  const glyphs = [
    [[[-.23,-.3],[-.23,.3],[.11,.3],[.23,.22],[.23,.12],[.12,.03],[-.23,.03]], [[.12,.03],[.26,-.07],[.26,-.2],[.12,-.3],[-.23,-.3]]],
    [[[-.26,-.30],[.0,.31],[.26,-.30]], [[-.17,-.08],[.17,-.08]]],
    [[[-.25,-.30],[-.25,.30],[.09,.30],[.22,.21],[.22,.09],[.09,.006],[-.25,.006]], [[.04,.006],[.26,-.3]]],
  ]
  glyphs.forEach((lines, i) => {
    const xx = (i-1)*.64
    for (const line of lines) for (let k=1;k<line.length;k++) {
      const [ax,ay] = line[k-1], [bx,by] = line[k]
      rod(red,[ax+xx,ay,.206],[bx+xx,by,.206],.029,shoulder)
      rod(red,[ax+xx,ay,.232],[bx+xx,by,.232],.011,core)
    }
    cheap(red, 'neon electrode boot', black, [xx-.235,-.33,.2], [.099,.074,.067])
    cheap(red, 'neon standoff', steel, [xx+.18,.14,.164], [.03,.025,.11])
  })
}

function roofDetails(city: THREE.Group): ((t: number) => void)[] {
  const updates: ((t: number) => void)[] = []
  const anchors = [...city.getObjectByName('near city')!.children, ...city.getObjectByName('middle city')!.children.slice(0,3)]
  const tankBody = gray(.044,.062,.075), tankStrap = gray(.021,.035,.055), plantLight = gray(.35,.56,.63)
  for (const building of anchors) {
    const mass = building.children.filter(o=>o.name==='building mass' && o.scale.y>3.1 && o.scale.x>7 && o.scale.z>7)
      .sort((a,b)=>(b.position.y+b.scale.y*.5)-(a.position.y+a.scale.y*.5))[0]
    if (!mass) continue
    const r = stream(`world/city/plant/${building.name}`)
    const {x,y,z} = mass.position
    const roofY = y+mass.scale.y*.5
    const sx = mass.scale.x, sz = mass.scale.z
    const roof = group(building,'roof equipment', [x,roofY,z])
    const positions = [[-.30,-.22],[.28,.21],[-.21,.27],[.23,-.25]]
    for (let i=0;i<r.int(3)+2;i++) {
      const [px,pz] = positions[i]
      const xx=sx*px+r.range(-.32,.3), zz=sz*pz+r.range(-.29,.29)
      const item = group(roof,'mounted roof plant',[xx,0,zz])
      item.rotation.y = r.pick([0,Math.PI*.5,Math.PI,Math.PI*1.5])
      const k = r.int(4)
      if (k===0) {
        const rad=r.range(.62,1.03), start=r.range(.48,.73), height=r.range(1.24,2.38)
        for (const a of [-1,1]) for (const b of [-1,1]) cheap(item,'tank steel leg',steel,[a*rad*.67,start*.5,b*rad*.67],[.084,start,.084])
        mesh(item,new THREE.Mesh(new THREE.CylinderGeometry(rad,rad,height,18),tankBody),'roof cistern shell',[0,start+height*.5,0],false)
        for (const y0 of [start+.14,start+height-.12]) mesh(item,new THREE.Mesh(new THREE.CylinderGeometry(rad+.028,rad+.028,.068,18),tankStrap),'hoop seam',[0,y0,0],false)
        rod(item,[0,start+height-.21,rad],[0,.06,rad+.12],.057,steel)
        for (const side of [-1,1]) rod(item,[side*.18,0,rad+.1],[side*.18,start+height+.18,rad+.1],.034,tankStrap)
        for (let n=1;n<Math.floor((start+height)/.28);n++) cheap(item,'cistern ladder rung',steel,[0,n*.28,rad+.1],[.36,.032,.032])
      } else if (k===1) {
        const w = r.range(.8,1.82), h=r.range(.47,1.13)
        cheap(item,'condenser tray',steel,[0,.09,0],[w+.24,.13,.86])
        cheap(item,'condenser case',trim,[0,h*.5+.15,0],[w,h,.72])
        for (let n=0;n<6;n++) cheap(item,'condenser louver',black,[0,.24+h*n/8,.375],[w*.86,.036,.027])
        rod(item,[w*.42,.28,.36],[w*.49,.04,.79],.041,steel)
        cheap(item,'condenser running indicator',plantLight,[w*.38,h+.065,.366],[.047,.034,.018])
      } else if (k===2) {
        const h=r.range(1.39,3.72)
        cheap(item,'antenna base',steel,[0,.09,0],[.28,.18,.26])
        rod(item,[0,0,0],[0,h,0],.037,tankStrap)
        rod(item,[0,h*.7,-.62],[0,h*.7,.57],.022,steel)
        rod(item,[-.52,h*.87,0],[.71,h*.87,0],.02,steel)
        rod(item,[0,h*.56,0],[.57,.1,-.46],.014,tankStrap)
      } else {
        const z0=.73+r.next()*.76
        rod(item,[0,0,0],[0,z0,0],.052,steel)
        const dish = mesh(item,new THREE.Mesh(new THREE.SphereGeometry(.48,12,7,0,tau,0,Math.PI*.27),tankBody),'angled rooftop dish',[0,z0,0],false)
        dish.rotation.z = -.78; dish.scale.y = .68
        rod(item,[0,z0+.13,0],[.34,z0+.35,0],.024,steel)
      }
    }
    if (roofY>25) {
      const phase=r.range(0,tau), cycles=r.int(7)+11
      const mat = gray(1,.13,.08)
      const [xx,zz]=[sx*.41,-sz*.40]
      cheap(roof,'aviation marker post',steel,[xx,.42,zz],[.064,.84,.064])
      mesh(roof,new THREE.Mesh(new THREE.SphereGeometry(.095,8,5),mat),'aviation warning bulb',[xx,.89,zz],false)
      updates.push(t=>{ const duty=Math.max(0,Math.cos(t*tau*cycles/duration+phase)); const amp=.38+6.4*duty**10; mat.color.setRGB(amp,amp*.175,amp*.103) })
    }
  }
  return updates
}

function railway(city: THREE.Group): (t: number) => void {
  const line=city.getObjectByName('elevated railway')!
  const rng=stream('world/city/traffic/elevated/train-a')
  const train=group(line,'tracked eight-axle electric train')
  const skin=gray(.041,.067,.092), head=gray(3.7,4.8,5.2), tail=gray(3.2,.18,.10)
  for (let i=0;i<3;i++) {
    const car=group(train,'steel-sided coach',[(i-1)*13.65,1.41,-1.90])
    cheap(car,'coach lower sill',black,[0,-.94,0],[12.94,.39,2.59])
    cheap(car,'coach body',skin,[0,0,0],[12.95,2.13,2.66])
    cheap(car,'roof trim',trim,[0,1.08,0],[12.53,.21,2.45])
    cheap(car,'coach door frame',trim,[-4.8,-.13,0],[1.08,1.82,2.702])
    cheap(car,'coach rear door frame',trim,[4.65,-.13,0],[1.08,1.82,2.702])
    for (const x of [-4.48,4.48]) {
      cheap(car,'axle bogie',black,[x,-1.13,0],[1.55,.33,2.43])
      for(const z of [-1.05,1.05]) rod(car,[x-.47,-1.16,z],[x+.47,-1.16,z],.31,black)
    }
    for (const z of [-1.343,1.343]) for (let j=0;j<8;j++) {
      const r=rng.next(), x=(j-3.5)*1.35
      const light=r>.34 ? gray(r*.92,r*.68,r*.42) : black
      cheap(car,'train body recessed glazing',light,[x,.29,z],[1.03,.57,.028])
      cheap(car,'train window vertical seal',black,[x+.19,.29,z+Math.sign(z)*.022],[.032,.58,.014])
    }
    if (i!==2) cheap(car,'dark accordion coupling',black,[6.74,-.03,0],[.67,1.35,1.7])
    if (i!==1) for (const zz of [-.87,.87]) cheap(car,i===2?'head marker':'rear marker',i===2?head:tail,[i===2?6.49:-6.49,.12,zz],[.027,.18,.23])
  }
  for(const side of [-1,1]) {
    const cap=group(line,'solid railway terminal approach',[side*312,0,0])
    cheap(cap,'portal roof',black,[0,4.3,0],[62,.88,8.69])
    for (const z of [-4.16,4.16]) cheap(cap,'portal retaining wall',trim,[0,2.14,z],[62,4.3,.55])
    cheap(cap,'blind-side terminal closure',black,[side*22,2.13,0],[11,4.24,8.53])
  }
  return t=>{
    const p=tau*(t/duration+.30), q=Math.cos(p)
    train.position.set(311*Math.sin(p),-40*(1-THREE.MathUtils.smoothstep(q,-.27,.16)),0)
  }
}

function aircraft(city: THREE.Group): (t: number) => void {
  const sky=group(city,'air traffic')
  const bodies=Array.from({length:2},(_,i)=>{
    const o=group(sky,'small aircraft')
    cheap(o,'aircraft fuselage',black,[0,0,0],[.83,.65,5.8])
    cheap(o,'aircraft wings',black,[0,.015,.71],[7.4,.078,1.12])
    cheap(o,'tailplane',trim,[0,.18,-2.48],[2.6,.057,.66])
    cheap(o,'tail fin',black,[0,.53,-2.4],[.072,.99,.67])
    const strobe=gray(2,2,2)
    const r=gray(3.4,.18,.1), g=gray(.2,2.5,1.65)
    for(const [xx,mat] of [[-3.69,r],[3.69,g]] as const) mesh(o,new THREE.Mesh(new THREE.SphereGeometry(.15,8,5),mat),'wing navigation light',[xx,.03,.86],false)
    mesh(o,new THREE.Mesh(new THREE.SphereGeometry(.165,8,5),strobe),'brief white tail strobe',[0,.59,-2.85],false)
    return {o,strobe,i}
  })
  return t=>{
    for (const {o,strobe,i} of bodies) {
      const p=tau*(t/duration+(i===0?.264:.657)), a=i===0?236:194, b=i===0?82:51
      o.position.set(Math.cos(p)*a-43, i===0?92:146, Math.sin(p)*b+(i===0?-315:390))
      o.rotation.y=Math.atan2(-a*Math.sin(p),b*Math.cos(p))
      const glint=.56+5.68*Math.max(0,Math.cos(p*14.+i*2.14))**24
      strobe.color.setRGB(glint*.81,glint*.92,glint)
    }
  }
}

export function cityPracticals(city: THREE.Group, labels: Label, signs: string[]): (t: number) => void {
  mountedText(city, labels, signs)
  const updates=[...roofDetails(city),railway(city),aircraft(city)]
  const update=(t: number)=>{ for (const fn of updates) fn(t) }
  update(0)
  return update
}
