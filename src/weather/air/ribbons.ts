import * as THREE from 'three'
import { config, frameCount, shutterSeconds } from '../../config'
import { layers, type FrameContext, type SampleContext } from '../../core/contract'
import { apertureRadius } from '../../core/lens'
import { filmLightsGlsl, type FilmLightUniforms } from '../../core/lights'
import { stream } from '../../core/random'
import type { WorldModule } from '../../world'
import { fallCycle, prevailingWind, terminalSpeed } from './motion'
import { clipBounds, rainFloor, ribbonCorners, worldRainMotion, WorldRibbonSelection } from './selection'

type Fade = readonly [number, number, number, number]
interface RibbonField {
  fade: Fade
  gain: number
  size: THREE.Vector3
  center: THREE.Vector3
  local?: boolean
  selection?: WorldRibbonSelection
}

const scatter = /* glsl */ `
${filmLightsGlsl}

vec3 scatterRain(vec3 p, vec3 delta, vec3 toEye, bool mist, float field, bool local, out vec3 flash) {
  vec3 light = vec3(0.0);
  flash = vec3(0.0);
  for (int i = 0; i < MAX_FILM_LIGHTS; ++i) {
    if (i >= filmLightCount) break;
    vec4 source = filmLightColor[i];
    if (all(equal(source.rgb, vec3(0.0)))) continue;
    vec3 offset = filmLightPosition[i] - p;
    float distance2 = dot(offset, offset);
    if (distance2 > source.a * source.a * 1.000001) continue;
    bool compact = filmLightShape[i].w > 0.5;
    if (local && !compact && distance2 > 900.0) continue;
    vec3 toSource;
    vec3 incident = filmLightAt(i, p, toSource);
    if (compact && field >= 0.0 && distance2 < 81.0 && dot(-offset, filmLightAxis[i].xyz) > 0.0) {
      vec3 unused;
      vec3 early = filmLightAt(i, p - delta * 0.774597, unused);
      vec3 late = filmLightAt(i, p + delta * 0.774597, unused);
      incident = (incident * 4.0 + (early + late) * 2.5) / 9.0;
    }
    if (all(equal(incident, vec3(0.0)))) continue;
    float mu = clamp(-dot(toEye, toSource), -1.0, 1.0);
    if (mist) {
      const float g = 0.68;
      float q = 1.0 + g * g - 2.0 * g * mu;
      float phase = (1.0 - g * g) * inversesqrt(q * q * q);
      light += incident * (0.015 + 0.32 * min(phase, 5.0));
      continue;
    }
    bool area = filmLightShape[i].x < 0.0;
    float width = area ? 0.067 : compact ? 0.078 : 0.043;
    float extent = filmLightShape[i].y;
    float spread = area ? min(0.045, extent * extent * 0.38 / max(0.01, distance2)) : 0.0;
    float forward = exp(-(1.0 - mu) / (width + spread)) * width / (width + spread);
    float rim = exp2(-(compact ? 26.0 : 55.0) * abs(mu - 0.774));
    float distantPanel = area ? smoothstep(8100.0, 40000.0, distance2) * smoothstep(0.7, 2.6, field) : 0.0;
    float forwardGain = area ? 2.55 : compact ? 3.45 : 2.16;
    vec3 scattered = incident * (0.002 + (forwardGain + 4.85 * distantPanel) * forward + (area ? 0.17 : compact ? 0.16 : 0.095) * rim);
    if (compact && field >= 0.0) flash += scattered;
    else light += scattered;
  }
  vec3 total = light + flash;
  float response = 1.0 + max(max(total.r, total.g), total.b) * 0.21;
  flash /= response;
  return light / response;
}
`

