import * as THREE from 'three'
import { config } from '../config'
import { candelaPerUnit, type FilmLight, type WetSurface } from '../core/contract'
import { stream, streamSeed } from '../core/random'
import { primaryBillboardSize } from './city'
import { group, type Tuple } from './forms'

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

export function addSky(root: THREE.Group, cloudDistricts: readonly [THREE.Vector2,THREE.Vector2], muralCloud: THREE.Color, northDistrict?: THREE.Vector2): void {
  const sky = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: {
      cloudSeed: { value: streamSeed('world/city/cloud-base') / 4294967296 * 37 },
      cloudDistricts: { value: cloudDistricts },
      muralCloud: { value: muralCloud },
      northDistrict: { value: northDistrict ?? new THREE.Vector2() },
      northGlow: { value: northDistrict ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        gl_Position = projectionMatrix * vec4(mat3(modelViewMatrix) * position, 1.0);
        gl_Position.z = gl_Position.w * .999999;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 skyDirection;
      uniform float cloudSeed;
      uniform vec2 cloudDistricts[2];
      uniform vec3 muralCloud;
      uniform vec2 northDistrict;
      uniform float northGlow;
      float cloudHash(vec2 p) {
        vec3 q = fract(vec3(p.xyx+cloudSeed)*.1031);
        q += dot(q,q.yzx+33.33);
        return fract((q.x+q.y)*q.z);
      }
      float cloudNoise(vec2 p) {
        vec2 i=floor(p), f=fract(p);
        vec2 q=f*f*(3.0-2.0*f);
        return mix(mix(cloudHash(i),cloudHash(i+vec2(1,0)),q.x),mix(cloudHash(i+vec2(0,1)),cloudHash(i+1.0),q.x),q.y);
      }
      float cloudLayer(vec2 p) {
        float lobe = cloudNoise(p*vec2(.71,1.31));
        float roll = cloudNoise(p*vec2(1.59,2.10)+vec2(lobe*1.18,-lobe*.93));
        float curl = cloudNoise(p*3.82+vec2(roll,-lobe));
        return .54*lobe+.32*roll+.14*curl;
      }
      void main() {
        vec3 d = normalize(skyDirection);
        float horizon = exp(-max(d.y, 0.0)*4.2);
        float south = pow(max(0.0, dot(d, normalize(vec3(.18,.16,-1.0)))), 5.0);
        float north = pow(max(0.0, dot(d, normalize(vec3(-.62,.13,1.0)))), 9.0);
        float warm = pow(max(0.0, dot(d, normalize(vec3(-1.0,.13,-.1)))), 10.0);
        vec2 bank = vec2(d.x*10.0+d.z*4.0,d.y*18.0-d.z*3.0);
        float coarse = cloudNoise(bank);
        float cloud = .52+.39*coarse+.19*cloudNoise(bank*2.22+coarse*1.53);
        vec3 c = mix(vec3(.0038,.008,.019),vec3(.011,.022,.041), horizon);
        c += horizon*cloud*(south*vec3(.014,.034,.071)+north*vec3(.013,.031,.047)+warm*vec3(.019,.012,.009));
        float canopy = pow(max(0.0,dot(d,normalize(vec3(-.68,.54,-.34)))), 5.2);
        float cloudBase = smoothstep(.05,.32,d.y+.05*(coarse-.5))*(.48+.55*cloud);
        c += cloudBase*(vec3(.003,.007,.012)+canopy*vec3(.017,.030,.052));
        vec2 skyPlane = normalize(d.xz+vec2(.0001,0.0));
        float wash = pow(max(dot(skyPlane,normalize(vec2(-.55,-.84))),0.0), 4.8);
        float cloudAngle = smoothstep(-.025,.058,d.y) * (1.0-smoothstep(.26,.58,d.y));
        vec2 low = vec2(d.x*11.2+d.z*6.0,(d.y+.036)*24.0);
        float banks = cloudNoise(low*.85);
        float layers = cloudNoise(low*2.55+vec2(3.1,banks*1.67));
        float cover = smoothstep(.26,.83,.58*banks+.39*layers+.16*cloudNoise(low*5.04));
        float pink = cloudNoise(low*.36+vec2(9.5,3.1));
        vec3 reflectedCity = mix(vec3(.28,.101,.39),vec3(.62,.186,.34),pink);
        float upper = smoothstep(.185,.448,d.y);
        float bankEdge = smoothstep(.23,.76,banks*.64+layers*.36);
        float lowSpill = mix(.24+.76*cover, cover*bankEdge, upper);
        c += wash*cloudAngle*reflectedCity*lowSpill;
        float mass = smoothstep(.26,.78, coarse*.62+cloudNoise(bank*1.73+vec2(coarse,2.4))*.38);
        float underside = max(0.0,cloudNoise(bank-vec2(0.0,.38))-coarse);
        vec3 upperBase = mix(vec3(.0038,.0035,.0047),vec3(.0087,.0079,.0100),mass);
        upperBase += vec3(.010,.007,.014)*smoothstep(.11,.42,underside)*(.24+.76*wash);
        c = mix(c,upperBase,upper);
        float azimuth = atan(d.x/max(-d.z,.001));
        float southClouds = smoothstep(.04,.31,-d.z)*smoothstep(-.93,-.76,azimuth)*(1.0-smoothstep(-.22,-.04,azimuth));
        float lowerSky = smoothstep(.024,.078,d.y)*(1.0-smoothstep(.192,.240,d.y));
        vec2 bankPoint = vec2((azimuth+.50)*24.3,(d.y-.155)*49.8);
        float windShear = cloudNoise(bankPoint*.51+vec2(7.1,3.9));
        float loftDrift = cloudNoise(bankPoint*.69+vec2(-4.3,8.2));
        vec2 advected = mat2(.96,-.21,.21,.96)*bankPoint+
          vec2(5.32+1.56*(windShear-.5),3.81+1.38*(loftDrift-.5));
        float cloudBody = cloudLayer(advected);
        float shadowLayer = cloudLayer(advected*vec2(.73,.88)+vec2(-3.17,2.81));
        float overlap = smoothstep(.33,.74,.59*shadowLayer+.41*cloudBody);
        float belly = smoothstep(.25,.67,cloudBody);
        float edge = cloudLayer(advected+vec2(.038,.28))-cloudBody;
        float crumbs = cloudNoise(advected*vec2(5.4,7.2)+vec2(3.31,-6.18));
        float openSeam = cloudNoise(advected*vec2(2.44,4.75)+vec2(-1.63,8.05));
        float illuminatedEdge = smoothstep(.012,.124,edge)*(.44+.56*crumbs)*
          smoothstep(.25,.61,cloudBody+.12*openSeam)*smoothstep(.23,.73,openSeam);
        float shadow = smoothstep(.35,.80,.72*overlap+.28*belly);
        float westCrest = (1.0-smoothstep(-.66,-.51,azimuth))*smoothstep(.124,.177,d.y);
        float arc = (azimuth+.498)*6.83;
        float loft = (d.y-.155-.031*(loftDrift-.5)-.018*(windShear-.5))*19.8;
        float field = exp(-arc*arc-loft*loft);
        vec3 dusk = mix(vec3(.097,.093,.125),vec3(.048,.054,.078),shadow*(.69+.31*westCrest));
        vec3 litCloud = muralCloud*mix(vec3(1.22,2.35,.72),vec3(1.95,3.37,.92),crumbs);
        float underlit = ((.166+.40*belly)*(1.0-.68*shadow)+2.23*illuminatedEdge*(1.0-.37*shadow))*(1.0-.52*westCrest);
        float underSky = smoothstep(.020,.066,d.y)*(1.0-smoothstep(.168,.208,d.y));
        c = mix(c,dusk,southClouds*lowerSky*(.72+.13*westCrest)) + litCloud*field*underlit*southClouds*underSky*.71;
        float highBand = smoothstep(.275,.457,d.y)*(1.0-smoothstep(.68,.84,d.y))*smoothstep(.07,.36,-d.z);
        if (highBand > .0) {
          vec2 cloudFoot = d.xz*(382.0/d.y);
          vec2 southOffset = (cloudFoot-cloudDistricts[0])/vec2(178.0,235.0);
          vec2 westOffset = (cloudFoot-cloudDistricts[1])/vec2(96.0,162.0);
          float mainUpglow = pow(1.0+dot(southOffset,southOffset),-1.56);
          float cyanUpglow = pow(1.0+dot(westOffset,westOffset),-1.72);
          vec2 wind = mat2(.88,.47,-.47,.88)*(cloudFoot/132.0);
          vec2 curl = vec2(cloudNoise(wind*.67+vec2(13.6,-4.2)),cloudNoise(wind*.83+vec2(-6.1,11.3)));
          vec2 fold = wind+1.38*(curl-.5);
          float lobe = cloudNoise(fold*vec2(.91,1.22)+vec2(6.2,3.3));
          float billows = cloudNoise(fold*2.35+vec2(3.3,lobe*.91));
          float thread = cloudNoise(fold*5.72-vec2(billows,-lobe));
          float density = .54*lobe+.34*billows+.12*thread;
          float canopyBelly = smoothstep(.29,.70,density);
          float slots = smoothstep(.34,.61,cloudNoise(fold*1.65+vec2(-4.8,8.6)));
          float rim = smoothstep(.018,.26,cloudNoise(fold*2.35+vec2(3.55,lobe*.91-.29))-billows);
          float radiance = (.043+.41*canopyBelly)*(.31+.69*slots)+.88*pow(rim,1.6)*(.32+.68*slots);
          vec3 magentaCloud = muralCloud*mix(vec3(1.38,1.02,.69),vec3(.66,.97,1.33),smoothstep(.23,.73,curl.y));
          c += highBand*radiance*(mainUpglow*magentaCloud+cyanUpglow*vec3(.013,.046,.105));
        }
        float northBand = northGlow*smoothstep(.15,.36,d.y)*(1.0-smoothstep(.80,.96,d.y))*smoothstep(0.0,.32,d.z);
        if (northBand > .0) {
          vec2 northFoot = d.xz*(410.0/d.y);
          vec2 northOffset = (northFoot-northDistrict)/vec2(230.0,270.0);
          float northUpglow = pow(1.0+dot(northOffset,northOffset),-1.38);
          vec2 northWind = mat2(.83,-.56,.56,.83)*(northFoot/148.0);
          vec2 northCurl = vec2(cloudNoise(northWind*.71+vec2(-8.4,2.7)),cloudNoise(northWind*.79+vec2(5.2,-9.6)));
          vec2 northFold = northWind+1.31*(northCurl-.5);
          float northLobe = cloudNoise(northFold*vec2(1.04,.88)+vec2(-2.9,7.1));
          float northBillows = cloudNoise(northFold*2.21+vec2(-5.6,northLobe*.87));
          float northDensity = .58*northLobe+.42*northBillows;
          float northBelly = smoothstep(.30,.72,northDensity);
          float northRim = smoothstep(.02,.27,cloudNoise(northFold*2.21+vec2(-5.4,northLobe*.87-.31))-northBillows);
          float northRadiance = (.05+.38*northBelly)+.62*pow(northRim,1.6)*(.4+.6*northBelly);
          vec3 northCloud = mix(vec3(1.18,.30,.70),vec3(.62,.30,1.32),smoothstep(.25,.75,northCurl.x));
          c += northBand*northRadiance*northUpglow*northCloud;
        }
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  })
  const ceiling = mesh(root, new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 16), sky), 'city-lit cloud base', [0, 0, 0], false)
  ceiling.renderOrder = -1000
  ceiling.frustumCulled = false
  root.add(new THREE.HemisphereLight(new THREE.Color(.20, .31, .47), new THREE.Color(.072, .083, .10), .28))
}

