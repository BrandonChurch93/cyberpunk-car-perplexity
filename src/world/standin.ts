import * as THREE from 'three'
import { config } from '../config'
import type { FilmLight } from '../core/contract'
import { stream } from '../core/random'
import type { WorldModule } from './contract'

const duration = config.film.durationSeconds
const tau = Math.PI * 2

/** A lit stand-in for the full world, so the pipeline, post and weather can be built before the real world lands. */
export function createStandInWorld(): WorldModule {
  const root = new THREE.Group()
  root.name = 'world'
  const lights: FilmLight[] = []
  const deckMaterial = new THREE.MeshPhysicalMaterial({ color: 0x1b1c1f, roughness: 0.42, metalness: 0 })
  const concrete = new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.85 })
  const steel = new THREE.MeshStandardMaterial({ color: 0x555960, roughness: 0.45, metalness: 0.9 })
  const paintLine = new THREE.MeshStandardMaterial({ color: 0x8d8f8a, roughness: 0.6 })
  const add = (mesh: THREE.Mesh, parent: THREE.Object3D = root): THREE.Mesh => {
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const deck = new THREE.Group()
  deck.rotation.y = THREE.MathUtils.degToRad(12)
  root.add(deck)
  const slab = add(new THREE.Mesh(new THREE.BoxGeometry(64, 0.5, 44), deckMaterial), deck)
  slab.position.y = -0.25
  for (let i = -12; i <= 12; i++) {
    for (const z of [-6, 6]) {
      const line = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.002, 5), paintLine), deck)
      line.position.set(i * 2.5, 0.001, z)
      line.castShadow = false
    }
  }
  for (const [w, d, x, z] of [[64, 0.25, 0, -22], [64, 0.25, 0, 22], [0.25, 44, -32, 0], [0.25, 44, 32, 0]] as const) {
    const wall = add(new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), concrete), deck)
    wall.position.set(x, 0.55, z)
    const rail = add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, Math.max(d, 0.05)), steel), deck)
    rail.position.set(x, 1.3, z)
  }
  const core = add(new THREE.Mesh(new THREE.BoxGeometry(6, 3.4, 5), concrete), deck)
  core.position.set(24, 1.7, -17)

  const emitter = (id: string, size: [number, number], position: [number, number, number], lookAt: [number, number, number], color: THREE.Color, luminance: number, range: number, shadow: boolean, beam: boolean, level: FilmLight['level'], colorAt?: FilmLight['colorAt']): THREE.Mesh => {
    const material = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(luminance), side: THREE.DoubleSide, toneMapped: false })
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material)
    panel.position.set(...position)
    panel.lookAt(...lookAt)
    root.add(panel)
    lights.push({ id, kind: 'area', object: panel, color, intensity: luminance * size[0] * size[1], size, range, shadow, beam, level, colorAt })
    panel.onBeforeRender = () => undefined
    panel.userData.emitter = { color, luminance, level, colorAt }
    return panel
  }

  const palette = [new THREE.Color(0.25, 0.75, 1), new THREE.Color(0.55, 0.9, 1), new THREE.Color(0.35, 0.5, 1), new THREE.Color(0.8, 0.95, 1)]
  const billboardColor = (t: number, out: THREE.Color): void => {
    const phase = (t / duration) * palette.length
    const i = ((Math.floor(phase) % palette.length) + palette.length) % palette.length
    const u = phase - Math.floor(phase)
    const s = u * u * (3 - 2 * u)
    out.copy(palette[i]).lerp(palette[(i + 1) % palette.length], s)
  }
  emitter('billboard', [14, 8], [16, 16, -62], [0, 2, 0], new THREE.Color(0.4, 0.8, 1), 4.5, 160, true, true, (t) => 0.85 + 0.15 * Math.sin((tau * 3 * t) / duration), billboardColor)
  emitter('red-sign', [3.2, 1.1], [27, 9, -48], [0, 1, 0], new THREE.Color(1, 0.06, 0.04), 14, 120, false, false, (t) => 0.92 + 0.08 * Math.sin((tau * 90 * t) / duration))
  emitter('cool-signs', [5, 7], [-46, 14, 6], [0, 1, 0], new THREE.Color(0.2, 0.55, 1), 6, 140, true, false, () => 1)
  emitter('warm-signs', [4, 5], [44, 12, 20], [0, 1, 0], new THREE.Color(1, 0.55, 0.2), 4, 140, false, false, () => 1)
  emitter('doorway', [1, 2.1], [21, 1.05, -14.4], [10, 0.5, 0], new THREE.Color(1, 0.86, 0.66), 2.5, 30, false, false, () => 1)

  for (const [x, z, id] of [[-13, 11, 'pole-a'], [15, -10, 'pole-b']] as const) {
    const pole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6, 16), steel), deck)
    pole.position.set(x, 3, z)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.85, 1).multiplyScalar(40), toneMapped: false }))
    head.position.set(x, 6, z)
    deck.add(head)
    const aim = new THREE.Object3D()
    aim.position.set(x, 5.95, z)
    aim.rotation.x = Math.PI / 2
    deck.add(aim)
    lights.push({
      id, kind: 'spot', object: aim, color: new THREE.Color(0.75, 0.85, 1), intensity: 18, size: [0.4, 0.15], angle: THREE.MathUtils.degToRad(62), penumbra: 0.7, range: 40, shadow: true, beam: true,
      level: id === 'pole-a' ? (t) => 1 - 0.06 * Math.max(0, Math.sin((tau * 37 * t) / duration)) * Math.max(0, Math.sin((tau * 211 * t) / duration)) : () => 1,
    })
  }

  const vent = add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.2), steel), deck)
  vent.position.set(-22, 0.45, -15)
  const ventTop = new THREE.Object3D()
  ventTop.position.set(-22, 0.92, -15)
  deck.add(ventTop)

  const rng = stream('standin-city')
  const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.7 })
  const windowColors = [new THREE.Color(1, 0.75, 0.45), new THREE.Color(0.55, 0.75, 1), new THREE.Color(0.9, 0.95, 1), new THREE.Color(1, 0.2, 0.25), new THREE.Color(0.2, 1, 0.9)]
  const dots: THREE.Matrix4[] = []
  const dotColors: THREE.Color[] = []
  for (let i = 0; i < 110; i++) {
    const angle = rng.next() * tau
    const distance = 55 + rng.next() * 190
    const w = 14 + rng.next() * 26
    const d = 14 + rng.next() * 26
    const h = 50 + rng.next() * 170
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), towerMaterial)
    tower.position.set(Math.sin(angle) * distance, h / 2 - 32, Math.cos(angle) * distance)
    tower.rotation.y = rng.next() * Math.PI
    root.add(tower)
    const count = 30 + rng.int(60)
    for (let k = 0; k < count; k++) {
      const face = rng.int(4)
      const local = new THREE.Vector3((rng.next() - 0.5) * w, (rng.next() - 0.5) * h, (rng.next() - 0.5) * d)
      if (face === 0) local.x = w / 2 + 0.05
      else if (face === 1) local.x = -w / 2 - 0.05
      else if (face === 2) local.z = d / 2 + 0.05
      else local.z = -d / 2 - 0.05
      const m = new THREE.Matrix4().makeRotationY(tower.rotation.y + (face < 2 ? Math.PI / 2 : 0))
      m.setPosition(local.applyEuler(tower.rotation).add(tower.position))
      const big = rng.next() < 0.04
      m.scale(new THREE.Vector3(big ? 4 + rng.next() * 5 : 1.4, big ? 2 + rng.next() * 3 : 1.6, 1))
      dots.push(m)
      dotColors.push(rng.pick(windowColors).clone().multiplyScalar(big ? 6 + rng.next() * 8 : 0.6 + rng.next() * 3))
    }
  }
  const windows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), dots.length)
  dots.forEach((m, i) => {
    windows.setMatrixAt(i, m)
    windows.setColorAt(i, dotColors[i])
  })
  windows.frustumCulled = false
  root.add(windows)

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(700, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 vDir; void main() { float h = clamp(vDir.y, -0.2, 1.0); vec3 low = vec3(0.035, 0.06, 0.1); vec3 high = vec3(0.012, 0.016, 0.026); gl_FragColor = vec4(mix(low, high, smoothstep(-0.05, 0.6, h)), 1.0); }',
    }),
  )
  root.add(sky)
  root.add(new THREE.HemisphereLight(new THREE.Color(0.05, 0.08, 0.13), new THREE.Color(0.01, 0.012, 0.016), 1))

  const emitters: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.emitter) emitters.push(o as THREE.Mesh)
  })
  const scratch = new THREE.Color()
  const setEmitters = (t: number): void => {
    for (const mesh of emitters) {
      const e = mesh.userData.emitter as { color: THREE.Color; luminance: number; level: FilmLight['level']; colorAt?: FilmLight['colorAt'] }
      if (e.colorAt) e.colorAt(t, scratch)
      else scratch.copy(e.color)
      ;(mesh.material as THREE.MeshBasicMaterial).color.copy(scratch).multiplyScalar(e.luminance * e.level(t))
    }
  }

  return {
    root,
    lights,
    signs: [],
    deck: { meshes: [slab], material: deckMaterial, bounds: new THREE.Box2(new THREE.Vector2(-40, -40), new THREE.Vector2(40, 40)), heightMap: null },
    reflectionBox: new THREE.Box3(new THREE.Vector3(-31, 0, -21), new THREE.Vector3(31, 80, 21)),
    surfaces: [{ material: deckMaterial, wetness: 'porous' }, { material: concrete, wetness: 'porous' }, { material: steel, wetness: 'sheet' }],
    steamSources: [{ object: ventTop, strength: 1, kind: 'vent' }],
    beginFrame: () => undefined,
    beginSample: (sample) => setEmitters(sample.timeSeconds),
  }
}