const vertex = /* glsl */ `
attribute vec4 aDrop;
attribute vec4 aMotion;
uniform vec2 uViewport;
uniform vec3 uVolumeSize;
uniform vec3 uVolumeCenter;
uniform vec3 uNearAnchor;
uniform vec2 uWind;
uniform vec4 uFade;
uniform float uGain;
uniform float uLayer;
uniform float uLocalFine;
uniform float uPhase;
uniform float uShutter;
uniform float uDuration;
uniform float uFocus;
uniform vec2 uAperture;
uniform vec2 uLensShift;
uniform float uFilmView;
uniform vec3 uOpticalEye;
flat out vec2 vHead;
flat out vec2 vTail;
flat out vec2 vSigma;
flat out vec3 vRadiance;
flat out float vVeil;
flat out float vBead;
flat out float vMist;

${scatter}

vec4 lensProject(vec4 vv) {
  vec4 clip = projectionMatrix * vv;
  clip.xy += vec2(projectionMatrix[0][0], projectionMatrix[1][1])
    * uLensShift * (1.0 - clip.w / uFocus);
  return clip;
}

vec3 wrapAround(vec3 point, vec3 anchor, vec3 span) {
  return anchor + mod(point - anchor + 0.5 * span, span) - 0.5 * span;
}

vec3 veilHighlights(vec3 peak, float weight) {
  float brightest = max(peak.r, max(peak.g, peak.b));
  const float knee = 0.017;
  const float span = 0.035;
  float excess = max(0.0, brightest - knee);
  float scale = 1.0 - weight * excess * excess / max(1e-6, brightest * (span + excess));
  return peak * (scale * mix(1.0, 0.69, weight));
}

void main() {
  vec3 p = aDrop.xyz;
  vec3 direction = aMotion.xyz;
  vec3 delta = 0.5 * direction;
  float amount = aMotion.w;
  gl_Position = vec4(3.0, 3.0, 3.0, 1.0);
  if (uLayer >= 0.0) {
    float tau = 6.28318530718;
    float slant = ${worldRainMotion.slant} + aMotion.w * ${worldRainMotion.variation};
    float cycle = fract(aDrop.y - uPhase * aMotion.x);
    float y = (cycle - 0.5) * aMotion.y;
    vec3 span = vec3(uVolumeSize.x, aMotion.y, uVolumeSize.z);
    vec3 origin = uLayer < 0.5 ? uNearAnchor : uVolumeCenter;
    if (uLayer < 0.5) y = wrapAround(vec3(0.0, y, 0.0), origin, span).y;
    float gustPhase = tau * (uPhase * ${worldRainMotion.gustCycles.toFixed(1)} + aDrop.x * 0.26 + aDrop.z * 0.14);
    float flutterPhase = tau * (uPhase * ${worldRainMotion.flutterCycles.toFixed(1)} + aMotion.w);
    float flutter = sin(flutterPhase);
    float gust = ${worldRainMotion.gust} * sin(gustPhase);
    vec2 drift = uWind * (-slant * y + gust) + vec2(uWind.y, -uWind.x) * (${worldRainMotion.flutter} * flutter);
    p = vec3(aDrop.x * uVolumeSize.x + drift.x, y, aDrop.z * uVolumeSize.z + drift.y);
    if (uLayer < 0.5) p = wrapAround(p, origin, span);
    else p += origin;
    vec3 eye = uFilmView > 0.5 ? uOpticalEye : cameraPosition;
    float distanceToEye = length(p - eye);
    float low = smoothstep(${rainFloor}, 0.14, p.y);
    amount = low * smoothstep(uFade.x, uFade.y, distanceToEye) * (1.0 - smoothstep(uFade.z, uFade.w, distanceToEye));
    if (uLayer < 0.5) {
      float border = max(max(abs(p.x - origin.x) / span.x, abs(p.y - origin.y) / span.y), abs(p.z - origin.z) / span.z);
      amount *= 1.0 - smoothstep(0.42, 0.5, border);
      amount *= mix(0.54, 1.0, smoothstep(0.88, 2.65, distanceToEye));
    } else {
      amount *= smoothstep(0.014, 0.11, min(cycle, 1.0 - cycle));
    }
    if (uLocalFine > 0.5) {
      vec2 across = abs(p.xz - origin.xz) / span.xz;
      amount *= (1.0 - smoothstep(0.30, 0.49, max(across.x, across.y)))
        * (1.0 - smoothstep(1.16, 2.62, p.y - origin.y + 0.5 * span.y));
    }
    float gustSheet = sin(dot(p, vec3(1.45, 0.32, -1.73)) - tau * 3.0 * uPhase);
    amount *= mix(0.77, 1.16, smoothstep(-0.85, 0.86, gustSheet));
    if (amount < 0.0003) return;
    float speed = aMotion.z;
    float vx = slant * speed + ${worldRainMotion.gust} * tau * ${worldRainMotion.gustCycles.toFixed(1)} / uDuration * cos(gustPhase);
    vec2 sideWind = uWind * vx + vec2(uWind.y, -uWind.x) * (${worldRainMotion.flutter} * tau * ${worldRainMotion.flutterCycles.toFixed(1)} / uDuration * cos(flutterPhase));
    delta = vec3(sideWind.x, -speed, sideWind.y) * (0.5 * uShutter);
  }

  if (amount < 0.0003) return;
  vec4 a = modelViewMatrix * vec4(p - delta, 1.0);
  vec4 b = modelViewMatrix * vec4(p + delta, 1.0);
  vec4 ca = lensProject(a);
  vec4 cb = lensProject(b);
  float depth = 0.5 * (ca.w + cb.w);
  if (min(ca.w, cb.w) < ${clipBounds.near} || abs(ca.x) > ca.w * ${clipBounds.x} || abs(ca.y) > ca.w * ${clipBounds.y}) return;
  vec2 ap = (ca.xy / ca.w * 0.5 + 0.5) * uViewport;
  vec2 bp = (cb.xy / cb.w * 0.5 + 0.5) * uViewport;
  vec2 line = bp - ap;
  float len = length(line);
  vec2 axis = len > 0.02 ? line / max(len, 0.02) : vec2(0.0, 1.0);
  vec2 normal = vec2(-axis.y, axis.x);
  vec2 pixelFocal = 0.5 * uViewport * vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
  float diameter = aDrop.w * pixelFocal.y / depth;
  vec2 coc = uAperture * abs(1.0 - depth / uFocus) * pixelFocal / depth;
  float physical = diameter * 0.5;
  bool mist = uLayer < -1.5;
  float sigma = physical * physical * (mist ? 0.5 : 0.25) + 0.17;
  float sigmaSide = sqrt(pow(length(normal * coc) * 0.5, 2.0) + sigma);
  float sigmaEnd = sqrt(pow(length(axis * coc) * 0.5, 2.0) + sigma);
  vec3 eye = uFilmView > 0.5 ? uOpticalEye : cameraPosition;
  vec3 flash;
  vec3 radiance = scatterRain(p, delta, normalize(eye - p), mist, uLayer, uLocalFine > 0.5, flash);
  if (all(equal(radiance + flash, vec3(0.0)))) return;
  float gain = uLayer < 0.0 ? (mist ? 1.0 : 0.64) : uGain;
  float coverage = min(1.0, diameter * 0.39894228 / sigmaSide) * min(1.0, max(len, diameter) / (1.35 * sigmaEnd));
  float frameTravel = len / max(uViewport.x, uViewport.y);
  float nearVeil = smoothstep(0.009, 0.028, frameTravel);
  float midVeil = smoothstep(0.013, 0.035, frameTravel);
  float veil = uLayer >= 0.0 ? uFilmView * (uLayer < 0.5 ? nearVeil : midVeil) : 0.0;
  vHead = ap;
  vTail = bp;
  vSigma = vec2(sigmaSide, sigmaEnd);
  vec3 peak = radiance * (amount * gain * coverage);
  if (uLocalFine > 0.5) peak /= 1.0 + 25.0 * max(peak.r, max(peak.g, peak.b));
  flash *= amount * gain * coverage;
  peak += flash / (1.0 + 20.0 * max(flash.r, max(flash.g, flash.b)));
  if (uLayer < 0.0 && !mist) peak /= 1.0 + 32.0 * max(peak.r, max(peak.g, peak.b));
  vRadiance = veilHighlights(peak, veil);
  vVeil = veil;
  vBead = uLayer < 0.0 ? 0.0 : clamp((aDrop.w - 0.0017) * 450.0, 0.0, 0.28);
  vMist = float(mist);
  vec4 corner = position.x < 0.0 ? ca : cb;
  vec2 offset = 2.7 * (axis * position.x * sigmaEnd + normal * position.y * sigmaSide);
  corner.xy += 2.0 * offset * corner.w / uViewport;
  gl_Position = corner;
}
`

