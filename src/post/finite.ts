import * as THREE from 'three'
import type { FormatSpec } from '../config'
import { FullscreenPass, passMaterial } from '../core/fullscreen'

const validity = /* glsl */ `
bool finiteRgb(vec3 rgb) {
  // Check IEEE-754 exponent bits rather than doing arithmetic on NaN/Inf.
  return !any(equal(floatBitsToUint(rgb) & uvec3(0x7f800000u), uvec3(0x7f800000u)));
}
`

const reduce = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D source;
uniform ivec2 fullSize;
uniform int stride;
out vec4 outColor;
${validity}
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 2;
  ivec2 size = textureSize(source, 0);
  vec3 mean = vec3(0.0);
  float valid = 0.0, invalid = 0.0;
  for (int y = 0; y < 2; ++y) {
    for (int x = 0; x < 2; ++x) {
      ivec2 p = base + ivec2(x, y);
      if (any(greaterThanEqual(p, size))) continue;
      vec4 cell = texelFetch(source, p, 0);
      ivec2 span = min(ivec2(stride), fullSize - p * stride);
      float bad = stride == 1 ? (finiteRgb(cell.rgb) ? 0.0 : 1.0) : cell.a;
      float good = float(span.x * span.y) - bad;
      invalid += bad;
      if (good == 0.0) continue;
      // Blend means rather than adding potentially very large finite values.
      if (valid == 0.0) mean = cell.rgb;
      else mean = mix(mean, cell.rgb, good / (valid + good));
      valid += good;
    }
  }
  outColor = vec4(mean, invalid);
}
`

const fill = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D source;
uniform sampler2D parent;
uniform ivec2 fullSize;
uniform int stride;
uniform bool hasParent;
uniform float neutral;
out vec4 outColor;
${validity}
bool usable(ivec2 p, vec4 cell) {
  if (stride == 1) return finiteRgb(cell.rgb);
  ivec2 span = min(ivec2(stride), fullSize - p * stride);
  return cell.a < float(span.x * span.y);
}
vec3 parentMean(ivec2 p) {
  if (!hasParent) return vec3(neutral);
  // Coarse texels sit between the fine texel centres; sample that field bilinearly.
  vec2 pos = (vec2(p) + 0.5) * 0.5 - 0.5;
  ivec2 a = ivec2(floor(pos));
  ivec2 hi = textureSize(parent, 0) - 1;
  vec2 u = fract(pos);
  vec3 aa = texelFetch(parent, clamp(a, ivec2(0), hi), 0).rgb;
  vec3 ba = texelFetch(parent, clamp(a + ivec2(1, 0), ivec2(0), hi), 0).rgb;
  vec3 ab = texelFetch(parent, clamp(a + ivec2(0, 1), ivec2(0), hi), 0).rgb;
  vec3 bb = texelFetch(parent, clamp(a + ivec2(1), ivec2(0), hi), 0).rgb;
  return mix(mix(aa, ba, u.x), mix(ab, bb, u.x), u.y);
}
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 cell = texelFetch(source, pixel, 0);
  if (usable(pixel, cell)) {
    outColor = vec4(cell.rgb, 1.0);
    return;
  }
  ivec2 size = textureSize(source, 0);
  vec3 mean = vec3(0.0);
  float weight = 0.0;
  for (int y = -1; y <= 1; ++y) {
    for (int x = -1; x <= 1; ++x) {
      ivec2 p = pixel + ivec2(x, y);
      if ((x == 0 && y == 0) || any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, size))) continue;
      vec4 neighbour = texelFetch(source, p, 0);
      if (!usable(p, neighbour)) continue;
      float w = x == 0 || y == 0 ? 1.0 : 0.70710678;
      if (weight == 0.0) mean = neighbour.rgb;
      else mean = mix(mean, neighbour.rgb, w / (weight + w));
      weight += w;
    }
  }
  outColor = vec4(weight > 0.0 ? mean : parentMean(pixel), 1.0);
}
`

function floatTarget(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.FloatType, depthBuffer: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  })
}

export class FiniteSum {
  private readonly probe = new Float32Array(4)
  private readonly reduced: THREE.WebGLRenderTarget[] = []
  private readonly repaired: THREE.WebGLRenderTarget[] = []
  private readonly reduce = new FullscreenPass(passMaterial(reduce, {
    source: { value: null }, fullSize: { value: new THREE.Vector2() }, stride: { value: 1 },
  }))
  private readonly fill = new FullscreenPass(passMaterial(fill, {
    source: { value: null }, parent: { value: null }, fullSize: { value: new THREE.Vector2() },
    stride: { value: 1 }, hasParent: { value: false }, neutral: { value: 0 },
  }))
  count = 0

  resize({ width, height }: FormatSpec): void {
    this.count = 0
    this.reduce.material.uniforms.fullSize.value.set(width, height)
    this.fill.material.uniforms.fullSize.value.set(width, height)
    let level = 0
    do {
      const repair = this.repaired[level] ??= floatTarget()
      repair.setSize(width, height)
      width = Math.ceil(width / 2)
      height = Math.ceil(height / 2)
      const reduction = this.reduced[level] ??= floatTarget()
      reduction.setSize(width, height)
      ++level
    } while (width > 1 || height > 1)
    for (const target of this.reduced.splice(level)) target.dispose()
    for (const target of this.repaired.splice(level)) target.dispose()
  }

  render(renderer: THREE.WebGLRenderer, sum: THREE.Texture, samples: number): THREE.Texture {
    const u = this.reduce.material.uniforms
    let source = sum
    for (const [level, target] of this.reduced.entries()) {
      u.source.value = source
      u.stride.value = 2 ** level
      this.reduce.render(renderer, target)
      source = target.texture
    }
    // At the supported sizes the float alpha channel holds the integer count exactly.
    renderer.readRenderTargetPixels(this.reduced[this.reduced.length - 1], 0, 0, 1, 1, this.probe)
    this.count = this.probe[3]
    if (this.count === 0) return sum

    const f = this.fill.material.uniforms
    f.neutral.value = 0.18 * samples // used only when the entire frame has no finite RGB
    for (let level = this.repaired.length - 1; level >= 0; --level) {
      f.source.value = level === 0 ? sum : this.reduced[level - 1].texture
      f.stride.value = 2 ** level
      f.hasParent.value = true
      f.parent.value = this.repaired[level + 1]?.texture ?? source
      // The coarsest reduction is 1x1. If it is entirely invalid, no neighbourhood exists.
      if (level === this.repaired.length - 1) {
        const size: THREE.Vector2 = f.fullSize.value
        f.hasParent.value = this.count < size.x * size.y
      }
      this.fill.render(renderer, this.repaired[level])
    }
    return this.repaired[0].texture
  }
}
