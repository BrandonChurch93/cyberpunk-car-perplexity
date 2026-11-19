import { BLACK_FLOOR, HIGHLIGHT_DESATURATION, SCENE_CEILING, WHITE_POINT } from './curves'

export const BLOOM_WEIGHT = 0.044
export const BLOOM_LEVEL_WEIGHTS = [0.28, 0.24, 0.19, 0.14, 0.09, 0.06] as const

export const HALATION_WEIGHT = 0.030
export const HALATION_TINT = [1.0, 0.25, 0.05] as const
export const HALATION_LEVEL_WEIGHTS = [0.52, 0.33, 0.15] as const

export const ANAMORPHIC_STREAK_WEIGHT = 0.016
export const ANAMORPHIC_STREAK_TINT = [0.42, 0.70, 1.0] as const
export const ANAMORPHIC_STREAK_STRIDES = [1.0, 3.5, 12.0, 42.0] as const
export const ANAMORPHIC_STREAK_LEVEL_WEIGHTS = [0.34, 0.28, 0.22, 0.16] as const

export const BARREL_DISTORTION = 0.011
export const CA_CORNER_PX_1080 = 0.95
export const VIGNETTE_STRENGTH = 0.33
export const CORNER_SOFTNESS_PX_1080 = 0.70

export const GRAIN_SIZE_PX_1080 = 1.75
export const GRAIN_LUMA_STRENGTH = 0.013
export const GRAIN_CHROMA_STRENGTH = 0.0042

const toneMapGlsl = /* glsl */ `
const float BLACK_FLOOR = ${BLACK_FLOOR.toFixed(6)};
const float HIGHLIGHT_DESAT = ${HIGHLIGHT_DESATURATION.toFixed(4)};

float curveCinemaLogShoulder(float x) {
  float v = max(x, 0.0);
  float toe = (v * (v + 0.006)) / (v + 0.055);
  float l = log2(1.0 + toe * 3.4);
  float lw = log2(1.0 + ${WHITE_POINT.toFixed(3)} * 3.4);
  float s = (l * (1.0 + l / (lw * 1.25))) / (l + 2.35);
  float sw = (lw * (1.0 + lw / (lw * 1.25))) / (lw + 2.35);
  return BLACK_FLOOR + (1.0 - BLACK_FLOOR) * clamp(s / sw, 0.0, 1.0);
}

float rationalRaw(float x) {
  const float a = 0.12;
  const float b = 0.34;
  const float c = 0.16;
  const float d = 0.24;
  const float e = 0.014;
  const float f = 0.32;
  return (x * (a * x + c * b) + d * e) / (x * (a * x + b) + d * f) - e / f;
}

float curveRationalToeShoulder(float x) {
  float v = max(x, 0.0);
  float mapped = clamp(rationalRaw(v) / rationalRaw(52.0), 0.0, 1.0);
  return BLACK_FLOOR + (1.0 - BLACK_FLOOR) * mapped;
}

float curveStandardShoulder(float x) {
  float v = max(x, 0.0);
  float mapped = clamp((v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14), 0.0, 1.0);
  return BLACK_FLOOR + (1.0 - BLACK_FLOOR) * mapped;
}

float evalCurve(float x, int curveId) {
  if (curveId == 1) return curveRationalToeShoulder(x);
  if (curveId == 2) return curveStandardShoulder(x);
  return curveCinemaLogShoulder(x);
}

vec3 toneMapFilmic(vec3 rgb, int curveId) {
  vec3 c = max(rgb, 0.0);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float peak = max(c.r, max(c.g, c.b));
  float crosstalk = 0.03 * smoothstep(1.0, 20.0, peak);
  vec3 ct = mix(c, vec3(luma), crosstalk);
  vec3 mapped = vec3(
    evalCurve(ct.r, curveId),
    evalCurve(ct.g, curveId),
    evalCurve(ct.b, curveId)
  );
  float core = evalCurve(mix(luma, peak, 0.68), curveId);
  float desat = HIGHLIGHT_DESAT * smoothstep(1.8, 28.0, peak);
  return mix(mapped, vec3(core), desat);
}

vec3 encodeSrgb(vec3 c) {
  vec3 v = clamp(c, 0.0, 1.0);
  return mix(v * 12.92, 1.055 * pow(max(v, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v));
}

float sanitizeChannel(float v) {
  if (isnan(v) || isinf(v) || v < 0.0) return 0.0;
  float ceiling = ${SCENE_CEILING.toFixed(1)};
  float over = max(v - ceiling, 0.0);
  return min(v, ceiling) + 0.5 * ceiling * (1.0 - exp(-over / (0.5 * ceiling)));
}

vec3 sanitizeScene(vec3 c) {
  return vec3(sanitizeChannel(c.r), sanitizeChannel(c.g), sanitizeChannel(c.b));
}

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

vec3 hash3(uvec3 v) {
  uvec3 h = pcg3d(v);
  return vec3(h & 0x00ffffffu) * (1.0 / 16777216.0);
}

float tpdfDither(vec2 fragCoord, uint seed) {
  uvec2 px = uvec2(fragCoord);
  float u1 = hash3(uvec3(px, seed)).x;
  float u2 = hash3(uvec3(px + uvec2(1913u, 3571u), seed ^ 0x9e3779b9u)).x;
  return (u1 + u2 - 1.0) / 255.0;
}
`

