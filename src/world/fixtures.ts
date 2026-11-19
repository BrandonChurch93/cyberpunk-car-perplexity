import * as THREE from 'three'
import { config } from '../config'
import type { FilmLight, WetSurface } from '../core/contract'
import { stream } from '../core/random'
import { type Tuple } from './forms'

const tau = Math.PI * 2
const duration = config.film.durationSeconds

export type Label = (text: string, face?: string, rows?: readonly string[], ratio?: number) => THREE.Texture | null

export async function loadLabels(): Promise<Label> {
  if (typeof document === 'undefined') return () => null
  const base = import.meta.env.BASE_URL + 'assets/third-party/fonts/'
  for (const [name, path] of [
    ['World Condensed', 'barlow-condensed/BarlowCondensed-Regular.ttf'],
    ['World Round', 'comfortaa/Comfortaa%5Bwght%5D.ttf'],
    ['World Pixel', 'doto/Doto%5BROND,wght%5D.ttf'],
  ]) {
    const face = new FontFace(name, `url(${base}${path})`)
    document.fonts.add(await face.load())
  }
  const cache = new Map<string, THREE.Texture>()
  return (label, face = 'World Condensed', rows = [label], ratio = 4) => {
    const key = `${face}/${rows.join('/')}/${ratio.toFixed(2)}`
    const hit = cache.get(key)
    if (hit) return hit
    const canvas = document.createElement('canvas')
    canvas.width = ratio >= 1 ? 512 : Math.max(40, Math.round(512 * ratio))
    canvas.height = ratio >= 1 ? Math.max(40, Math.round(512 / ratio)) : 512
    const cx = canvas.getContext('2d')
    if (!cx) return null
    cx.fillStyle = '#fff'
    cx.textAlign = 'center'
    cx.textBaseline = 'middle'
    const line = canvas.height / rows.length
    let px = line * .96
    const set = () => { cx.font = `${px}px "${face}"` }
    set()
    const max = Math.max(...rows.map(row => cx.measureText(row).width))
    if (max > canvas.width * .87) { px *= canvas.width * .87 / max; set() }
    rows.forEach((row, i) => cx.fillText(row, canvas.width/2, line * (i + .52)))
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    cache.set(key, texture)
    return texture
  }
}

export function mesh<T extends THREE.Mesh>(parent: THREE.Object3D, item: T, name: string, at: Tuple, shadow = true): T {
  item.name = name
  item.castShadow = shadow
  item.receiveShadow = shadow
  item.position.set(...at)
  parent.add(item)
  return item
}

export function plate(parent: THREE.Object3D, name: string, material: THREE.Material, at: Tuple, width: number, height: number): THREE.Mesh {
  return mesh(parent, new THREE.Mesh(new THREE.PlaneGeometry(width, height), material), name, at, false)
}

export function block(parent: THREE.Object3D, name: string, material: THREE.Material, at: Tuple, size: Tuple): THREE.Mesh {
  return mesh(parent, new THREE.Mesh(new THREE.BoxGeometry(...size), material), name, at)
}

export function labelFace(parent: THREE.Object3D, name: string, at: Tuple, size: readonly [number, number], label: Label, color: THREE.Color, face?: string, rows?: readonly string[], rotation = 0): void {
  const tx = label(name, face, rows, size[0]/size[1])
  if (!tx) return
  plate(parent, `lettering ${name}`, new THREE.MeshBasicMaterial({ color, map: tx, toneMapped: false, alphaTest: .22 }), at, ...size).rotation.z = rotation
}

