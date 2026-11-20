import * as THREE from 'three'
import { FullscreenPass, passMaterial } from '../fullscreen'
import { filmLightsGlsl, filmLightsShadowGlsl } from '../lights'
import type { StageDeps, StagePart } from '../parts'

export const atmosphere = {
  uniformExtinction: 0.0045,
  deckExtinction: 0.052,
  layerHeight: 0.27,
  anisotropy: 0.58,
  scatterFraction: 0.56,
  projectorAnisotropy: 0.76,
  projectorWingAnisotropy: 0.28,
  projectorWingFraction: 0.07,
  projectorScatterFraction: 0.24,
  projectorBodyAnisotropy: 0.38,
  projectorBodyScatterFraction: 0.59,
  projectorBodyDistance: [0.46, 1.38],
  projectorBodyClearance: [1.0, 2.3],
  projectorFocus: [1.28, 2.1],
} as const

const scattering = /* glsl */ `
uniform sampler2D sceneColor;
uniform sampler2D sceneDepth;
uniform sampler2D coarseHaze;
uniform ivec2 coarseResolution;
uniform mat4 inverseProjection;
uniform mat4 cameraWorld;
uniform vec4 deckBounds;
uniform vec2 sampleJitter;
uniform float focusDistance;
in vec2 vUv;
out vec4 outColor;

${filmLightsGlsl}
${filmLightsShadowGlsl}

const float airDensity = ${atmosphere.uniformExtinction};
const float deckDensity = ${atmosphere.deckExtinction};
const float layerHeight = ${atmosphere.layerHeight};
const float anisotropy = ${atmosphere.anisotropy};
const float scatterFraction = ${atmosphere.scatterFraction};
const int steps = 8;

float phase(float cosine, float g) {
  float a = 1.0 + g * g - 2.0 * g * clamp(cosine, -1.0, 1.0);
  return 0.07957747 * (1.0 - g * g) / (a * sqrt(a));
}

float projectorPhase(float cosine) {
  return mix(phase(cosine, ${atmosphere.projectorAnisotropy}),
    phase(cosine, ${atmosphere.projectorWingAnisotropy}), ${atmosphere.projectorWingFraction});
}

float projectorBodyPhase(float cosine, float distanceToLight, float downward, float clearance) {
  float spread = smoothstep(-0.04, 0.44, cosine) * (1.0 - smoothstep(0.91, 0.99, cosine));
  float body = smoothstep(${atmosphere.projectorBodyDistance.join(', ')}, distanceToLight);
  float lower = smoothstep(0.012, 0.097, downward);
  float open = smoothstep(${atmosphere.projectorBodyClearance.join(', ')}, clearance);
  return phase(cosine, ${atmosphere.projectorBodyAnisotropy}) * ${atmosphere.projectorBodyScatterFraction}
    * body * spread * lower * open;
}

float projectorReceiver(vec3 hit, vec3 source, vec3 axis) {
  vec3 delta = hit - source;
  float nearBody = 1.0 - smoothstep(1.55, 2.3, length(delta));
  float behindLamp = 1.0 - smoothstep(0.04, 0.32, dot(delta, axis));
  float aboveDeck = smoothstep(0.07, 0.24, hit.y);
  // Reserve the visible shaft for open air, not a depth hit on the nose.
  return 1.0 - nearBody * behindLamp * aboveDeck;
}

float foregroundScatter(float t) {
  float closeFocus = 1.0 - smoothstep(0.8, 3.0, focusDistance);
  float foreground = 1.0 - smoothstep(0.06, clamp(focusDistance * 1.15, 0.12, 1.6), t);
  return 1.0 - 0.85 * closeFocus * foreground;
}

vec2 layerInterval(vec3 origin, vec3 ray) {
  vec2 d = ray.xz;
  vec2 inv = sign(d + 1e-12) / max(abs(d), vec2(1e-6));
  vec2 a = (deckBounds.xy - origin.xz) * inv;
  vec2 b = (deckBounds.zw - origin.xz) * inv;
  vec2 lo = min(a, b);
  vec2 hi = max(a, b);
  float start = max(0.0, max(lo.x, lo.y));
  float end = min(hi.x, hi.y);
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

float densityAt(float t, float y, vec2 layer) {
  return airDensity + ((t > layer.x && t < layer.y) ? deckDensity * exp(-max(y, 0.0) / layerHeight) : 0.0);
}

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

vec4 scatterToDepth(vec2 uv, float depth) {
  vec4 eye = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 eyePoint = eye.xyz / eye.w;
  float far = length(eyePoint);
  vec3 ray = mat3(cameraWorld) * (eyePoint / far);
  vec3 origin = cameraWorld[3].xyz;
  vec3 hit = origin + far * ray;
  vec2 layer = layerInterval(origin, ray);
  float layerDepth = layerOpticalDepth(origin.y, ray.y, layer, far);
  float airDepth = far * airDensity;
  float transmission = exp(-airDepth - layerDepth);
  vec3 skyGlow = mix(vec3(0.032, 0.076, 0.103), vec3(0.019, 0.036, 0.054), smoothstep(0.02, 0.48, ray.y));
  vec3 radiance = skyGlow * (1.0 - exp(-airDepth)) * foregroundScatter(far * 0.5);
  vec2 pixel = floor(uv * vec2(textureSize(sceneDepth, 0)));
  float pixelNoise = fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));

  for (int i = 0; i < MAX_FILM_LIGHTS; i++) {
    if (i >= filmLightCount) break;
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
      if (glowSegment.y <= glowSegment.x) continue;
      float glowRadius = sqrt(perp2 + shape.y * shape.y);
      float glowStart = atan((glowSegment.x - along) / glowRadius);
      float glowEnd = atan((glowSegment.y - along) / glowRadius);
      float tGlow = clamp(along + glowRadius * tan(0.5 * (glowStart + glowEnd)), glowSegment.x, glowSegment.y);
      vec3 glowDirection = toSource - tGlow * ray;
      float sourceDistance = length(glowDirection);
      float glowDistance = max(sourceDistance, shape.y);
      vec3 glowPoint = origin + tGlow * ray;
      float r = glowDistance / color.a;
      float falloff = max(0.0, 1.0 - r * r * r * r);
      float glowT = exp(-airDensity * (tGlow + glowDistance) - layerOpticalDepth(origin.y, ray.y, layer, tGlow));
      float angular = spot ? filmAngularFalloff(i, glowDirection / max(sourceDistance, 1e-4)) * filmLightVisibility(i, glowPoint)
        : (axis.w < -0.5 ? 1.0 : 0.28 + 0.72 * max(0.0, dot(-glowDirection / glowDistance, axis.xyz)));
      float glow = (glowEnd - glowStart) / glowRadius;
      float strength = spot ? 0.36 : 0.72;
      radiance += color.rgb * glow * angular * glowT * falloff * falloff * strength
        * densityAt(tGlow, glowPoint.y, layer) * phase(dot(ray, glowDirection) / glowDistance, anisotropy) * foregroundScatter(tGlow);
      continue;
    }

    if (axis.w > -0.5) segment = clipCone(segment, -toSource, ray, axis.xyz, axis.w);
    if (segment.y <= segment.x) continue;
    float projectorGain = projector
      ? smoothstep(${atmosphere.projectorFocus.join(', ')}, focusDistance) * projectorReceiver(hit, filmLightPosition[i], axis.xyz)
      : 1.0;
    if (projectorGain < 1e-4) continue;
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
      float opticalDepth = airDensity * (t + distanceToLight) + layerOpticalDepth(origin.y, ray.y, layer, t);
      float cosine = dot(ray, toLight);
      float scatteringPhase = projector
        ? projectorPhase(cosine) * ${atmosphere.projectorScatterFraction} * smoothstep(0.1, 0.43, distanceToLight)
          + projectorBodyPhase(cosine, distanceToLight, dot(toLight, up), far - t)
        : phase(cosine, anisotropy) * scatterFraction;
      radiance += light * (visible * weight * densityAt(t, p.y, layer) * scatteringPhase * exp(-opticalDepth) * foregroundScatter(t) * projectorGain);
    }
  }
  return vec4(radiance, transmission);
}
`