const fragment = /* glsl */ `
flat in vec2 vHead;
flat in vec2 vTail;
flat in vec2 vSigma;
flat in vec3 vRadiance;
flat in float vVeil;
flat in float vBead;
flat in float vMist;
out vec4 outColor;

void main() {
  vec2 line = vTail - vHead;
  float len = length(line);
  vec2 axis = len > 0.02 ? line / max(len, 0.02) : vec2(0.0, 1.0);
  vec2 relative = gl_FragCoord.xy - vHead;
  float x = dot(relative, axis);
  float y = dot(relative, vec2(-axis.y, axis.x));
  float endpoint = (x - clamp(x, 0.0, len)) / vSigma.y;
  float across = y / vSigma.x;
  float envelope = exp(-0.5 * (endpoint * endpoint + across * across));
  float progress = x / max(len, 0.2);
  float core = smoothstep(-vSigma.y, vSigma.y * 1.6, len - x) * mix(0.49, 1.0, smoothstep(0.0, 1.0, progress));
  float tips = (0.38 + 0.62 * smoothstep(-0.04, 0.27, progress)) * (1.0 - 0.57 * smoothstep(0.72, 1.04, progress));
  float bead = 1.0 + vBead * cos(progress * 16.0 + 1.4);
  float profile = mix(core * bead * mix(1.0, tips, vVeil), 1.0, vMist);
  outColor = vec4(vRadiance * (envelope * profile), 0.0);
}
`

