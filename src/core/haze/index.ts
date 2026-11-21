import * as THREE from 'three'
import { FullscreenPass, passMaterial } from '../fullscreen'
import { filmLightsGlsl, filmLightsShadowGlsl } from '../lights'
import type { StageDeps, StagePart } from '../parts'
import { streamSeed } from '../random'
import { createSignAir, signAirGlsl } from './signs'

export const atmosphere = {
  uniformExtinction: 0.0045,
  airHeight: 16.0,
  localAirRange: 44.0,
  deckExtinction: 0.052,
  layerHeight: 0.27,
  cityExtinction: 0.00054,
  cityLayerHeight: 170.0,
  cityFillRange: [475.0, 765.0],
  cityFillAltitude: [54.0, 108.0],
  cityFillUpperFraction: 0.23,
  cityFillAirlight: [0.185, 0.155, 0.196],
  outerCityStart: 610.0,
  outerCityExtinction: 0.00156,
  distantHaloStart: 80.0,
  cityHaloRange: 0.16,
  cityHaloLimits: [48.0, 218.0],
  cityHaloScatter: [65.0, 86.0],
  cloudStart: 615.0,
  cloudEnd: 1060.0,
  airlight: [0.028, 0.028, 0.033],
  cityAirlight: [0.020, 0.023, 0.029],
  outerCityAirlight: [0.050, 0.060, 0.079],
  anisotropy: 0.58,
  scatterFraction: 0.56,
  projectorAnisotropy: 0.76,
  projectorWingAnisotropy: 0.38,
  projectorWingFraction: 0.18,
  projectorScatterFraction: 0.38,
  projectorScatterDistance: [0.10, 0.28],
  projectorBodyAnisotropy: 0.38,
  projectorBodyScatterFraction: 0.05,
  projectorBodyDistance: [0.46, 1.38],
  projectorBodyClearance: [1.0, 2.3],
  projectorFocus: [1.28, 2.1],
  projectorAerosolHeight: 0.29,
  projectorSuspendedFraction: 0.24,
  projectorSuspendedWingAnisotropy: 0.34,
  projectorSuspendedWingFraction: 0.40,
  projectorSuspendedScatterFraction: 0.58,
  projectorSuspendedHeight: [0.13, 0.27, 0.50, 0.72],
  projectorSuspendedReach: [1.12, 2.48],
  projectorWakeFocus: [2.2, 3.12],
  projectorWakeReach: [0.96, 2.18],
  projectorWakeFraction: 0.27,
  projectorWakeSlope: [-0.062, -0.012, 0.17, 0.24],
  projectorWakeScatter: [0.53, 0.54],
  projectorCoreCosine: [0.987688, 0.997564],
  projectorCoreSpan: [0.12, 0.28, 1.40, 2.85],
  projectorCoreClearance: [0.045, 0.24],
  projectorCoreAnisotropy: 0.45,
  projectorCoreScatter: 0.92,
  projectorOffAxisLoss: 0.32,
  projectorOpeningFraction: 0.17,
  projectorOpeningAngle: [0.58, 0.86],
  projectorOpeningHeight: [-0.12, -0.045],
  projectorOpeningReach: [0.14, 0.32, 0.97, 1.40],
  projectorOpeningClearance: [0.10, 0.29],
  projectorDeckHitHeight: [0.022, 0.095],
  projectorDeckRaySlope: [0.119, 0.161],
  projectorDeckFacing: [0.22, 0.65],
  foregroundDeckScatterPath: [7.2, 8.7],
  projectorDeckScatterHeight: [0.30, 0.57],
  projectorDeckScatterLoss: 0.75,
  projectorDeckExtinctionLoss: 0.55,
  projectorDeckWingPath: [8.1, 10.5],
  projectorDeckWingView: [0.012, 0.026],
  projectorDeckWingReach: [0.40, 1.05],
  projectorDeckWingLoss: 0.92,
} as const

const cloudSeed = (streamSeed('haze/cloud-underlight') / 4294967296 * 64).toFixed(8)

