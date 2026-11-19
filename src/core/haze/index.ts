import * as THREE from 'three'
import { FullscreenPass, passMaterial } from '../fullscreen'
import { filmLightsGlsl, filmLightsShadowGlsl } from '../lights'
import type { StageDeps, StagePart } from '../parts'

// The board retains about 40% contrast at 200 m, with a denser 15 to 30 cm layer and stronger backlit scattering.
export const atmosphere = {
  uniformExtinction: 0.0045,
  deckExtinction: 0.052,
  layerHeight: 0.27,
  anisotropy: 0.58,
  scatterFraction: 0.56,
} as const

const fragment = /* glsl */ `
uniform sampler2D sceneColor;
uniform sampler2D sceneDepth;
uniform mat4 inverseProjection;
uniform mat4 cameraWorld;
uniform vec4 deckBounds;
uniform vec2 sampleJitter;
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

float phase(float cosine) {
  float a = 1.0 + anisotropy * anisotropy - 2.0 * anisotropy * cosine;
  return 0.07957747 * (1.0 - anisotropy * anisotropy) / (a * sqrt(a));
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

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 scene = texelFetch(sceneColor, pixel, 0);
  float depth = texelFetch(sceneDepth, pixel, 0).r;
  vec4 eye = inverseProjection * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 eyePoint = eye.xyz / eye.w;
  float far = length(eyePoint);
  vec3 ray = mat3(cameraWorld) * (eyePoint / far);
  vec3 origin = cameraWorld[3].xyz;
  vec2 layer = layerInterval(origin, ray);
  float layerDepth = layerOpticalDepth(origin.y, ray.y, layer, far);
  float airDepth = far * airDensity;
  float transmission = exp(-airDepth - layerDepth);
  vec3 skyGlow = mix(vec3(0.032, 0.076, 0.103), vec3(0.019, 0.036, 0.054), smoothstep(0.02, 0.48, ray.y));
  vec3 radiance = skyGlow * (1.0 - exp(-airDepth));
  float pixelNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

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
    float glowRadius = sqrt(perp2 + shape.y * shape.y);
    float glowStart = atan((segment.x - along) / glowRadius);
    float glowEnd = atan((segment.y - along) / glowRadius);
    float tGlow = clamp(along + glowRadius * tan(0.5 * (glowStart + glowEnd)), segment.x, segment.y);
    vec3 glowDirection = toSource - tGlow * ray;
    float glowDistance = max(length(glowDirection), shape.y);
    float r = glowDistance / color.a;
    float falloff = max(0.0, 1.0 - r * r * r * r);
    float glowT = exp(-airDensity * (tGlow + glowDistance) - layerOpticalDepth(origin.y, ray.y, layer, tGlow));
    float angular = filmLightAxis[i].w < -0.5 ? 1.0 : 0.28 + 0.72 * max(0.0, dot(-glowDirection / glowDistance, filmLightAxis[i].xyz));
    vec3 glowPoint = origin + tGlow * ray;
    float glow = (glowEnd - glowStart) / glowRadius;
    float glowStrength = shape.z > 0.5 ? (shape.w > 0.5 ? 0.016 : 0.095) : 0.72;
    radiance += color.rgb * glow * angular * glowT * falloff * falloff * glowStrength
      * densityAt(tGlow, glowPoint.y, layer) * phase(dot(ray, glowDirection) / glowDistance);
    if (shape.z < 0.5) continue;

    vec4 axis = filmLightAxis[i];
    if (axis.w > -0.5) segment = clipCone(segment, -toSource, ray, axis.xyz, axis.w);
    if (segment.y <= segment.x) continue;
    float beamRadius = sqrt(perp2 + min(shape.y * shape.y, 0.01));
    float theta0 = atan((segment.x - along) / beamRadius);
    float theta1 = atan((segment.y - along) / beamRadius);
    float stepAngle = (theta1 - theta0) / float(steps);
    float offset = fract(sampleJitter.x + pixelNoise + float(i) * 0.618034);
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
      float opticalDepth = airDensity * (t + length(filmLightPosition[i] - p)) + layerOpticalDepth(origin.y, ray.y, layer, t);
      radiance += light * (visible * weight * densityAt(t, p.y, layer) * phase(dot(ray, toLight)) * exp(-opticalDepth) * scatterFraction);
    }
  }
  outColor = vec4(scene.rgb * transmission + radiance, scene.a);
}
`

export function createHaze({ rig, world }: StageDeps): StagePart {
  const uniforms = {
    ...rig.uniforms,
    ...rig.shadowUniforms,
    sceneColor: { value: null as THREE.Texture | null },
    sceneDepth: { value: null as THREE.Texture | null },
    inverseProjection: { value: new THREE.Matrix4() },
    cameraWorld: { value: new THREE.Matrix4() },
    deckBounds: { value: new THREE.Vector4() },
    sampleJitter: { value: new THREE.Vector2() },
  }
  const pass = new FullscreenPass(passMaterial(fragment, uniforms, { blending: THREE.NoBlending }))
  return {
    resize() {},
    samplePasses: [{
      id: 'haze',
      render(renderer, input, output, { camera, sample }) {
        rig.syncShadowUniforms()
        uniforms.sceneColor.value = input.color
        uniforms.sceneDepth.value = input.depth
        uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse)
        uniforms.cameraWorld.value.copy(camera.matrixWorld)
        const { min, max } = world.deck.bounds
        uniforms.deckBounds.value.set(min.x, min.y, max.x, max.y)
        uniforms.sampleJitter.value.set(...sample.misc)
        pass.render(renderer, output)
      },
    }],
  }
}
