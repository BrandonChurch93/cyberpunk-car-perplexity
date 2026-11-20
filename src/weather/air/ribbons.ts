import * as THREE from 'three'
import { config, frameCount, shutterSeconds } from '../../config'
import { layers, type FrameContext, type SampleContext } from '../../core/contract'
import { apertureRadius } from '../../core/lens'
import { filmLightsGlsl, type FilmLightUniforms } from '../../core/lights'
import { stream } from '../../core/random'
import type { WorldModule } from '../../world'
import { fallCycle, prevailingWind, terminalSpeed } from './motion'

const nearRainDensity = 5.4
const middleRainDensity = 2.42
const farRainDensity = 0.085

const scatter = /* glsl */ `
${filmLightsGlsl}

vec3 scatterRain(vec3 p, vec3 toEye) {
  vec3 light = vec3(0.0);
  for (int i = 0; i < MAX_FILM_LIGHTS; ++i) {
    if (i >= filmLightCount) break;
    vec3 toSource;
    vec3 incident = filmLightAt(i, p, toSource);
    float mu = -dot(toEye, toSource);
    bool area = filmLightShape[i].x < 0.0;
    float forward = exp2(-(area ? 12.0 : 18.0) * (1.0 - mu));
    float rim = exp2(-64.0 * abs(mu - 0.79));
    light += incident * (area ? 0.008 + 1.6 * forward + 0.16 * rim : 0.003 + 1.8 * forward + 0.11 * rim);
  }
  return light / (1.0 + max(max(light.r, light.g), light.b) * 0.21);
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
uniform float uLayer;
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
  if (uLayer >= 0.0) {
    float tau = 6.28318530718;
    float slant = 0.19 + aMotion.w * 0.075;
    float cycle = fract(aDrop.y - uPhase * aMotion.x);
    float y = (cycle - 0.5) * aMotion.y;
    vec3 span = vec3(uVolumeSize.x, aMotion.y, uVolumeSize.z);
    vec3 origin = uLayer < 0.5 ? uNearAnchor : uVolumeCenter;
    if (uLayer < 0.5) y = wrapAround(vec3(0.0, y, 0.0), origin, span).y;
    float gustPhase = tau * (uPhase * 14.0 + aDrop.x * 0.26 + aDrop.z * 0.14);
    float flutter = sin(tau * (uPhase * 91.0 + aMotion.w));
    float gust = 0.09 * sin(gustPhase);
    vec2 drift = uWind * (-slant * y + gust) + vec2(uWind.y, -uWind.x) * (0.018 * flutter);
    p = vec3(aDrop.x * uVolumeSize.x + drift.x, y, aDrop.z * uVolumeSize.z + drift.y);
    if (uLayer < 0.5) p = wrapAround(p, origin, span);
    else p += origin;
    vec3 eye = uFilmView > 0.5 ? uOpticalEye : cameraPosition;
    float distanceToEye = length(p - eye);
    float low = smoothstep(0.018, 0.14, p.y);
    if (uLayer < 0.5) {
      float border = max(max(abs(p.x - origin.x) / span.x, abs(p.y - origin.y) / span.y), abs(p.z - origin.z) / span.z);
      amount = low * smoothstep(0.65, 1.48, distanceToEye) * (1.0 - smoothstep(3.25, 4.8, distanceToEye));
      amount *= 1.0 - smoothstep(0.42, 0.5, border);
      amount *= mix(0.54, 1.0, smoothstep(0.88, 2.65, distanceToEye));
    } else if (uLayer < 1.5) {
      amount = low * smoothstep(0.01, 0.10, min(cycle, 1.0 - cycle));
      amount *= smoothstep(1.9, uFilmView > 0.5 ? 4.4 : 3.1, distanceToEye);
      amount *= 1.0 - smoothstep(17.0, 25.0, distanceToEye);
    } else {
      amount = low * smoothstep(0.02, 0.14, min(cycle, 1.0 - cycle));
      amount *= smoothstep(15.0, 24.0, distanceToEye) * (1.0 - smoothstep(25.0, 36.0, distanceToEye));
      amount *= 0.38;
    }
    float speed = aMotion.z;
    float vx = slant * speed + 0.09 * tau * 14.0 / uDuration * cos(gustPhase);
    vec2 sideWind = uWind * vx + vec2(uWind.y, -uWind.x) * (0.018 * tau * 91.0 / uDuration * cos(tau * (uPhase * 91.0 + aMotion.w)));
    delta = vec3(sideWind.x, -speed, sideWind.y) * (0.5 * uShutter);
  }

  gl_Position = vec4(3.0, 3.0, 3.0, 1.0);
  if (amount < 0.0003) return;
  vec4 a = modelViewMatrix * vec4(p - delta, 1.0);
  vec4 b = modelViewMatrix * vec4(p + delta, 1.0);
  vec4 ca = lensProject(a);
  vec4 cb = lensProject(b);
  float depth = 0.5 * (ca.w + cb.w);
  if (min(ca.w, cb.w) < 0.035 || abs(ca.x) > ca.w * 1.4 || abs(ca.y) > ca.w * 1.7) return;
  vec2 ap = (ca.xy / ca.w * 0.5 + 0.5) * uViewport;
  vec2 bp = (cb.xy / cb.w * 0.5 + 0.5) * uViewport;
  vec2 line = bp - ap;
  float len = length(line);
  vec2 axis = len > 0.02 ? line / max(len, 0.02) : vec2(0.0, 1.0);
  vec2 normal = vec2(-axis.y, axis.x);
  vec2 pixelFocal = 0.5 * uViewport * vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
  float diameter = aDrop.w * pixelFocal.y / depth;
  vec2 coc = uAperture * abs(1.0 - depth / uFocus) * pixelFocal / depth;
  coc = min(coc, vec2(28.0, 36.0) * uViewport.y / ${config.formats.master.height.toFixed(1)});
  float physical = diameter * 0.5;
  float sigmaSide = sqrt(pow(length(normal * coc) * 0.5, 2.0) + physical * physical * 0.5 + 0.17);
  float sigmaEnd = sqrt(pow(length(axis * coc) * 0.5, 2.0) + physical * physical * 0.5 + 0.17);
  vec3 eye = uFilmView > 0.5 ? uOpticalEye : cameraPosition;
  vec3 radiance = scatterRain(p, normalize(eye - p));
  float gain = uLayer < 0.0 ? 0.64 : uLayer < 0.5 ? 0.92 : 4.2;
  float coverage = min(1.0, diameter * 0.39894228 / sigmaSide) * min(1.0, max(len, diameter) / (1.35 * sigmaEnd));
  float frameTravel = len / max(uViewport.x, uViewport.y);
  float nearVeil = smoothstep(0.006, 0.024, frameTravel);
  float midVeil = smoothstep(0.0095, 0.031, frameTravel);
  float veil = uLayer >= 0.0 && uLayer < 1.5 ? uFilmView * (uLayer < 0.5 ? nearVeil : midVeil) : 0.0;
  vHead = ap;
  vTail = bp;
  vSigma = vec2(sigmaSide, sigmaEnd);
  vRadiance = veilHighlights(radiance * (amount * gain * coverage), veil);
  vVeil = veil;
  vBead = uLayer < 0.0 ? 0.0 : clamp((aDrop.w - 0.0017) * 450.0, 0.0, 0.28);
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
  outColor = vec4(vRadiance * (envelope * core * bead * mix(1.0, tips, vVeil)), 0.0);
}
`