const scattering = /* glsl */ `
uniform sampler2D sceneColor;
uniform sampler2D sceneDepth;
uniform sampler2D coarseHaze;
uniform ivec2 coarseResolution;
uniform mat4 inverseProjection;
uniform mat4 cameraWorld;
uniform vec4 deckBounds;
uniform int cloudLightIndex;
uniform int frontProjectorIndex;
uniform int hazeLightLimit;
uniform vec2 sampleJitter;
uniform float focusDistance;
uniform float farAirCameraFar;
uniform bool cameraWake;
in vec2 vUv;
out vec4 outColor;

${filmLightsGlsl}
${filmLightsShadowGlsl}

const float airDensity = ${atmosphere.uniformExtinction};
const float airHeight = ${atmosphere.airHeight.toFixed(1)};
const float localAirRange = ${atmosphere.localAirRange.toFixed(1)};
const float deckDensity = ${atmosphere.deckExtinction};
const float layerHeight = ${atmosphere.layerHeight};
const float cityDensity = ${atmosphere.cityExtinction};
const float cityLayerHeight = ${atmosphere.cityLayerHeight.toFixed(1)};
const vec2 cityFillRange = vec2(${atmosphere.cityFillRange.map((distance) => distance.toFixed(1)).join(', ')});
const vec2 cityFillAltitude = vec2(${atmosphere.cityFillAltitude.map((height) => height.toFixed(1)).join(', ')});
const float cityFillUpperFraction = ${atmosphere.cityFillUpperFraction};
const vec3 cityFillAirlight = vec3(${atmosphere.cityFillAirlight.join(', ')});
const float outerCityStart = ${atmosphere.outerCityStart.toFixed(1)};
const float outerCityDensity = ${atmosphere.outerCityExtinction};
const float distantHaloStart = ${atmosphere.distantHaloStart.toFixed(1)};
const float cityHaloRange = ${atmosphere.cityHaloRange};
const vec2 cityHaloLimits = vec2(${atmosphere.cityHaloLimits.map((range) => range.toFixed(1)).join(', ')});
const vec2 cityHaloScatter = vec2(${atmosphere.cityHaloScatter.map((gain) => gain.toFixed(1)).join(', ')});
const float cloudStart = ${atmosphere.cloudStart.toFixed(1)};
const float cloudEnd = ${atmosphere.cloudEnd.toFixed(1)};
const vec3 nearAirlight = vec3(${atmosphere.airlight.join(', ')});
const vec3 cityAirlight = vec3(${atmosphere.cityAirlight.join(', ')});
const vec3 outerCityAirlight = vec3(${atmosphere.outerCityAirlight.join(', ')});
const float anisotropy = ${atmosphere.anisotropy};
const float scatterFraction = ${atmosphere.scatterFraction};
const int steps = 8;

float bankCell(vec2 cell) {
  vec3 p = fract(vec3(cell.xyx) * 0.1031 + ${cloudSeed});
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float bankNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 t = fract(p);
  vec2 f = t * t * t * (t * (6.0 * t - 15.0) + 10.0);
  return mix(mix(bankCell(i), bankCell(i + vec2(1, 0)), f.x),
    mix(bankCell(i + vec2(0, 1)), bankCell(i + 1.0), f.x), f.y);
}

vec3 cloudGlow(vec3 origin, vec3 ray) {
  if (cloudLightIndex < 0 || ray.y < -0.015 || ray.y > 0.31) return vec3(0.0);
  vec4 source = filmLightColor[cloudLightIndex];
  vec2 axis = normalize((filmLightPosition[cloudLightIndex] - origin).xz);
  float side = smoothstep(0.65, 0.93, dot(ray.xz, axis));
  if (side <= 0.0) return vec3(0.0);
  float across = dot(ray.xz, vec2(-axis.y, axis.x));
  vec2 p = vec2(across * 9.6, ray.y * 12.0);
  float bank = bankNoise(p * 0.68);
  float rolls = bankNoise(p * 1.51 + vec2(1.28 * bank, 2.13));
  float cover = smoothstep(0.24, 0.78, 0.66 * bank + 0.34 * rolls);
  float lateral = 1.0 - smoothstep(0.04, 0.22, abs(across + 0.11));
  float underside = (ray.y - 0.131 - 0.040 * (bank - 0.5)) / 0.105;
  float altitude = smoothstep(-0.015, 0.055, ray.y) * (1.0 - smoothstep(0.185, 0.31, ray.y));
  vec3 irradiance = source.rgb / max(source.a * source.a, 1.0);
  vec3 underlight = mix(irradiance, irradiance.rrr, 0.16) * vec3(1.16, 1.15, 0.72);
  return underlight * (side * lateral * altitude * (10.0 + 56.0 * cover * exp(-underside * underside)));
}

float phase(float cosine, float g) {
  float a = 1.0 + g * g - 2.0 * g * clamp(cosine, -1.0, 1.0);
  return 0.07957747 * (1.0 - g * g) / (a * sqrt(a));
}

float projectorPhase(float cosine) {
  return mix(phase(cosine, ${atmosphere.projectorAnisotropy}),
    phase(cosine, ${atmosphere.projectorWingAnisotropy}), ${atmosphere.projectorWingFraction});
}

float projectorSuspendedPhase(float cosine) {
  return mix(phase(cosine, ${atmosphere.projectorAnisotropy}),
    phase(cosine, ${atmosphere.projectorSuspendedWingAnisotropy}), ${atmosphere.projectorSuspendedWingFraction});
}

float projectorBodyPhase(float cosine, float distanceToLight, float downward, float clearance) {
  float spread = smoothstep(-0.04, 0.44, cosine) * (1.0 - smoothstep(0.91, 0.99, cosine));
  float body = smoothstep(${atmosphere.projectorBodyDistance.join(', ')}, distanceToLight);
  float lower = smoothstep(0.012, 0.097, downward);
  float open = smoothstep(${atmosphere.projectorBodyClearance.map((edge) => edge.toFixed(2)).join(', ')}, clearance);
  return phase(cosine, ${atmosphere.projectorBodyAnisotropy}) * ${atmosphere.projectorBodyScatterFraction}
    * body * spread * lower * open;
}

float projectorReceiver(vec3 hit, vec3 source, vec3 axis) {
  vec3 delta = hit - source;
  float nearBody = 1.0 - smoothstep(1.6, 2.35, length(delta));
  float noseDepth = 1.0 - smoothstep(0.31, 0.83, dot(delta, axis));
  float aboveDeck = smoothstep(0.022, 0.092, hit.y);
  return 1.0 - nearBody * noseDepth * aboveDeck;
}

vec2 projectorDensities(float t, float height, float distanceToLight, float wakeGain) {
  float h = max(0.0, height);
  float taper = 1.0 - exp(-h / ${atmosphere.projectorAerosolHeight});
  float air = airDensity * exp(-h / airHeight) * taper * taper * taper * taper;
  float suspended = smoothstep(${atmosphere.projectorSuspendedHeight.slice(0, 2).join(', ')}, h)
    * (1.0 - smoothstep(${atmosphere.projectorSuspendedHeight.slice(2).join(', ')}, h));
  vec2 reach = mix(vec2(${atmosphere.projectorSuspendedReach.join(', ')}),
    vec2(${atmosphere.projectorWakeReach.join(', ')}), wakeGain);
  float near = 1.0 - smoothstep(reach.x, reach.y, distanceToLight);
  float wake = mix(${atmosphere.projectorSuspendedFraction}, ${atmosphere.projectorWakeFraction}, wakeGain)
    * deckDensity * exp(-h / layerHeight) * suspended * near;
  return vec2(air, wake) * (1.0 - step(localAirRange, t));
}

float foregroundScatter(float t) {
  float closeFocus = 1.0 - smoothstep(0.8, 3.0, focusDistance);
  float foreground = 1.0 - smoothstep(0.06, clamp(focusDistance * 1.15, 0.12, 1.6), t);
  return 1.0 - 0.85 * closeFocus * foreground;
}

vec2 deckInterval(vec3 origin, vec3 ray) {
  vec2 d = ray.xz;
  vec2 inv = sign(d + 1e-12) / max(abs(d), vec2(1e-6));
  vec2 a = (deckBounds.xy - origin.xz) * inv;
  vec2 b = (deckBounds.zw - origin.xz) * inv;
  vec2 lo = min(a, b);
  vec2 hi = max(a, b);
  return vec2(max(0.0, max(lo.x, lo.y)), min(hi.x, hi.y));
}

vec2 layerInterval(vec3 origin, vec3 ray, vec2 interval) {
  float start = interval.x;
  float end = interval.y;
  if (ray.y > 1e-6) start = max(start, -origin.y / ray.y);
  else if (ray.y < -1e-6) end = min(end, -origin.y / ray.y);
  else if (origin.y < 0.0) end = -1.0;
  return vec2(start, end);
}

float layerOpticalDepth(float y, float dy, vec2 layer, float t) {
  float start = layer.x;
  float end = min(t, layer.y);
  if (end <= start) return 0.0;
  float a = exp(-max(0.0, y + dy * start) / layerHeight);
  float b = exp(-max(0.0, y + dy * end) / layerHeight);
  if (abs((end - start) * dy) < 0.003) return deckDensity * (end - start) * 0.5 * (a + b);
  return deckDensity * layerHeight * (a - b) / dy;
}

float heightOpticalDepth(float y, float dy, float distance, float density, float height) {
  float end = y + dy * distance;
  float lo = min(y, end);
  float hi = max(y, end);
  if (hi <= 0.0) return density * distance;
  if (hi - lo < 0.003) return density * distance * exp(-max(0.0, 0.5 * (lo + hi)) / height);
  float a = exp(-max(0.0, lo) / height);
  float b = exp(-hi / height);
  return density * (max(0.0, -lo) + height * (a - b)) / abs(dy);
}

vec2 cityOpticalLayers(vec3 origin, vec3 ray, float start, float end) {
  if (end <= start) return vec2(0.0);
  float innerDepth = heightOpticalDepth(origin.y + ray.y * start, ray.y, end - start, cityDensity, cityLayerHeight);
  float outer = max(start, outerCityStart);
  float outerDepth = end > outer ? heightOpticalDepth(origin.y + ray.y * outer, ray.y, end - outer, outerCityDensity, cityLayerHeight) : 0.0;
  return vec2(innerDepth, outerDepth);
}

float cityOpticalDepth(vec3 origin, vec3 ray, float start, float end) {
  vec2 layers = cityOpticalLayers(origin, ray, start, end);
  return layers.x + layers.y;
}

vec3 cityRadiance(vec3 origin, vec3 ray, float cityStart, float far, vec2 layers) {
  if (layers.x + layers.y <= 1e-6) return vec3(0.0);
  vec2 transmission = exp(-layers);
  vec3 radiance = cityAirlight * (1.0 - transmission.x)
    + transmission.x * outerCityAirlight * (1.0 - transmission.y);
  float fillEntry = max(cityStart, cityFillRange.x);
  float fillExit = min(far, cityFillRange.y);
  if (fillExit > fillEntry) {
    float fillNear = cityOpticalDepth(origin, ray, cityStart, fillEntry);
    float fillFar = cityOpticalDepth(origin, ray, cityStart, fillExit);
    float fillAltitude = origin.y + ray.y * 0.5 * (cityFillRange.x + cityFillRange.y);
    float fillLight = mix(1.0, cityFillUpperFraction, smoothstep(cityFillAltitude.x, cityFillAltitude.y, fillAltitude));
    radiance += cityFillAirlight * fillLight * (exp(-fillNear) - exp(-fillFar));
  }
  float entry = max(cityStart, cloudStart);
  float exit = min(far, cloudEnd);
  if (exit > entry) {
    float beforeCloud = cityOpticalDepth(origin, ray, cityStart, entry);
    float cloudDepth = cityOpticalDepth(origin, ray, entry, exit);
    radiance += exp(-beforeCloud) * cloudGlow(origin, ray) * (1.0 - exp(-cloudDepth));
  }
  return radiance;
}

vec3 distantSourceScatter(vec3 origin, vec3 ray, float far, float cityStart, float nearDepth, vec4 source, float radius, float along, float perp2) {
  float reach = clamp(cityHaloRange * source.a + radius, cityHaloLimits.x, cityHaloLimits.y);
  float reach2 = reach * reach;
  if (perp2 >= reach2) return vec3(0.0);
  float interval = sqrt(reach2 - perp2);
  float entry = max(cityStart, along - interval);
  float exit = min(far, along + 0.35 * interval);
  if (exit <= entry) return vec3(0.0);
  float envelope = 1.0 - smoothstep(0.07, 1.0, perp2 / reach2);
  float before = nearDepth + cityOpticalDepth(origin, ray, cityStart, entry);
  float depth = cityOpticalDepth(origin, ray, entry, exit);
  vec3 irradiance = source.rgb / max(source.a * source.a, 1.0);
  float peak = max(irradiance.r, max(irradiance.g, irradiance.b));
  float warm = smoothstep(0.12, 0.68, (irradiance.r - irradiance.b) / max(peak, 1e-6));
  vec3 diffuse = mix(irradiance, vec3(peak), mix(0.07, 0.16, warm));
  return diffuse * mix(cityHaloScatter.x, cityHaloScatter.y, warm) * envelope * exp(-before) * (1.0 - exp(-depth));
}

float densityAt(float t, float y, vec2 layer, float cityStart) {
  float h = max(y, 0.0);
  float density = t < localAirRange ? airDensity * exp(-h / airHeight) : 0.0;
  if (t > layer.x && t < layer.y) density += deckDensity * exp(-h / layerHeight);
  if (t > cityStart) density += (cityDensity + step(outerCityStart, t) * outerCityDensity) * exp(-h / cityLayerHeight);
  return density;
}

#ifdef SIGN_AIR
${signAirGlsl}
#endif

vec2 clipCone(vec2 segment, vec3 eyeFromLight, vec3 ray, vec3 axis, float cutoff) {
  float axialOrigin = dot(eyeFromLight, axis);
  float axialRay = dot(ray, axis);
  if (abs(axialRay) < 1e-6) {
    if (axialOrigin <= 0.0) return vec2(1.0, 0.0);
  } else if (axialRay > 0.0) {
    segment.x = max(segment.x, -axialOrigin / axialRay);
  } else {
    segment.y = min(segment.y, -axialOrigin / axialRay);
  }
  float k = cutoff * cutoff;
  float a = axialRay * axialRay - k;
  float b = axialOrigin * axialRay - k * dot(eyeFromLight, ray);
  float c = axialOrigin * axialOrigin - k * dot(eyeFromLight, eyeFromLight);
  if (abs(a) < 1e-6) {
    if (abs(b) < 1e-6) return c >= 0.0 ? segment : vec2(1.0, 0.0);
    if (b > 0.0) segment.x = max(segment.x, -0.5 * c / b);
    else segment.y = min(segment.y, -0.5 * c / b);
    return segment;
  }
  float discriminant = b * b - a * c;
  if (discriminant < 0.0) return a > 0.0 ? segment : vec2(1.0, 0.0);
  float r = sqrt(max(discriminant, 0.0));
  float root1 = (-b - r) / a;
  float root2 = (-b + r) / a;
  vec2 roots = vec2(min(root1, root2), max(root1, root2));
  if (a < 0.0) return vec2(max(segment.x, roots.x), min(segment.y, roots.y));
  if (axialRay > 0.0) segment.x = max(segment.x, roots.y);
  else segment.y = min(segment.y, roots.x);
  return segment;
}

float deckHitWeight(vec3 hit) {
  if (any(lessThan(hit.xz, deckBounds.xy)) || any(greaterThan(hit.xz, deckBounds.zw))) return 0.0;
  return 1.0 - smoothstep(${atmosphere.projectorDeckHitHeight.join(', ')}, abs(hit.y));
}

vec2 frontDeckWeights(vec3 hit, vec3 ray, float distance, float wakeGain) {
  if (wakeGain <= 0.0 || frontProjectorIndex < 0 || frontProjectorIndex >= filmLightCount) return vec2(0.0);
  if (filmLightShape[frontProjectorIndex].w < 0.5) return vec2(0.0);
  float frontView = smoothstep(${atmosphere.projectorDeckFacing.join(', ')}, dot(-ray, filmLightAxis[frontProjectorIndex].xyz));
  float deck = deckHitWeight(hit) * frontView * wakeGain;
  float slope = smoothstep(${atmosphere.projectorDeckRaySlope.join(', ')}, -ray.y);
  float localPath = 1.0 - smoothstep(${atmosphere.foregroundDeckScatterPath.join(', ')}, distance);
  return deck * vec2(slope, max(slope, localPath));
}

vec4 scatterToDepth(vec2 uv, float depth) {
  vec4 eye = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 eyePoint = eye.xyz / eye.w;
  float far = length(eyePoint);
  vec3 ray = mat3(cameraWorld) * (eyePoint / far);
  vec3 origin = cameraWorld[3].xyz;
  vec3 hit = origin + far * ray;
  float wakeGain = cameraWake ? smoothstep(${atmosphere.projectorWakeFocus.join(', ')}, focusDistance) : 0.0;
  vec2 frontDeck = frontDeckWeights(hit, ray, far, wakeGain);
  #ifdef SIGN_AIR
  float farDeck = deckHitWeight(hit) * smoothstep(${atmosphere.projectorDeckWingPath.join(', ')}, far) * wakeGain;
  #endif
  // The short deck path hands off scatter to Air without changing extinction.
  float localScatterWeight = 1.0 - frontDeck.y;
  float deckAir = 1.0 - ${atmosphere.projectorDeckExtinctionLoss} * frontDeck.x;
  vec2 footprint = deckInterval(origin, ray);
  vec2 layer = layerInterval(origin, ray, footprint);
  float layerDepth = deckAir * layerOpticalDepth(origin.y, ray.y, layer, far);
  float cityStart = footprint.y >= footprint.x ? max(localAirRange, footprint.y) : localAirRange;
  float airDepth = heightOpticalDepth(origin.y, ray.y, min(far, localAirRange), airDensity, airHeight);
  vec2 cityLayers = cityOpticalLayers(origin, ray, cityStart, far);
  float cityDepth = cityLayers.x + cityLayers.y;
  float transmission = exp(-airDepth - layerDepth - cityDepth);
  vec3 airlight = nearAirlight * (1.0 - exp(-airDepth));
  airlight += exp(-airDepth - layerDepth) * cityRadiance(origin, ray, cityStart, far, cityLayers);
  vec3 radiance = airlight * foregroundScatter(far * 0.5);
  #ifdef SIGN_AIR
  radiance += scatterSigns(origin, ray, far, cityStart, layerDepth);
  #endif
  vec2 pixel = floor(uv * vec2(textureSize(sceneDepth, 0)));
  float pixelNoise = fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < MAX_FILM_LIGHTS; i++) {
    if (i >= filmLightCount || (hazeLightLimit >= 0 && i >= hazeLightLimit)) break;
    vec4 color = filmLightColor[i];
    if (max(color.r, max(color.g, color.b)) < 1e-5) continue;
    vec3 toSource = filmLightPosition[i] - origin;
    float along = dot(toSource, ray);
    vec3 perp = toSource - along * ray;
    float perp2 = dot(perp, perp);
    float reach2 = color.a * color.a - perp2;
    if (reach2 <= 0.0) continue;
    float reach = sqrt(reach2);
    vec2 segment = vec2(max(0.0, along - reach), min(far, along + reach));
    if (segment.y <= segment.x) continue;
    vec4 shape = filmLightShape[i];
    vec4 axis = filmLightAxis[i];
    bool beam = shape.z > 0.5;
    bool projector = shape.w > 0.5;
    bool spot = axis.w > -0.5 && shape.x >= 0.0;
    if (!beam) {
      vec2 glowSegment = spot ? clipCone(segment, -toSource, ray, axis.xyz, axis.w) : segment;
      bool distantArea = shape.x < 0.0 && axis.w > -0.5 && dot(toSource, toSource) > distantHaloStart * distantHaloStart;
      float haloEnvelope = 1.0;
      if (distantArea) {
        radiance += distantSourceScatter(origin, ray, far, cityStart, airDepth + layerDepth, color, shape.y, along, perp2);
        const float haloEdge = 4.2;
        float haloReach = haloEdge * shape.y;
        float haloReach2 = haloReach * haloReach - perp2;
        if (haloReach2 <= 0.0) continue;
        float halfPath = sqrt(haloReach2);
        glowSegment = vec2(max(glowSegment.x, along - halfPath), min(glowSegment.y, along + halfPath));
        haloEnvelope = 1.0 - smoothstep(2.4, haloEdge, sqrt(perp2) / shape.y);
      }
      if (glowSegment.y <= glowSegment.x) continue;
      float glowRadius = sqrt(perp2 + shape.y * shape.y);
      float glowStart = atan((glowSegment.x - along) / glowRadius);
      float glowEnd = atan((glowSegment.y - along) / glowRadius);
      float tGlow = clamp(along + glowRadius * tan(0.5 * (glowStart + glowEnd)), glowSegment.x, glowSegment.y);
      vec3 glowDirection = toSource - tGlow * ray;
      float sourceDistance = length(glowDirection);
      float glowDistance = max(sourceDistance, shape.y);
      vec3 glowRay = glowDirection / max(sourceDistance, 1e-4);
      vec3 glowPoint = origin + tGlow * ray;
      float r = glowDistance / color.a;
      float falloff = max(0.0, 1.0 - r * r * r * r);
      float sourceDepth = distantArea
        ? heightOpticalDepth(glowPoint.y, glowRay.y, sourceDistance, cityDensity, cityLayerHeight)
        : heightOpticalDepth(glowPoint.y, glowRay.y, glowDistance, airDensity, airHeight);
      float glowDepth = heightOpticalDepth(origin.y, ray.y, min(tGlow, localAirRange), airDensity, airHeight)
        + sourceDepth
        + deckAir * layerOpticalDepth(origin.y, ray.y, layer, tGlow) + cityOpticalDepth(origin, ray, cityStart, tGlow);
      float angular = spot ? filmAngularFalloff(i, glowRay) * filmLightVisibility(i, glowPoint)
        : (axis.w < -0.5 ? 1.0 : 0.28 + 0.72 * max(0.0, dot(-glowDirection / glowDistance, axis.xyz)));
      float glow = haloEnvelope * (glowEnd - glowStart) / glowRadius;
      float strength = spot ? 0.36 : 0.72;
      if (shape.x < 0.0 && axis.w > -0.5) {
        float sourceChroma = 1.0 - min(color.r, min(color.g, color.b)) / max(color.r, max(color.g, color.b));
        float close = 1.0 - smoothstep(1.0, 3.0, sourceDistance / shape.y);
        strength *= 1.0 + 1.1 * sourceChroma * close;
      }
      radiance += (distantArea ? 1.0 : localScatterWeight) * color.rgb * glow * angular * exp(-glowDepth) * falloff * falloff * strength
        * densityAt(tGlow, glowPoint.y, layer, cityStart) * phase(dot(ray, glowDirection) / glowDistance, anisotropy) * foregroundScatter(tGlow);
      continue;
    }

    if (axis.w > -0.5) segment = clipCone(segment, -toSource, ray, axis.xyz, axis.w);
    if (segment.y <= segment.x) continue;
    float projectorGain = projector
      ? smoothstep(${atmosphere.projectorFocus.join(', ')}, focusDistance)
      : 1.0;
    if (projectorGain < 1e-4) continue;
    float receiver = projector ? projectorReceiver(hit, filmLightPosition[i], axis.xyz) : 1.0;
    float opening = projector && wakeGain > 0.0 ? ${atmosphere.projectorOpeningFraction} * wakeGain
      * (1.0 - smoothstep(${atmosphere.projectorOpeningHeight.join(', ')}, hit.y - filmLightPosition[i].y))
      * smoothstep(${atmosphere.projectorOpeningAngle.join(', ')}, dot(-ray, axis.xyz)) : 0.0;
    #ifdef SIGN_AIR
    float deckWingLoss = 0.0;
    if (projector && farDeck > 0.0) {
      // Protect the shaft in the plane through the lens and the emitter axis.
      vec3 plane = cross(toSource, axis.xyz);
      float separation = abs(dot(plane, ray)) * inversesqrt(max(dot(plane, plane), 1e-6));
      float outside = smoothstep(${atmosphere.projectorDeckWingView.join(', ')}, separation);
      float facing = smoothstep(${atmosphere.projectorDeckFacing.join(', ')}, dot(-ray, axis.xyz));
      deckWingLoss = ${atmosphere.projectorDeckWingLoss} * farDeck * outside * facing;
    }
    #endif
    float beamRadius = sqrt(perp2 + min(shape.y * shape.y, 0.01));
    float theta0 = atan((segment.x - along) / beamRadius);
    float theta1 = atan((segment.y - along) / beamRadius);
    float stepAngle = (theta1 - theta0) / float(steps);
    float offset = fract(sampleJitter.x + pixelNoise + float(i) * 0.618034);
    vec3 up = projector ? normalize(vec3(0.0, 1.0, 0.0) - axis.xyz * axis.y) : vec3(0.0, 1.0, 0.0);
    for (int j = 0; j < steps; j++) {
      float angle = theta0 + (float(j) + offset) * stepAngle;
      float tangent = tan(angle);
      float t = clamp(along + beamRadius * tangent, segment.x, segment.y);
      vec3 p = origin + t * ray;
      vec3 toLight;
      vec3 light = filmLightAt(i, p, toLight);
      if (max(light.r, max(light.g, light.b)) < 1e-6) continue;
      float visible = filmLightVisibility(i, p);
      if (visible < 0.01) continue;
      float weight = beamRadius * (1.0 + tangent * tangent) * stepAngle;
      float distanceToLight = length(filmLightPosition[i] - p);
      float opticalDepth = heightOpticalDepth(origin.y, ray.y, min(t, localAirRange), airDensity, airHeight)
        + heightOpticalDepth(p.y, toLight.y, distanceToLight, airDensity, airHeight)
        + deckAir * layerOpticalDepth(origin.y, ray.y, layer, t) + cityOpticalDepth(origin, ray, cityStart, t);
      float cosine = dot(ray, toLight);
      float inScatter;
      float receive = receiver;
      if (projector) {
        float onset = smoothstep(${atmosphere.projectorScatterDistance.join(', ')}, distanceToLight);
        float slope = dot(toLight, up);
        float clearance = far - t;
        float body = projectorBodyPhase(cosine, distanceToLight, slope, clearance);
        float middle = smoothstep(${atmosphere.projectorWakeSlope.slice(0, 2).join(', ')}, slope)
          * (1.0 - smoothstep(${atmosphere.projectorWakeSlope.slice(2).join(', ')}, slope));
        float wing = mix(${atmosphere.projectorSuspendedScatterFraction},
          ${atmosphere.projectorWakeScatter[0]} + ${atmosphere.projectorWakeScatter[1]} * middle, wakeGain);
        vec2 densities = projectorDensities(t, p.y, distanceToLight, wakeGain);
        inScatter = dot(densities, vec2(
          projectorPhase(cosine) * ${atmosphere.projectorScatterFraction},
          projectorSuspendedPhase(cosine) * wing
        ) * onset + body);
        inScatter *= 1.0 - ${atmosphere.projectorDeckScatterLoss} * frontDeck.y
          * (1.0 - smoothstep(${atmosphere.projectorDeckScatterHeight.join(', ')}, p.y));
        if (wakeGain > 0.0 && frontDeck.y < 1.0) {
          float beamCore = smoothstep(${atmosphere.projectorCoreCosine.join(', ')}, dot(-toLight, axis.xyz));
          float beamSpan = smoothstep(${atmosphere.projectorCoreSpan.slice(0, 2).join(', ')}, distanceToLight)
            * (1.0 - smoothstep(${atmosphere.projectorCoreSpan.slice(2).join(', ')}, distanceToLight));
          float coreWeight = beamSpan * smoothstep(${atmosphere.projectorCoreClearance.join(', ')}, clearance)
            * (1.0 - frontDeck.y) * wakeGain;
          inScatter += coreWeight * (${atmosphere.projectorCoreScatter} * beamCore
            * phase(cosine, ${atmosphere.projectorCoreAnisotropy}) * (densities.x + densities.y)
            - ${atmosphere.projectorOffAxisLoss} * (1.0 - beamCore) * inScatter);
        }
        #ifdef SIGN_AIR
        inScatter *= 1.0 - deckWingLoss * smoothstep(${atmosphere.projectorDeckWingReach.join(', ')}, distanceToLight);
        #endif
        if (opening > 0.0) {
          float span = smoothstep(${atmosphere.projectorOpeningReach.slice(0, 2).join(', ')}, distanceToLight)
            * (1.0 - smoothstep(${atmosphere.projectorOpeningReach.slice(2).join(', ')}, distanceToLight));
          receive = mix(receiver, 1.0, opening * span * smoothstep(${atmosphere.projectorOpeningClearance.join(', ')}, clearance));
        }
      } else {
        inScatter = localScatterWeight * densityAt(t, p.y, layer, cityStart) * phase(cosine, anisotropy) * scatterFraction;
      }
      radiance += light * (visible * weight * inScatter * receive
        * exp(-opticalDepth) * foregroundScatter(t) * projectorGain);
    }
  }
  return vec4(radiance, transmission);
}
`

