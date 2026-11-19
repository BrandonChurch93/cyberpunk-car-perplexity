export const FILM_CURVES = { NightNegative: 0, SoftReinhard: 1, NeutralShoulder: 2 } as const
export const FILM_CURVE = FILM_CURVES.NightNegative

export const toneMapGlsl = /* glsl */ `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float BLACK_FLOOR = 0.00085;

vec3 toneMap(vec3 x, int curve) {
  x = max(x, 0.0);
  float peak = max(x.r, max(x.g, x.b));
  x = mix(x, vec3(peak), 0.79 * smoothstep(0.9, 18.0, peak));
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
  return mix(vec3(BLACK_FLOOR), vec3(1.0), y);
}

vec3 encodeDisplay(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`