const rakingBillboardSize = [9.6, 4.8] as const
const bbSigma = .148
const bbBase = .31
const bbPeak = 3.4
const bbFill = 1.15
const bbWaveMean = .81
const bbStripeFloor = .38

const ease = THREE.MathUtils.smoothstep
const wheelBeat = config.beats.find(b => b.id === 'wheel')!
const detailBeat = config.beats.find(b => b.id === 'detail')!
const lampEnvelope = (t: number, beat: { start: number; end: number }) =>
  ease(t, beat.start-.3, beat.start+.23) * (1-ease(t, beat.end-.23, beat.end+.3))

export function billboardState(t: number, out: THREE.Color, cool: THREE.Color, light: THREE.Color): { center: number; mean: number } {
  const phase = tau * t / duration
  const center = .63 + .15 * Math.sin(2 * phase - 1.15) + .041 * Math.sin(3 * phase + .31)
  const k = .5 + .5 * Math.sin(phase - .85)
  cool.setRGB(.20 + .14*k, .46 + .15*k, .81 + .10*k)
  light.setRGB(.57 + .15*k, .81 + .12*k, 1)
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
    stripe += bbPeak*Math.exp(-((rail/bbSigma)**2))*wave*cover*(bbStripeFloor+(1-bbStripeFloor)*chart)
  }
  fill /= 48*12
  stripe /= 48*12
  out.setRGB(fill * cool.r + stripe * light.r, fill * cool.g + stripe * light.g, fill * cool.b + stripe * light.b)
  return { center, mean: Math.max(out.r, out.g, out.b) }
}