export const exposeFragment = /* glsl */ `
precision highp float;
uniform sampler2D sum;
uniform float inverseCount;
uniform float exposure;
in vec2 vUv;
out vec4 outColor;

${toneMapGlsl}

void main() {
  vec3 raw = texelFetch(sum, ivec2(gl_FragCoord.xy), 0).rgb * inverseCount;
  outColor = vec4(sanitizeScene(raw) * exposure, 1.0);
}
`

export const downsampleFragment = /* glsl */ `
precision highp float;
uniform sampler2D source;
uniform vec2 texelSize;
uniform int karis;
in vec2 vUv;
out vec4 outColor;

float karisWeight(vec3 c) {
  float over = max(dot(c, vec3(0.2126, 0.7152, 0.0722)) - 2500.0, 0.0);
  return karis == 1 ? 1.0 / (1.0 + over * 0.002) : 1.0;
}

void main() {
  vec2 d = texelSize;
  vec3 a = texture(source, vUv + vec2(-2.0, -2.0) * d).rgb;
  vec3 b = texture(source, vUv + vec2( 0.0, -2.0) * d).rgb;
  vec3 c = texture(source, vUv + vec2( 2.0, -2.0) * d).rgb;
  vec3 e = texture(source, vUv + vec2(-1.0, -1.0) * d).rgb;
  vec3 f = texture(source, vUv + vec2( 1.0, -1.0) * d).rgb;
  vec3 g = texture(source, vUv + vec2(-2.0,  0.0) * d).rgb;
  vec3 h = texture(source, vUv).rgb;
  vec3 i = texture(source, vUv + vec2( 2.0,  0.0) * d).rgb;
  vec3 j = texture(source, vUv + vec2(-1.0,  1.0) * d).rgb;
  vec3 k = texture(source, vUv + vec2( 1.0,  1.0) * d).rgb;
  vec3 l = texture(source, vUv + vec2(-2.0,  2.0) * d).rgb;
  vec3 m = texture(source, vUv + vec2( 0.0,  2.0) * d).rgb;
  vec3 n = texture(source, vUv + vec2( 2.0,  2.0) * d).rgb;

  vec3 q0 = (e + f + j + k) * 0.25;
  vec3 q1 = (a + b + g + h) * 0.25;
  vec3 q2 = (b + c + h + i) * 0.25;
  vec3 q3 = (g + h + l + m) * 0.25;
  vec3 q4 = (h + i + m + n) * 0.25;
  float w0 = 0.5 * karisWeight(q0);
  float w1 = 0.125 * karisWeight(q1);
  float w2 = 0.125 * karisWeight(q2);
  float w3 = 0.125 * karisWeight(q3);
  float w4 = 0.125 * karisWeight(q4);
  vec3 sum = q0 * w0 + q1 * w1 + q2 * w2 + q3 * w3 + q4 * w4;
  outColor = vec4(sum / (w0 + w1 + w2 + w3 + w4), 1.0);
}
`

