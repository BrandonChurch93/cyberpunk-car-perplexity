import * as THREE from 'three'
import { config, frameCount, shutterSeconds } from '../../config'
import { layers, type FrameContext, type SampleContext } from '../../core/contract'
import { apertureRadius } from '../../core/lens'
import { filmLightsGlsl, type FilmLightUniforms } from '../../core/lights'
import { stream } from '../../core/random'
import type { WorldModule } from '../../world'
import { fallCycle, prevailingWind, terminalSpeed } from './motion'
import { clipBounds, rainFloor, ribbonCorners, worldRainMotion, WorldRibbonSelection } from './selection'
import { RainSkyDepth } from './sky-depth'

type Fade = readonly [number, number, number, number]
export const deckGlintLayer = -3
interface RibbonField {
  fade: Fade
  gain: number
  size: THREE.Vector3
  center: THREE.Vector3
  local?: boolean
  paint?: boolean
  hero?: 'beam' | 'media'
  selection?: WorldRibbonSelection
}

const scatter = /* glsl */ `
${filmLightsGlsl}

float skyEmitterSupport(int i, float distance2) {
  if (filmLightShape[i].w > 0.5 || (filmLightShape[i].z > 0.5 && filmLightShape[i].x > 0.0)) return 1.0;
  return 1.0 - smoothstep(16.0, 144.0, distance2);
}

vec3 scatterRain(vec3 p, vec3 delta, vec3 toEye, bool mist, float field, bool local, float paint, float hero, bool skyAware, out vec3 flash, out vec3 trace, out float skyKeep) {
  const vec3 luma = vec3(0.2126, 0.7152, 0.0722);
  vec3 light = vec3(0.0);
  flash = vec3(0.0);
  trace = vec3(1.0);
  float skyLight = 0.0;
  vec3 beamExposure = vec3(0.0);
  bool sampleBeam = local && hero > 0.5;
  bool fineBeam = local && hero > 1.5;
  bool media = hero > 2.5;
  for (int i = 0; i < MAX_FILM_LIGHTS; ++i) {
    if (i >= filmLightCount) break;
    vec4 source = filmLightColor[i];
    if (all(equal(source.rgb, vec3(0.0)))) continue;
    vec3 offset = filmLightPosition[i] - p;
    float distance2 = dot(offset, offset);
    if (distance2 > source.a * source.a * 1.000001) continue;
    bool compact = filmLightShape[i].w > 0.5;
    bool sharpSpot = compact || (filmLightShape[i].x > 0.0 && filmLightAxis[i].w > 0.94);
    if (local && (!compact || distance2 > 42.25)) continue;
    float extent = filmLightShape[i].y;
    if (media && (filmLightShape[i].x >= 0.0 || extent < 6.5)) continue;
    vec3 toSource;
    vec3 incident = filmLightAt(i, p, toSource);
    vec3 early = incident;
    vec3 late = incident;
    if (sharpSpot && field >= 0.0 && distance2 < (compact ? 81.0 : 324.0) && dot(-offset, filmLightAxis[i].xyz) > 0.0) {
      vec3 unused;
      early = filmLightAt(i, p - delta * 0.774597, unused);
      late = filmLightAt(i, p + delta * 0.774597, unused);
      if (!sampleBeam) incident = (incident * 4.0 + (early + late) * 2.5) / 9.0;
    }
    if (all(equal(incident + early + late, vec3(0.0)))) continue;
    float mu = clamp(-dot(toEye, toSource), -1.0, 1.0);
    if (media) {
      float spread = min(0.032, extent * extent * 0.38 / max(0.01, distance2));
      float forward = exp(-(1.0 - mu) / (0.019 + spread));
      vec3 scattered = incident * forward;
      light += scattered;
      if (skyAware) skyLight += dot(scattered, luma) * skyEmitterSupport(i, distance2);
      continue;
    }
    if (local) {
      float forward = fineBeam ? 2.15 * exp(-(1.0 - mu) / 0.36) : 2.4 * exp(-(1.0 - mu) / 0.23);
      float rim = 0.32 * exp2(-24.0 * abs(mu - 0.774));
      float reach = smoothstep(0.015, 0.16, distance2) * (1.0 - smoothstep(16.0, 42.25, distance2));
      float scatter = (forward + rim) * reach;
      if (sampleBeam) {
        beamExposure += vec3(dot(early, luma), dot(incident, luma), dot(late, luma)) * scatter;
        flash += max(incident, max(early, late)) * scatter;
      } else flash += incident * scatter;
      continue;
    }
    if (mist) {
      const float g = 0.68;
      float q = 1.0 + g * g - 2.0 * g * mu;
      float phase = (1.0 - g * g) * inversesqrt(q * q * q);
      light += incident * (0.19 * min(phase, 4.0) * smoothstep(0.06, 0.57, mu));
      continue;
    }
    bool area = filmLightShape[i].x < 0.0;
    bool splash = field < 0.0;
    float width = area ? 0.067 : compact ? (splash ? 0.15 : 0.078) : 0.043;
    float spread = area ? min(0.045, extent * extent * 0.38 / max(0.01, distance2)) : 0.0;
    float forward = exp(-(1.0 - mu) / (width + spread)) * width / (width + spread);
    float rim = exp2(-(compact ? 26.0 : 55.0) * abs(mu - 0.774));
    float distantPanel = area ? smoothstep(8100.0, 40000.0, distance2) * smoothstep(0.7, 2.6, field) : 0.0;
    float forwardGain = area ? 2.55 : compact ? (splash ? 2.0 : 3.45) : 2.16;
    float side = paint > 1.5 ? 0.10 + 0.28 * exp2(-12.0 * abs(mu + 0.19)) : paint > 0.5 ? 0.055 + 0.16 * exp2(-14.0 * abs(mu + 0.12)) : 0.0;
    vec3 scattered = incident * (0.002 + side + (forwardGain + 4.85 * distantPanel) * forward + (area ? 0.17 : compact ? 0.16 : 0.095) * rim);
    if (skyAware) skyLight += dot(scattered, luma) * skyEmitterSupport(i, distance2);
    if (sharpSpot && field >= 0.0) flash += scattered;
    else light += scattered;
  }
  vec3 total = light + flash;
  skyKeep = skyAware ? clamp(skyLight / max(1e-8, dot(total, luma)), 0.0, 1.0) : 1.0;
  if (sampleBeam) trace = beamExposure / max(1e-6, max(beamExposure.r, max(beamExposure.g, beamExposure.b)));
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
uniform vec2 uFocusAperture;
uniform vec2 uLensShift;
uniform float uFilmView;
uniform bool uSkyDepthEnabled;
uniform bool uMacro;
uniform float uPaint;
uniform float uHero;
uniform vec3 uOpticalEye;
flat out vec2 vHead;
flat out vec2 vTail;
flat out vec2 vSigma;
flat out vec3 vRadiance;
flat out float vVeil;
flat out float vBead;
flat out float vMist;
flat out vec3 vBeamTrace;
flat out vec2 vGlint;
flat out float vSkyKeep;
flat out vec4 vDropFlashes;
flat out vec2 vMacroFlashWeight;

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

float macroFocus(float depth, vec2 normal, vec2 focal, float longSide) {
  float offset = abs(depth - uFocus);
  float width = length(normal * uFocusAperture * focal) * offset / (uFocus * depth * longSide);
  return (1.0 - smoothstep(0.019, 0.062, offset)) * (1.0 - smoothstep(0.00068, 0.00155, width));
}

void main() {
  vec3 p = aDrop.xyz;
  vec3 direction = aMotion.xyz;
  vec3 delta = 0.5 * direction;
  float amount = aMotion.w;
  gl_Position = vec4(3.0, 3.0, 3.0, 1.0);
  bool macroFlash = uMacro && uPaint > 0.5;
  if (macroFlash && aMotion.w < 0.64) return;
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
    if (uHero > 2.5) amount *= smoothstep(0.84, 1.58, p.y);
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
  float diameter = aDrop.w * abs(pixelFocal.y) / depth;
  vec2 coc = uAperture * abs(1.0 - depth / uFocus) * pixelFocal / depth;
  float physical = diameter * 0.5;
  bool mist = uLayer == -2.0;
  float sigma = physical * physical * (mist ? 0.5 : 0.25) + (uHero > 1.5 ? 1.0 / 12.0 : 0.17);
  float sigmaSide = sqrt(pow(length(normal * coc) * 0.5, 2.0) + sigma);
  float sigmaEnd = sqrt(pow(length(axis * coc) * 0.5, 2.0) + sigma);
  vec3 eye = uFilmView > 0.5 ? uOpticalEye : cameraPosition;
  vec3 flash;
  float paint = uPaint;
  if (paint > 1.5 && depth > uFocus * 1.4) paint = 0.0;
  bool strata = uFilmView > 0.5 && uLayer >= 0.0 && uLocalFine < 0.5 && uHero < 2.5;
  float depthGain = strata && paint < 0.5 ? 1.0 - smoothstep(13.5, 27.0, depth) : 1.0;
  if (depthGain <= 0.0) return;
  vec3 trace;
  vec3 radiance = scatterRain(p, delta, normalize(eye - p), mist, uLayer, uLocalFine > 0.5, paint, uHero, uSkyDepthEnabled, flash, trace, vSkyKeep);
  if (all(equal(radiance + flash, vec3(0.0)))) return;
  float gain = uLayer < 0.0 ? (mist ? 1.0 : 0.64) : uGain * depthGain;
  float paintDefocus = smoothstep(0.10, 0.34, abs(depth / uFocus - 1.0));
  if (!uMacro && paint > 0.5 && paint < 1.5) gain *= mix(2.9, 0.21, paintDefocus);
  float coverage = min(1.0, diameter * 0.39894228 / sigmaSide) * min(1.0, max(len, diameter) / (1.35 * sigmaEnd));
  float longSide = max(uViewport.x, uViewport.y);
  float frameTravel = len / longSide;
  vGlint = vec2(-1.0, 1.0);
  vDropFlashes = vec4(0.0);
  vMacroFlashWeight = vec2(0.0);
  if (macroFlash) {
    float phase = 6.28318530718 * (uPhase * floor(79.0 * uDuration * pow(0.001 / aDrop.w, 1.5) + 0.5) + aMotion.w);
    vec2 pulse = vec2(0.26 + 0.17 * sin(phase), 0.72 + 0.16 * sin(phase + 2.3 + aMotion.w));
    vec2 pulseDepth = mix(vec2(ca.w), vec2(cb.w), pulse);
    vec2 progress = pulse * cb.w / pulseDepth;
    vMacroFlashWeight = vec2(macroFocus(pulseDepth.x, normal, pixelFocal, longSide),
      macroFocus(pulseDepth.y, normal, pixelFocal, longSide) * smoothstep(0.81, 0.97, aMotion.w) * 0.72);
    if (max(vMacroFlashWeight.x, vMacroFlashWeight.y) <= 0.0) return;
    float flashTime = mix(0.00032, 0.00063, aMotion.w);
    vDropFlashes = vec4(0.0, progress * len, length(vec2(sigmaEnd, len * flashTime / uShutter)));
  } else if (uMacro) {
    vec2 focusCoc = uFocusAperture * abs(1.0 - depth / uFocus) * pixelFocal / depth;
    float opticalWidth = length(normal * focusCoc) / longSide;
    gain *= 0.32 * smoothstep(0.0013, 0.0038, opticalWidth);
    sigmaSide = max(sigmaSide, 0.0025 * longSide);
  } else if (strata) {
    vec2 focusCoc = uFocusAperture * abs(1.0 - depth / uFocus) * pixelFocal / depth;
    float opticalWidth = length(normal * focusCoc) / longSide;
    float diffuse = smoothstep(0.00085, 0.0026, opticalWidth);
    float rare = smoothstep(0.91, 0.995, aMotion.w);
    if (uLayer < 0.5 && paint < 0.5) gain *= mix(1.0, 0.30 + 1.85 * rare, diffuse);
    float resolution = smoothstep(3.2, 6.5, len) * (1.0 - diffuse);
    float phase = 6.28318530718 * (uPhase * floor(43.0 * uDuration * pow(0.001 / aDrop.w, 1.5) + 0.5) + aMotion.w);
    float first = 0.22 + 0.14 * sin(phase);
    float second = 0.70 + 0.17 * sin(phase + 2.5 + aMotion.w * 2.2);
    float span = sqrt(sigmaEnd * sigmaEnd + (0.075 + 0.045 * aMotion.w) * (0.075 + 0.045 * aMotion.w) * len * len);
    vDropFlashes = vec4(resolution, first * len, second * len, span);
  }
  if (uHero > 0.5 && uLayer >= 0.0) {
    vec2 focusCoc = uFocusAperture * abs(1.0 - depth / uFocus) * pixelFocal / depth;
    float opticalWidth = length(vec2(length(normal * focusCoc), physical)) * 0.5 / longSide;
    float wide = smoothstep(0.00022, 0.00057, opticalWidth);
    float longTrail = smoothstep(0.0068, 0.019, frameTravel);
    float narrow = (1.0 - wide) * (1.0 - longTrail);
    float defocused = uLayer < 0.5 ? 0.065 + 0.14 * smoothstep(0.91, 0.99, aMotion.w) : 0.038;
    if (uHero > 1.5) {
      bool beamGrain = uHero < 2.5;
      if (beamGrain) sigmaSide *= mix(0.72, 1.0, wide);
      float oscillations = floor(78.0 * uDuration * pow(0.001 / aDrop.w, 1.5) + 0.5);
      float crest = 0.5 + 0.31 * sin(6.28318530718 * (uPhase * oscillations + aMotion.w));
      float crestSpan = beamGrain ? min(len * 0.16, 0.00160 * longSide) : min(len * 0.24, 0.00245 * longSide);
      float glintSigma = length(vec2(sigmaEnd, crestSpan));
      vGlint = vec2(crest * len, glintSigma);
      float clean = (1.0 - smoothstep(0.00016, 0.00047, opticalWidth)) * (1.0 - 0.51 * smoothstep(0.016, 0.033, frameTravel));
      gain *= beamGrain ? mix(0.003, 2.65, clean) : 17.8 * clean;
    } else gain *= uLocalFine > 0.5 ? mix(0.008, 0.82, narrow) : mix(defocused, 0.77, narrow);
  }
  float nearVeil = smoothstep(0.009, 0.028, frameTravel);
  float midVeil = smoothstep(0.013, 0.035, frameTravel);
  float veil = uLayer >= 0.0 ? uFilmView * (uLayer < 0.5 ? nearVeil : midVeil) : 0.0;
  if (paint > 0.5 && paint < 1.5) veil *= mix(0.14, 1.0, paintDefocus);
  vHead = ap;
  vTail = bp;
  vSigma = vec2(sigmaSide, sigmaEnd);
  vec3 peak = radiance * (amount * gain * coverage);
  flash *= amount * gain * coverage;
  peak += flash / (1.0 + (uLocalFine > 0.5 ? 5.5 : 20.0) * max(flash.r, max(flash.g, flash.b)));
  if (mist) peak /= 1.0 + 76.0 * max(peak.r, max(peak.g, peak.b));
  if (uLayer < 0.0 && !mist) {
    float knee = uLayer == ${deckGlintLayer.toFixed(1)} ? 17.0 : paint > 1.5 ? 9.0 : 32.0;
    peak /= 1.0 + knee * max(peak.r, max(peak.g, peak.b));
  }
  vRadiance = veilHighlights(peak, veil);
  vVeil = veil;
  vBead = uLayer < 0.0 ? 0.0 : clamp((aDrop.w - 0.0017) * 450.0, 0.0, 0.28);
  vMist = float(mist);
  vBeamTrace = trace;
  vec4 corner = position.x < 0.0 ? ca : cb;
  vec2 offset = 2.7 * (axis * position.x * sigmaEnd + normal * position.y * sigmaSide);
  corner.xy += 2.0 * offset * corner.w / uViewport;
  gl_Position = corner;
}
`