function addBillboard(sign: THREE.Object3D, metal: THREE.Material, key: boolean, labels?: Label): { film: FilmLight; set(t: number): void } {
  const [width, height] = key ? rakingBillboardSize : primaryBillboardSize
  const intensity = key ? .64 * width * height : 9.216
  const cool = new THREE.Color(), light = new THREE.Color(), average = new THREE.Color()
  const title = labels?.(generic('LEVEL 9'), 'World Condensed', undefined, 3.25) ?? null
  const uniforms = { centerX: { value: .5 }, cool: { value: cool }, light: { value: light }, headline: { value: title }, pixelCount: { value: new THREE.Vector2(width / .008, height / .008) } }
  const shader = new THREE.ShaderMaterial({
    uniforms, defines: key ? { WORLD_BILLBOARD_KEY: 1 } : title ? { WORLD_BILLBOARD_TITLE: 1 } : {}, toneMapped: false,
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
        float band = exp(-a*a);
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
          if (all(greaterThan(mark,vec2(0))) && all(lessThan(mark,vec2(1)))) rgb += vec3(.80,.93,1.0)*.84*texture2D(headline,mark).a;
          float track = smoothstep(.028,.039,uv.x)*(1.0-smoothstep(.248,.258,uv.x));
          rgb += (.29+.68*smoothstep(.03,.23,centerX-uv.x-.35))*cool*track*(1.0-smoothstep(.008,.012,abs(uv.y-.267)));
        #endif
        float fine = max(fwidth(faceUV.x)*pixelCount.x, fwidth(faceUV.y)*pixelCount.y);
        vec2 dotXY = abs(fract(faceUV*pixelCount)-.5);
        float led = 1.0-smoothstep(.31,.49,max(dotXY.x,dotXY.y));
        float grid = mix(.24+1.21*led,1.0,smoothstep(.36,.65,fine));
        float seamsDist = min(abs(fract(faceUV.x*10.0+.5)-.5),abs(fract(faceUV.y*5.0+.5)-.5));
        float seams = mix(.93,1.0,smoothstep(.0,.013,seamsDist));
        #ifdef WORLD_BILLBOARD_KEY
          float edgeX = smoothstep(.02,.23,uv.x)*(1.0-smoothstep(.77,.99,uv.x));
          float rail = (uv.y-.635-.025*sin(uv.x*6.28-centerX*3.0))/.077;
          float softBar = exp(-rail*rail)*edgeX;
          rgb = vec3(.008,.013,.021) + softBar * mix(vec3(.46,1.83,3.15),vec3(.73,2.68,4.6),band) * (.86+.14*wave);
        #else
          float lipShadow = smoothstep(.002,.018,min(uv.y,1.0-uv.y));
          float moduleWake = 1.0-smoothstep(0.0,.019,abs(uv.x-.811+.003*sin(uv.y*23.0)));
          rgb *= mix(.77,1.0,lipShadow)*(1.0-.17*moduleWake*(1.0-smoothstep(.03,.33,uv.y)));
        #endif
        gl_FragColor = vec4(rgb * grid * seams,1.0);
      }
    `,
  })
  const face = plate(sign, 'animated cabinet LED face', shader, [0, 0, .195], width, height)
  const anchor = new THREE.Object3D()
  sign.add(anchor)
  for (const x of [-width / 2 - .07, width / 2 + .07]) block(sign, 'cabinet edge extrusion', metal, [x, 0, .09], [.12, height + .18, .42])
  for (const y of [-height / 2 - .045, height / 2 + .045]) block(sign, 'cabinet weather strip', metal, [0, y, .12], [width + .25, .085, .38])
  if (!key) for (const x of [-width*.414,-width*.143,width*.143,width*.414]) {
    block(sign, 'cabinet rain shed lip', metal, [x,height*.5+.064,.13], [width*.224,.044,.49])
    block(sign, 'cabinet lower weep slot', metal, [x,-height*.5-.082,.23], [.116,.014,.072])
  }
  const rungX = key ? 3.45 : width * .359375
  for (const x of [-rungX, rungX]) block(sign, 'cabinet maintenance rung', metal, [x, -height * .5 - .23, -.14], [.68, .12, .76])
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
    id: key ? 'raking billboard' : 'billboard', kind: 'area', object: anchor, color, intensity,
    size: [width*.75, height-.32], range: key ? 63 : 112, shadow: false, beam: false,
    level: (t) => billboardState(t, scratch, scratchCool, scratchLight).mean,
    colorAt: (t, out) => { const { mean } = billboardState(t, out, scratchCool, scratchLight); out.multiplyScalar(1 / mean) },
  } }
}

function addRakingCabinet(roof: THREE.Group, metal: THREE.Material, frame: THREE.Material): THREE.Group {
  const sign = new THREE.Group()
  sign.name = 'side-facing billboard cabinet'
  sign.position.set(10.9, 6.35, -15.4)
  sign.rotation.y = -.42
  roof.add(sign)
  block(sign, 'screen cabinet enclosure', frame, [0, 0, -.16], [9.66, 4.92, .55])
  for (const side of [-1, 1]) {
    const foundation = side < 0 ? 3.61 : 0
    const drop = sign.position.y - foundation
    block(sign, 'billboard lattice post', metal, [side*4.56,-(2.45+drop)/2,-.67], [.205,drop-2.45,.205])
    block(sign, 'ballasted billboard foot', frame, [side*4.56,.12-drop,-.67], [.79,.24,.76])
    block(sign, 'cabinet vertical rear rail', frame, [side*4.38,-.31,-.69], [.18,4.2,.2])
    block(sign, 'cabinet mounting clevis', metal, [side*4.38,-2.55,-.5], [.43,.29,.87])
    if (side > 0) {
      const diagonal = block(sign, 'billboard diagonal steel tie', metal, [side*3.98,-3.42,-.67], [.095,2.03,.10])
      diagonal.rotation.z = side*.60
    }
  }
  block(sign, 'billboard cross beam', metal, [0,-2.71,-.67], [9.29,.23,.27])
  return sign
}

function panelPractical(
  parent: THREE.Group, metal: THREE.Material, frame: THREE.Material,
  name: string, at: Tuple, yaw: number, size: [number, number], color: THREE.Color, radiance: number,
  range: number, shadow: boolean, seams: number, foot = 0, delivery = 1,
): FilmLight {
  const group = new THREE.Group()
  const [width, height] = size
  group.name = name
  group.position.set(...at)
  group.rotation.y = yaw
  parent.add(group)
  const diffuser = new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: { opalRadiance: { value: color.clone().multiplyScalar(radiance) }, joinCount: { value: seams } },
    vertexShader: 'varying vec2 faceUV; void main() { faceUV=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `
      varying vec2 faceUV;
      uniform vec3 opalRadiance;
      uniform float joinCount;
      void main() {
        float u=faceUV.x,v=faceUV.y;
        float edge=smoothstep(.01,.18,v)*(1.0-smoothstep(.82,.99,v));
        float q=(v-.56)/.335;
        float grad=.40+.49*exp(-q*q)+.20*edge;
        float joins=mix(.89,1.,smoothstep(0.,.018,abs(fract(u*joinCount+.5)-.5)));
        float falloff=.77+.23*sin(u*3.14159);
        gl_FragColor=vec4(opalRadiance*grad*falloff*joins,1.);
      }`,
  })
  block(group, 'weatherproof luminaire body', frame, [0,0,-.13], [width+.16,height+.12,.37])
  plate(group, 'graded opal face', diffuser, [0,0,.07], width, height)
  for (const y of [-height/2-.02,height/2+.02]) block(group, 'radiused edge rail', metal, [0,y,.064], [width+.10,.048,.19])
  for (const dir of [-1,1]) {
    const x = dir*width*.39
    const riser = at[1] - foot
    block(group, 'galvanized mounting leg', metal, [x,-riser*.5,-.26], [.15,riser,.18])
    block(group, 'bolted fixture foot', frame, [x,.073-riser,-.26], [.35,.146,.38])
  }
  const anchor = new THREE.Object3D()
  anchor.position.z = .19
  group.add(anchor)
  return { id: name, kind: 'area', object: anchor, color, intensity: width*height*radiance*.78*delivery, size, range, shadow, beam: false, level: () => 1 }
}

function frontageRibbon(parent: THREE.Object3D, shell: THREE.Material, name: string, at: Tuple, yaw: number, size: [number, number], gain: number,
  profile: 'soft' | 'flush' | 'glazed' = 'soft'): THREE.Group {
  const housing = new THREE.Group()
  housing.name = name
  housing.position.set(...at)
  housing.rotation.y = yaw
  parent.add(housing)
  const [width,height] = size
  block(housing, 'ribbon casing', shell, [0,0,-.18], [width+.16,height+.14,.35]).castShadow = false
  plate(housing, 'feathered LED ribbon', new THREE.ShaderMaterial({
    uniforms: { gain: { value: gain } },
    defines: profile === 'flush' ? { WORLD_INSET_LOUVRE: 1 } : profile === 'glazed' ? { WORLD_GLAZED_RIBBON: 1 } : {}, toneMapped: false,
    vertexShader: 'varying vec2 faceUV; varying vec3 faceWorld; void main(){faceUV=uv;faceWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: /* glsl */ `
      varying vec2 faceUV;
      varying vec3 faceWorld;
      uniform float gain;
      void main(){
        vec2 p=faceUV;
        float lengthMask=smoothstep(.02,.22,p.x)*(1.-smoothstep(.79,.98,p.x));
        float row=.57+.055*sin(p.x*4.6);
        float cyanOffset=(p.y-row)/.20, redOffset=(p.y-.16)/.055;
        float cyan=exp(-cyanOffset*cyanOffset);
        float red=exp(-redOffset*redOffset)*smoothstep(.40,.76,p.x);
        float pitch=abs(fract(p.x*6.)-.5);
        float joins=mix(.91,1.,1.-smoothstep(.475,.495,pitch));
        vec3 cool=mix(vec3(.20,.93,1.65),vec3(.62,1.72,2.35),smoothstep(.05,.86,p.x));
        float beam=1.;
        #ifdef WORLD_INSET_LOUVRE
          beam=smoothstep(.136,.204,normalize(cameraPosition-faceWorld).y);
          if (abs(p.y-.5)>mix(.08,.5,beam)) discard;
        #endif
        vec3 source=lengthMask*joins*(cool*cyan+red*vec3(1.03,.045,.087));
        #ifdef WORLD_GLAZED_RIBBON
          float bay=floor(p.x*7.);
          vec2 pane=vec2(fract(p.x*7.),p.y);
          vec2 gasket=smoothstep(vec2(.014,.025),vec2(.065,.105),min(pane,1.-pane));
          float occupancy=.14+.52*step(.39,fract(bay*.71+.21))+.25*step(.48,fract(bay*.42+.47));
          vec3 glass=mix(vec3(.76,.91,1.03),vec3(.38,.85,1.12),step(.42,fract(bay*.622+.13)));
          source=glass*gasket.x*gasket.y*occupancy*(.30+.70*smoothstep(.08,.69,p.y));
        #endif
        gl_FragColor=vec4(vec3(.014,.021,.028)+beam*gain*source,1.);
      }`,
  }), [0,0,.003], width,height)
  return housing
}

function rampRibbon(roof: THREE.Group, shell: THREE.Material, metal: THREE.Material): void {
  const housing = new THREE.Group()
  housing.name = 'west ramp luminous barrier'
  housing.position.set(-20.08, 1.38, 14.56)
  housing.rotation.y = Math.PI / 2
  roof.getObjectByName('drive-down ramp and control island')!.add(housing)
  const width = 7.08, height = .205
  const concrete = new THREE.MeshStandardMaterial({
    color: new THREE.Color(.115,.118,.113), roughness: .85,
    emissive: new THREE.Color(.023,.033,.041), emissiveIntensity: .46,
  })
  block(housing,'precast ramp barrier extension',concrete,[0,-.053,-.025],[width+.43,1.33,.285])
  block(housing,'sealed barrier coping',metal,[0,.626,-.024],[width+.53,.103,.355])
  block(housing,'recessed barrier lighting channel',shell,[0,.148,.106],[width+.148,height+.144,.107])
  for (const x of [-2.61, -.91, 1.51, 3.13]) {
    block(housing, 'ramp guard upright', metal, [x, -.457, .117], [.108, .51, .17])
    block(housing, 'ramp guard anchoring cleat', metal, [x, -.672, -.095], [.25, .123, .27])
  }
  for (const y of [.148-height*.69,.148+height*.69]) {
    block(housing, 'barrier glazing gasket', metal, [0,y,.158], [width + .08,.040,.055])
  }
  plate(housing, 'graded ramp opal strip', new THREE.ShaderMaterial({
    toneMapped: false,
    vertexShader: /* glsl */ `varying vec2 faceUV; void main() { faceUV=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      varying vec2 faceUV;
      void main() {
        vec2 p=faceUV;
        vec2 cell=fract(p*vec2(8.,1.));
        vec2 lens=smoothstep(vec2(.016,.028),vec2(.049,.15),min(cell,1.-cell));
        float center=1.-smoothstep(.11,.48,abs(p.y-.52));
        float level=.73+.25*fract(floor(p.x*8.)*.667+.21);
        gl_FragColor=vec4(vec3(.009,.016,.026)+lens.x*lens.y*level*mix(vec3(.25,1.55,2.16),vec3(2.46,4.92,6.28),center),1.);
      }
    `,
  }), [0,.148,.169], width, height)
}

function westFacadePractical(parent: THREE.Object3D, shell: THREE.Material, metal: THREE.Material, name: string, at: Tuple, size: [number, number], neon: boolean): void {
  const housing = new THREE.Group()
  housing.name = name
  housing.position.set(...at)
  housing.rotation.y = Math.PI / 2
  parent.add(housing)
  const [width, height] = size
  block(housing, 'sealed practical casing', shell, [0, 0, -.135], [width + .15, height + .16, .28]).castShadow = false
  const depth = at[0] + 53 + .12
  for (const x of [-width * .36, width * .36]) {
    block(housing, 'facade practical wall plate', metal, [x, 0, -depth + .12], [.29, height * .88, .19]).castShadow = false
    for (const y of [-height * .30, height * .30]) {
      block(housing, 'facade practical cantilever', metal, [x, y, -depth * .5], [.15, .16, depth]).castShadow = false
    }
  }
  const face = new THREE.ShaderMaterial({
    toneMapped: false,
    defines: neon ? { WORLD_RED_NEON: 1 } : {},
    vertexShader: 'varying vec2 faceUV; void main(){faceUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: /* glsl */ `
      varying vec2 faceUV;
      void main(){
        vec2 p=faceUV;
        #ifdef WORLD_RED_NEON
          float x=(p.x-.53)/.41;
          float rail=.46+.10*x;
          float y1=abs(p.y-rail), y2=abs(p.y-rail-.235);
          float end=1.-smoothstep(.72,1.,abs(x));
          float end2=smoothstep(-.95,-.60,x)*(1.-smoothstep(.20,.64,x));
          float tube=end*(1.-smoothstep(.036,.090,y1));
          tube+=end2*.68*(1.-smoothstep(.033,.083,y2));
          float haze=end*(1.-smoothstep(.04,.205,y1));
          vec3 outputColor=vec3(.017,.009,.015)+tube*vec3(6.,.22,.65)+haze*vec3(.66,.023,.082);
        #else
          float end=smoothstep(.018,.19,p.x)*(1.-smoothstep(.82,.988,p.x));
          float beam=smoothstep(.012,.23,p.y)*(1.-smoothstep(.60,.99,p.y));
          vec2 cells=p*vec2(108.,48.);
          float detail=1.-smoothstep(.21,.82,max(fwidth(cells.x),fwidth(cells.y)));
          vec2 pitch=abs(fract(cells)-.5);
          float grid=1.-smoothstep(.32,.48,max(pitch.x,pitch.y));
          float seam=1.-.08*smoothstep(.46,.50,abs(fract(p.x*6.)-.5));
          float wash=mix(.61,1.,smoothstep(.015,.44,p.y));
          vec3 outputColor=vec3(.012,.018,.025)+end*beam*wash*seam*mix(1.,.78+.35*grid,detail)*vec3(5.,6.,7.5);
        #endif
        gl_FragColor=vec4(outputColor,1.);
      }`,
  })
  plate(housing, neon ? 'red opal neon badge' : 'segmented cool white LED face', face, [0, 0, .013], width, height)
}

function paintPracticals(roof: THREE.Group, city: THREE.Group, shell: THREE.Material, metal: THREE.Material): void {
  rampRibbon(roof, shell, metal)
  const east = frontageRibbon(roof,shell,'east traffic guidance ribbon',[12.7,.62,7.7],-1.57,[11.3,.58],7.7)
  for (const x of [-4.6,0,4.6]) {
    block(east,'traffic ribbon frame',metal,[x,-.35,-.2],[.093,.55,.28])
    block(east,'traffic ribbon bolted shoe',shell,[x,-.556,-.2],[.34,.124,.47])
  }
  frontageRibbon(roof,shell,'flush bay approach guide',[1.64,.004,2.27],-.26,[.91,.18],3.5,'flush').rotateX(-Math.PI/2)
  const west = city.getObjectByName('west low block')!
  const fascia = frontageRibbon(west,shell,'west parking fascia return',[-52.63,10.8,24.85],Math.PI/2,[12.5,1.41],3.9,'glazed')
  block(fascia,'parking floor edge and fascia backing',metal,[0,-.74,-.265],[12.87,.45,.59])
  for (const x of [-5.55,0,5.55]) block(fascia,'weatherproof fascia bracket',metal,[x,-.04,-.30],[.22,1.35,.46])
  const plant = group(west,'west rooftop service penthouse',[-56.1,19.15,24.3])
  block(plant,'roof plant and duct enclosure',shell,[0,0,0],[7.1,8.56,15.32])
  block(plant,'folded roof plant coping',metal,[0,4.22,0],[7.23,.26,15.52])
  const westRibbon = frontageRibbon(plant,shell,'west roof wayfinding crown',[3.64,3.08,0],Math.PI/2,[13.8,1.44],3.6,'glazed')
  block(westRibbon,'roof plant glazing sill',metal,[0,-.80,-.10],[14.08,.26,.36])
  westFacadePractical(west,shell,metal,'west upper service LED cabinet',[-52.65,12.61,34.92],[4.66,1.45],false)
  westFacadePractical(west,shell,metal,'west south frontage neon badge',[-51.61,8.02,18.42],[2.82,1.31],true)
  const north = city.getObjectByName('northwest tower')!
  const eastReturn = frontageRibbon(north,shell,'east glazed concourse return',[-41.57,22.48,51.04],Math.PI/2,[10.85,1.52],3.95,'glazed')
  block(eastReturn,'concourse return slab',metal,[0,-.88,-.31],[11.25,.37,.56])
  for (const x of [-4.61,0,4.61]) block(eastReturn,'concourse return standoff',metal,[x,0,-.39],[.23,1.67,.56])
  const concourse = frontageRibbon(north,shell,'northwest concourse ribbon',[-49.45,11.10,43.92],Math.PI,[13.35,1.88],4.85,'glazed')
  block(concourse,'concourse slab return',metal,[0,-1.03,-.34],[13.83,.43,.91])
  for (const x of [-6.25,0,6.25]) {
    block(concourse,'concourse fascia standoff',metal,[x,0,-.39],[.25,2.13,.69])
    block(concourse,'concourse fascia wall plate',metal,[x,.03,-.58],[.42,2.27,.23])
  }
  for (const y of [-1.00,1.00]) block(concourse,'concourse folded fascia flange',metal,[0,y,-.12],[13.74,.18,.36])
  const ice = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5,3.9,6.1), toneMapped: false })
  const ruby = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.9,.23,.42), toneMapped: false })
  const pearl = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6,3.8,4.2), toneMapped: false })
  for (const [z,y,width,height,face] of [
    [17.46,2.15,.33,1.12,ice],[19.45,2.87,.38,.64,ruby],
    [22.03,2.59,.74,.49,pearl],[23.5,1.75,.4,.82,ice],
  ] as const) {
    const mount = new THREE.Group()
    mount.position.set(-52.67,y,z)
    mount.rotation.y = Math.PI/2
    west.add(mount)
    block(mount,'recessed frontage beacon mount',shell,[0,0,-.25],[width+.12,height+.12,.49]).castShadow = false
    plate(mount,'frontage beacon opal',face,[0,0,.006],width,height)
  }
}

function deckLuminaire(roof: THREE.Group, metal: THREE.Material, frame: THREE.Material, id: string, at: Tuple, aim: Tuple, lumens: number) {
  const [x,h,z] = at
  const pole = group(roof,x < 0 ? 'west nose luminaire' : 'east rim luminaire',[x,0,z])
  pole.rotation.y = Math.atan2(aim[0]-x,aim[2]-z)
  block(pole,'concrete pole footing',frame,[0,.076,0],[.38,.152,.38])
  block(pole,'galvanized anchor plate',metal,[0,.161,0],[.25,.031,.25])
  mesh(pole,new THREE.Mesh(new THREE.CylinderGeometry(.042,.085,h-.38,14),metal),'tapered galvanized mast',[0,h*.5-.012,0])
  block(pole,'gasketed mast access plate',frame,[0,.78,.075],[.101,.244,.018])
  for (const dx of [-.08,.08]) for (const dz of [-.08,.08]) {
    mesh(pole,new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.034,8),metal),'anchor nut',[dx,.190,dz])
  }
  block(pole,'sealed spigot collar',frame,[0,h-.18,0],[.13,.19,.14])
  block(pole,'folded luminaire outreach',metal,[0,h-.045,.154],[.13,.086,.44])
  const head = group(pole,'sealed cutoff LED head',[0,h,.37])
  const normal = new THREE.Vector3(...aim).sub(head.getWorldPosition(new THREE.Vector3())).normalize()
  const up = new THREE.Vector3(0,1,0)
  normal.applyAxisAngle(up,-pole.rotation.y)
  const across = up.cross(normal).normalize()
  head.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,new THREE.Vector3().crossVectors(normal,across),normal))
  block(head,'cast aluminium body',metal,[0,0,-.078],[.97,.32,.15])
  for (const dx of [-.468,.468]) block(head,'side cutoff flange',frame,[dx,0,.009],[.034,.32,.084])
  for (const dy of [-.141,.141]) block(head,'rain lip',frame,[0,dy,.009],[.93,.035,.084])
  for (let i=-3;i<=3;i++) block(head,'cast heat sink rib',metal,[.128*i,0,-.164],[.024,.247,.033])
  const size: FilmLight['size'] = [.865,.229]
  const color = new THREE.Color(1,.87,.8)
  const angle = THREE.MathUtils.degToRad(65), penumbra = .35
  const solidAngle = 2*Math.PI*(1-.5*(Math.cos(angle)+Math.cos(angle*(1-penumbra))))
  const intensity = lumens/(solidAngle*candelaPerUnit)
  const optic = new THREE.MeshBasicMaterial({ toneMapped: false })
  for (const dx of [-1,1]) plate(head,'opal LED optic',optic,[dx*.217,0,.003],.426,size[1])
  const object = group(head,'luminaire diode center',[0,0,.061])
  const film: FilmLight = { id, kind: 'spot', object, color, intensity, size, angle, penumbra, range: 33, shadow: true, beam: true, level: () => 1 }
  const set = (wide: boolean) => optic.color.copy(color).multiplyScalar(wide ? intensity/(size[0]*size[1]) : .024)
  return { film, set }
}

function rearDeckPractical(pole: THREE.Object3D, roof: THREE.Group, metal: THREE.Material, frame: THREE.Material): { film: FilmLight; set(t: number, cutTime?: number): void } {
  const tint = new THREE.Color(.53,.76,1)
  const radiance = 245
  const face = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(radiance), toneMapped: false })
  const mast = pole.getObjectByName('tapered steel post')!
  mast.scale.y *= 1.81
  mast.position.y = 4.18
  pole.position.set(-3.9,0,12.3)
  for (const child of [...pole.children]) if (/opaque lamp head|unlit lamp diffuser|luminaire cross arm/.test(child.name)) child.removeFromParent()
  block(pole, 'worklight bolted base collar', metal, [0,.211,0], [.26,.108,.26])
  block(pole, 'worklight mast socket', metal, [0,8.08,0], [.24,.41,.26])
  const rack = new THREE.Group()
  rack.name = 'rear service flood bank'
  rack.position.set(0,8.31,0)
  const origin = new THREE.Vector3(pole.position.x,rack.position.y,pole.position.z)
  pole.add(rack)
  block(rack, 'worklight bracket plate', metal, [0,0,-.22], [4.39,.45,.34])
  for (const x of [-1.44,0,1.44]) {
    block(rack, 'worklight weather hood', frame, [x,0,-.05], [1.39,.62,.19])
    plate(rack, 'rear service flood diffuser', face, [x,0,.053], 1.27, .51)
    for (let i=0; i<9; i++) {
      const vane = block(rack, 'downward-cutoff worklight louvre', frame, [x,(i-4)*.060-.025,.279], [1.31,.013,.46])
      vane.rotation.x = .063
      vane.castShadow = false
    }
  }
  const anchor = new THREE.Object3D()
  anchor.position.z = .54
  rack.add(anchor)
  const up = new THREE.Vector3(0,1,0), forward = new THREE.Vector3(0,0,1), aim = new THREE.Vector3()
  aim.set(.04,.88,-1.44).sub(origin).applyAxisAngle(up,-pole.rotation.y).normalize()
  const across = new THREE.Vector3().crossVectors(up,aim).normalize()
  rack.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,new THREE.Vector3().crossVectors(aim,across),aim))
  const rake = new THREE.Group()
  rake.name = 'rear parapet grille grazer'
  const source = new THREE.Vector3(-.83,2.67,-18.52)
  rake.position.copy(source)
  roof.add(rake)
  block(rake,'bonded service pier',frame,[0,-1.12,-.22],[1.12,2.39,.56])
  block(rake,'service pier side flange',metal,[0,-.49,-.08],[1.04,.82,.16])
  const head = new THREE.Group()
  rake.add(head)
  const graze = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(.26), toneMapped: false })
  block(head,'grazer rain hood',frame,[0,0,-.08],[1.13,.32,.37])
  plate(head,'grazer frosted optic',graze,[0,-.006,.114],.96,.13)
  for (const y of [-.11,.11]) block(head,'linear cutoff blade',metal,[0,y,.16],[1.04,.026,.34]).castShadow = false
  const low = new THREE.Object3D()
  low.position.z = .36
  head.add(low)
  const resting = radiance * (3*1.27*.51) * 1.31
  const film: FilmLight = { id: 'north deck pole', kind: 'spot', object: anchor, color: tint.clone(), intensity: resting, size: [1.42,.35],
    angle: .123, penumbra: .39, range: 39, shadow: true, beam: false, level: () => 1 }
  const set = (t: number, cutTime = t) => {
    // Keep the shared light slot on one physical emitter across the shutter.
    const active = cutTime >= detailBeat.start && cutTime < detailBeat.end
    rake.position.y = active ? source.y : .38
    const progress = active ? ease(t,detailBeat.start,detailBeat.end) : 0
    aim.set(-.358+.12*progress,1.011,-1.22+.38*progress).sub(source).normalize()
    head.quaternion.setFromUnitVectors(forward,aim)
    film.object = active ? low : anchor
    film.size[0] = active ? .85 : 1.42
    film.size[1] = active ? .10 : .35
    film.penumbra = active ? .64 : .39
    film.intensity = active ? 2950 : resting
    if (active) film.color.setRGB(.69,.83,1)
    else film.color.copy(tint)
    graze.color.copy(film.color).multiplyScalar(active ? 14 : .26)
  }
  set(0)
  return { film, set }
}

export interface RoofFixtures {
  lights: FilmLight[]
  wideLights: FilmLight[]
  signs: string[]
  steamSources: NonNullable<import('./contract').WorldModule['steamSources']>
  set(t: number, cutTime?: number, wide?: boolean): void
}

const generic = (name: string): string => {
  const value = config.signage.generic.find(s => s === name)
  if (!value) throw new Error(`Missing generic sign: ${name}`)
  return value
}

function rearRoofAccess(parent: THREE.Group, pole: THREE.Object3D, labels: Label, metal: THREE.Material, frame: THREE.Material): void {
  const zone = group(parent,'northeast roof access')
  const at = (name: string, x: number, z: number) => {
    const node = group(zone,name,[x,0,z])
    node.rotation.y = Math.atan2(-x,-z)
    return node
  }
  const core = at('northeast stair and lift core',14.9,14.0)
  const concrete = new THREE.MeshStandardMaterial({ color: new THREE.Color(.16,.14,.12), roughness: .84 })
  const vestibule = new THREE.MeshStandardMaterial({
    color: new THREE.Color(.17,.116,.078), emissive: new THREE.Color(.79,.31,.070), emissiveIntensity: .67, roughness: .8,
  })
  const amber = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.28,1.2,.25), toneMapped: false })
  const ice = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.46,2.53,3.27), toneMapped: false })
  block(core,'concrete rear shear wall',concrete,[0,1.68,-1.52],[5.4,3.36,.30])
  for (const x of [-2.54,2.54]) block(core,'concrete side shear wall',concrete,[x,1.68,-.05],[.32,3.36,2.88])
  block(core,'concrete head and fascia',concrete,[0,2.87,1.40],[5.40,.98,.29])
  block(core,'folded roof coping',metal,[0,3.36,-.03],[5.53,.16,3.39])
  block(core,'lift roof overrun',concrete,[1.14,3.65,-.61],[2.16,.52,1.37])
  block(core,'concrete left door pier',concrete,[-2.05,1.19,1.4],[1.30,2.38,.29])
  block(core,'concrete landing end pier',concrete,[2.28,1.19,1.4],[.84,2.38,.29])
  block(core,'concrete landing lower sill',concrete,[1.04,.40,1.4],[1.66,.80,.29])
  block(core,'lit stair landing back',vestibule,[1.04,1.61,.91],[1.66,1.66,.16])
  const milk = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.2,3.32,1.65), toneMapped: false })
  const smoked = new THREE.MeshBasicMaterial({
    color: new THREE.Color(.082,.101,.116), side: THREE.DoubleSide, transparent: true, opacity: .29, depthWrite: false,
  })
  for (const x of [.21,.75,1.33,1.87]) block(core,'glazed landing mullion',frame,[x,1.60,1.59],[.064,1.60,.12])
  for (const y of [.81,1.28,2.39]) block(core,'glazed landing crossrail',frame,[1.04,y,1.59],[1.71,.064,.12])
  const rail = block(core,'visible interior stair handrail',metal,[1.04,1.43,1.18],[1.57,.048,.055])
  rail.rotation.z = .14
  plate(core,'stair landing ceiling return',milk,[1.04,2.22,1.07],1.54,.21).rotation.x = .48
  plate(core,'smoked stair landing glazing',smoked,[1.04,1.62,1.624],1.60,1.53)
  block(core,'door reveal back',vestibule,[-.64,1.17,.60],[1.62,2.34,.17])
  for (const x of [-1.4,.12]) {
    block(core,'oxide door channel',metal,[x,1.18,1.38],[.089,2.35,.19])
    block(core,'doorway inner return',vestibule,[x,1.17,1.0],[.077,2.34,.61])
  }
  for (let i=0;i<3;i++) block(core,'recessed stair tread',metal,[-.64,.034+i*.093,1.27-i*.225],[1.42,.067+i*.187,.22])
  const optic = plate(core,'doorway ceiling opal',amber,[-.64,2.29,1.19],1.24,.09)
  optic.rotation.x = .87
  block(core,'stair wayfinding cabinet',frame,[-.63,2.70,1.60],[1.67,.33,.13])
  labelFace(core,generic('STAIRS'),[-.63,2.70,1.674],[1.48,.269],labels,amber.color)
  const pay = at('northeast pay station',11.07,13.03)
  block(pay,'pay station socket',concrete,[0,.08,0],[.54,.16,.43])
  block(pay,'pay station pedestal',metal,[0,.57,0],[.20,1.0,.19])
  block(pay,'pay station cabinet',frame,[0,1.28,.015],[.46,.56,.27])
  block(pay,'coin and card housing',metal,[0,1.13,.169],[.235,.089,.075])
  plate(pay,'pay station backlit screen',milk,[0,1.37,.154],.289,.154)
  labelFace(pay,generic('PAY HERE'),[0,1.56,.154],[.393,.10],labels,amber.color)
  pole.name = 'northeast access light pole'
  pole.position.set(16.2,0,11.1)
  pole.rotation.y = Math.atan2(-16.2,-11.1)
  for (const x of [-.48,.48]) {
    const key = block(pole,'access pole cutoff housing',frame,[x,4.59,.069],[.44,.115,.194])
    key.castShadow = false
    const opal = plate(pole,'access pole opal face',ice,[x,4.558,.174],.38,.087)
    opal.rotation.x = .39
  }
}

export function roofFixtures(roof: THREE.Group, city: THREE.Group, labels: Label, surfaces: WetSurface[]): RoofFixtures {
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(.12, .135, .16), metalness: .73, roughness: .39 })
  const frame = new THREE.MeshStandardMaterial({ color: new THREE.Color(.023, .031, .047), metalness: .6, roughness: .56 })
  surfaces.push({ material: metal, wetness: 'sheet' })
  const billboard = city.getObjectByName('billboard')!
  billboard.getObjectByName('blank unlit face')?.removeFromParent()
  const primary = addBillboard(billboard, metal, false, labels)
  const rakingCabinet = addRakingCabinet(roof, metal, frame)
  const raking = addBillboard(rakingCabinet, metal, true)
  paintPracticals(roof,city,frame,metal)
  const lights = [
    primary.film, raking.film,
    panelPractical(roof, metal, frame, 'east parking canopy fascia', [13.65,2.58,-4.95], -1.42, [9.6,.46], new THREE.Color(.36,.66,1), 7.0, 44, true, 8, 0, .64),
    panelPractical(rakingCabinet, metal, frame, 'red deck marker', [1.765,2.76,.55], -.11, [5.3,.20], new THREE.Color(1,.048,.068), 10, 47, false, 3, 2.45),
    panelPractical(roof, metal, frame, 'lane separator opal', [11.4,.32,7.65], -2.04, [5.4,.27], new THREE.Color(.49,.64,.88), 15, 30, false, 6, 0, .72),
  ]
  const redMarker = lights.find(light => light.id === 'red deck marker')!.object.parent!
  const markerFace = redMarker.getObjectByName('graded opal face') as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  const markerRadiance = markerFace.material.uniforms.opalRadiance.value.clone() as THREE.Color
  const signs: string[] = []
  signs.push(generic('LEVEL 9'))
  const dirtyAcrylic = new THREE.MeshStandardMaterial({ color: 0x30383b, roughness: .54 })
  const install = (key: string, text: string, width: number, height: number, color: THREE.Color, intensity: number) => {
    const fixture = city.getObjectByName(key)!
    fixture.getObjectByName('blank unlit face')?.removeFromParent()
    plate(fixture, `${key} substrate`, dirtyAcrylic, [0, 0, .179], width, height)
    labelFace(fixture, text, [0, 0, .188], [width * .94, height * .88], labels, color.clone().multiplyScalar(intensity))
    signs.push(text)
  }
  install('red sign', generic('BAR'), 2.3, 1, new THREE.Color(1, .28, .31), 9.8)
  install('wide cool panel', generic('ARCADE'), 4.4, 1.5, new THREE.Color(.73, .85, 1), 4.8)
  for (const name of ['vertical cool panel', 'small cool panel', 'corner cool panel', 'vertical warm panel', 'wide warm panel', 'small warm panel']) {
    const blank = city.getObjectByName(name)?.getObjectByName('blank unlit face')
    if (blank instanceof THREE.Mesh) blank.material = frame
  }

  const core = roof.getObjectByName('stair and lift core')!
  const doorTint = new THREE.Color(.76, .78, .84)
  const doorBack = core.getObjectByName('recessed doorway back')
  if (doorBack instanceof THREE.Mesh) doorBack.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(.035, .041, .051), emissive: doorTint, emissiveIntensity: .008, roughness: .79 })
  for (const x of [-3.23, -2.23]) block(core, 'door channel jamb', metal, [x, 1.06, 2.085], [.056, 2.11, .22])
  block(core, 'door closer', metal, [-2.73, 2.076, 2.12], [.29, .041, .13])
  for (let i = 0; i < 4; i++) block(core, 'interior stair tread', metal, [-2.73, .09 - i * .028, 1.57 + i * .16], [.95, .036, .152])
  const innerHandrail = block(core, 'interior warm handrail', metal, [-3.08, .91, 1.88], [.034, .035, .65])
  innerHandrail.rotation.x = -.18
  const door = plate(core, 'doorway opal luminaire', new THREE.MeshBasicMaterial({ color: doorTint.clone().multiplyScalar(4.4), toneMapped: false, side: THREE.DoubleSide }), [-2.73, 2.0, 2.28], .39, .045)
  door.rotation.x = 1.14
  const doorAnchor = new THREE.Object3D()
  doorAnchor.position.set(-2.73, 1.54, 2.47)
  doorAnchor.rotation.x = .69
  core.add(doorAnchor)
  lights.push({ id: 'doorway', kind: 'area', object: doorAnchor, color: doorTint, intensity: 2.8, size: [.9, .36], range: 18, shadow: false, beam: false, level: () => 1 })
  const signMount = core.getObjectByName('blank wayfinding plate')
  const stairSidelight = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.07,1.07,.22), toneMapped: false })
  for (const x of [-.73,.49,1.71]) {
    const head = block(core,'recessed stairwell sidelight casing',frame,[x,.83,2.41],[.97,.36,.15])
    head.castShadow = false
    plate(core,'warm stairwell sidelight opal',stairSidelight,[x,.83,2.488],.86,.245)
    block(core,'sidelight storm cap',metal,[x,1.014,2.432],[1.01,.042,.19]).castShadow = false
  }
  const stairs = generic('STAIRS')
  if (signMount instanceof THREE.Mesh) {
    signMount.material = frame
    const { x, y, z } = signMount.position
    labelFace(core, stairs, [x, y, z + .024], [.84, .26], labels, new THREE.Color(.69, .72, .71))
  }
  signs.push(stairs)
  const payMount = roof.getObjectByName('pay station display')
  if (payMount) {
    const tag = plate(payMount.parent!, 'payment plate', frame, [-24.191, 1.244, -13.98], .225, .16)
    tag.rotation.y = Math.PI / 2
    const pay = generic('PAY HERE')
    labelFace(tag, pay, [0, 0, .003], [.22, .077], labels, new THREE.Color(.41, .56, .66))
    signs.push(pay)
  }

  const cool = new THREE.Color(.64, .81, 1)
  const flicker = stream('world/roof/pole/wheel/flicker')
  const phase = flicker.range(0, tau)
  const slow = flicker.int(4) + 5
  const fast = flicker.int(11) + 26
  const mild = (t: number) => 1 - .105 * Math.max(0, Math.sin(tau * fast * t / duration)) * Math.max(0, Math.sin(tau * slow * t / duration + phase))
  const poleMats = new Map<string, THREE.MeshBasicMaterial>()
  const poles = roof.children.filter(o => o.name === 'deck light pole')
  rearRoofAccess(roof,poles[7]!,labels,metal,frame)
  const service = rearDeckPractical(poles[8]!,roof,metal,frame)
  const luminaires = [
    deckLuminaire(roof,metal,frame,service.film.id,[-13,7.58,2],[.04,.84,1.18],17_800),
    deckLuminaire(roof,metal,frame,'wheel deck pole',[8,7.14,11],[.37,1.10,.10],18_600),
  ]
  let setWheel = (_t: number): void => undefined
  const wheelPeak = 330
  const lowerWheelAim = (t: number) => ease(t,wheelBeat.end-2.15,wheelBeat.end-.67)
  const wheelLevel = (t: number) => mild(t) * (31+(246+53*lowerWheelAim(t))*lampEnvelope(t,wheelBeat))/wheelPeak
  for (const [i, pole] of poles.entries()) {
    if (i === 8) { lights.push(service.film); continue }
    const key = i === 5 ? 'wheel deck pole' : 'auxiliary pole'
    const radiance = key === 'wheel deck pole' ? 115 : 11
    let mat = poleMats.get(key)
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: cool.clone().multiplyScalar(radiance), toneMapped: false })
      poleMats.set(key, mat)
    }
    for (const o of pole.children) if (o.name === 'unlit lamp diffuser' && o instanceof THREE.Mesh) { o.material = mat; o.castShadow = false }
    if (key !== 'auxiliary pole') {
      pole.position.set(10.8, 0, 4.9)
      const aim = new THREE.Vector3(), origin = new THREE.Vector3(pole.position.x,4.586,pole.position.z)
      const up = new THREE.Vector3(0,1,0), down = new THREE.Vector3(0,-1,0), forward = new THREE.Vector3(0,0,1)
      const tilt = new THREE.Quaternion()
      const heads = pole.children.filter(o => o.name === 'opaque lamp head')
      const diffusers = pole.children.filter(o => o.name === 'unlit lamp diffuser')
      const offsets = diffusers.map(o => o.position.x*1.25)
      for (const o of heads) { o.position.x *= 1.25; o.scale.set(2.1,1.55,2.05) }
      for (const o of diffusers) o.scale.set(2.55,1,2.25)
      const anchor = new THREE.Object3D()
      pole.add(anchor)
      setWheel = t => {
        const late = lowerWheelAim(t), gate = lampEnvelope(t,wheelBeat)
        aim.set(1.04+.18*gate*late,.23+(.345-.533*late)*gate,1.36+.19*gate*late)
          .sub(origin).applyAxisAngle(up,-pole.rotation.y).normalize()
        tilt.setFromUnitVectors(down,aim)
        for (const o of heads) o.quaternion.copy(tilt)
        for (const [i,o] of diffusers.entries()) {
          o.quaternion.copy(tilt)
          o.position.set(offsets[i]!,4.586,0).addScaledVector(aim,.085)
        }
        anchor.position.set(0,4.586,0).addScaledVector(aim,.27)
        anchor.quaternion.setFromUnitVectors(forward,aim)
      }
      setWheel(0)
      lights.push({ id: key, kind: 'spot', object: anchor, color: cool, intensity: wheelPeak, size: [2, .36], angle: .115,
        penumbra: .57, range: 26, shadow: true, beam: false, level: wheelLevel })
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
  return {
    lights, wideLights: luminaires.map(l=>l.film), signs,
    steamSources: [{ object: vent, kind: 'vent', strength: .7 }, { object: drain, kind: 'drain', strength: .38 }],
    set(t, cutTime, wide) {
      primary.set(t)
      raking.set(t)
      service.set(t, cutTime)
      markerFace.material.uniforms.opalRadiance.value.copy(markerRadiance).multiplyScalar(wide ? .18 : 1)
      for (const luminaire of luminaires) luminaire.set(wide === true)
      setWheel(t)
      poleMats.get('wheel deck pole')?.color.copy(cool).multiplyScalar((115+59*lampEnvelope(t,wheelBeat))*mild(t))
    },
  }
}
