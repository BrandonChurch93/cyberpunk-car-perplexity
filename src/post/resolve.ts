import * as THREE from 'three'
import { config, type FormatSpec } from '../config'
import type { FrameInfo, Resolver } from '../core/engine'
import { FullscreenPass, passMaterial } from '../core/fullscreen'
import { LogMeter, clayGain } from './meter'
import { hashInts, streamSeed } from '../core/random'
import { FiniteSum } from './finite'
import { opticsGlsl } from './optics'
import { Scatter, BLOOM_WEIGHT, HALATION_WEIGHT, SCATTER_DECODE, STREAK_WEIGHT } from './scatter'
import { FILM_CURVE, toneMapGlsl } from './tone'

export const FILM_EXPOSURE = 0.84
const GRAIN_SIZE_PX = 1.8
const GRAIN_LUMA = 0.022
const GRAIN_CHROMA = 0.005
const grainStream = streamSeed('film-grain')
const ditherStream = streamSeed('film-dither')

const fragment = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D sum;
uniform sampler2D bloom;
uniform sampler2D halation;
uniform sampler2D streak;
uniform float exposurePerSample;
uniform float inverseCount;
uniform float imageScale;
uniform float grainSize;
uniform uint grainSeed;
uniform uint ditherSeed;
uniform int treatment;
uniform bool anamorphic;
in vec2 vUv;
out vec4 outColor;

${toneMapGlsl}
${opticsGlsl}

uint scramble(uint x) {
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return x ^ (x >> 16u);
}

uint pixelHash(ivec2 p, uint seed) {
  return scramble(uint(p.x) * 0x9e3779b1u ^ uint(p.y) * 0x85ebca77u ^ seed);
}

vec3 grainCell(ivec2 p) {
  uint h = pixelHash(p, grainSeed);
  return vec3(uvec3(h, h >> 8u, h >> 16u) & 255u) / 255.0 - 0.5;
}

vec3 grainAt(vec2 p) {
  ivec2 cell = ivec2(floor(p));
  vec2 f = fract(p);
  vec3 a = mix(grainCell(cell), grainCell(cell + ivec2(1, 0)), f.x);
  vec3 b = mix(grainCell(cell + ivec2(0, 1)), grainCell(cell + ivec2(1, 1)), f.x);
  return mix(a, b, f.y);
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec3 hdr;
  if (treatment == 2) {
    hdr = texelFetch(sum, pixel, 0).rgb;
    outColor = vec4(hdr * inverseCount, 1.0);
    return;
  }
  vec3 display;
  if (treatment == 3) {
    hdr = texelFetch(sum, pixel, 0).rgb;
    display = encodeDisplay(clamp(hdr * inverseCount, 0.0, 1.0));
  } else {
    if (treatment == 0) {
      vec2 gate = vec2(textureSize(sum, 0));
      float radius2;
      vec2 uv = lensGeometry(vUv, gate, radius2);
      hdr = lensSample(uv, gate, radius2) * exposurePerSample;
      hdr += ${BLOOM_WEIGHT * SCATTER_DECODE} * texture(bloom, uv).rgb;
      hdr += vec3(${HALATION_WEIGHT.map(w => w * SCATTER_DECODE).join(', ')}) * texture(halation, uv).rgb;
      if (anamorphic) hdr += vec3(${STREAK_WEIGHT.map(w => w * SCATTER_DECODE).join(', ')}) * texture(streak, uv).r;
      hdr *= lensVignette(radius2);
    } else {
      hdr = texelFetch(sum, pixel, 0).rgb * exposurePerSample;
    }
    vec3 mapped = toneMap(hdr, ${FILM_CURVE});
    display = encodeDisplay(treatment == 0 ? grade(mapped) : mapped);
    if (treatment == 0) {
      float y = dot(display, LUMA);
      float response = mix(0.22, 1.0, smoothstep(0.0, 0.10, y))
        * (1.0 - 0.88 * smoothstep(0.40, 0.96, y));
      vec3 grain = grainAt(gl_FragCoord.xy / grainSize);
      vec3 chroma = vec3(grain.y, -0.26 * grain.y - 0.10 * grain.z, grain.z);
      display += response * (${GRAIN_LUMA} * grain.x + ${GRAIN_CHROMA} * chroma);
    }
  }
  uint h = pixelHash(pixel, ditherSeed);
  float tpdf = (float(h & 65535u) + float(h >> 16u)) / 65535.0 - 1.0;
  outColor = vec4(floor(clamp(display * 255.0 + tpdf, 0.0, 255.0) + 0.5) / 255.0, 1.0);
}
`

export class BasicResolver implements Resolver {
  private readonly pass: FullscreenPass
  private readonly scatter = new Scatter()
  private readonly finiteSum = new FiniteSum()
  private treatment = 0
  private clay = false
  private readonly meter = new LogMeter()

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.pass = new FullscreenPass(passMaterial(fragment, {
      sum: { value: null },
      bloom: { value: null },
      halation: { value: null },
      streak: { value: null },
      exposurePerSample: { value: 1 },
      inverseCount: { value: 1 },
      imageScale: { value: 1 },
      grainSize: { value: GRAIN_SIZE_PX },
      grainSeed: { value: 0 },
      ditherSeed: { value: 0 },
      treatment: { value: 0 },
      anamorphic: { value: config.lens.anamorphic },
    }))
  }

  resize(format: FormatSpec): void {
    const scale = format.height / config.formats.master.height
    this.finiteSum.resize(format)
    this.scatter.resize(format, scale)
    this.pass.material.uniforms.imageScale.value = scale
    this.pass.material.uniforms.grainSize.value = GRAIN_SIZE_PX * scale
  }

  setDiagnostic(view: string): void {
    this.treatment = view === 'beauty' ? 0 : view === 'normals' ? 2 : view === 'caps' ? 3 : 1
    this.clay = view === 'clay'
  }

  /** Number of pixels with a non-finite RGB component in the last unresolved HDR sum. */
  get nonFinitePixels(): number {
    return this.finiteSum.count
  }

  resolve(sum: THREE.Texture, count: number, frame: FrameInfo, target: THREE.WebGLRenderTarget | null): void {
    const u = this.pass.material.uniforms
    const safeSum = this.finiteSum.render(this.renderer, sum, count)
    u.sum.value = safeSum
    u.inverseCount.value = 1 / count
    const gain = this.clay ? clayGain(this.meter.key(this.renderer, safeSum, count), FILM_EXPOSURE) : 1
    u.exposurePerSample.value = FILM_EXPOSURE * gain / count
    if (this.treatment === 0) {
      this.scatter.render(this.renderer, safeSum, u.exposurePerSample.value, config.lens.anamorphic)
      u.bloom.value = this.scatter.bloom
      u.halation.value = this.scatter.halation
      u.streak.value = this.scatter.streak
    }
    u.grainSeed.value = hashInts(grainStream, frame.frameKey)
    u.ditherSeed.value = hashInts(ditherStream, frame.frameKey)
    u.treatment.value = this.treatment
    this.pass.render(this.renderer, target)
  }
}
