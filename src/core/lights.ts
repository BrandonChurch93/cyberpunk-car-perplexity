import * as THREE from 'three'
import { replaceOnce, patchMaterial } from '../materials/patch'
import type { FilmLight } from './contract'

export const maxFilmLights = 16
const maxFilmShadows = 8
const areaAngle = THREE.MathUtils.degToRad(84)
const areaConeCos = Math.cos(areaAngle)
const areaPenumbraMarker = 1 + Math.PI / areaAngle
const contactReach = 12

const world = new THREE.Vector3()
const axis = new THREE.Vector3()
const side = new THREE.Vector3()
const lift = new THREE.Vector3()
const scratch = new THREE.Color()
const rotation = new THREE.Quaternion()

interface Entry {
  film: FilmLight
  light: THREE.SpotLight | THREE.PointLight
  shadowSlot: number
  compactBeam: boolean
}

export interface FilmLightUniforms {
  filmLightCount: { value: number }
  filmLightPosition: { value: THREE.Vector3[] }
  /** xyz: axis. w: cosine of the cone half angle, or -1 for a point light. */
  filmLightAxis: { value: THREE.Vector4[] }
  /** rgb: color times intensity times level. a: range in meters. */
  filmLightColor: { value: THREE.Vector4[] }
  /** x: inner cone cosine, or -1 for an area. y: effective emitter radius. z: beam flag. w: compact beam optics. */
  filmLightShape: { value: THREE.Vector4[] }
}

interface FilmShadowUniforms {
  filmSpotShadow: { value: (THREE.Texture | null)[] }
  filmPointShadow: { value: (THREE.Texture | null)[] }
  filmShadowMatrix: { value: THREE.Matrix4[] }
  filmShadowParams: { value: THREE.Vector4[] }
}

const compactBeamGlsl = /* glsl */ `
float filmCompactBeamFalloff(vec3 emission, vec3 axis, vec3 up) {
  float above = dot(emission, normalize(up - axis * dot(up, axis)));
  return smoothstep(-0.185, -0.06, above) * (1.0 - smoothstep(0.032, 0.068, above));
}
`

export const filmLightsGlsl = /* glsl */ `
#define MAX_FILM_LIGHTS ${maxFilmLights}
uniform int filmLightCount;
uniform vec3 filmLightPosition[MAX_FILM_LIGHTS];
uniform vec4 filmLightAxis[MAX_FILM_LIGHTS];
uniform vec4 filmLightColor[MAX_FILM_LIGHTS];
uniform vec4 filmLightShape[MAX_FILM_LIGHTS];

${compactBeamGlsl}

float filmAngularFalloff(int i, vec3 toLight) {
  float cutoff = filmLightAxis[i].w;
  if (cutoff < -0.5) return 1.0;
  float c = dot(-toLight, filmLightAxis[i].xyz);
  float inner = filmLightShape[i].x;
  if (inner < 0.0) return max(c, 0.0) * smoothstep(cutoff, cutoff + 0.035, c);
  float cone = smoothstep(cutoff, max(cutoff + 1e-5, inner), c);
  if (filmLightShape[i].w > 0.5) cone *= filmCompactBeamFalloff(-toLight, filmLightAxis[i].xyz, vec3(0.0, 1.0, 0.0));
  return cone;
}

vec3 filmLightAt(int i, vec3 p, out vec3 toLight) {
  vec3 d = filmLightPosition[i] - p;
  float dist2 = max(dot(d, d), 1e-4);
  float dist = sqrt(dist2);
  toLight = d / dist;
  float r = dist / filmLightColor[i].a;
  float r2 = r * r;
  float window = max(0.0, 1.0 - r2 * r2);
  return filmLightColor[i].rgb * filmAngularFalloff(i, toLight) * window * window / max(dist2, 0.01);
}
`

const shadowCases = (name: string) => Array.from({ length: maxFilmShadows }, (_, i) => `case ${i}: return texture(${name}[${i}], coord);`).join('\n')

