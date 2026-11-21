import * as THREE from 'three'
import type { VehicleModule } from '../../vehicle'

function portAimName(meshName: string): string | undefined {
  const side = meshName.endsWith(' right') ? 'right' : 'left'
  if (/^front Y running guide(?: right)?$/.test(meshName)) return `front running guide ${side} origin`
  if (/^front projector LED dies \d+(?: right)?$/.test(meshName)) return `main beam projector ${side} origin`
  if (meshName === 'tail-guide-left') return 'tail-1'
  if (meshName === 'tail-guide-right') return 'tail--1'
}

export function probeLamps(vehicle: Pick<VehicleModule, 'root' | 'lamps'>) {
  const root = new THREE.Group()
  root.name = 'cube lamp emitters'
  root.visible = false
  const entries: Array<{ source: THREE.Mesh; emitter: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> }> = []
  // The rig receives each emitter's aim anchor, not its drawing mesh.
  const origins = new Set(vehicle.lamps.map(({ object }) => object.name))
  vehicle.root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshStandardMaterial)) return
    const port = portAimName(node.name)
    if (!origins.has(`${node.name} emission origin`) && (port === undefined || !origins.has(port))) return
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
  })
  return {
    root,
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