const cameraScattering = '#define SIGN_AIR\n' + scattering

const integrate = cameraScattering + /* glsl */ `
void main() {
  ivec2 size = textureSize(sceneDepth, 0);
  ivec2 pixel = ((ivec2(gl_FragCoord.xy) * 2 + 1) * size) / (2 * coarseResolution);
  float depth = texelFetch(sceneDepth, pixel, 0).r;
  outColor = scatterToDepth((vec2(pixel) + 0.5) / vec2(size), depth);
}
`

const composite = cameraScattering + /* glsl */ `
float eyeDepth(float d) {
  return 1.0 / (inverseProjection[2].w * (d * 2.0 - 1.0) + inverseProjection[3].w);
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  ivec2 fineSize = textureSize(sceneDepth, 0);
  ivec2 coarseSize = textureSize(coarseHaze, 0);
  vec2 at = vUv * vec2(coarseSize) - 0.5;
  vec2 f = fract(at);
  ivec2 q = ivec2(floor(at));
  float depth = texelFetch(sceneDepth, pixel, 0).r;
  float z = eyeDepth(depth);
  vec4 total = vec4(0.0);
  float totalWeight = 0.0;
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      ivec2 t = clamp(q + ivec2(x, y), ivec2(0), coarseSize - 1);
      ivec2 p = ((t * 2 + 1) * fineSize) / (2 * coarseSize);
      float tapZ = eyeDepth(texelFetch(sceneDepth, p, 0).r);
      float w = (x == 0 ? 1.0 - f.x : f.x) * (y == 0 ? 1.0 - f.y : f.y);
      w *= 1.0 - smoothstep(0.009, 0.055, abs(tapZ - z) / max(z, 0.5));
      total += texelFetch(coarseHaze, t, 0) * w;
      totalWeight += w;
    }
  }
  vec4 fog = totalWeight > 0.08 ? total / totalWeight : scatterToDepth(vUv, depth);
  vec4 scene = texelFetch(sceneColor, pixel, 0);
  outColor = vec4(scene.rgb * fog.a + fog.rgb, scene.a);
}
`