const tent9Glsl = /* glsl */ `
vec3 tent9(sampler2D tex, vec2 uv, vec2 r) {
  vec3 s = texture(tex, uv + vec2(-r.x, -r.y)).rgb;
  s += texture(tex, uv + vec2(0.0, -r.y)).rgb * 2.0;
  s += texture(tex, uv + vec2( r.x, -r.y)).rgb;
  s += texture(tex, uv + vec2(-r.x, 0.0)).rgb * 2.0;
  s += texture(tex, uv).rgb * 4.0;
  s += texture(tex, uv + vec2( r.x, 0.0)).rgb * 2.0;
  s += texture(tex, uv + vec2(-r.x,  r.y)).rgb;
  s += texture(tex, uv + vec2(0.0,  r.y)).rgb * 2.0;
  s += texture(tex, uv + vec2( r.x,  r.y)).rgb;
  return s * (1.0 / 16.0);
}
`

export const upsampleFragment = /* glsl */ `
precision highp float;
uniform sampler2D coarse;
uniform sampler2D detail;
uniform vec2 radiusUv;
uniform float coarseWeight;
uniform float detailWeight;
in vec2 vUv;
out vec4 outColor;

${tent9Glsl}

void main() {
  vec3 c = tent9(coarse, vUv, radiusUv) * coarseWeight;
  vec3 d = texture(detail, vUv).rgb * detailWeight;
  outColor = vec4(c + d, 1.0);
}
`

export const halationFragment = /* glsl */ `
precision highp float;
uniform sampler2D mip0;
uniform sampler2D mip1;
uniform sampler2D mip2;
uniform vec2 r0;
uniform vec2 r1;
uniform vec2 r2;
uniform vec3 weights;
uniform vec3 tint;
in vec2 vUv;
out vec4 outColor;

${tent9Glsl}

void main() {
  vec3 scatter = tent9(mip0, vUv, r0) * weights.x
    + tent9(mip1, vUv, r1) * weights.y
    + tent9(mip2, vUv, r2) * weights.z;
  outColor = vec4(scatter * tint, 1.0);
}
`

export const streakBlurFragment = /* glsl */ `
precision highp float;
uniform sampler2D source;
uniform float stepU;
in vec2 vUv;
out vec4 outColor;

vec3 gated(vec2 uv) {
  return uv.x < 0.0 || uv.x > 1.0 ? vec3(0.0) : texture(source, uv).rgb;
}

void main() {
  const float w0 = 0.227026;
  const float w1 = 0.194595;
  const float w2 = 0.121622;
  const float w3 = 0.054054;
  const float w4 = 0.016216;
  vec3 acc = texture(source, vUv).rgb * w0;
  acc += (gated(vUv + vec2(stepU * 1.0, 0.0)) + gated(vUv - vec2(stepU * 1.0, 0.0))) * w1;
  acc += (gated(vUv + vec2(stepU * 2.0, 0.0)) + gated(vUv - vec2(stepU * 2.0, 0.0))) * w2;
  acc += (gated(vUv + vec2(stepU * 3.0, 0.0)) + gated(vUv - vec2(stepU * 3.0, 0.0))) * w3;
  acc += (gated(vUv + vec2(stepU * 4.0, 0.0)) + gated(vUv - vec2(stepU * 4.0, 0.0))) * w4;
  outColor = vec4(acc, 1.0);
}
`

export const compositeFragment = /* glsl */ `
precision highp float;
uniform sampler2D exposedTex;
uniform sampler2D bloomTex;
uniform sampler2D halationTex;
uniform sampler2D streak0;
uniform sampler2D streak1;
uniform sampler2D streak2;
uniform sampler2D streak3;
uniform vec2 bloomRadiusUv;
uniform float bloomWeight;
uniform float halationWeight;
uniform vec3 halationTint;
uniform int anamorphic;
uniform float streakWeight;
uniform vec3 streakTint;
uniform vec4 streakLevelWeights;
in vec2 vUv;
out vec4 outColor;

${tent9Glsl}

void main() {
  vec3 direct = texelFetch(exposedTex, ivec2(gl_FragCoord.xy), 0).rgb;
  vec3 bloom = tent9(bloomTex, vUv, bloomRadiusUv);
  vec3 halation = texture(halationTex, vUv).rgb;
  vec3 streakEnergy = vec3(0.0);
  if (anamorphic == 1) {
    vec3 s = texture(streak0, vUv).rgb * streakLevelWeights.x
      + texture(streak1, vUv).rgb * streakLevelWeights.y
      + texture(streak2, vUv).rgb * streakLevelWeights.z
      + texture(streak3, vUv).rgb * streakLevelWeights.w;
    streakEnergy = s * streakTint * streakWeight;
  }
  vec3 transmit = max(vec3(0.0), vec3(1.0 - bloomWeight) - halationTint * halationWeight);
  vec3 combined = direct * transmit + bloom * bloomWeight + halation * halationWeight + streakEnergy;
  outColor = vec4(max(combined, 0.0), 1.0);
}
`

