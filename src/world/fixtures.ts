import * as THREE from 'three'
import { config } from '../config'
import type { FilmLight, WetSurface } from '../core/contract'
import { type Tuple } from './forms'

const tau = Math.PI * 2
const duration = config.film.durationSeconds

export type Label = (text: string, face?: string, rows?: readonly string[]) => THREE.Texture | null

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
  return (label, face = 'World Condensed', rows = [label]) => {
    const key = `${face}/${rows.join('/')}`
    const hit = cache.get(key)
    if (hit) return hit
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = rows.length === 1 ? 128 : 256
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
    rows.forEach((row, i) => cx.fillText(row, 256, line * (i + .52)))
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

export function labelFace(parent: THREE.Object3D, name: string, at: Tuple, size: readonly [number, number], label: Label, color: THREE.Color, face?: string, rows?: readonly string[]): void {
  const tx = label(name, face, rows)
  if (!tx) return
  plate(parent, `lettering ${name}`, new THREE.MeshBasicMaterial({ color, map: tx, toneMapped: false, alphaTest: .22 }), at, ...size)
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
const bbSigma = .31
const bbSaturation = .63
const bbBase = .39
const bbPeak = 8.95
const bbWaveMean = .85

export function billboardState(t: number, out: THREE.Color, cool: THREE.Color, light: THREE.Color): { center: number; mean: number } {
  const phase = tau * t / duration
  const center = .5 + .25 * Math.sin(2 * phase - 1.15) + .055 * Math.sin(3 * phase + .31)
  const k = .5 + .5 * Math.sin(phase - .85)
  cool.setRGB(.29 + .10*k, .58 + .09*k, .88 + .11*k)
  light.setRGB(.65 + .19*k, .85 + .09*k, 1)
  let mean = 0
  for (let j = 0; j < 32; j++) { const x = (j + .5) / 32; mean += Math.exp(-(((x - center) / bbSigma) ** 4)) / 32 }
  const stripe = bbWaveMean * bbPeak * mean
  out.setRGB(bbBase * cool.r + stripe * light.r, bbBase * cool.g + stripe * light.g, bbBase * cool.b + stripe * light.b)
  return { center, mean: Math.max(out.r, out.g, out.b) }
}

function addBillboard(sign: THREE.Object3D, metal: THREE.Material): { film: FilmLight; set(t: number): void } {
  const [width, height] = bbSize
  const cool = new THREE.Color(), light = new THREE.Color(), average = new THREE.Color()
  const uniforms = { centerX: { value: .5 }, cool: { value: cool }, light: { value: light }, pixelCount: { value: new THREE.Vector2(width / .008, height / .008) } }
  const shader = new THREE.ShaderMaterial({
    uniforms, toneMapped: false,
    vertexShader: /* glsl */ `varying vec2 faceUV; void main() { faceUV = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 faceUV;
      uniform float centerX;
      uniform vec3 cool, light;
      uniform vec2 pixelCount;
      void main() {
        float a = (faceUV.x - centerX) / ${bbSigma.toFixed(3)};
        float band = exp(-a*a*a*a);
        float wave = ${bbWaveMean.toFixed(3)} + .15*cos((faceUV.y-.48+.24*sin(faceUV.x*6.28))*6.283);
        vec3 rgb = ${bbBase.toFixed(3)}*cool + ${bbPeak.toFixed(3)}*band*wave*light;
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
    anchor.position.set((state.center - .5) * bbSaturation * 2, 0, face.position.z + .017)
  }
  set(0)
  return { set, film: {
    id: 'billboard', kind: 'area', object: anchor, color, intensity: 4.5 * width * height,
    size: [width-1.05, height], range: 112, shadow: true, beam: true,
    level: (t) => billboardState(t, scratch, scratchCool, scratchLight).mean / 4.5,
    colorAt: (t, out) => { const { mean } = billboardState(t, out, scratchCool, scratchLight); out.multiplyScalar(1 / mean) },
  } }
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
  const primary = addBillboard(billboard, metal)
  const lights = [primary.film]
  const signs: string[] = []
  const dirtyAcrylic = new THREE.MeshStandardMaterial({ color: 0x30383b, roughness: .54 })
  const install = (key: string, text: string, width: number, height: number, color: THREE.Color, intensity: number, direct = false) => {
    const fixture = city.getObjectByName(key)!
    fixture.getObjectByName('blank unlit face')?.removeFromParent()
    plate(fixture, `${key} substrate`, dirtyAcrylic, [0, 0, .179], width, height)
    labelFace(fixture, text, [0, 0, .188], [width * .94, height * .88], labels, color.clone().multiplyScalar(intensity))
    signs.push(text)
    if (direct) lights.push({ id: key, kind: 'area', object: fixture, color, intensity: intensity * width * height * .42, size: [width, height], range: 105, shadow: false, beam: false, level: () => 1 })
  }
  install('red sign', generic('BAR'), 2.3, 1, new THREE.Color(1, .105, .16), 15, true)
  install('wide cool panel', generic('ARCADE'), 4.4, 1.5, new THREE.Color(.49, .74, 1), 7, true)
  install('wide warm panel', generic('HOTEL'), 3.1, 1.22, new THREE.Color(1, .75, .48), 4.5, true)
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

  const cool = new THREE.Color(.60, .79, 1)
  let mild = 1
  const poleMats = new Map<string, THREE.MeshBasicMaterial>()
  const poles = roof.children.filter(o => o.name === 'deck light pole')
  for (const [i, pole] of poles.entries()) {
    const key = i === 0 ? 'south deck pole' : i === 8 ? 'north deck pole' : 'auxiliary pole'
    const radiance = key === 'auxiliary pole' ? 3.5 : 19
    let mat = poleMats.get(key)
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: cool.clone().multiplyScalar(radiance), toneMapped: false })
      poleMats.set(key, mat)
    }
    for (const o of pole.children) if (o.name === 'unlit lamp diffuser' && o instanceof THREE.Mesh) { o.material = mat; o.castShadow = false }
    if (key !== 'auxiliary pole') {
      const anchor = new THREE.Object3D()
      anchor.position.set(0, 4.528, 0)
      anchor.rotation.x = Math.PI / 2
      pole.add(anchor)
      lights.push({ id: key, kind: 'spot', object: anchor, color: cool, intensity: 10.8, size: [1.26, .16], angle: 1.04,
        penumbra: .71, range: 22, shadow: true, beam: true, level: key === 'south deck pole' ? () => mild : () => 1 })
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
      mild = 1 - .105 * Math.max(0, Math.sin(tau * 29 * t / duration)) * Math.max(0, Math.sin(tau * 7 * t / duration + .88))
      poleMats.get('south deck pole')?.color.copy(cool).multiplyScalar(19 * mild)
    },
  }
}