type HazeDomain = {
  rig: StageDeps['rig']
  world: Pick<StageDeps['world'], 'lights'> & { deck: Pick<StageDeps['world']['deck'], 'bounds'> }
}

function hazeUniforms({ rig, world }: HazeDomain, texture: THREE.Texture | null) {
  const { min, max } = world.deck.bounds
  return {
    ...rig.uniforms,
    ...rig.shadowUniforms,
    sceneColor: { value: null as THREE.Texture | null },
    sceneDepth: { value: null as THREE.Texture | null },
    coarseHaze: { value: texture },
    coarseResolution: { value: new THREE.Vector2(1, 1) },
    inverseProjection: { value: new THREE.Matrix4() },
    cameraWorld: { value: new THREE.Matrix4() },
    deckBounds: { value: new THREE.Vector4(min.x, min.y, max.x, max.y) },
    cloudLightIndex: { value: world.lights?.findIndex((light) => light.id === 'magenta violet tower screen') ?? -1 },
    frontProjectorIndex: { value: -1 },
    hazeLightLimit: { value: -1 },
    sampleJitter: { value: new THREE.Vector2() },
    focusDistance: { value: 1 },
    farAirCameraFar: { value: 1 },
    cameraWake: { value: false },
  }
}

const captureComposite = scattering + /* glsl */ `
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  float depth = texelFetch(sceneDepth, pixel, 0).r;
  vec4 fog = scatterToDepth(vUv, depth);
  vec4 scene = texelFetch(sceneColor, pixel, 0);
  outColor = vec4(scene.rgb * fog.a + fog.rgb, scene.a);
}
`