export function makeRibbonGeometry(drops: Float32Array, motion: Float32Array, dynamic = false): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(ribbonCorners, 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drops, 4).setUsage(dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage))
  geometry.setAttribute('aMotion', new THREE.InstancedBufferAttribute(motion, 4).setUsage(dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage))
  geometry.instanceCount = dynamic ? 0 : drops.length / 4
  return geometry
}

export class RibbonView {
  private sample: SampleContext | undefined
  readonly nearAnchor = new THREE.Vector3()
  phase = 0

  beginFrame({ camera, frame }: FrameContext): void {
    this.sample = undefined
    this.nearAnchor.copy(camera.position)
    this.phase = frame.frameKey / frameCount
  }

  beginSample(sample: SampleContext): void {
    this.sample = sample
  }

  makeMesh(lights: FilmLightUniforms, geometry: THREE.BufferGeometry, layer: number, field?: RibbonField): THREE.Mesh {
    const uniform = {
      ...lights,
      uViewport: { value: new THREE.Vector2() },
      uVolumeSize: { value: field?.size ?? new THREE.Vector3() },
      uVolumeCenter: { value: field?.center ?? new THREE.Vector3() },
      uNearAnchor: { value: this.nearAnchor },
      uWind: { value: new THREE.Vector2(...prevailingWind) },
      uFade: { value: new THREE.Vector4(...(field?.fade ?? [0, 1, 2, 3])) },
      uGain: { value: field?.gain ?? 0 },
      uLayer: { value: layer },
      uLocalFine: { value: field?.local ? 1 : 0 },
      uPhase: { value: 0 },
      uShutter: { value: shutterSeconds },
      uDuration: { value: config.film.durationSeconds },
      uFocus: { value: 1 },
      uAperture: { value: new THREE.Vector2() },
      uLensShift: { value: new THREE.Vector2() },
      uFilmView: { value: 0 },
      uOpticalEye: { value: new THREE.Vector3() },
    }
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: uniform,
      vertexShader: vertex,
      fragmentShader: fragment,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      side: THREE.DoubleSide,
      toneMapped: false,
      forceSinglePass: true,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.layers.set(layer === 0 ? layers.cameraOnly : layers.scene)
    const viewport = new THREE.Vector4()
    const offset = new THREE.Vector3()
    const inverse = new THREE.Quaternion()
    mesh.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getCurrentViewport(viewport)
      uniform.uViewport.value.set(viewport.z, viewport.w)
      uniform.uPhase.value = this.phase
      const s = this.sample
      uniform.uFilmView.value = s && camera === s.camera ? 1 : 0
      uniform.uAperture.value.set(0, 0)
      uniform.uLensShift.value.set(0, 0)
      if (s && camera === s.camera) {
        uniform.uFocus.value = s.state.focusDistance
        uniform.uOpticalEye.value.copy(s.state.position)
        if (s.sample.frame.tier !== 'final') {
          // The analytic footprint replaces aperture motion but keeps camera and pixel motion.
          const radius = apertureRadius(s.state)
          uniform.uAperture.value.set(radius / (config.lens.anamorphic ? 1.5 : 1), radius)
          offset.copy(camera.position).sub(s.state.position).applyQuaternion(inverse.copy(s.state.quaternion).invert())
          uniform.uLensShift.value.set(offset.x, offset.y)
        }
      }
      field?.selection?.select(camera, mesh.matrixWorld, uniform.uFilmView.value ? uniform.uOpticalEye.value : undefined, uniform.uLensShift.value, uniform.uFocus.value, this.phase)
      material.uniformsNeedUpdate = true
    }
    return mesh
  }
}

