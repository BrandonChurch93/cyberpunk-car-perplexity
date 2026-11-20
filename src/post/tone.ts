export const FILM_CURVES = { NightNegative: 0, SoftReinhard: 1, NeutralShoulder: 2 } as const
export const FILM_CURVE = FILM_CURVES.NightNegative
export const NIGHT_NEGATIVE = {
  toe: 0.074,
  shoulder: 0.53,
  foot: 0.12,
  shoulderJoin: 0.63,
  shoulderFalloff: 0.35,
  blackFloor: 0.00085,
} as const

const { toe, shoulder, foot, shoulderJoin: join, shoulderFalloff: falloff, blackFloor } = NIGHT_NEGATIVE
const joinNumerator = join * (join + toe)
const joinDenominator = join * (join + shoulder) + foot
const joinValue = joinNumerator / joinDenominator
const joinSlope = ((2 * join + toe) * joinDenominator - (2 * join + shoulder) * joinNumerator) / joinDenominator ** 2
// Match the toe's value and slope at the shoulder join.
const tailScale = joinSlope / ((1 - joinValue) * falloff)

export const toneMapGlsl = /* glsl */ `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 nightNegative(vec3 x) {
  vec3 toe = x * (x + ${toe}) / (x * (x + ${shoulder}) + ${foot});
  vec3 tail = 1.0 - ${1 - joinValue} * pow(1.0 + ${tailScale} * max(x - ${join}, 0.0), vec3(-${falloff}));
  return mix(toe, tail, step(${join}, x));
}

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
    y = nightNegative(x);
  }
  float dry = 0.22 * smoothstep(1.5, 20.0, peak) + 0.68 * smoothstep(35.0, 300.0, peak);
  y = mix(y, vec3(max(y.r, max(y.g, y.b))), dry);
  return mix(vec3(${blackFloor}), vec3(1.0), y);
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