const farAirComposite = scattering + /* glsl */ `
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 scene = texelFetch(sceneColor, pixel, 0);
  float depth = texelFetch(sceneDepth, pixel, 0).r;
  vec4 eye = inverseProjection * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  float eyeLength = length(eye.xyz);
  vec3 ray = mat3(cameraWorld) * (eye.xyz / eyeLength);
  float far = depth < 1.0 && eye.w > 0.0 ? eyeLength / eye.w : farAirCameraFar * eyeLength / -eye.z;
  vec3 origin = cameraWorld[3].xyz;
  vec2 footprint = deckInterval(origin, ray);
  float cityStart = footprint.y >= footprint.x ? max(localAirRange, footprint.y) : localAirRange;
  if (origin.y < 0.0) cityStart = max(cityStart, ray.y > 0.0 ? -origin.y / ray.y : far);
  if (far <= cityStart) {
    outColor = scene;
    return;
  }
  vec2 layers = cityOpticalLayers(origin, ray, cityStart, far);
  vec3 radiance = cityRadiance(origin, ray, cityStart, far, layers);
  for (int i = 0; i < MAX_FILM_LIGHTS; i++) {
    if (i >= filmLightCount || (hazeLightLimit >= 0 && i >= hazeLightLimit)) break;
    vec4 shape = filmLightShape[i];
    if (shape.z > 0.5 || shape.x >= 0.0 || filmLightAxis[i].w <= -0.5) continue;
    vec4 color = filmLightColor[i];
    if (max(color.r, max(color.g, color.b)) < 1e-5) continue;
    vec3 toSource = filmLightPosition[i] - origin;
    if (dot(toSource, toSource) <= distantHaloStart * distantHaloStart) continue;
    float along = dot(toSource, ray);
    vec3 perp = toSource - along * ray;
    float perp2 = dot(perp, perp);
    if (perp2 >= color.a * color.a) continue;
    radiance += distantSourceScatter(origin, ray, far, cityStart, 0.0, color, shape.y, along, perp2);
  }
  outColor = vec4(scene.rgb * exp(-layers.x - layers.y) + radiance, scene.a);
}
`