/** Append to filmLightsGlsl with rig.shadowUniforms. Refresh after a shadow-producing scene render. */
export const filmLightsShadowGlsl = /* glsl */ `
uniform highp sampler2DShadow filmSpotShadow[${maxFilmShadows}];
uniform highp samplerCubeShadow filmPointShadow[${maxFilmShadows}];
uniform mat4 filmShadowMatrix[${maxFilmShadows}];
uniform vec4 filmShadowParams[MAX_FILM_LIGHTS];

float filmSpotCompare(int slot, vec3 coord) {
  switch (slot) { ${shadowCases('filmSpotShadow')} }
  return 1.0;
}

float filmPointCompare(int slot, vec4 coord) {
  switch (slot) { ${shadowCases('filmPointShadow')} }
  return 1.0;
}

float filmLightVisibility(int i, vec3 p) {
  vec4 params = filmShadowParams[i];
  int slot = int(abs(params.x)) - 1;
  if (slot < 0) return 1.0;
  if (params.x < 0.0) {
    vec3 delta = p - filmLightPosition[i];
    vec3 axes = abs(delta);
    float z = max(axes.x, max(axes.y, axes.z));
    if (z < params.z || z > params.w) return 1.0;
    float d = params.w * (1.0 - params.z / z) / (params.w - params.z);
    return filmPointCompare(slot, vec4(delta, d + params.y));
  }
  vec4 clip = filmShadowMatrix[slot] * vec4(p, 1.0);
  if (clip.w <= 0.0) return 1.0;
  vec3 uvz = clip.xyz / clip.w;
  if (any(lessThan(uvz, vec3(0.0))) || any(greaterThan(uvz, vec3(1.0)))) return 1.0;
  return filmSpotCompare(slot, vec3(uvz.xy, uvz.z + params.y));
}

vec3 filmLightAtShadowed(int i, vec3 p, out vec3 toLight) {
  return filmLightAt(i, p, toLight) * filmLightVisibility(i, p);
}
`

export function patchFilmLighting(material: THREE.Material): void {
  const marker = 'return smoothstep( coneCosine, penumbraCosine, angleCosine );'
  const spotMarker = 'float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );'
  patchMaterial(material, {
    id: 'film-lambert-area',
    apply(shader) {
      // The negative penumbra cosine identifies film optics without tying them to Three's per-camera spot order.
      const attenuation = replaceOnce(THREE.ShaderChunk.lights_pars_begin, marker, `
        if (penumbraCosine < -0.999999) return max(angleCosine, 0.0) * smoothstep(coneCosine, coneCosine + 0.035, angleCosine);
        return smoothstep(coneCosine, max(coneCosine + 1e-5, abs(penumbraCosine)), angleCosine);
      `)
      const chunk = replaceOnce(attenuation, spotMarker, `
        ${spotMarker}
        if (spotLight.penumbraCos < 0.0 && spotLight.penumbraCos > -0.999999) {
          spotAttenuation *= filmCompactBeamFalloff(-light.direction, -spotLight.direction, mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
        }
      `)
      shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <lights_pars_begin>', compactBeamGlsl + chunk)
    },
  })
}

export function vehicleShadowRegion(vehicle: THREE.Box3, deck: THREE.Box2): THREE.Box3 {
  const min = new THREE.Vector3(Math.max(deck.min.x, vehicle.min.x - contactReach), Math.min(vehicle.min.y, 0) - 0.3, Math.max(deck.min.y, vehicle.min.z - contactReach))
  const max = new THREE.Vector3(Math.min(deck.max.x, vehicle.max.x + contactReach), Math.max(vehicle.max.y, 0) + 0.3, Math.min(deck.max.y, vehicle.max.z + contactReach))
  return new THREE.Box3(min, max).union(vehicle)
}

const corner = new THREE.Vector3()
const shadowPose = new THREE.Matrix4()
const shadowView = new THREE.Matrix4()
const sourcePosition = new THREE.Vector3()
const aimPoint = new THREE.Vector3()
const viewAxis = new THREE.Vector3()
const fitRegion = new THREE.Box3()

