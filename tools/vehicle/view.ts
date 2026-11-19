import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { defaultPaint, paintById } from '../../src/config'
import { createVehicle, type VehicleModule } from '../../src/vehicle'

export interface Shot {
  view: 'side' | 'top' | 'front' | 'rear' | 'bottom' | 'persp'
  mode: 'mask' | 'clay' | 'zebra' | 'beauty' | 'normals' | 'wire'
  width: number
  height: number
  eye?: [number, number, number]
  target?: [number, number, number]
  fov?: number
  time?: number
  lampStage?: number
  engine?: number
  vibration?: number
  /** Ortho window in view-plane meters: [left, right, bottom, top]. Defaults to the bounding box. */
  window?: [number, number, number, number]
  ground?: boolean
}

declare global {
  interface Window {
    vehicleView?: { load(detail: 'blockout' | 'full', paint?: string): Promise<unknown>; shoot(shot: Shot): Promise<string> }
  }
}

const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.shadowMap.enabled = true
renderer.toneMapping = THREE.ACESFilmicToneMapping
const scene = new THREE.Scene()
const pmrem = new THREE.PMREMGenerator(renderer)
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
let vehicle: VehicleModule | null = null

const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1.2)
const sun = new THREE.DirectionalLight(0xffffff, 2.2)
sun.position.set(3, 6, 4)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -4
sun.shadow.camera.right = 4
sun.shadow.camera.top = 4
sun.shadow.camera.bottom = -4
scene.add(hemi, sun)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x505050, roughness: 0.9 }))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
const clay = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.55, metalness: 0 })
const normals = new THREE.MeshNormalMaterial()
const wire = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
const zebra = new THREE.ShaderMaterial({
  vertexShader: `varying vec3 vN; varying vec3 vP;
    void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vP;
    void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; vec3 d = normalize(vP - cameraPosition); vec3 r = reflect(d, n);
      float s = step(0.5, fract(r.y * 9.0)); gl_FragColor = vec4(vec3(mix(0.08, 0.95, s)), 1.0); }`,
})

async function load(detail: 'blockout' | 'full', paint?: string): Promise<unknown> {
  if (vehicle) scene.remove(vehicle.root)
  const t0 = performance.now()
  vehicle = await createVehicle({ paint: paintById(paint ?? defaultPaint), detail })
  scene.add(vehicle.root)
  let tris = 0
  vehicle.root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      const g = m.geometry
      tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3
    }
  })
  const box = new THREE.Box3().setFromObject(vehicle.root)
  return { ms: Math.round(performance.now() - t0), tris, box: [box.min.toArray(), box.max.toArray()], anchors: Object.fromEntries(Object.entries(vehicle.anchors).map(([k, a]) => [k, { p: a.position.toArray(), n: a.normal.toArray(), r: a.radius }])) }
}

async function shoot(s: Shot): Promise<string> {
  if (!vehicle) throw new Error('no vehicle')
  renderer.setSize(s.width, s.height, false)
  vehicle.update({ timeSeconds: s.time ?? 0, lampStage: s.lampStage ?? 0, engine: s.engine ?? 0, vibration: s.vibration ?? 0 })
  ground.visible = s.ground ?? (s.mode !== 'mask' && s.view === 'persp')
  scene.environment = s.mode === 'beauty' ? envTex : null
  scene.background = new THREE.Color(s.mode === 'mask' ? 0x000000 : 0x202226)
  scene.overrideMaterial = s.mode === 'mask' ? white : s.mode === 'clay' ? clay : s.mode === 'zebra' ? zebra : s.mode === 'normals' ? normals : s.mode === 'wire' ? wire : null
  hemi.visible = sun.visible = s.mode !== 'mask'
  renderer.toneMapping = s.mode === 'beauty' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping
  vehicle.root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  vehicle.root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && m.visible) box.expandByObject(m)
  })
  let camera: THREE.Camera
  if (s.view === 'persp') {
    const c = new THREE.PerspectiveCamera(s.fov ?? 30, s.width / s.height, 0.01, 100)
    c.position.set(...(s.eye ?? [5, 1.5, 5]))
    c.lookAt(new THREE.Vector3(...(s.target ?? [0, 0.5, 0])))
    camera = c
  } else {
    const views = {
      side: { dir: [1, 0, 0], up: [0, 1, 0], h: (b: THREE.Box3) => [-b.max.z, -b.min.z, b.min.y, b.max.y] },
      top: { dir: [0, 1, 0], up: [-1, 0, 0], h: (b: THREE.Box3) => [-b.max.z, -b.min.z, -b.max.x, -b.min.x] },
      bottom: { dir: [0, -1, 0], up: [-1, 0, 0], h: (b: THREE.Box3) => [b.min.z, b.max.z, -b.max.x, -b.min.x] },
      front: { dir: [0, 0, 1], up: [0, 1, 0], h: (b: THREE.Box3) => [b.min.x, b.max.x, b.min.y, b.max.y] },
      rear: { dir: [0, 0, -1], up: [0, 1, 0], h: (b: THREE.Box3) => [-b.max.x, -b.min.x, b.min.y, b.max.y] },
    } as const
    const v = views[s.view]
    const w = s.window ?? (v.h(box) as [number, number, number, number])
    const c = new THREE.OrthographicCamera(w[0], w[1], w[3], w[2], 0.01, 100)
    const d = new THREE.Vector3(...v.dir).multiplyScalar(20)
    c.position.copy(d)
    c.up.set(v.up[0], v.up[1], v.up[2])
    c.lookAt(0, 0, 0)
    camera = c
  }
  renderer.render(scene, camera)
  return canvas.toDataURL('image/png')
}

window.vehicleView = { load, shoot }