export function createHazeCapture(domain: HazeDomain) {
  const uniforms = hazeUniforms(domain, null)
  uniforms.focusDistance.value = 6
  uniforms.sampleJitter.value.set(.5, .5)
  const eye = new THREE.Camera()
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), passMaterial(captureComposite, uniforms, { blending: THREE.NoBlending }))
  mesh.frustumCulled = false
  const farAirPass = new FullscreenPass(passMaterial(farAirComposite, uniforms, { blending: THREE.NoBlending }))
  return {
    render(renderer: THREE.WebGLRenderer, source: THREE.WebGLRenderTarget, output: THREE.WebGLCubeRenderTarget,
      face: number, camera: THREE.PerspectiveCamera, includeVehicleLights: boolean) {
      const { min, max } = domain.world.deck.bounds
      uniforms.deckBounds.value.set(min.x, min.y, max.x, max.y)
      uniforms.sceneColor.value = source.texture
      uniforms.sceneDepth.value = source.depthTexture
      uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse)
      uniforms.cameraWorld.value.copy(camera.matrixWorld)
      uniforms.hazeLightLimit.value = includeVehicleLights ? -1 : domain.world.lights.length
      domain.rig.syncShadowUniforms()
      renderer.setRenderTarget(output, face)
      renderer.render(mesh, eye)
    },
    renderFarAir(renderer: THREE.WebGLRenderer, source: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget,
      camera: THREE.PerspectiveCamera) {
      const { min, max } = domain.world.deck.bounds
      uniforms.deckBounds.value.set(min.x, min.y, max.x, max.y)
      uniforms.sceneColor.value = source.texture
      uniforms.sceneDepth.value = source.depthTexture
      uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse)
      uniforms.cameraWorld.value.copy(camera.matrixWorld)
      uniforms.farAirCameraFar.value = camera.far
      uniforms.hazeLightLimit.value = domain.world.lights.length
      farAirPass.render(renderer, output)
    },
  }
}

