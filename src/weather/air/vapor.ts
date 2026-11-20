import * as THREE from 'three'
import { config, frameCount, shutterSeconds } from '../../config'
import type { SampleContext, SamplePass } from '../../core/contract'
import { FullscreenPass, passMaterial } from '../../core/fullscreen'
import { filmLightsGlsl } from '../../core/lights'
import { stream } from '../../core/random'
import { engine } from '../../director/timeline'
import type { WeatherDeps } from '../contract'
import { prevailingWind } from './motion'

const maxVaporSources = 8
const slabHeight = 0.29
const vaporScale = 0.42

const optics = /* glsl */ `
#define MAX_VAPOR_SOURCES ${maxVaporSources}
const float TAU = 6.28318530718;
uniform sampler2D uDepth;
uniform vec2 uLensScale;
uniform vec2 uLensCenter;
uniform vec2 uClip;
uniform vec3 uEye;
uniform mat3 uOrientation;
uniform vec2 uWind;
uniform float uPhase;
uniform vec2 uNoise;
uniform int uCount;
uniform vec4 uSources[MAX_VAPOR_SOURCES];
uniform vec4 uAxes[MAX_VAPOR_SOURCES];

vec3 viewRay(vec2 uv) {
  return uOrientation * vec3((uv * 2.0 - 1.0 + uLensCenter) / uLensScale, -1.0);
}

float viewDepth(vec2 uv) {
  float z = texture(uDepth, uv).r;
  return uClip.x * uClip.y / (uClip.y - z * (uClip.y - uClip.x));
}

vec2 sphereBounds(vec3 p, float r, vec3 ray) {
  vec3 v = p - uEye;
  float ray2 = dot(ray, ray);
  float closest = dot(v, ray) / ray2;
  float d2 = dot(v, v) - closest * closest * ray2;
  float halfSpan = sqrt(max(0.0, (r * r - d2) / ray2));
  return vec2(closest - halfSpan, closest + halfSpan);
}

float smootherNoise(vec3 p, float a) {
  return sin(dot(p, vec3(1.95, 4.53, 2.17)) + a) * 0.50
       + sin(dot(p, vec3(-3.32, 2.87, 4.43)) - a * 2.0) * 0.32
       + sin(dot(p, vec3(5.27, -3.88, 6.53)) + a * 3.0) * 0.18;
}
`

const vaporFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec4 uDeck;
${optics}
${filmLightsGlsl}

vec3 vaporLight(vec3 p, vec3 toEye) {
  vec3 illumination = vec3(0.0);
  for (int i = 0; i < MAX_FILM_LIGHTS; ++i) {
    if (i >= filmLightCount) break;
    vec4 source = filmLightColor[i];
    if (all(equal(source.rgb, vec3(0.0)))) continue;
    vec3 offset = filmLightPosition[i] - p;
    if (dot(offset, offset) > source.a * source.a * 1.000001) continue;
    vec3 toLight;
    vec3 incident = filmLightAt(i, p, toLight);
    float mu = -dot(toEye, toLight);
    float lobe = 0.51 * inversesqrt(pow(1.42 - 1.30 * mu, 3.0));
    illumination += incident * (0.10 + lobe * 0.20);
  }
  return illumination / (1.0 + max(max(illumination.r, illumination.g), illumination.b) * 0.38);
}

float deckSpray(vec3 p) {
  vec2 border = min(p.xz - uDeck.xy, uDeck.zw - p.xz);
  float edge = smoothstep(0.0, 1.5, min(border.x, border.y));
  float e = exp(-max(0.0, p.y - 0.025) * 18.0) * (1.0 - smoothstep(0.12, ${slabHeight}, p.y));
  float primary = sin(dot(p.xz, vec2(2.04, -2.14)) - TAU * 12.0 * uPhase + uNoise.x);
  float secondary = sin(dot(p.xz, vec2(3.89, 1.13)) - TAU * 15.0 * uPhase + uNoise.y);
  float pockets = 0.48 + 0.52 * smoothstep(-0.62, 0.78, primary * 0.68 + secondary * 0.32);
  return 0.050 * edge * e * pockets;
}

