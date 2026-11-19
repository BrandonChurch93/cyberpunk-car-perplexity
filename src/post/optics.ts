const BARREL = 0.009
const CHROMATIC_OFFSET_PX = 0.54
const CORNER_SOFTNESS = 0.16
const CORNER_SOFTNESS_PX = 0.80
const VIGNETTE_STOPS = 0.85

export const opticsGlsl = /* glsl */ `
vec3 linearSum(vec2 uv, vec2 size) {
  // The accumulator owns a nearest-filtered float texture.
  vec2 xy = clamp(uv * size - 0.5, vec2(0.0), size - 1.0);
  ivec2 p = ivec2(xy);
  ivec2 q = min(p + 1, ivec2(size) - 1);
  vec2 f = fract(xy);
  vec3 a = mix(texelFetch(sum, p, 0).rgb, texelFetch(sum, ivec2(q.x, p.y), 0).rgb, f.x);
  vec3 b = mix(texelFetch(sum, ivec2(p.x, q.y), 0).rgb, texelFetch(sum, q, 0).rgb, f.x);
  return mix(a, b, f.y);
}

vec2 lensGeometry(vec2 uv, vec2 gate, out float radius2) {
  vec2 xy = (uv - 0.5) * gate;
  radius2 = 4.0 * dot(xy, xy) / dot(gate, gate);
  return 0.5 + (uv - 0.5) * (1.0 - ${BARREL} * (1.0 - radius2));
}

vec3 lensSample(vec2 uv, vec2 size, float radius2) {
  vec2 ray = (uv - 0.5) * size;
  vec2 axis = ray * inversesqrt(max(1.0, dot(ray, ray)));
  vec2 onePixel = imageScale / size;
  vec2 split = axis * onePixel * (${CHROMATIC_OFFSET_PX} * radius2);
  vec3 sharp = vec3(linearSum(uv + split, size).r, linearSum(uv, size).g, linearSum(uv - split, size).b);
  vec2 tangent = vec2(-axis.y, axis.x) * onePixel * ${CORNER_SOFTNESS_PX};
  if (radius2 > 0.39) {
    vec3 soft = 0.5 * (linearSum(uv + tangent, size) + linearSum(uv - tangent, size));
    sharp = mix(sharp, soft, ${CORNER_SOFTNESS} * smoothstep(0.39, 1.0, radius2));
  }
  return sharp;
}

float lensVignette(float radius2) {
  float cos2 = 1.0 / (1.0 + (exp2(0.5 * ${VIGNETTE_STOPS}) - 1.0) * radius2);
  return cos2 * cos2;
}
`
