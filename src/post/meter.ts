import * as THREE from 'three'
import { FullscreenPass, passMaterial } from '../core/fullscreen'

const columns = 48
const rows = 27

const fragment = /* glsl */ `
precision highp float;
uniform sampler2D source;
uniform float inverseCount;
out vec4 outColor;
void main() {
  vec2 size = vec2(textureSize(source, 0));
  vec2 cell = size / vec2(${columns}.0, ${rows}.0);
  vec2 base = floor(gl_FragCoord.xy) * cell;
  float total = 0.0;
  for (int y = 0; y < 4; ++y) {
    for (int x = 0; x < 4; ++x) {
      ivec2 p = ivec2(base + (vec2(x, y) + 0.5) * 0.25 * cell);
      vec3 rgb = max(texelFetch(source, clamp(p, ivec2(0), ivec2(size) - 1), 0).rgb * inverseCount, 0.0);
      total += log(dot(rgb, vec3(0.2126, 0.7152, 0.0722)) + 1e-4);
    }
  }
  outColor = vec4(total / 16.0, 0.0, 0.0, 1.0);
}
`

export class LogMeter {
  private readonly target = new THREE.WebGLRenderTarget(columns, rows, {
    type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  })
  private readonly pixels = new Float32Array(columns * rows * 4)
  private readonly pass = new FullscreenPass(passMaterial(fragment, { source: { value: null }, inverseCount: { value: 1 } }))

  key(renderer: THREE.WebGLRenderer, sum: THREE.Texture, count: number): number {
    const u = this.pass.material.uniforms
    u.source.value = sum
    u.inverseCount.value = 1 / count
    this.pass.render(renderer, this.target)
    renderer.readRenderTargetPixels(this.target, 0, 0, columns, rows, this.pixels)
    let total = 0
    for (let i = 0; i < this.pixels.length; i += 4) total += this.pixels[i]
    return Math.exp(total / (columns * rows))
  }
}

export function clayGain(key: number, exposure: number): number {
  const wanted = 0.16 / Math.max(key * exposure, 1e-6)
  const thirds = Math.round(Math.log2(Math.min(Math.max(wanted, 1), 64)) * 3)
  return 2 ** (thirds / 3)
}