float plumeDensity(vec3 q, vec3 axis, float type, float index) {
  bool vent = type < 1.5;
  bool drain = type > 1.5 && type < 2.5;
  bool exhaust = type > 3.5;
  float span = vent ? 2.8 : drain ? 1.35 : 0.86;
  vec3 main = vent || drain ? axis : vec3(0.0, 1.0, 0.0);
  vec3 wind = vec3(uWind.x, 0.0, uWind.y);
  float y = dot(q, main);
  if (y < 0.025 || y > span) return 0.0;
  float u = y / span;
  float t = TAU * (uPhase * (vent ? 11.0 : 21.0) + index * 0.341 + uNoise.x);
  float bend = vent ? 0.85 * y * u : drain ? (0.18 + 0.52 * sqrt(u)) : 0.47 * y;
  vec3 p = q - main * y - wind * bend;
  if (exhaust) p -= axis * (0.055 + 0.42 * sqrt(u));
  vec3 left = cross(main, wind);
  float twist = y * (vent ? 4.9 : 9.4) - t;
  p -= left * ((vent ? 0.32 : 0.14) * u * sin(twist));
  p -= wind * ((vent ? 0.19 : 0.085) * u * cos(twist + 1.4));
  float width = (vent ? 0.105 : 0.071) + (vent ? 0.25 : 0.35) * y;
  float core = 1.0 - smoothstep(0.22, 1.0, length(p) / max(width, 0.001));
  vec3 noisePoint = q * (vent ? 2.2 : 4.2);
  float billows = 0.31 + 0.69 * smoothstep(-0.55, 0.8, smootherNoise(noisePoint, t - 1.4 * y));
  float life = smoothstep(0.025, vent ? 0.19 : 0.07, y) * (1.0 - smoothstep(0.26, 1.0, u));
  return core * billows * life * (vent ? 0.96 : 0.66);
}