function fitSpotShadow(light: THREE.SpotLight, region: THREE.Box3, isArea: boolean): void {
  const camera = light.shadow.camera
  sourcePosition.setFromMatrixPosition(light.matrixWorld)
  aimPoint.setFromMatrixPosition(light.target.matrixWorld)
  viewAxis.subVectors(aimPoint, sourcePosition).normalize()
  shadowPose.lookAt(sourcePosition, aimPoint, camera.up).setPosition(sourcePosition)
  shadowView.copy(shadowPose).invert()
  fitRegion.copy(region)
  if (!isArea && viewAxis.y < -0.25) {
    const t = Math.max(0, -sourcePosition.y / viewAxis.y)
    corner.copy(sourcePosition).addScaledVector(viewAxis, t)
    fitRegion.expandByPoint(corner)
  }
  const limit = Math.tan(light.angle)
  let left = Infinity
  let right = -Infinity
  let bottom = Infinity
  let top = -Infinity
  let minZ = Infinity
  let maxZ = 0
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? fitRegion.max.x : fitRegion.min.x, i & 2 ? fitRegion.max.y : fitRegion.min.y, i & 4 ? fitRegion.max.z : fitRegion.min.z)
    corner.applyMatrix4(shadowView)
    const z = -corner.z
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
    const x = corner.x / Math.max(z, 0.02)
    const y = corner.y / Math.max(z, 0.02)
    left = Math.min(left, x)
    right = Math.max(right, x)
    bottom = Math.min(bottom, y)
    top = Math.max(top, y)
  }
  const hasFit = minZ > 0.2 && left < limit && right > -limit && bottom < limit && top > -limit
  const margin = 0.045
  const padX = Math.max((right - left) * margin, 0.02)
  const padY = Math.max((top - bottom) * margin, 0.02)
  const near = isArea ? Math.max(Math.min(0.45, Math.max(0.035, minZ * 0.18)), minZ - 60) : 0.045
  const far = hasFit && isArea ? Math.max(near + 0.1, Math.min(light.distance, maxZ + 8)) : light.distance
  camera.near = near
  camera.far = far
  camera.projectionMatrix.makePerspective(
    (hasFit ? Math.max(-limit, left - padX) : -limit) * near,
    (hasFit ? Math.min(limit, right + padX) : limit) * near,
    (hasFit ? Math.min(limit, top + padY) : limit) * near,
    (hasFit ? Math.max(-limit, bottom - padY) : -limit) * near,
    near, far, camera.coordinateSystem, camera.reversedDepth,
  )
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
}

export class LightRig {
  readonly group = new THREE.Group()
  readonly uniforms: FilmLightUniforms = {
    filmLightCount: { value: 0 },
    filmLightPosition: { value: Array.from({ length: maxFilmLights }, () => new THREE.Vector3()) },
    filmLightAxis: { value: Array.from({ length: maxFilmLights }, () => new THREE.Vector4(0, 0, 1, -1)) },
    filmLightColor: { value: Array.from({ length: maxFilmLights }, () => new THREE.Vector4(0, 0, 0, 1)) },
    filmLightShape: { value: Array.from({ length: maxFilmLights }, () => new THREE.Vector4()) },
  }
  readonly shadowUniforms: FilmShadowUniforms = {
    filmSpotShadow: { value: Array(maxFilmShadows).fill(null) },
    filmPointShadow: { value: Array(maxFilmShadows).fill(null) },
    filmShadowMatrix: { value: Array.from({ length: maxFilmShadows }, () => new THREE.Matrix4()) },
    filmShadowParams: { value: Array.from({ length: maxFilmLights }, () => new THREE.Vector4()) },
  }
  private readonly entries: Entry[] = []
  private readonly region = new THREE.Box3()
  private readonly vehicleBounds = new THREE.Box3()

  constructor(lights: FilmLight[], shadowMapSize: number) {
    if (lights.length > maxFilmLights) throw new Error(`The film has ${lights.length} lights. The rig holds ${maxFilmLights}.`)
    if (lights.filter((light) => light.shadow).length > maxFilmShadows) throw new Error(`The rig holds ${maxFilmShadows} shadow maps.`)
    let spotSlot = 0
    let pointSlot = 0
    for (const film of lights) {
      const light = film.kind === 'point' ? new THREE.PointLight() : new THREE.SpotLight()
      const halfAngle = film.angle ?? Math.PI / 6
      const compactBeam = film.kind === 'spot' && film.beam && halfAngle <= Math.PI / 7 && Math.max(...film.size) <= 0.1
      const penumbra = film.penumbra ?? 0.3
      light.decay = 2
      light.distance = film.range
      if (light instanceof THREE.SpotLight) {
        light.angle = film.kind === 'area' ? areaAngle : halfAngle
        light.penumbra = film.kind === 'area' ? areaPenumbraMarker : penumbra
        this.group.add(light.target)
      }
      let shadowSlot = -1
      if (film.shadow) {
        const isArea = film.kind === 'area'
        const isCrisp = compactBeam
        light.castShadow = true
        light.shadow.mapSize.set(shadowMapSize, shadowMapSize)
        light.shadow.bias = isArea ? -0.0000015 : isCrisp ? -0.000035 : -0.000008
        light.shadow.normalBias = isArea ? 0.002 : isCrisp ? 0.001 : 0.003
        light.shadow.radius = isArea ? 3.4 : isCrisp ? 0.7 : 1.4
        light.shadow.camera.near = 0.045
        light.shadow.camera.far = film.range
        if (light instanceof THREE.SpotLight) {
          shadowSlot = spotSlot++
          const shadow = light.shadow
          const update = shadow.updateMatrices
          shadow.updateMatrices = () => {
            if (this.region.isEmpty()) {
              update.call(shadow, light)
              return
            }
            fitSpotShadow(light, this.region, isArea)
            THREE.LightShadow.prototype.updateMatrices.call(shadow, light)
          }
        } else shadowSlot = pointSlot++
      }
      light.name = film.id
      this.group.add(light)
      this.entries.push({ film, light, shadowSlot, compactBeam })
    }
  }

