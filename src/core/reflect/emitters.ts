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
  const slots: { light?: FilmLight; lamp?: THREE.Mesh; spot: THREE.SpotLight; position: THREE.Vector4; uv: THREE.Vector4 }[] = lights.flatMap(light => {
    const spot = spots.get(light.id)
    return spot ? [{ light, spot, position: new THREE.Vector4(), uv: new THREE.Vector4() }] : []
  })
  for (const [id, lamp] of lampApertures ?? []) {
    const spot = spots.get(id)
    if (spot) slots.push({ lamp, spot, position: new THREE.Vector4(), uv: new THREE.Vector4() })
  }
  const peaks = slots.map(() => 0)
  const faces = new WeakMap<THREE.Object3D, THREE.Mesh | null>()
  const frustum = new THREE.Frustum()
  const point = new THREE.Vector3()
  const clip = new THREE.Vector4()
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
    bounds: { value: slots.map(slot => slot.uv) },
    peaks: { value: peaks },
    update(viewProjection: THREE.Matrix4, layers: THREE.Layers, size: THREE.Vector2) {
      frustum.setFromProjectionMatrix(viewProjection)
      for (const { light, lamp, spot, position, uv } of slots) {
        position.w = 0
        uv.set(1, 1, 0, 0)
        const face = light ? aperture(light) : lamp
        if (!face || !spot.visible || !visible(face) || !layers.test(face.layers)) continue
        if (lamp && (!(lamp.material instanceof THREE.MeshStandardMaterial) || lamp.material.emissiveIntensity <= 0)) continue
        face.updateWorldMatrix(true, false)
        if (!frustum.intersectsObject(face)) continue
        spot.getWorldPosition(point)
        position.set(point.x, point.y, point.z, 1)
        if (face.name !== 'weather-sealed opal face') continue
        if (!face.geometry.boundingBox) face.geometry.computeBoundingBox()
        const range = face.geometry.boundingBox
        if (!range) continue
        let valid = true
        for (const x of [range.min.x, range.max.x]) for (const y of [range.min.y, range.max.y]) {
          clip.set(x, y, range.max.z, 1).applyMatrix4(face.matrixWorld).applyMatrix4(viewProjection)
          if (clip.w <= 0) {
            valid = false
            continue
          }
          const u = 0.5 + 0.5 * clip.x / clip.w
          const v = 0.5 + 0.5 * clip.y / clip.w
          uv.set(Math.min(uv.x, u), Math.min(uv.y, v), Math.max(uv.z, u), Math.max(uv.w, v))
        }
        if (valid) uv.set(uv.x - 1 / size.x, uv.y - 1 / size.y, uv.z + 1 / size.x, uv.w + 1 / size.y)
        else uv.set(1, 1, 0, 0)
      }
    },
    withRadiance(time: number, draw: () => void) {
      const restore: [THREE.ShaderMaterial, THREE.Color, THREE.Color][] = []
      for (const [index, { light }] of slots.entries()) {
        peaks[index] = 0
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
        peaks[index] = tint.r * .2126 + tint.g * .7152 + tint.b * .0722
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
