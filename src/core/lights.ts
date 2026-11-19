import * as THREE from 'three'
import type { FilmLight } from './contract'

export const maxFilmLights = 16

const world = new THREE.Vector3()
const axis = new THREE.Vector3()
const side = new THREE.Vector3()
const lift = new THREE.Vector3()
const scratch = new THREE.Color()
const rotation = new THREE.Quaternion()

interface Entry {
  film: FilmLight
  light: THREE.SpotLight | THREE.PointLight
}

/** Uniform block any custom shader can use to evaluate the film's lights, for example rain streaks and steam. */
export interface FilmLightUniforms {
  filmLightCount: { value: number }
  filmLightPosition: { value: THREE.Vector3[] }
  /** xyz: axis. w: cosine of the cone half angle, or -1 for a point light. */
  filmLightAxis: { value: THREE.Vector4[] }
  /** rgb: color times intensity times level. a: range in meters. */
  filmLightColor: { value: THREE.Vector4[] }
}

export const filmLightsGlsl = /* glsl */ `
#define MAX_FILM_LIGHTS ${maxFilmLights}
uniform int filmLightCount;
uniform vec3 filmLightPosition[MAX_FILM_LIGHTS];
uniform vec4 filmLightAxis[MAX_FILM_LIGHTS];
uniform vec4 filmLightColor[MAX_FILM_LIGHTS];

/** Radiant intensity reaching point p from light i, without shadowing, with inverse square falloff. */
vec3 filmLightAt(int i, vec3 p, out vec3 toLight) {
  vec3 d = filmLightPosition[i] - p;
  float dist2 = max(dot(d, d), 1e-4);
  float dist = sqrt(dist2);
  toLight = d / dist;
  float cone = 1.0;
  if (filmLightAxis[i].w > -0.5) {
    float c = dot(-toLight, filmLightAxis[i].xyz);
    cone = smoothstep(filmLightAxis[i].w, mix(filmLightAxis[i].w, 1.0, 0.35), c);
  }
  float window = clamp(1.0 - pow(dist / filmLightColor[i].a, 4.0), 0.0, 1.0);
  return filmLightColor[i].rgb * cone * window * window / dist2;
}
`

export class LightRig {
  readonly group = new THREE.Group()
  readonly uniforms: FilmLightUniforms = {
    filmLightCount: { value: 0 },
    filmLightPosition: { value: Array.from({ length: maxFilmLights }, () => new THREE.Vector3()) },
    filmLightAxis: { value: Array.from({ length: maxFilmLights }, () => new THREE.Vector4(0, 0, 1, -1)) },
    filmLightColor: { value: Array.from({ length: maxFilmLights }, () => new THREE.Vector4(0, 0, 0, 1)) },
  }
  private readonly entries: Entry[] = []

  constructor(lights: FilmLight[], shadowMapSize: number) {
    if (lights.length > maxFilmLights) throw new Error(`The film has ${lights.length} lights. The rig holds ${maxFilmLights}.`)
    for (const film of lights) {
      const light = film.kind === 'point' ? new THREE.PointLight() : new THREE.SpotLight()
      light.decay = 2
      light.distance = film.range
      if (light instanceof THREE.SpotLight) {
        light.angle = film.kind === 'area' ? THREE.MathUtils.degToRad(84) : film.angle ?? Math.PI / 6
        light.penumbra = film.kind === 'area' ? 1 : film.penumbra ?? 0.3
        this.group.add(light.target)
      }
      if (film.shadow) {
        light.castShadow = true
        light.shadow.mapSize.set(shadowMapSize, shadowMapSize)
        light.shadow.bias = -0.0005
        light.shadow.normalBias = 0.01
        light.shadow.camera.near = 0.1
        light.shadow.camera.far = film.range
      }
      light.name = film.id
      this.group.add(light)
      this.entries.push({ film, light })
    }
  }

  /** Sets every light for one sub-render. `jitter` holds two numbers from 0 to 1 that pick the point on each emitter. */
  update(timeSeconds: number, jitter: [number, number]): void {
    const u = this.uniforms
    u.filmLightCount.value = this.entries.length
    this.entries.forEach(({ film, light }, i) => {
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
      if (light instanceof THREE.SpotLight) light.target.position.copy(world).add(axis)
      const level = Math.max(0, film.level(timeSeconds))
      if (film.colorAt) film.colorAt(timeSeconds, scratch)
      else scratch.copy(film.color)
      light.color.copy(scratch)
      light.intensity = film.intensity * level
      light.visible = light.intensity > 1e-5
      u.filmLightPosition.value[i].copy(world)
      u.filmLightAxis.value[i].set(axis.x, axis.y, axis.z, film.kind === 'point' ? -1 : Math.cos(film.kind === 'area' ? THREE.MathUtils.degToRad(84) : film.angle ?? Math.PI / 6))
      u.filmLightColor.value[i].set(scratch.r * light.intensity, scratch.g * light.intensity, scratch.b * light.intensity, film.range)
    })
  }
}