  fitContactRegion(vehicle: THREE.Object3D, deck: THREE.Box2): void {
    this.vehicleBounds.setFromObject(vehicle)
    if (!this.vehicleBounds.isEmpty()) this.region.copy(vehicleShadowRegion(this.vehicleBounds, deck))
    else this.region.makeEmpty()
  }

  syncShadowUniforms(): void {
    const u = this.shadowUniforms
    this.entries.forEach(({ light, shadowSlot, film }, i) => {
      const depth = light.shadow.map?.depthTexture
      const params = u.filmShadowParams.value[i]
      if (!light.visible || shadowSlot < 0 || !depth) {
        params.set(0, 0, 0, 0)
        return
      }
      const isSpot = light instanceof THREE.SpotLight
      const shadow = light.shadow
      const bias = film.kind === 'area' ? -0.000001 : -0.000008
      params.set((isSpot ? 1 : -1) * (shadowSlot + 1), bias, shadow.camera.near, shadow.camera.far)
      if (isSpot) {
        u.filmSpotShadow.value[shadowSlot] = depth
        u.filmShadowMatrix.value[shadowSlot].copy(shadow.matrix)
      } else u.filmPointShadow.value[shadowSlot] = depth
    })
  }

  update(timeSeconds: number, jitter: [number, number]): void {
    const u = this.uniforms
    u.filmLightCount.value = this.entries.length
    this.entries.forEach(({ film, light, compactBeam }, i) => {
      film.object.updateWorldMatrix(true, false)
      film.object.getWorldPosition(world)
      film.object.getWorldQuaternion(rotation)
      axis.set(0, 0, 1).applyQuaternion(rotation)
      side.set(1, 0, 0).applyQuaternion(rotation)
      lift.set(0, 1, 0).applyQuaternion(rotation)
      const jx = ((jitter[0] + i * 0.61803398875) % 1) - 0.5
      const jy = ((jitter[1] + i * 0.75487766625) % 1) - 0.5
      world.addScaledVector(side, jx * film.size[0]).addScaledVector(lift, jy * film.size[1])
      light.position.copy(world)
      let inner = -1
      const useCompactOptics = compactBeam && Math.abs(axis.y) < 0.9
      if (light instanceof THREE.SpotLight) {
        light.target.position.copy(world).add(axis)
        light.shadow.camera.up.copy(lift)
        light.angle = film.kind === 'area' ? areaAngle : film.angle ?? Math.PI / 6
        if (film.kind !== 'area') {
          const penumbra = film.penumbra ?? 0.3
          inner = Math.cos(light.angle * (1 - penumbra))
          light.penumbra = useCompactOptics ? 1 - Math.acos(-Math.min(inner, 0.99999)) / light.angle : penumbra
        }
      }
      const level = Math.max(0, film.level(timeSeconds))
      if (film.colorAt) film.colorAt(timeSeconds, scratch)
      else scratch.copy(film.color)
      light.color.copy(scratch)
      light.intensity = film.intensity * level
      light.distance = film.range
      light.visible = light.intensity > 1e-5
      u.filmLightPosition.value[i].copy(world)
      const cutoff = light instanceof THREE.SpotLight ? Math.cos(light.angle) : -1
      u.filmLightAxis.value[i].set(axis.x, axis.y, axis.z, cutoff)
      u.filmLightColor.value[i].set(scratch.r * light.intensity, scratch.g * light.intensity, scratch.b * light.intensity, film.range)
      u.filmLightShape.value[i].set(inner, Math.max(0.06, Math.hypot(...film.size) * 0.22), Number(film.beam), Number(useCompactOptics))
    })
  }
}
