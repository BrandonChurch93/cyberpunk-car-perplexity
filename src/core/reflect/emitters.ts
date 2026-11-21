import * as THREE from 'three'
import type { FilmLight } from '../contract'
import type { LightRig } from '../lights'

const apertures = new Set([
  'weather-sealed opal face',
  'graded opal face',
  'animated magenta violet mural',
  'animated cabinet LED face',
])

function visible(object: THREE.Object3D): boolean {
  for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
    if (!parent.visible) return false
  }
  return true
}

export function mirrorEmitters(lights: readonly FilmLight[], rig?: LightRig, lampApertures?: ReadonlyMap<string, THREE.Mesh>) {
  const spots = new Map(rig?.group.children.flatMap(object =>
    object instanceof THREE.SpotLight ? [[object.name, object] as const] : []))
  const slots: { light?: FilmLight; lamp?: THREE.Mesh; spot: THREE.SpotLight; position: THREE.Vector4 }[] = lights.flatMap(light => {
    const spot = spots.get(light.id)
    return spot ? [{ light, spot, position: new THREE.Vector4() }] : []
  })
  for (const [id, lamp] of lampApertures ?? []) {
    const spot = spots.get(id)
    if (spot) slots.push({ lamp, spot, position: new THREE.Vector4() })
  }
  const faces = new WeakMap<THREE.Object3D, THREE.Mesh | null>()
  const frustum = new THREE.Frustum()
  const point = new THREE.Vector3()
  const color = new THREE.Color()

  function aperture(light: FilmLight): THREE.Mesh | null {
    if (light.kind !== 'area') return null
    const source = light.object
    const saved = faces.get(source)
    if (saved !== undefined) return saved
    const face = source.parent?.children.find((mesh): mesh is THREE.Mesh => mesh instanceof THREE.Mesh && apertures.has(mesh.name)) ?? null
    faces.set(source, face)
    return face
  }

  return {
    positions: { value: slots.map(slot => slot.position) },
    update(viewProjection: THREE.Matrix4, layers: THREE.Layers) {
      frustum.setFromProjectionMatrix(viewProjection)
      for (const { light, lamp, spot, position } of slots) {
        position.w = 0
        const face = light ? aperture(light) : lamp
        if (!face || !spot.visible || !visible(face) || !layers.test(face.layers)) continue
        if (lamp && (!(lamp.material instanceof THREE.MeshStandardMaterial) || lamp.material.emissiveIntensity <= 0)) continue
        face.updateWorldMatrix(true, false)
        if (!frustum.intersectsObject(face)) continue
        spot.getWorldPosition(point)
        position.set(point.x, point.y, point.z, 1)
      }
    },
    withRadiance(time: number, draw: () => void) {
      const restore: [THREE.ShaderMaterial, THREE.Color, THREE.Color][] = []
      for (const { light } of slots) {
        if (!light) continue
        const face = aperture(light)
        if (face?.name !== 'weather-sealed opal face' || !(face.material instanceof THREE.ShaderMaterial)) continue
        const tint = face.material.uniforms.tint?.value
        if (!(tint instanceof THREE.Color)) continue
        const area = light.size[0] * light.size[1]
        if (area <= 0) continue
        restore.push([face.material, tint, tint.clone()])
        if (light.colorAt) light.colorAt(time, color)
        else color.copy(light.color)
        tint.copy(color).multiplyScalar(light.intensity * Math.max(0, light.level(time)) / area)
        face.material.uniformsNeedUpdate = true
      }
      try {
        draw()
      } finally {
        for (const [material, tint, original] of restore) {
          tint.copy(original)
          material.uniformsNeedUpdate = true
        }
      }
    },
  }
}
