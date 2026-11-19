import * as THREE from 'three'
import type { FormatSpec } from '../config'
import { FullscreenPass, passMaterial } from '../core/fullscreen'

const BLOOM_LEVEL_WEIGHTS = [0.36, 0.24, 0.16, 0.10, 0.08, 0.06]
export const BLOOM_WEIGHT = 0.027
export const HALATION_WEIGHT = [0.020, 0.0045, 0.0015]

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
  outColor = vec4(s * (0.25 * exposurePerSample), 1.0);
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

function target(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.NoColorSpace,
    generateMipmaps: false,
    depthBuffer: false,
  })
}

export class Scatter {
  private readonly down = BLOOM_LEVEL_WEIGHTS.map(target)
  private readonly up = BLOOM_LEVEL_WEIGHTS.slice(1).map(target)
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

  get bloom(): THREE.Texture { return this.up[0].texture }
  get halation(): THREE.Texture { return this.down[1].texture }

  resize(format: FormatSpec, scale: number): void {
    this.downPass.material.uniforms.kernelScale.value = scale
    this.upPass.material.uniforms.kernelScale.value = scale
    let { width, height } = format
    for (const [i, down] of this.down.entries()) {
      width = Math.ceil(width / 2)
      height = Math.ceil(height / 2)
      down.setSize(width, height)
      this.up[i]?.setSize(width, height)
    }
  }

  render(renderer: THREE.WebGLRenderer, sum: THREE.Texture, exposurePerSample: number): void {
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
  }
}