const fragment = /* glsl */ `
uniform bool uSkyDepthEnabled;
uniform bool uMacro;
uniform float uPaint;
uniform sampler2D uSkyDepth;
flat in vec2 vHead;
flat in vec2 vTail;
flat in vec2 vSigma;
flat in vec3 vRadiance;
flat in float vVeil;
flat in float vBead;
flat in float vMist;
flat in vec3 vBeamTrace;
flat in vec2 vGlint;
flat in float vSkyKeep;
flat in vec4 vDropFlashes;
flat in vec2 vMacroFlashWeight;
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
  float beamTrace = progress < 0.5
    ? mix(vBeamTrace.x, vBeamTrace.y, smoothstep(0.1127, 0.5, progress))
    : mix(vBeamTrace.y, vBeamTrace.z, smoothstep(0.5, 0.8873, progress));
  if (vGlint.x >= 0.0) {
    float glint = (x - vGlint.x) / vGlint.y;
    beamTrace *= mix(0.095, 1.0, exp(-0.5 * glint * glint));
  }
  if (vDropFlashes.x > 0.0) {
    vec2 glints = (x - vDropFlashes.yz) / vDropFlashes.w;
    vec2 highlights = exp(-0.5 * glints * glints);
    beamTrace *= mix(1.0, 0.40 + dot(highlights, vec2(1.18, 1.42)), vDropFlashes.x);
  }
  if (uSkyDepthEnabled && texelFetch(uSkyDepth, ivec2(gl_FragCoord.xy), 0).r >= 1.0) {
    beamTrace *= mix(0.04, 1.0, vSkyKeep);
  }
  if (uMacro) {
    if (uPaint > 0.5) {
      vec2 glints = (x - vDropFlashes.yz) / vDropFlashes.w;
      float pulse = dot(exp(-0.5 * glints * glints), vMacroFlashWeight);
      vec3 flash = min(vRadiance * 8.0, vec3(0.22));
      outColor = vec4(flash * (exp(-0.5 * across * across) * min(1.0, pulse)), 0.0);
    } else {
      outColor = vec4(min(vRadiance * 1.8, vec3(0.075)) * (envelope * profile * beamTrace), 0.0);
    }
  } else outColor = vec4(vRadiance * (envelope * profile * beamTrace), 0.0);
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
  private readonly skyDepth = new RainSkyDepth()
  private sample: SampleContext | undefined
  private paint = false
  private hero = false
  private paintField?: { geometry: THREE.InstancedBufferGeometry; count: number }
  private readonly heroFields: THREE.Mesh[] = []
  readonly nearAnchor = new THREE.Vector3()
  phase = 0

  beginFrame({ camera, frame }: FrameContext): void {
    this.sample = undefined
    this.nearAnchor.copy(camera.position)
    this.phase = frame.frameKey / frameCount
    const t = frame.frameKey / config.film.fps
    const beat = config.beats.find(beat => t >= beat.start && t < beat.end)?.id
    this.paint = beat === 'paint'
    this.hero = beat === 'arrival' || beat === 'wake' || beat === 'return'
    if (this.paintField) this.paintField.geometry.instanceCount = this.paint ? this.paintField.count : 0
    for (const mesh of this.heroFields) mesh.visible = this.hero
  }

  beginSample(sample: SampleContext): void {
    this.sample = sample
    this.skyDepth.beginSample()
  }

  registerPaintField(geometry: THREE.InstancedBufferGeometry): void {
    this.paintField = { geometry, count: geometry.instanceCount }
    geometry.instanceCount = 0
  }

  registerHeroField(mesh: THREE.Mesh): void {
    this.heroFields.push(mesh)
    mesh.visible = false
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
      uFocusAperture: { value: new THREE.Vector2() },
      uLensShift: { value: new THREE.Vector2() },
      uFilmView: { value: 0 },
      uSkyDepthEnabled: { value: false },
      uMacro: { value: false },
      uSkyDepth: { value: null as THREE.DepthTexture | null },
      uPaint: { value: 0 },
      uHero: { value: 0 },
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
    mesh.layers.set(layer === 0 || layer === deckGlintLayer || field?.hero ? layers.cameraOnly : layers.scene)
    const viewport = new THREE.Vector4()
    const offset = new THREE.Vector3()
    const inverse = new THREE.Quaternion()
    mesh.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getCurrentViewport(viewport)
      uniform.uViewport.value.set(viewport.z, viewport.w)
      uniform.uPhase.value = this.phase
      const s = this.sample
      uniform.uFilmView.value = s && camera === s.camera ? 1 : 0
      uniform.uSkyDepth.value = uniform.uFilmView.value && layer >= 0 && !field?.local ? this.skyDepth.capture(renderer) : null
      uniform.uSkyDepthEnabled.value = uniform.uSkyDepth.value !== null
      uniform.uMacro.value = this.paint && uniform.uFilmView.value > 0.5 && layer >= 0
      material.blendSrc = uniform.uMacro.value ? THREE.DstColorFactor : THREE.OneFactor
      uniform.uPaint.value = this.paint && uniform.uFilmView.value ? field?.paint ? 1 : layer === -1 ? 2 : 0 : 0
      uniform.uHero.value = this.hero && uniform.uFilmView.value ? field?.hero === 'media' ? 3 : field?.hero ? 2 : 1 : 0
      uniform.uAperture.value.set(0, 0)
      uniform.uFocusAperture.value.set(0, 0)
      uniform.uLensShift.value.set(0, 0)
      if (s && camera === s.camera) {
        uniform.uFocus.value = s.state.focusDistance
        uniform.uOpticalEye.value.copy(s.state.position)
        const radius = apertureRadius(s.state)
        uniform.uFocusAperture.value.set(radius / (config.lens.anamorphic ? 1.5 : 1), radius)
        if (s.sample.frame.tier !== 'final') {
          // The analytic footprint replaces aperture motion but keeps camera and pixel motion.
          uniform.uAperture.value.copy(uniform.uFocusAperture.value)
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
  const specs: { key: string; layer: number; density: number; fine: number; size: THREE.Vector3; fade: Fade; gain: number; local?: boolean; paint?: boolean; hero?: RibbonField['hero'] }[] = [
    { key: 'near', layer: 0, density: 8.5, fine: 5.2, size: new THREE.Vector3(9.4, 9.4, 9.4), fade: [0.63, 1.51, 3.25, 4.8], gain: 0.88 },
    { key: 'close', layer: 1, density: 8.15, fine: 4.8, size: new THREE.Vector3(21, 7.8, 21), fade: [2.55, 4.8, 8.1, 13.0], gain: 2.45 },
    { key: 'middle', layer: 2, density: 4.45, fine: 5.6, size: new THREE.Vector3(Math.min(deckSpan.x, 41), 11.6, Math.min(deckSpan.y, 40)), fade: [7.2, 11.25, 22, 31], gain: 6.4 },
    { key: 'distance', layer: 3, density: 0.56, fine: 5.1, size: new THREE.Vector3(Math.max(deckSpan.x, 96), 20.5, Math.max(deckSpan.y, 96)), fade: [17.4, 25, 43, 61], gain: 3.0 },
    { key: 'beam', layer: 1, density: 76, fine: 7.0, size: new THREE.Vector3(12, 3.2, 14), fade: [1.05, 2.15, 9, 13], gain: 2.45, local: true },
    { key: 'paint', layer: 0, density: 930, fine: 7.8, size: new THREE.Vector3(1.75, 2.15, 1.75), fade: [0.28, 0.45, 0.76, 0.92], gain: 0.92, paint: true },
    { key: 'beam-grain', layer: 1, density: 660, fine: 11, size: new THREE.Vector3(7.6, 1.65, 7.9), fade: [3.25, 4.55, 11.2, 15.8], gain: 1.08, local: true, hero: 'beam' },
    { key: 'media-grain', layer: 2, density: 81, fine: 11, size: new THREE.Vector3(12, 4.8, 7.6), fade: [6.1, 7.2, 10.4, 13.4], gain: 1.0, hero: 'media' },
  ]
  return specs.map(({ key, layer, density, fine, size, fade, gain, local, paint, hero }) => {
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
    const center = layer === 0 ? new THREE.Vector3()
      : local ? body.clone().add(new THREE.Vector3(0, size.y * 0.48, hero ? 5.15 : 0))
      : hero === 'media' ? body.clone().add(new THREE.Vector3(-2.65, size.y * 0.48, -2.55))
      : new THREE.Vector3(deckCenter.x, size.y * 0.48, deckCenter.y)
    const selection = layer > 0 ? new WorldRibbonSelection(drops, motion, size, center, [fade[0], fade[3]]) : undefined
    const geometry = selection?.geometry ?? (() => {
      const ribbons = makeRibbonGeometry(drops, motion)
      if (paint) view.registerPaintField(ribbons)
      return ribbons
    })()
    const mesh = view.makeMesh(lights, geometry, layer, { center, size, fade, gain, local, paint, hero, selection })
    if (hero) view.registerHeroField(mesh)
    mesh.name = `rain-${key}`
    return mesh
  })
}