void main() {
  vec3 ray = viewRay(vUv);
  float rayLength = length(ray);
  vec3 toEye = -ray / rayLength;
  float scene = viewDepth(vUv);
  float optical = 0.0;
  vec3 scattered = vec3(0.0);

  if (abs(ray.y) > 1e-5) {
    vec2 water = (vec2(0.025, ${slabHeight}) - uEye.y) / ray.y;
    float enter = max(uClip.x, min(water.x, water.y));
    float exit = min(scene, min(26.0 / rayLength, max(water.x, water.y)));
    if (exit > enter) {
      float dt = (exit - enter) / 7.0;
      for (int j = 0; j < 7; ++j) {
        float t = enter + (float(j) + 0.5) * dt;
        vec3 p = uEye + ray * t;
        float density = deckSpray(p) * dt * rayLength * (1.0 - smoothstep(18.0, 26.0, t * rayLength));
        if (density > 0.00002) {
          optical += density;
          scattered += vaporLight(p, toEye) * density;
        }
      }
    }
  }

  for (int i = 0; i < MAX_VAPOR_SOURCES; ++i) {
    if (i >= uCount) break;
    vec3 source = uSources[i].xyz;
    float emission = uSources[i].w;
    vec3 axis = uAxes[i].xyz;
    float type = uAxes[i].w;
    if (emission < 0.001) continue;
    bool vent = type < 1.5;
    bool drain = type > 1.5 && type < 2.5;
    vec3 main = vent || drain ? axis : vec3(0.0, 1.0, 0.0);
    vec3 center = source + main * (vent ? 1.25 : 0.49);
    center += vec3(uWind.x, 0.0, uWind.y) * (vent ? 0.58 : drain ? 0.48 : 0.22);
    if (type > 3.5) center += axis * 0.39;
    vec2 bounds = sphereBounds(center, vent ? 2.08 : 0.95, ray);
    float enter = max(bounds.x, uClip.x);
    float exit = min(bounds.y, scene);
    if (exit <= enter) continue;
    float dt = (exit - enter) / 8.0;
    for (int j = 0; j < 8; ++j) {
      vec3 p = uEye + ray * (enter + (float(j) + 0.5) * dt);
      float density = plumeDensity(p - source, axis, type, float(i)) * emission * dt * rayLength;
      if (density > 0.00002) {
        optical += density;
        scattered += vaporLight(p, toEye) * density;
      }
    }
  }

  float opacity = 1.0 - exp(-optical);
  outColor = vec4(scattered * opacity / max(optical, 1e-5), opacity);
}
`

const compositeFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uInput;
uniform sampler2D uVapor;
uniform vec2 uLowRes;
uniform vec2 uFullRes;
uniform vec4 uShimmerRect;
uniform float uHot;
uniform float uEnabled;
${optics}

vec4 upsampleVapor(float depth) {
  depth = min(depth, 25.0);
  vec2 extent = vUv * uLowRes - 0.5;
  vec2 base = floor(extent);
  vec2 fraction = extent - base;
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < 4; ++i) {
    vec2 corner = vec2(float(i % 2), float(i / 2));
    vec2 uv = clamp((base + corner + 0.5) / uLowRes, 0.5 / uLowRes, 1.0 - 0.5 / uLowRes);
    vec2 bilinear = 1.0 - abs(corner - fraction);
    float d = min(viewDepth(uv), 25.0);
    float mismatch = max(d - depth, (depth - d) * 0.35) / max(0.30, min(d, depth) * 0.16);
    float w = bilinear.x * bilinear.y / (1.0 + mismatch * mismatch * mismatch);
    sum += w * texture(uVapor, uv);
    total += w;
  }
  return sum / max(0.24, total);
}

vec2 shimmer(vec3 ray, float scene, out float guard) {
  vec2 offset = vec2(0.0);
  guard = uClip.x;
  for (int i = 0; i < MAX_VAPOR_SOURCES; ++i) {
    if (i >= uCount) break;
    if (uAxes[i].w < 3.5 || uSources[i].w < 0.002) continue;
    vec3 axis = uAxes[i].xyz;
    vec3 origin = uSources[i].xyz + axis * 0.12 + vec3(0.0, 0.06, 0.0);
    vec3 plumeAxis = normalize(vec3(0.0, 0.95, 0.0) + axis * 0.72);
    vec3 center = origin + plumeAxis * 0.37;
    vec2 hit = sphereBounds(center, 0.48, ray);
    if (hit.y <= max(hit.x, uClip.x)) continue;
    float t = 0.5 * (hit.x + hit.y);
    if (t >= scene || t < uClip.x) continue;
    vec3 p = uEye + ray * t;
    vec3 d = p - origin;
    float y = dot(d, plumeAxis);
    float peak = smoothstep(-0.02, 0.12, y) * (1.0 - smoothstep(0.36, 0.79, y));
    float radial = length(d - plumeAxis * y);
    float r = 0.085 + 0.24 * max(0.0, y);
    float shape = peak * (1.0 - smoothstep(r * 0.32, r, radial));
    shape *= smoothstep(t, t + 0.07, scene);
    if (shape < 0.003) continue;
    guard = max(guard, t);
    float phase = TAU * (uPhase * 306.0 + float(i) * 0.23 + uNoise.y);
    float a = dot(d, vec3(22.5, 26.8, 18.4)) - phase;
    float b = dot(d, vec3(-42.3, 44.0, 35.8)) - 2.0 * phase;
    offset += shape * min(1.0, uSources[i].w) * vec2(cos(a) * 0.82 + sin(b) * 0.24, sin(a + 1.1) * 0.47 - cos(b) * 0.34);
  }
  return clamp(offset, -1.0, 1.0) * (2.65 * uFullRes.y / ${config.formats.master.height.toFixed(1)}) / uFullRes;
}

vec3 sourceAt(vec2 uv) {
  vec2 pixel = uv * uFullRes - 0.5;
  ivec2 minPixel = ivec2(floor(pixel));
  ivec2 bound = ivec2(uFullRes) - 1;
  ivec2 p = clamp(minPixel, ivec2(0), bound);
  ivec2 q = clamp(minPixel + 1, ivec2(0), bound);
  vec2 u = fract(pixel);
  vec3 a = mix(texelFetch(uInput, p, 0).rgb, texelFetch(uInput, ivec2(q.x, p.y), 0).rgb, u.x);
  vec3 b = mix(texelFetch(uInput, ivec2(p.x, q.y), 0).rgb, texelFetch(uInput, q, 0).rgb, u.x);
  return mix(a, b, u.y);
}

void main() {
  vec3 base = texelFetch(uInput, ivec2(gl_FragCoord.xy), 0).rgb;
  if (uEnabled < 0.5) {
    outColor = vec4(base, 1.0);
    return;
  }
  float scene = viewDepth(vUv);
  if (uHot > 0.5 && all(greaterThan(vUv, uShimmerRect.xy)) && all(lessThan(vUv, uShimmerRect.zw))) {
    float guard;
    vec2 delta = shimmer(viewRay(vUv), scene, guard);
    vec2 bent = clamp(vUv + delta, 0.5 / uFullRes, 1.0 - 0.5 / uFullRes);
    if (dot(delta, delta) > 1e-12) {
      vec2 corner = floor(bent * uFullRes - 0.5) + 0.5;
      float nearest = min(min(viewDepth(corner / uFullRes), viewDepth((corner + vec2(1.0, 0.0)) / uFullRes)),
                          min(viewDepth((corner + vec2(0.0, 1.0)) / uFullRes), viewDepth((corner + 1.0) / uFullRes)));
      if (nearest > guard + 0.02) base = sourceAt(bent);
    }
  }
  vec4 vapor = upsampleVapor(scene);
  outColor = vec4(base * (1.0 - vapor.a) + vapor.rgb, 1.0);
}
`