export function rainMeshes(view: RibbonView, world: WorldModule, lights: FilmLightUniforms, body = new THREE.Vector3()): THREE.Mesh[] {
  const deckCenter = world.deck.bounds.getCenter(new THREE.Vector2())
  const deckSpan = world.deck.bounds.getSize(new THREE.Vector2())
  const specs: { key: string; layer: number; density: number; fine: number; size: THREE.Vector3; fade: Fade; gain: number; local?: boolean }[] = [
    { key: 'near', layer: 0, density: 8.5, fine: 2.65, size: new THREE.Vector3(9.4, 9.4, 9.4), fade: [0.63, 1.31, 3.25, 4.8], gain: 1.04 },
    { key: 'close', layer: 1, density: 5.4, fine: 2.2, size: new THREE.Vector3(21, 7.8, 21), fade: [2.25, 4.1, 7.6, 13.0], gain: 2.6 },
    { key: 'middle', layer: 2, density: 2.65, fine: 1.75, size: new THREE.Vector3(Math.min(deckSpan.x, 41), 11.6, Math.min(deckSpan.y, 40)), fade: [7.2, 11.25, 20, 29], gain: 5.15 },
    { key: 'distance', layer: 3, density: 0.17, fine: 1.6, size: new THREE.Vector3(Math.max(deckSpan.x, 66), 16.5, Math.max(deckSpan.y, 66)), fade: [17.4, 24, 28, 38], gain: 2.05 },
    { key: 'beam', layer: 1, density: 27.0, fine: 4.4, size: new THREE.Vector3(12, 3.2, 14), fade: [1.05, 2.15, 9, 13], gain: 1.38, local: true },
  ]
  return specs.map(({ key, layer, density, fine, size, fade, gain, local }) => {
    const rng = stream(`air-streaks-${key}`)
    const volume = size.x * size.y * size.z
    const count = Math.round(Math.min(volume, 90_000) * density)
    const drops = new Float32Array(count * 4)
    const motion = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      const diameter = (1 + 2 * Math.pow(rng.next(), fine)) * 0.001
      const { cycles, wrapHeight } = fallCycle(diameter, size.y)
      drops.set([rng.range(-0.5, 0.5), rng.next(), rng.range(-0.5, 0.5), diameter], i * 4)
      motion.set([cycles, wrapHeight, terminalSpeed(diameter), rng.next()], i * 4)
    }
    const center = layer === 0 ? new THREE.Vector3() : local ? body.clone().add(new THREE.Vector3(0, size.y * 0.48, 0)) : new THREE.Vector3(deckCenter.x, size.y * 0.48, deckCenter.y)
    const selection = layer > 0 ? new WorldRibbonSelection(drops, motion, size, center, [fade[0], fade[3]]) : undefined
    const mesh = view.makeMesh(lights, selection?.geometry ?? makeRibbonGeometry(drops, motion), layer, { center, size, fade, gain, local, selection })
    mesh.name = `rain-${key}`
    return mesh
  })
}