export type HazeCapture = ReturnType<typeof createHazeCapture>

export function createHaze({ rig, world }: HazeDomain & { world: { root?: THREE.Object3D } }): StagePart {
  const coarse = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  })
  const signs = createSignAir(world.root)
  const uniforms = { ...hazeUniforms({ rig, world }, coarse.texture), ...signs.uniforms }
  uniforms.cameraWake.value = true
  // The rig places the vehicle projectors directly after the world lights.
  uniforms.frontProjectorIndex.value = world.lights?.length ?? -1
  const integratePass = new FullscreenPass(passMaterial(integrate, uniforms, { blending: THREE.NoBlending }))
  const compositePass = new FullscreenPass(passMaterial(composite, uniforms, { blending: THREE.NoBlending }))
  return {
    resize({ width, height }) {
      coarse.setSize(Math.ceil(width / 2), Math.ceil(height / 2))
      uniforms.coarseResolution.value.set(coarse.width, coarse.height)
    },
    samplePasses: [{
      id: 'haze',
      render(renderer, input, output, { camera, sample, state }) {
        rig.syncShadowUniforms()
        uniforms.sceneColor.value = input.color
        uniforms.sceneDepth.value = input.depth
        uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse)
        uniforms.cameraWorld.value.copy(camera.matrixWorld)
        const { min, max } = world.deck.bounds
        uniforms.deckBounds.value.set(min.x, min.y, max.x, max.y)
        uniforms.sampleJitter.value.set(...sample.misc)
        uniforms.focusDistance.value = state.focusDistance
        signs.update(camera)
        integratePass.render(renderer, coarse)
        compositePass.render(renderer, output)
      },
    }],
  }
}