export function makeRibbonGeometry(drops: Float32Array, motion: Float32Array, dynamic = false): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
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

  makeMesh(lights: FilmLightUniforms, geometry: THREE.InstancedBufferGeometry, layer: number, center = new THREE.Vector3(), size = new THREE.Vector3()): THREE.Mesh {
    const uniform = {
      ...lights,
      uViewport: { value: new THREE.Vector2() },
      uVolumeSize: { value: size },
      uVolumeCenter: { value: center },
      uNearAnchor: { value: this.nearAnchor },
      uWind: { value: new THREE.Vector2(...prevailingWind) },
      uLayer: { value: layer },
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
      material.uniformsNeedUpdate = true
    }
    return mesh
  }
}

export function rainMeshes(view: RibbonView, world: WorldModule, lights: FilmLightUniforms): THREE.Mesh[] {
  const deckCenter = world.deck.bounds.getCenter(new THREE.Vector2())
  const deckSpan = world.deck.bounds.getSize(new THREE.Vector2())
  const middle = new THREE.Vector3(Math.min(deckSpan.x, 31), 8.5, Math.min(deckSpan.y, 31))
  const farSize = new THREE.Vector3(Math.max(deckSpan.x, 58), 11.5, Math.max(deckSpan.y, 58))
  const specs = [
    { key: 'near', density: nearRainDensity, size: new THREE.Vector3(9.4, 9.4, 9.4), center: new THREE.Vector3() },
    { key: 'middle', density: middleRainDensity, size: middle, center: new THREE.Vector3(deckCenter.x, middle.y * 0.47, deckCenter.y) },
    { key: 'distance', density: farRainDensity, size: farSize, center: new THREE.Vector3(deckCenter.x, farSize.y * 0.49, deckCenter.y) },
  ]
  return specs.map(({ key, density, size, center }, layer) => {
    const rng = stream(`air-streaks-${key}`)
    const volume = size.x * size.y * size.z
    const count = Math.round(Math.min(volume, 90_000) * density)
    const drops = new Float32Array(count * 4)
    const motion = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      const diameter = (1 + 2 * Math.pow(rng.next(), layer === 0 ? 2.65 : 1.75)) * 0.001
      const { cycles, wrapHeight } = fallCycle(diameter, size.y)
      drops.set([rng.range(-0.5, 0.5), rng.next(), rng.range(-0.5, 0.5), diameter], i * 4)
      motion.set([cycles, wrapHeight, terminalSpeed(diameter), rng.next()], i * 4)
    }
    const mesh = view.makeMesh(lights, makeRibbonGeometry(drops, motion), layer, center, size)
    mesh.name = `rain-${key}`
    return mesh
  })
}