export function addSky(root: THREE.Group): void {
  const sky = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    vertexShader: /* glsl */ `varying vec3 skyDirection; void main() { skyDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 skyDirection;
      void main() {
        vec3 d = normalize(skyDirection);
        float horizon = exp(-max(d.y, 0.0)*4.2);
        float south = pow(max(0.0, dot(d, normalize(vec3(.18,.16,-1.0)))), 5.0);
        float north = pow(max(0.0, dot(d, normalize(vec3(-.62,.13,1.0)))), 9.0);
        float warm = pow(max(0.0, dot(d, normalize(vec3(-1.0,.13,-.1)))), 10.0);
        float cloud = .77+.16*sin(d.x*11.0+d.z*5.8+d.y*12.0)+.11*sin(d.x*25.0-d.z*9.0+d.y*20.0);
        vec3 c = mix(vec3(.0038,.008,.019),vec3(.011,.022,.041), horizon);
        c += horizon*cloud*(south*vec3(.014,.034,.071)+north*vec3(.013,.031,.047)+warm*vec3(.019,.012,.009));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  })
  mesh(root, new THREE.Mesh(new THREE.SphereGeometry(812, 32, 16), sky), 'city-lit cloud base', [0, 0, 0], false).renderOrder = -1000
  root.add(new THREE.HemisphereLight(new THREE.Color(.16, .29, .47), new THREE.Color(.067, .072, .08), .44))
}

const bbSize = [9.6, 4.8] as const
const bbSigma = .151
const bbBase = .20
const bbPeak = 20.7
const bbFill = 1.60
const bbWaveMean = .81
const bbStripeFloor = .48

const ease = THREE.MathUtils.smoothstep

export function billboardState(t: number, out: THREE.Color, cool: THREE.Color, light: THREE.Color): { center: number; mean: number } {
  const phase = tau * t / duration
  const center = .63 + .15 * Math.sin(2 * phase - 1.15) + .041 * Math.sin(3 * phase + .31)
  const k = .5 + .5 * Math.sin(phase - .85)
  cool.setRGB(.37 + .16*k, .61 + .09*k, .84 + .10*k)
  light.setRGB(.76 + .12*k, .88 + .07*k, 1)
  let fill = 0, stripe = 0
  for (let j = 0; j < 48; j++) for (let i = 0; i < 12; i++) {
    const x = (j+.5)/48, y = (i+.5)/12
    const rail = x-center-(y-.5)*.20
    const cover = ease(x,.29,.39)
    const ridge = y+.115*Math.sin((x-center*.72)*9.8)+x*.52
    const chart = 1-ease(Math.abs(ridge*7-Math.floor(ridge*7)-.5),.035,.13)
    const lanes = ease(ridge,.18,.35)*(1-ease(ridge,1.08,1.26))
    const wave = bbWaveMean+.19*Math.cos((y-.48+.20*Math.sin(x*6.28))*6.283)
    const ruled = ease(Math.abs(y-.167),.016,.026)*ease(Math.abs(y-.833),.025,.04)
    fill += (bbBase*(.35+.65*cover)+cover*(.45+(.12+.75*chart)*lanes*bbFill+.012))*(.28+.72*ruled)
    stripe += bbPeak*Math.exp(-((rail/bbSigma)**4))*wave*cover*(bbStripeFloor+(1-bbStripeFloor)*chart)
  }
  fill /= 48*12
  stripe /= 48*12
  out.setRGB(fill * cool.r + stripe * light.r, fill * cool.g + stripe * light.g, fill * cool.b + stripe * light.b)
  return { center, mean: Math.max(out.r, out.g, out.b) }
}

function addBillboard(sign: THREE.Object3D, metal: THREE.Material, key: boolean, labels?: Label): { film: FilmLight; set(t: number): void } {
  const [width, height] = bbSize
  const cool = new THREE.Color(), light = new THREE.Color(), average = new THREE.Color()
  const title = labels?.(generic('LEVEL 9'), 'World Condensed', undefined, 3.25) ?? null
  const uniforms = { centerX: { value: .5 }, cool: { value: cool }, light: { value: light }, headline: { value: title }, pixelCount: { value: new THREE.Vector2(width / .008, height / .008) } }
  const shader = new THREE.ShaderMaterial({
    uniforms, defines: title ? { WORLD_BILLBOARD_TITLE: 1 } : {}, toneMapped: false,
    vertexShader: /* glsl */ `varying vec2 faceUV; void main() { faceUV = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 faceUV;
      uniform float centerX;
      uniform vec3 cool, light;
      uniform vec2 pixelCount;
      uniform sampler2D headline;
      void main() {
        vec2 uv = faceUV;
        float cover = smoothstep(.29,.39,uv.x);
        float a = (uv.x - centerX - (uv.y-.5)*.20) / ${bbSigma.toFixed(3)};
        float band = exp(-a*a*a*a);
        float wave = ${bbWaveMean.toFixed(3)} + .19*cos((uv.y-.48+.20*sin(uv.x*6.28))*6.283);
        float ridge = uv.y + .115*sin((uv.x - centerX*.72)*9.8) + uv.x*.52;
        float chart = 1.0-smoothstep(.035, .13+fwidth(ridge)*6.0, abs(fract(ridge*7.0)-.5));
        float lanes = smoothstep(.18,.35,ridge) * (1.0-smoothstep(1.08,1.26,ridge));
        float detail = (.12+.75*chart) * lanes;
        float dots = pow(1.0-abs(fract(uv.x*21.0+uv.y*13.0)-.5)*2.0,8.0);
        float ruled = smoothstep(.016,.026,abs(uv.y-.167)) * smoothstep(.025,.04,abs(uv.y-.833));
        vec3 rgb = ${bbBase.toFixed(3)}*cool*(.35+.65*cover);
        rgb += cool*cover*(.45+detail*${bbFill.toFixed(3)}+.12*dots);
        rgb = rgb * mix(.28,1.0,ruled) + ${bbPeak.toFixed(3)}*band*wave*light*cover*mix(${bbStripeFloor.toFixed(3)},1.,chart);
        #ifdef WORLD_BILLBOARD_TITLE
          vec2 mark = (uv-vec2(.018,.34))/vec2(.295,.228);
          if (all(greaterThan(mark,vec2(0))) && all(lessThan(mark,vec2(1)))) rgb += vec3(.88,.95,1.0)*1.36*texture2D(headline,mark).a;
          float track = smoothstep(.028,.039,uv.x)*(1.0-smoothstep(.248,.258,uv.x));
          rgb += (.29+.68*smoothstep(.03,.23,centerX-uv.x-.35))*cool*track*(1.0-smoothstep(.008,.012,abs(uv.y-.267)));
        #endif
        float fine = max(fwidth(faceUV.x)*pixelCount.x, fwidth(faceUV.y)*pixelCount.y);
        vec2 dotXY = abs(fract(faceUV*pixelCount)-.5);
        float led = 1.0-smoothstep(.31,.49,max(dotXY.x,dotXY.y));
        float grid = mix(.24+1.21*led,1.0,smoothstep(.36,.65,fine));
        float seamsDist = min(abs(fract(faceUV.x*10.0+.5)-.5),abs(fract(faceUV.y*5.0+.5)-.5));
        float seams = mix(.93,1.0,smoothstep(.0,.013,seamsDist));
        gl_FragColor = vec4(rgb * grid * seams,1.0);
      }
    `,
  })
  const face = plate(sign, 'animated cabinet LED face', shader, [0, 0, .195], width, height)
  const anchor = new THREE.Object3D()
  sign.add(anchor)
  for (const x of [-width / 2 - .07, width / 2 + .07]) block(sign, 'cabinet edge extrusion', metal, [x, 0, .09], [.12, height + .18, .42])
  for (const y of [-height / 2 - .045, height / 2 + .045]) block(sign, 'cabinet weather strip', metal, [0, y, .12], [width + .25, .085, .38])
  for (const x of [-3.45, 3.45]) block(sign, 'cabinet maintenance rung', metal, [x, -2.63, -.14], [.68, .12, .76])
  const color = new THREE.Color()
  const scratch = new THREE.Color(), scratchCool = new THREE.Color(), scratchLight = new THREE.Color()
  const set = (t: number) => {
    const state = billboardState(t, average, cool, light)
    uniforms.centerX.value = state.center
    color.copy(average).multiplyScalar(1 / state.mean)
    anchor.position.set(THREE.MathUtils.clamp((state.center - .53) * width, -1.65, 1.65), 0, face.position.z + .054)
  }
  set(0)
  return { set, film: {
    id: key ? 'raking billboard' : 'billboard', kind: 'area', object: anchor, color, intensity: 4.5 * width * height,
    size: [width-3.4, height-.32], range: key ? 52 : 112, shadow: key, beam: false,
    level: (t) => billboardState(t, scratch, scratchCool, scratchLight).mean / 4.5,
    colorAt: (t, out) => { const { mean } = billboardState(t, out, scratchCool, scratchLight); out.multiplyScalar(1 / mean) },
  } }
}

function addRakingCabinet(roof: THREE.Group, metal: THREE.Material, frame: THREE.Material): THREE.Group {
  const sign = new THREE.Group()
  sign.name = 'side-facing billboard cabinet'
  sign.position.set(15.0, 7.25, -10.15)
  sign.rotation.y = -1.00
  roof.add(sign)
  block(sign, 'screen cabinet enclosure', frame, [0, 0, -.16], [9.66, 4.92, .55])
  for (const side of [-1, 1]) {
    block(sign, 'billboard lattice post', metal, [side*4.56,-4.87,-.67], [.205,4.41,.205])
    block(sign, 'ballasted billboard foot', frame, [side*4.56,-7.08,-.67], [.86,.32,.89])
    block(sign, 'cabinet vertical rear rail', frame, [side*4.38,-.31,-.69], [.18,4.2,.2])
    block(sign, 'cabinet mounting clevis', metal, [side*4.38,-2.55,-.5], [.43,.29,.87])
    const diagonal = block(sign, 'billboard diagonal steel tie', metal, [side*3.98,-3.42,-.67], [.095,2.03,.10])
    diagonal.rotation.z = side*.60
  }
  block(sign, 'billboard cross beam', metal, [0,-2.71,-.67], [9.29,.23,.27])
  return sign
}

function rearDeckPractical(pole: THREE.Object3D, metal: THREE.Material, frame: THREE.Material): FilmLight {
  const tint = new THREE.Color(.76,.86,1)
  const radiance = 370
  const face = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(radiance), toneMapped: false })
  const mast = pole.getObjectByName('tapered steel post')!
  mast.scale.y *= 1.64
  mast.position.y = 3.78
  pole.position.set(-6.45,0,12.86)
  for (const child of [...pole.children]) if (/opaque lamp head|unlit lamp diffuser|luminaire cross arm/.test(child.name)) child.removeFromParent()
  block(pole, 'worklight mast socket', metal, [0,7.31,0], [.23,.36,.25])
  const rack = new THREE.Group()
  rack.name = 'rear service flood bank'
  rack.position.set(0,7.52,0)
  const aim = new THREE.Vector3(0,.93,-1.05).sub(new THREE.Vector3(pole.position.x,7.52,pole.position.z))
    .applyAxisAngle(new THREE.Vector3(0,1,0),-pole.rotation.y).normalize()
  const across = new THREE.Vector3(0,1,0).cross(aim).normalize()
  rack.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, aim.clone().cross(across), aim))
  pole.add(rack)
  block(rack, 'worklight bracket plate', metal, [0,0,-.22], [3.06,.31,.34])
  for (const x of [-.98,0,.98]) {
    block(rack, 'worklight weather hood', frame, [x,0,-.05], [.98,.44,.19])
    plate(rack, 'rear service flood diffuser', face, [x,0,.053], .88, .35)
    for (let i=0; i<9; i++) {
      const vane = block(rack, 'downward-cutoff worklight louvre', frame, [x,(i-4)*.044-.016,.279], [.91,.010,.46])
      vane.rotation.x = .063
      vane.castShadow = false
    }
  }
  const anchor = new THREE.Object3D()
  anchor.position.z = .54
  rack.add(anchor)
  return { id: 'north deck pole', kind: 'area', object: anchor, color: tint, intensity: radiance * (3*.88*.35), size: [2.78,.35],
    range: 39, shadow: true, beam: false, level: () => 1 }
}

export interface RoofFixtures { lights: FilmLight[]; signs: string[]; steamSources: NonNullable<import('./contract').WorldModule['steamSources']>; set(t: number): void }

const generic = (name: string): string => {
  const value = config.signage.generic.find(s => s === name)
  if (!value) throw new Error(`Missing generic sign: ${name}`)
  return value
}

export function roofFixtures(root: THREE.Group, roof: THREE.Group, city: THREE.Group, labels: Label, surfaces: WetSurface[]): RoofFixtures {
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(.12, .135, .16), metalness: .73, roughness: .39 })
  const frame = new THREE.MeshStandardMaterial({ color: new THREE.Color(.023, .031, .047), metalness: .6, roughness: .56 })
  surfaces.push({ material: metal, wetness: 'sheet' })
  const billboard = city.getObjectByName('billboard')!
  billboard.getObjectByName('blank unlit face')?.removeFromParent()
  const primary = addBillboard(billboard, metal, false, labels)
  const raking = addBillboard(addRakingCabinet(roof, metal, frame), metal, true)
  const lights = [primary.film, raking.film]
  const signs: string[] = []
  signs.push(generic('LEVEL 9'))
  const dirtyAcrylic = new THREE.MeshStandardMaterial({ color: 0x30383b, roughness: .54 })
  const install = (key: string, text: string, width: number, height: number, color: THREE.Color, intensity: number, direct = false) => {
    const fixture = city.getObjectByName(key)!
    fixture.getObjectByName('blank unlit face')?.removeFromParent()
    plate(fixture, `${key} substrate`, dirtyAcrylic, [0, 0, .179], width, height)
    labelFace(fixture, text, [0, 0, .188], [width * .94, height * .88], labels, color.clone().multiplyScalar(intensity))
    signs.push(text)
    if (direct) lights.push({ id: key, kind: 'area', object: fixture, color, intensity: intensity * width * height * .42, size: [width, height], range: 105, shadow: false, beam: false, level: () => 1 })
  }
  install('red sign', generic('BAR'), 2.3, 1, new THREE.Color(1, .28, .31), 9.8, true)
  install('wide cool panel', generic('ARCADE'), 4.4, 1.5, new THREE.Color(.73, .85, 1), 4.8, true)
  install('wide warm panel', generic('HOTEL'), 3.1, 1.22, new THREE.Color(1, .82, .63), 3.8, true)
  for (const name of ['vertical cool panel', 'small cool panel', 'corner cool panel', 'vertical warm panel', 'small warm panel']) {
    const blank = city.getObjectByName(name)?.getObjectByName('blank unlit face')
    if (blank instanceof THREE.Mesh) blank.material = frame
  }

  const core = roof.getObjectByName('stair and lift core')!
  const warmth = new THREE.Color(1, .76, .44)
  const doorBack = core.getObjectByName('recessed doorway back')
  if (doorBack instanceof THREE.Mesh) doorBack.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(.25, .195, .133), emissive: warmth, emissiveIntensity: .038, roughness: .69 })
  for (const x of [-3.23, -2.23]) block(core, 'door channel jamb', metal, [x, 1.06, 2.085], [.056, 2.11, .22])
  block(core, 'door closer', metal, [-2.73, 2.076, 2.12], [.29, .041, .13])
  for (let i = 0; i < 4; i++) block(core, 'interior stair tread', metal, [-2.73, .09 - i * .028, 1.57 + i * .16], [.95, .036, .152])
  const innerHandrail = block(core, 'interior warm handrail', metal, [-3.08, .91, 1.88], [.034, .035, .65])
  innerHandrail.rotation.x = -.18
  const door = plate(core, 'doorway opal luminaire', new THREE.MeshBasicMaterial({ color: warmth.clone().multiplyScalar(11), toneMapped: false, side: THREE.DoubleSide }), [-2.73, 2.0, 2.28], .39, .082)
  door.rotation.x = 1.14
  const doorAnchor = new THREE.Object3D()
  doorAnchor.position.set(-2.73, 1.54, 2.47)
  doorAnchor.rotation.x = .32
  core.add(doorAnchor)
  lights.push({ id: 'doorway', kind: 'area', object: doorAnchor, color: warmth, intensity: 3.2, size: [.9, 1.6], range: 12, shadow: false, beam: false, level: () => 1 })
  const signMount = core.getObjectByName('blank wayfinding plate')
  if (signMount instanceof THREE.Mesh) signMount.material = frame
  const stairs = generic('STAIRS')
  labelFace(core, stairs, [-2.73, 2.48, 2.434], [.84, .26], labels, new THREE.Color(.69, .72, .71))
  signs.push(stairs)
  const payMount = roof.getObjectByName('pay station display')
  if (payMount) {
    const tag = plate(payMount.parent!, 'payment plate', frame, [-24.191, 1.244, -13.98], .225, .16)
    tag.rotation.y = Math.PI / 2
    const pay = generic('PAY HERE')
    labelFace(tag, pay, [0, 0, .003], [.22, .077], labels, new THREE.Color(.41, .56, .66))
    signs.push(pay)
  }

  const cool = new THREE.Color(.73, .86, 1)
  const flicker = stream('world/roof/pole/wheel/flicker')
  const phase = flicker.range(0, tau)
  const slow = flicker.int(4) + 5
  const fast = flicker.int(11) + 26
  const mild = (t: number) => 1 - .105 * Math.max(0, Math.sin(tau * fast * t / duration)) * Math.max(0, Math.sin(tau * slow * t / duration + phase))
  const poleMats = new Map<string, THREE.MeshBasicMaterial>()
  const poles = roof.children.filter(o => o.name === 'deck light pole')
  for (const [i, pole] of poles.entries()) {
    if (i === 8) {
      lights.push(rearDeckPractical(pole, metal, frame))
      continue
    }
    const key = i === 5 ? 'wheel deck pole' : 'auxiliary pole'
    const radiance = key === 'wheel deck pole' ? 580 : 11
    let mat = poleMats.get(key)
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: cool.clone().multiplyScalar(radiance), toneMapped: false })
      poleMats.set(key, mat)
    }
    for (const o of pole.children) if (o.name === 'unlit lamp diffuser' && o instanceof THREE.Mesh) { o.material = mat; o.castShadow = false }
    if (key !== 'auxiliary pole') {
      pole.position.set(13.45, 0, -2.22)
      const aim = new THREE.Vector3(.80, .46, 1.20)
        .sub(new THREE.Vector3(pole.position.x, 4.586, pole.position.z)).applyAxisAngle(new THREE.Vector3(0,1,0), -pole.rotation.y).normalize()
      const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,-1,0), aim)
      for (const o of pole.children) {
        if (o.name === 'opaque lamp head') o.quaternion.copy(tilt)
        if (o.name === 'unlit lamp diffuser') {
          o.quaternion.copy(tilt)
          o.position.set(o.position.x, 4.586, 0).addScaledVector(aim,.051)
        }
      }
      const anchor = new THREE.Object3D()
      anchor.position.set(0, 4.586, 0).addScaledVector(aim,.27)
      anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), aim)
      pole.add(anchor)
      lights.push({ id: key, kind: 'spot', object: anchor, color: cool, intensity: 112, size: [.94, .16], angle: .41,
        penumbra: .73, range: 26, shadow: true, beam: false, level: mild })
    }
  }

  const plant = roof.getObjectByName('rooftop mechanical plant')!
  plant.getObjectByName('roof vent cap')?.removeFromParent()
  mesh(plant, new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .24, 24, 1, true), metal), 'open flue collar', [-1.65, 1.28, -1.08])
  const vent = new THREE.Object3D()
  vent.position.set(-1.65, 1.402, -1.08); plant.add(vent)
  const grate = roof.children.find(o => o.name === 'drain grate' && o.position.x === -1.7)!
  const drain = new THREE.Object3D()
  drain.position.y = .012; grate.add(drain)
  addSky(root)
  return {
    lights, signs, steamSources: [{ object: vent, kind: 'vent', strength: .7 }, { object: drain, kind: 'drain', strength: .38 }],
    set(t) {
      primary.set(t)
      raking.set(t)
      poleMats.get('wheel deck pole')?.color.copy(cool).multiplyScalar(580 * mild(t))
    },
  }
}
