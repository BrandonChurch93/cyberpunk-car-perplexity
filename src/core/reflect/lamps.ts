import * as THREE from 'three'
import { insertAfter, patchMaterial } from '../../materials/patch'
import type { VehicleModule } from '../../vehicle'

const guideDeckRadiance = 0.40
const guideDeckArm = { fraction: 0.95, height: [0.29, 0.48], lateral: [0.06, 0.28] }

function portAimName(meshName: string): string | undefined {
  const side = meshName.endsWith(' right') ? 'right' : 'left'
  if (/^front Y running guide(?: right)?$/.test(meshName)) return `front running guide ${side} origin`
  if (/^front projector LED dies \d+(?: right)?$/.test(meshName)) return `main beam projector ${side} origin`
  if (meshName === 'tail-guide-left') return 'tail-1'
  if (meshName === 'tail-guide-right') return 'tail--1'
}

export function lampSources(vehicle: Pick<VehicleModule, 'root' | 'lamps'>) {
  const origins = new Map(vehicle.lamps.map(({ object }) => [object.name, object] as const))
  const beams = vehicle.lamps.filter(({ beam }) => beam).map(({ object }) => object)
  const found: Array<{ mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; origin: THREE.Object3D; beamIndex: number }> = []
  vehicle.root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshStandardMaterial)) return
    const port = portAimName(node.name)
    const die = /^front projector LED dies (\d+)/.exec(node.name)
    const beamIndex = die ? beams.flatMap(({ name }, index) => name === port ? [index] : [])[Number(die[1])] ?? -1 : -1
    const origin = beams[beamIndex] ?? origins.get(`${node.name} emission origin`) ?? (port === undefined ? undefined : origins.get(port))
    if (origin) found.push({ mesh: node as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>, origin, beamIndex })
  })
  return found
}

export function probeLamps(vehicle: Pick<VehicleModule, 'root' | 'lamps'>) {
  const root = new THREE.Group()
  root.name = 'cube lamp emitters'
  root.visible = false
  const entries: Array<{ source: THREE.Mesh; emitter: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> }> = []
  const mirrorApertures = new Map<string, THREE.Mesh>()
  const guides = new Set<THREE.MeshStandardMaterial>()
  const lateral = { value: 0 }
  const eyeLocal = new THREE.Vector3()
  for (const { mesh: node, origin, beamIndex } of lampSources(vehicle)) {
    const side = node.name.endsWith(' right') ? 'right' : 'left'
    if (origin.name.startsWith('front running guide')) {
      mirrorApertures.set(`vehicle-glow-front-${side}`, node)
      guides.add(node.material)
      patchMaterial(node.material, {
        id: 'deck-guide-arm',
        uniforms: { reflectGuideLateral: lateral },
        apply(shader) {
          shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', 'varying vec2 vDeckGuide;')
          shader.vertexShader = insertAfter(shader.vertexShader, '#include <begin_vertex>', 'vDeckGuide = position.xy;')
          shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', `
            varying vec2 vDeckGuide;
            uniform float reflectGuideLateral;
          `)
          shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <emissivemap_fragment>', `
            float guideAngle = smoothstep(${guideDeckArm.lateral.join(', ')}, sign(vDeckGuide.x) * reflectGuideLateral);
            totalEmissiveRadiance *= 1.0 - ${guideDeckArm.fraction} * guideAngle
              * smoothstep(${guideDeckArm.height.join(', ')}, vDeckGuide.y);
          `)
        },
      })
    }
    if (beamIndex >= 0) mirrorApertures.set(`vehicle-beam-${beamIndex}`, node)
    const material = node.material.clone()
    material.side = THREE.DoubleSide
    material.onBeforeCompile = node.material.onBeforeCompile
    material.customProgramCacheKey = node.material.customProgramCacheKey
    const emitter = new THREE.Mesh(node.geometry, material)
    emitter.name = node.name
    emitter.matrixAutoUpdate = false
    emitter.matrixWorldAutoUpdate = false
    root.add(emitter)
    entries.push({ source: node, emitter })
  }
  return {
    root,
    mirrorApertures,
    withDeckRadiance(eye: THREE.Vector3, draw: () => void) {
      const restore = Array.from(guides, material => [material, material.emissiveIntensity] as const)
      const prior = lateral.value
      vehicle.root.worldToLocal(eyeLocal.copy(eye))
      lateral.value = eyeLocal.x / Math.max(Math.hypot(eyeLocal.x, eyeLocal.z), 1e-6)
      for (const [material, intensity] of restore) material.emissiveIntensity = intensity * guideDeckRadiance
      try {
        draw()
      } finally {
        lateral.value = prior
        for (const [material, intensity] of restore) material.emissiveIntensity = intensity
      }
    },
    sync() {
      for (const { source, emitter } of entries) {
        const material = source.material
        if (!(material instanceof THREE.MeshStandardMaterial)) {
          emitter.visible = false
          continue
        }
        source.updateWorldMatrix(true, false)
        let visible = source.visible
        for (let parent = source.parent; parent && visible; parent = parent.parent) visible = parent.visible
        emitter.geometry = source.geometry
        emitter.matrixWorld.copy(source.matrixWorld)
        emitter.visible = visible && material.emissiveIntensity > 0
        emitter.material.emissive.copy(material.emissive)
        emitter.material.emissiveIntensity = material.emissiveIntensity
      }
    },
  }
}
