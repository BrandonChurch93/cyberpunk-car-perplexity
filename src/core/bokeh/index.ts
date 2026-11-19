import * as THREE from 'three'
import type { SamplePass } from '../contract'
import type { SampleInfo } from '../engine'
import { FullscreenPass, passMaterial } from '../fullscreen'
import type { CameraState } from '../lens'
import { circleScale, pupilCell, pupilIsActive, pupilTapCount } from './pupil'

const depthCode = /* glsl */ `
uniform sampler2D sceneDepth;
uniform vec2 inverseDepth;
uniform float focusDistance;
uniform float coScale;

float sceneDistance(ivec2 p) {
  float d = texelFetch(sceneDepth, p, 0).r;
  return 1.0 / (inverseDepth.x * (2.0 * d - 1.0) + inverseDepth.y);
}

bool isDistant(float z) { return z > 2.1 * focusDistance; }
`

const prefilterFragment = depthCode + /* glsl */ `
uniform sampler2D sceneColor;
out vec4 color;

void main() {
  ivec2 start = ivec2(gl_FragCoord.xy) * 2;
  ivec2 last = textureSize(sceneDepth, 0) - 1;
  vec4 total = vec4(0.0);
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      ivec2 at = min(start + ivec2(x, y), last);
      if (isDistant(sceneDistance(at))) total += vec4(texelFetch(sceneColor, at, 0).rgb, 1.0);
    }
  }
  color = total * 0.25;
}
`

const reconstructFragment = depthCode + /* glsl */ `
uniform sampler2D sceneColor;
uniform sampler2D farMip;
uniform vec2 inverseSize;
uniform vec2 apertureCenter;
uniform vec2 apertureTaps[${pupilTapCount}];
uniform float rootSamples;
uniform float squeeze;
in vec2 vUv;
out vec4 color;

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  float z = sceneDistance(texel);
  vec4 sharp = texelFetch(sceneColor, texel, 0);
  color = sharp;
  if (!isDistant(z)) return;
  float coc = coScale * (1.0 / focusDistance - 1.0 / z);
  float cellRadius = coc / rootSamples;
  if (cellRadius < 0.8) return;

  vec2 field = (vUv * 2.0 - 1.0) * vec2(1.0, inverseSize.x / inverseSize.y);
  float edge = smoothstep(0.22, 1.24, length(field));
  vec2 radial = field * inversesqrt(max(dot(field, field), 1e-6));
  vec2 tangent = vec2(-radial.y, radial.x);
  vec2 anamorphic = vec2(1.0 / squeeze, 1.0);
  float tapRadius = cellRadius * inversesqrt(float(${pupilTapCount}));
  float lod = log2(max(1.0, 0.85 * tapRadius));
  vec4 sum = vec4(0.0);
  for (int j = 0; j < ${pupilTapCount}; j++) {
    vec2 p = apertureTaps[j] * anamorphic;
    p -= radial * edge * (dot(radial, p) * (0.18 + 0.16 * abs(dot(tangent, p))) + 0.045);
    vec2 uv = vUv - (p - apertureCenter) * coc * inverseSize;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
    sum += textureLod(farMip, uv, lod);
  }
  if (sum.a < 1e-5) return;
  float strength = smoothstep(0.8, 2.0, cellRadius) * smoothstep(0.1, 0.8, sum.a);
  color.rgb = mix(sharp.rgb, sum.rgb / sum.a, strength);
}
`

export interface BokehPass extends SamplePass {
  aperture(sample: SampleInfo, state: CameraState): [number, number] | null
}

export function createBokeh(squeeze: number): BokehPass {
  const far = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  })
  const uniforms = {
    sceneColor: { value: null as THREE.Texture | null },
    sceneDepth: { value: null as THREE.Texture | null },
    inverseDepth: { value: new THREE.Vector2() },
    focusDistance: { value: 0 },
    coScale: { value: 0 },
    farMip: { value: far.texture },
    inverseSize: { value: new THREE.Vector2() },
    apertureCenter: { value: new THREE.Vector2() },
    apertureTaps: { value: Array.from({ length: pupilTapCount }, () => new THREE.Vector2()) },
    rootSamples: { value: 1 },
    squeeze: { value: squeeze },
  }
  const prefilter = new FullscreenPass(passMaterial(prefilterFragment, uniforms, { blending: THREE.NoBlending }))
  const reconstruct = new FullscreenPass(passMaterial(reconstructFragment, uniforms, { blending: THREE.NoBlending }))

  return {
    id: 'bokeh',
    aperture({ frame, sampleIndex }, state) {
      return pupilIsActive(state, frame.format.width, frame.samples) ? pupilCell(frame.frameKey, sampleIndex, frame.samples).center : null
    },
    render(renderer, input, output, { camera, sample, state }) {
      const { width, height } = output
      const { center, taps } = pupilCell(sample.frame.frameKey, sample.sampleIndex, sample.frame.samples)
      uniforms.sceneColor.value = input.color
      uniforms.sceneDepth.value = input.depth
      uniforms.inverseDepth.value.set(camera.projectionMatrixInverse.elements[11], camera.projectionMatrixInverse.elements[15])
      uniforms.focusDistance.value = state.focusDistance
      uniforms.coScale.value = circleScale(state, width)
      uniforms.inverseSize.value.set(1 / width, 1 / height)
      uniforms.apertureCenter.value.set(center[0] / squeeze, center[1])
      uniforms.rootSamples.value = Math.sqrt(sample.frame.samples)
      taps.forEach((tap, index) => uniforms.apertureTaps.value[index].set(...tap))
      far.setSize(Math.ceil(width / 2), Math.ceil(height / 2))
      prefilter.render(renderer, far)
      reconstruct.render(renderer, output)
    },
  }
}
