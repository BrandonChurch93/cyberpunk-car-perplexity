export const FILM_CURVES = { NightNegative: 0, SoftReinhard: 1, NeutralShoulder: 2 } as const
export const FILM_CURVE = FILM_CURVES.NightNegative

export const toneMapGlsl = /* glsl */ `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float BLACK_FLOOR = 0.00085;

vec3 toneMap(vec3 x, int curve) {
  x = max(x, 0.0);
  float peak = max(x.r, max(x.g, x.b));
  vec3 y;
  if (curve == 1) {
    vec3 toe = x * (x + 0.12) / (x + 0.24);
    y = toe / (1.0 + toe);
  } else if (curve == 2) {
    vec3 toe = x * (x + 0.04) / (x + 0.15);
    y = 1.0 - exp(-toe);
  } else {
    y = (x * (x + 0.06)) / (x * (x + 0.53) + 0.12);
  }
  float dry = 0.22 * smoothstep(1.5, 20.0, peak) + 0.68 * smoothstep(35.0, 300.0, peak);
  y = mix(y, vec3(max(y.r, max(y.g, y.b))), dry);
  return mix(vec3(BLACK_FLOOR), vec3(1.0), y);
}

vec3 grade(vec3 x) {
  float y = dot(x, LUMA);
  float low = (1.0 - smoothstep(0.005, 0.065, y));
  x = mix(x, vec3(y), 0.09 * low);
  x += low * smoothstep(0.002, 0.018, y) * vec3(-0.0005, 0.0, 0.0009);
  return x + (1.0 - y) * smoothstep(0.35, 0.85, y) * vec3(0.016, 0.004, -0.014);
}

vec3 encodeDisplay(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`