const integrate = scattering + /* glsl */ `
void main() {
  ivec2 size = textureSize(sceneDepth, 0);
  ivec2 pixel = ((ivec2(gl_FragCoord.xy) * 2 + 1) * size) / (2 * coarseResolution);
  float depth = texelFetch(sceneDepth, pixel, 0).r;
  outColor = scatterToDepth((vec2(pixel) + 0.5) / vec2(size), depth);
}
`

const composite = scattering + /* glsl */ `
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

export function createHaze({ rig, world }: StageDeps): StagePart {
  const coarse = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  })
  const uniforms = {
    ...rig.uniforms,
    ...rig.shadowUniforms,
    sceneColor: { value: null as THREE.Texture | null },
    sceneDepth: { value: null as THREE.Texture | null },
    coarseHaze: { value: coarse.texture },
    coarseResolution: { value: new THREE.Vector2(1, 1) },
    inverseProjection: { value: new THREE.Matrix4() },
    cameraWorld: { value: new THREE.Matrix4() },
    deckBounds: { value: new THREE.Vector4() },
    sampleJitter: { value: new THREE.Vector2() },
    focusDistance: { value: 1 },
  }
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
        integratePass.render(renderer, coarse)
        compositePass.render(renderer, output)
      },
    }],
  }
}