export const beautyResolveFragment = /* glsl */ `
precision highp float;
uniform sampler2D compositeTex;
uniform vec2 resolution;
uniform int curveId;
uniform uint grainSeed;
uniform uint ditherSeed;
in vec2 vUv;
out vec4 outColor;

${toneMapGlsl}

vec3 sampleSoft(vec2 uv, vec2 softStepUv) {
  vec3 c = texture(compositeTex, uv).rgb * 0.44;
  c += texture(compositeTex, uv + vec2( softStepUv.x,  softStepUv.y)).rgb * 0.14;
  c += texture(compositeTex, uv + vec2(-softStepUv.x,  softStepUv.y)).rgb * 0.14;
  c += texture(compositeTex, uv + vec2( softStepUv.x, -softStepUv.y)).rgb * 0.14;
  c += texture(compositeTex, uv + vec2(-softStepUv.x, -softStepUv.y)).rgb * 0.14;
  return c;
}

vec3 smoothGrainCell(ivec2 cell, uint seed) {
  uvec3 base = uvec3(uvec2(cell + ivec2(8192)), seed);
  vec3 a = hash3(base);
  vec3 b = hash3(base ^ uvec3(0x68bc21ebu, 0x02e5be93u, 0x9e3779b9u));
  return a + b - 1.0;
}

vec3 softGrainOctave(vec2 p, uint seed) {
  vec2 pf = floor(p);
  ivec2 ip = ivec2(pf);
  vec2 f = p - pf;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 n00 = smoothGrainCell(ip, seed);
  vec3 n10 = smoothGrainCell(ip + ivec2(1, 0), seed);
  vec3 n01 = smoothGrainCell(ip + ivec2(0, 1), seed);
  vec3 n11 = smoothGrainCell(ip + ivec2(1, 1), seed);
  return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
}

vec3 applyGrade(vec3 c) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float peak = max(c.r, max(c.g, c.b));
  float low = min(c.r, min(c.g, c.b));
  float sat = peak > 1e-5 ? (peak - low) / peak : 0.0;
  float neutralMask = 1.0 - sat * 0.78;
  float shadowMask = smoothstep(0.0025, 0.025, luma) * (1.0 - smoothstep(0.07, 0.30, luma));
  float hiMask = smoothstep(0.32, 0.85, luma);
  vec3 shadowBalance = mix(vec3(1.0), vec3(0.982, 0.998, 1.018), shadowMask * neutralMask);
  vec3 hiBalance = mix(vec3(1.0), vec3(1.015, 1.003, 0.985), hiMask * neutralMask);
  return clamp(c * shadowBalance * hiBalance, 0.0, 1.0);
}

void main() {
  float aspect = resolution.x / max(resolution.y, 1.0);
  vec2 metricScale = vec2(aspect, 1.0);
  vec2 p = (vUv - 0.5) * metricScale;
  float diagHalf = 0.5 * sqrt(aspect * aspect + 1.0);
  float r = length(p);
  float rNorm = clamp(r / max(diagHalf, 1e-5), 0.0, 1.0);
  float rNorm2 = rNorm * rNorm;

  // Corners map onto themselves so the frame never samples outside the gate.
  float barrelScale = 1.0 - ${BARREL_DISTORTION.toFixed(5)} * (1.0 - rNorm2);
  vec2 pDistorted = p * barrelScale;
  vec2 uvBase = clamp(pDistorted / metricScale + 0.5, vec2(0.0), vec2(1.0));

  vec2 radialDir = r > 1e-6 ? p / r : vec2(0.0);
  float caShiftH = (${CA_CORNER_PX_1080.toFixed(4)} / 1080.0) * pow(rNorm, 1.8) * 0.5;
  vec2 caOffsetUv = (radialDir * caShiftH) / metricScale;

  float softRadiusH = (${CORNER_SOFTNESS_PX_1080.toFixed(4)} / 1080.0) * rNorm2 * rNorm;
  vec2 softStepUv = vec2(softRadiusH / aspect, softRadiusH);

  vec2 uvR = clamp(uvBase + caOffsetUv, vec2(0.0), vec2(1.0));
  vec2 uvG = uvBase;
  vec2 uvB = clamp(uvBase - caOffsetUv, vec2(0.0), vec2(1.0));

  vec3 lensHdr;
  if (softRadiusH < 1e-5) {
    lensHdr = vec3(
      texture(compositeTex, uvR).r,
      texture(compositeTex, uvG).g,
      texture(compositeTex, uvB).b
    );
  } else {
    lensHdr = vec3(
      sampleSoft(uvR, softStepUv).r,
      sampleSoft(uvG, softStepUv).g,
      sampleSoft(uvB, softStepUv).b
    );
  }

  float cos2 = 1.0 / (1.0 + ${VIGNETTE_STRENGTH.toFixed(4)} * rNorm2);
  float vignette = cos2 * cos2;
  lensHdr *= vignette;

  vec3 mapped = toneMapFilmic(lensHdr, curveId);
  vec3 graded = applyGrade(mapped);
  vec3 display = encodeSrgb(graded);

  float dispLuma = dot(display, vec3(0.2126, 0.7152, 0.0722));
  vec2 grainCoord = gl_FragCoord.xy * (1080.0 / max(resolution.y, 1.0)) / ${GRAIN_SIZE_PX_1080.toFixed(4)};
  vec3 g1 = softGrainOctave(grainCoord, grainSeed);
  vec3 g2 = softGrainOctave(grainCoord * 1.85 + vec2(37.2, 91.7), grainSeed ^ 0x517cc1b7u);
  vec3 rawGrain = (g1 * 0.76 + g2 * 0.24) * 1.95;

  float shadowRamp = mix(0.35, 1.0, smoothstep(0.0, 0.06, dispLuma));
  float highlightFade = pow(1.0 - smoothstep(0.34, 0.97, dispLuma), 1.35);
  float lumaMask = shadowRamp * highlightFade;
  float chromaMask = shadowRamp * pow(1.0 - smoothstep(0.18, 0.78, dispLuma), 1.6);

  float grainLuma = rawGrain.x * ${GRAIN_LUMA_STRENGTH.toFixed(5)} * lumaMask;
  vec2 grainOpponent = (rawGrain.yz - rawGrain.x * 0.25) * ${GRAIN_CHROMA_STRENGTH.toFixed(5)} * chromaMask;
  vec3 grainRgb = vec3(grainLuma + grainOpponent.x, grainLuma - 0.35 * (grainOpponent.x + grainOpponent.y), grainLuma + grainOpponent.y);

  vec3 grained = clamp(display + grainRgb, 0.0, 1.0);
  float dither = tpdfDither(gl_FragCoord.xy, ditherSeed);
  outColor = vec4(clamp(grained + dither, 0.0, 1.0), 1.0);
}
`

export const diagnosticResolveFragment = /* glsl */ `
precision highp float;
uniform sampler2D sum;
uniform float inverseCount;
uniform float exposure;
uniform int mode;
uniform int curveId;
uniform uint ditherSeed;
in vec2 vUv;
out vec4 outColor;

${toneMapGlsl}

void main() {
  vec3 raw = texelFetch(sum, ivec2(gl_FragCoord.xy), 0).rgb * inverseCount;
  if (mode == 1) {
    outColor = vec4(clamp(raw, 0.0, 1.0), 1.0);
    return;
  }
  if (mode == 2) {
    vec3 display = encodeSrgb(clamp(raw, 0.0, 1.0));
    outColor = vec4(clamp(display + tpdfDither(gl_FragCoord.xy, ditherSeed), 0.0, 1.0), 1.0);
    return;
  }
  vec3 mapped = toneMapFilmic(sanitizeScene(raw) * exposure, curveId);
  vec3 display = encodeSrgb(mapped);
  outColor = vec4(clamp(display + tpdfDither(gl_FragCoord.xy, ditherSeed), 0.0, 1.0), 1.0);
}
`
