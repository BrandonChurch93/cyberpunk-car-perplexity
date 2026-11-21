import * as THREE from 'three'
import type { FormatSpec } from '../config'
import { FullscreenPass, passMaterial } from '../core/fullscreen'

const BLOOM_LEVEL_WEIGHTS = [0.36, 0.24, 0.16, 0.10, 0.08, 0.06]
export const BLOOM_WEIGHT = 0.025
export const HALATION_WEIGHT = [0.012, 0.0032, 0.0010]
export const STREAK_WEIGHT = [0.0005, 0.00115, 0.0022]
const STREAK_TAPS = [1, 2, 4, 8, 16, 32]
// Carry the same linear energy with four extra stops of half-float headroom.
// Resolve restores these stops when weighting the lens contributions.
const SCATTER_ENCODE = 0.0625
export const SCATTER_DECODE = 1 / SCATTER_ENCODE

const firstFragment = /* glsl */ `
precision highp float;
uniform sampler2D source;
uniform float exposurePerSample;
in vec2 vUv;
out vec4 outColor;
void main() {
  ivec2 size = textureSize(source, 0);
  ivec2 p = min(ivec2(gl_FragCoord.xy) * 2, size - 1);
  ivec2 q = min(p + 1, size - 1);
  vec3 s = texelFetch(source, p, 0).rgb + texelFetch(source, q, 0).rgb;
  s += texelFetch(source, ivec2(p.x, q.y), 0).rgb + texelFetch(source, ivec2(q.x, p.y), 0).rgb;
  // Prevent out-of-range input from writing Inf, which linear filtering can
  // turn into NaN and spread across a whole coarse bloom tile.
  vec3 encoded = s * (0.25 * exposurePerSample * ${SCATTER_ENCODE});
  outColor = vec4(clamp(encoded, -65504.0, 65504.0), 1.0);
}
`

const downFragment = /* glsl */ `
precision highp float;
uniform sampler2D source;
uniform float kernelScale;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 d = max(0.5, 0.90 * kernelScale) / vec2(textureSize(source, 0));
  vec3 s = texture(source, vUv).rgb * 0.25;
  s += texture(source, vUv + vec2( d.x,  d.y)).rgb * 0.1875;
  s += texture(source, vUv + vec2(-d.x,  d.y)).rgb * 0.1875;
  s += texture(source, vUv + vec2( d.x, -d.y)).rgb * 0.1875;
  s += texture(source, vUv + vec2(-d.x, -d.y)).rgb * 0.1875;
  outColor = vec4(s, 1.0);
}
`

const upFragment = /* glsl */ `
precision highp float;
uniform sampler2D source;
uniform sampler2D wide;
uniform float kernelScale;
uniform float weight;
uniform float wideWeight;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 d = 0.67 * kernelScale / vec2(textureSize(wide, 0));
  vec3 s = texture(wide, vUv + vec2( d.x,  d.y)).rgb;
  s += texture(wide, vUv + vec2(-d.x,  d.y)).rgb;
  s += texture(wide, vUv + vec2( d.x, -d.y)).rgb;
  s += texture(wide, vUv + vec2(-d.x, -d.y)).rgb;
  outColor = vec4(weight * texture(source, vUv).rgb + 0.25 * wideWeight * s, 1.0);
}
`

const streakFragment = /* glsl */ `
precision highp float;
uniform sampler2D source;
uniform float reach;
uniform bool ingress;
in vec2 vUv;
out vec4 outColor;
float light(vec2 uv) {
  vec3 v = texture(source, uv).rgb;
  return ingress ? dot(v, vec3(0.2126, 0.7152, 0.0722)) : v.r;
}
void main() {
  vec2 d = vec2(reach / float(textureSize(source, 0).x), 0.0);
  float s = 0.5 * light(vUv) + 0.25 * (light(vUv - d) + light(vUv + d));
  outColor = vec4(s, 0.0, 0.0, 1.0);
}
`

function target(format: THREE.PixelFormat = THREE.RGBAFormat): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, {
    format,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.NoColorSpace,
    generateMipmaps: false,
    depthBuffer: false,
  })
}

export class Scatter {
  private readonly down = BLOOM_LEVEL_WEIGHTS.map(() => target())
  private readonly up = BLOOM_LEVEL_WEIGHTS.slice(1).map(() => target())
  private readonly streakTargets = [target(THREE.RedFormat), target(THREE.RedFormat)]
  private streakScale = 1
  private readonly firstPass = new FullscreenPass(passMaterial(firstFragment, {
    source: { value: null },
    exposurePerSample: { value: 1 },
  }))
  private readonly downPass = new FullscreenPass(passMaterial(downFragment, {
    source: { value: null },
    kernelScale: { value: 1 },
  }))
  private readonly upPass = new FullscreenPass(passMaterial(upFragment, {
    source: { value: null },
    wide: { value: null },
    kernelScale: { value: 1 },
    weight: { value: 1 },
    wideWeight: { value: 1 },
  }))
  private readonly streakPass = new FullscreenPass(passMaterial(streakFragment, {
    source: { value: null },
    reach: { value: 1 },
    ingress: { value: true },
  }))

  get bloom(): THREE.Texture { return this.up[0].texture }
  get halation(): THREE.Texture { return this.down[1].texture }
  get streak(): THREE.Texture { return this.streakTargets[(STREAK_TAPS.length - 1) % 2].texture }

  resize(format: FormatSpec, scale: number): void {
    this.downPass.material.uniforms.kernelScale.value = scale
    this.upPass.material.uniforms.kernelScale.value = scale
    this.streakScale = scale
    for (const streak of this.streakTargets) streak.setSize(Math.ceil(format.width / 4), Math.ceil(format.height / 2))
    let { width, height } = format
    for (const [i, down] of this.down.entries()) {
      width = Math.ceil(width / 2)
      height = Math.ceil(height / 2)
      down.setSize(width, height)
      this.up[i]?.setSize(width, height)
    }
  }

  render(renderer: THREE.WebGLRenderer, sum: THREE.Texture, exposurePerSample: number, anamorphic: boolean): void {
    const first = this.firstPass.material.uniforms
    first.source.value = sum
    first.exposurePerSample.value = exposurePerSample
    this.firstPass.render(renderer, this.down[0])
    const down = this.downPass.material.uniforms
    for (let i = 1; i < this.down.length; i++) {
      down.source.value = this.down[i - 1].texture
      this.downPass.render(renderer, this.down[i])
    }
    const up = this.upPass.material.uniforms
    const last = this.down.length - 1
    for (let i = last - 1; i >= 0; i--) {
      up.source.value = this.down[i].texture
      up.wide.value = (i === last - 1 ? this.down[last] : this.up[i + 1]).texture
      up.weight.value = BLOOM_LEVEL_WEIGHTS[i]
      up.wideWeight.value = i === last - 1 ? BLOOM_LEVEL_WEIGHTS[last] : 1
      this.upPass.render(renderer, this.up[i])
    }
    if (anamorphic) {
      const streak = this.streakPass.material.uniforms
      streak.source.value = this.down[0].texture
      for (const [i, tap] of STREAK_TAPS.entries()) {
        streak.ingress.value = i === 0
        streak.reach.value = Math.max(0.5, tap * this.streakScale * (i === 0 ? 2 : 1))
        const output = this.streakTargets[i % 2]
        this.streakPass.render(renderer, output)
        streak.source.value = output.texture
      }
    }
  }
}