export class AirVolume implements SamplePass {
  readonly id = 'air-vapor-and-refraction'
  enabled = true
  private readonly low = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  })
  private readonly noise = stream('air-vapor')
  private readonly shared = {
    uDepth: { value: null as THREE.Texture | null },
    uLensScale: { value: new THREE.Vector2() },
    uLensCenter: { value: new THREE.Vector2() },
    uClip: { value: new THREE.Vector2() },
    uEye: { value: new THREE.Vector3() },
    uOrientation: { value: new THREE.Matrix3() },
    uWind: { value: new THREE.Vector2(...prevailingWind) },
    uPhase: { value: 0 },
    uNoise: { value: new THREE.Vector2(this.noise.range(0, 2 * Math.PI), this.noise.range(0, 2 * Math.PI)) },
    uCount: { value: 0 },
    uSources: { value: Array.from({ length: maxVaporSources }, () => new THREE.Vector4()) },
    uAxes: { value: Array.from({ length: maxVaporSources }, () => new THREE.Vector4()) },
  }
  private readonly compositeUniforms = {
    ...this.shared,
    uInput: { value: null as THREE.Texture | null },
    uVapor: { value: this.low.texture },
    uLowRes: { value: new THREE.Vector2() },
    uFullRes: { value: new THREE.Vector2() },
    uShimmerRect: { value: new THREE.Vector4() },
    uHot: { value: 0 },
    uEnabled: { value: 1 },
  }
  private readonly composite = new FullscreenPass(passMaterial(compositeFragment, this.compositeUniforms))
  private readonly vapor: FullscreenPass
  private readonly position = new THREE.Vector3()
  private readonly exhaust = new THREE.Vector3()
  private readonly direction = new THREE.Vector3()
  private readonly rotation = new THREE.Quaternion()
  private readonly corner = new THREE.Vector3()

  constructor(private readonly deps: WeatherDeps) {
    const b = deps.world.deck.bounds
    this.vapor = new FullscreenPass(passMaterial(vaporFragment, {
      ...this.shared,
      ...deps.lights,
      uDeck: { value: new THREE.Vector4(b.min.x, b.min.y, b.max.x, b.max.y) },
    }))
  }

  private updateSources({ camera, timeSeconds }: SampleContext): void {
    const { vehicle, world } = this.deps
    const source = this.shared.uSources.value
    const axis = this.shared.uAxes.value
    const rect = this.compositeUniforms.uShimmerRect.value.set(1, 1, 0, 0)
    let index = 0
    let hot = 0
    const power = engine(timeSeconds)
    const afterglow = 0.74 * engine(timeSeconds - 0.11) + 0.26 * engine(timeSeconds - 0.37)
    if (Math.max(power, afterglow) > 0.0001) {
      vehicle.root.updateWorldMatrix(true, false)
      this.exhaust.copy(vehicle.anchors.exhaust.position).applyMatrix4(vehicle.root.matrixWorld)
      for (const heat of vehicle.heatSources) {
        if (index >= maxVaporSources) break
        heat.object.getWorldPosition(this.position)
        const isExhaust = this.position.distanceTo(this.exhaust) < Math.max(0.25, 1.8 * vehicle.anchors.exhaust.radius)
        if (isExhaust) this.direction.copy(vehicle.anchors.exhaust.normal).transformDirection(vehicle.root.matrixWorld)
        else this.direction.set(0, 1, 0)
        source[index].set(this.position.x, this.position.y, this.position.z, heat.strength * afterglow)
        axis[index].set(this.direction.x, this.direction.y, this.direction.z, isExhaust ? 4 : 3)
        index++
        if (!isExhaust || power < 0.002) continue
        hot = 1
        for (const dx of [-0.9, 0.9]) for (const dy of [-0.42, 1.1]) for (const dz of [-0.9, 0.9]) {
          this.corner.copy(this.position).addScaledVector(this.direction, 0.32)
          this.corner.x += dx
          this.corner.y += dy
          this.corner.z += dz
          if (this.corner.applyMatrix4(camera.matrixWorldInverse).z > -camera.near) {
            rect.set(0, 0, 1, 1)
            continue
          }
          this.corner.applyMatrix4(camera.projectionMatrix)
          const u = this.corner.x * 0.5 + 0.5
          const v = this.corner.y * 0.5 + 0.5
          rect.set(Math.min(rect.x, u), Math.min(rect.y, v), Math.max(rect.z, u), Math.max(rect.w, v))
        }
      }
    }
    for (const vent of world.steamSources ?? []) {
      if (index >= maxVaporSources) break
      vent.object.getWorldPosition(this.position)
      vent.object.getWorldQuaternion(this.rotation)
      this.direction.set(0, 1, 0).applyQuaternion(this.rotation)
      source[index].set(this.position.x, this.position.y, this.position.z, vent.strength ?? 1)
      axis[index].set(this.direction.x, this.direction.y, this.direction.z, vent.kind === 'drain' ? 2 : 1)
      index++
    }
    this.shared.uCount.value = index
    this.compositeUniforms.uHot.value = hot
  }

  render(renderer: THREE.WebGLRenderer, input: { color: THREE.Texture; depth: THREE.Texture }, output: THREE.WebGLRenderTarget, sample: SampleContext): void {
    const { camera } = sample
    this.compositeUniforms.uInput.value = input.color
    this.compositeUniforms.uEnabled.value = this.enabled ? 1 : 0
    if (this.enabled) {
      const p = camera.projectionMatrix.elements
      const width = Math.max(1, Math.round(output.width * vaporScale))
      const height = Math.max(1, Math.round(output.height * vaporScale))
      if (this.low.width !== width || this.low.height !== height) this.low.setSize(width, height)
      this.shared.uDepth.value = input.depth
      this.shared.uLensScale.value.set(p[0], p[5])
      this.shared.uLensCenter.value.set(p[8], p[9])
      this.shared.uClip.value.set(camera.near, camera.far)
      this.shared.uEye.value.copy(camera.position)
      this.shared.uOrientation.value.setFromMatrix4(camera.matrixWorld)
      this.shared.uPhase.value = (sample.sample.frame.frameKey + (sample.sample.shutter - 0.5) * shutterSeconds * config.film.fps) / frameCount
      this.compositeUniforms.uLowRes.value.set(width, height)
      this.compositeUniforms.uFullRes.value.set(output.width, output.height)
      this.updateSources(sample)
      this.vapor.render(renderer, this.low)
    }
    this.composite.render(renderer, output)
  }
}
