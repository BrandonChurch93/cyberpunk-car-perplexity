import * as THREE from 'three'
import type { FormatSpec } from '../config'
import type { FrameInfo, Resolver } from '../core/engine'
import { FullscreenPass, passMaterial } from '../core/fullscreen'
import { hashInts, streamSeed } from '../core/random'

const fragment = /* glsl */ `
precision highp float;
uniform sampler2D sum;
uniform float inverseCount;
uniform float exposure;
uniform float ditherSeed;
uniform int passthrough;
in vec2 vUv;
out vec4 outColor;

vec3 filmic(vec3 x) {
  x = max(x, 0.0);
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 encode(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p, float s) {
  vec3 q = fract(vec3(p.xyx) * 0.1031 + s);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  vec3 hdr = texelFetch(sum, ivec2(gl_FragCoord.xy), 0).rgb * inverseCount;
  vec3 mapped = passthrough == 1 ? clamp(hdr, 0.0, 1.0) : filmic(hdr * exposure);
  vec3 display = encode(mapped);
  float n = hash(gl_FragCoord.xy, ditherSeed) + hash(gl_FragCoord.xy + 17.0, ditherSeed + 0.37) - 1.0;
  outColor = vec4(display + n / 255.0, 1.0);
}
`

const ditherStream = streamSeed('dither')

export class BasicResolver implements Resolver {
  private readonly pass: FullscreenPass
  private passthrough = false

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.pass = new FullscreenPass(passMaterial(fragment, {
      sum: { value: null },
      inverseCount: { value: 1 },
      exposure: { value: 1 },
      ditherSeed: { value: 0 },
      passthrough: { value: 0 },
    }))
  }

  resize(_format: FormatSpec): void {}

  setDiagnostic(view: string): void {
    this.passthrough = view !== 'beauty'
  }

  resolve(sum: THREE.Texture, count: number, frame: FrameInfo, target: THREE.WebGLRenderTarget | null): void {
    const u = this.pass.material.uniforms
    u.sum.value = sum
    u.inverseCount.value = 1 / count
    u.ditherSeed.value = (hashInts(ditherStream, frame.frameKey) % 4096) / 4096
    u.passthrough.value = this.passthrough ? 1 : 0
    this.pass.render(this.renderer, target)
  }
}
