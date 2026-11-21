import * as THREE from 'three'
import { config } from '../../config'
import { insertAfter, insertBefore, patchMaterial } from '../../materials/patch'
import { prevailingWind } from '../air/motion'
import { surfaceCommonGlsl, surfaceVaryingsGlsl, surfaceVertexGlsl } from './glsl'
import { ripplesGlsl } from './ripples'

export type Uniforms = Record<string, THREE.IUniform>

/**
 * Wet porous ground. Board 01: concrete darkens to 0.5 to 0.6 of dry and gains saturation, roughness falls to 0.15 to 0.3,
 * aggregate keeps 5 to 20 mm patches rougher. Board 02: standing water is a level near-mirror with F0 0.02 and roughness
 * 0.02 to 0.05 once it is deep, rougher where a thin sheet follows the aggregate, a 2 to 5 mm meniscus, a darker damp halo outside it, and depth that hides the aggregate over the first 3 mm.
 */
/**
 * The rain sheet on the deck: the film the rain keeps over the aggregate (negative, so the tips break it), the pooled level over the
 * slab's resting height near the car and away from it, the spread of its broad and small crowns and how much of that spread is
 * left near the car, so only the basins hold deep water there, and the low fall around the car, in world X and Z meters.
 */
const sheet = { filmMm: -0.3, baseMm: -4, nearNoise: 0.4, farMm: 4.5, broadMm: 16, patchMm: 7, low: [-2.6, -0.5, 3.0, 5.4], fallMeters: 2.5 }
/**
 * The car's body hides most of the sky from the deck beneath it: the indirect light there falls to a floor inside the footprint,
 * grown by a margin to the body's edge, and recovers within a reach outside it. The planar mirror already sees the underside, so
 * only the rough environment term is occluded.
 */
const occlusion = { margin: [0.2, 0.25], floor: 0.15, inside: 0.3, reach: 0.35 }
/** Undulation of the slab below a puddle's scale: wavelengths in meters and slope amplitude of each. */
const undulation = [
  [0.045, 0.045],
  [0.11, 0.033],
]

/** Faces of the exposed aggregate on damp crowns: wavelength in meters and slope amplitude. */
const aggregate = [
  [0.014, 0.06],
  [0.0065, 0.04],
]
/** Roughness the film over resolved aggregate keeps between its faces. */
const aggregateFloor = 0.12

/**
 * Wind ripples on standing water under the gusting wind: wavelength in meters, slope, and how many wavelengths each octave
 * travels downwind over the film, so the pattern returns to its start. They break each mirrored source into a long broken streak.
 */
const windSpeed = 0.25
const windRipples = [
  [0.12, 0.02],
].map(([w, a]) => [w, a, Math.max(1, Math.round((windSpeed * config.film.durationSeconds) / w))])
const windAcross = 2.2

const porousGlsl = /* glsl */ `
uniform float surfDiag;
uniform float surfRain;
uniform sampler2D surfRelief;
uniform vec4 surfReliefBounds;
uniform float surfReliefScale;
uniform float surfReliefOffset;
uniform vec4 surfShelter;
uniform float surfPorosity;
uniform float surfTime;

float surfTips(vec2 p, float detail) {
  return detail * (0.7 * (surfNoise2(p / 0.016, 13u) - 0.5) + 0.35 * (surfNoise2(p / 0.0065 + 7.7, 14u) - 0.5));
}

float surfFineRelief(vec2 p, float detail) {
  return 1.2 * (surfNoise2(p / 0.55, 11u) - 0.5) + 0.5 * (surfNoise2(p / 0.17 + 3.1, 12u) - 0.5) + surfTips(p, detail);
}

/**
 * Depth of rain held on the deck above its relief, in millimeters. Heavy rain floods the shallow fall of a roof deck into wide
 * sheets, broken by drier crowns half a meter to two meters across where the slab sits high.
 */
float surfSheetLift(vec2 p) {
  float broad = surfNoise2(p / 1.3 + 17.0, 31u) - 0.5;
  float patchy = surfNoise2(p / 0.42 + 5.0, 32u) - 0.5;
  vec2 o = max(max(vec2(${sheet.low[0].toFixed(2)}, ${sheet.low[1].toFixed(2)}) - p, p - vec2(${sheet.low[2].toFixed(2)}, ${sheet.low[3].toFixed(2)})), vec2(0.0));
  float low = 1.0 - smoothstep(0.0, ${sheet.fallMeters.toFixed(2)}, length(o));
  return mix(${sheet.farMm.toFixed(2)}, ${sheet.baseMm.toFixed(2)}, low) + mix(1.0, ${sheet.nearNoise.toFixed(2)}, low) * (${sheet.broadMm.toFixed(2)} * broad + ${sheet.patchMm.toFixed(2)} * patchy);
}

vec3 surfNoiseGrad(vec2 p, uint salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  ivec2 c = ivec2(i);
  float a = surfHash2(c, salt).x;
  float b = surfHash2(c + ivec2(1, 0), salt).x;
  float d = surfHash2(c + ivec2(0, 1), salt).x;
  float e = surfHash2(c + ivec2(1, 1), salt).x;
  return vec3(mix(mix(a, b, u.x), mix(d, e, u.x), u.y), du.x * mix(b - a, e - d, u.y), du.y * mix(d - a, e - b, u.x));
}

float surfUndulationVar;

/** Slope of the slab's undulation. Octaves finer than the footprint leave the slope and add their variance to surfUndulationVar. */
vec2 surfUndulation(vec2 p, float foot) {
  vec2 slope = vec2(0.0);
  surfUndulationVar = 0.0;
  ${undulation.map(([w, a], i) => `{
    vec3 n = surfNoiseGrad(p / ${w.toFixed(3)} + ${(3.7 * i).toFixed(1)}, ${51 + i}u);
    float filt = exp(-2.0 * pow(foot / ${w.toFixed(3)}, 2.0));
    slope += ${a.toFixed(3)} * filt * n.yz;
    surfUndulationVar += ${(a * a * 0.15).toFixed(6)} * (1.0 - filt * filt);
  }`).join('\n  ')}
  return slope;
}

vec3 surfNoiseGradWrap(vec2 p, int period, uint salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  ivec2 c = ivec2(i);
  int x0 = ((c.x % period) + period) % period;
  int x1 = (x0 + 1) % period;
  float a = surfHash2(ivec2(x0, c.y), salt).x;
  float b = surfHash2(ivec2(x1, c.y), salt).x;
  float d = surfHash2(ivec2(x0, c.y + 1), salt).x;
  float e = surfHash2(ivec2(x1, c.y + 1), salt).x;
  return vec3(mix(mix(a, b, u.x), mix(d, e, u.x), u.y), du.x * mix(b - a, e - d, u.y), du.y * mix(d - a, e - b, u.x));
}

float surfAggregateHeld;

/** Slope of the wet aggregate's faces on the damp slab. Octaves the footprint resolves move their variance out of the roughness. */
vec2 surfAggregate(vec2 p, float foot) {
  vec2 slope = vec2(0.0);
  surfAggregateHeld = 0.0;
  ${aggregate.map(([w, a], i) => `{
    vec3 n = surfNoiseGrad(p / ${w.toFixed(4)} + ${(5.3 * i).toFixed(1)}, ${71 + i}u);
    float filt = exp(-2.0 * pow(foot / ${w.toFixed(4)}, 2.0));
    slope += ${a.toFixed(3)} * filt * n.yz;
    surfAggregateHeld += ${(a * a * 0.15).toFixed(6)} * filt * filt;
  }`).join('\n  ')}
  return slope;
}

float surfWindVar;

/** Slope of the wind ripples on open water at time t. Octaves finer than the footprint add their variance to surfWindVar. */
vec2 surfWind(vec2 p, float foot, float t) {
  vec2 along = vec2(${prevailingWind[0].toFixed(3)}, ${prevailingWind[1].toFixed(3)});
  along = normalize(along);
  vec2 across = vec2(-along.y, along.x);
  vec2 q = vec2(dot(p, along), dot(p, across));
  float phase = t / ${config.film.durationSeconds.toFixed(3)};
  vec2 slope = vec2(0.0);
  surfWindVar = 0.0;
  ${windRipples.map(([w, a, c], i) => `{
    vec3 n = surfNoiseGradWrap(vec2(q.x / ${w.toFixed(3)} - phase * ${c.toFixed(1)}, q.y / ${(w * windAcross).toFixed(4)}), ${c}, ${61 + i}u);
    float filt = exp(-2.0 * pow(foot / ${w.toFixed(3)}, 2.0));
    vec2 g = vec2(n.y, n.z / ${windAcross.toFixed(2)});
    slope += ${a.toFixed(3)} * filt * (along * g.x + across * g.y);
    surfWindVar += ${(a * a * 0.15).toFixed(6)} * (1.0 - filt * filt);
  }`).join('\n  ')}
  return slope;
}

/** Height of the surface against the water line in millimeters. Negative is under water. */
float surfDeckHeight(vec2 p, float detail) {
  float h = 3.0;
  #ifdef SURF_DECK
    vec2 uv = (p - surfReliefBounds.xy) / surfReliefBounds.zw;
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
      float pool = texture2D(surfRelief, uv).r * surfReliefScale + surfReliefOffset - surfSheetLift(p) + surfFineRelief(p, detail);
      return min(pool, ${sheet.filmMm.toFixed(2)} * surfRain + surfTips(p, detail));
    }
  #endif
  return h + surfFineRelief(p, detail);
}

float surfShelterAt(vec2 p) {
  vec2 o = max(max(surfShelter.xy - p, p - surfShelter.zw), vec2(0.0));
  return 1.0 - smoothstep(0.0, 0.5, length(o));
}
`

const porousFragment = /* glsl */ `
{
  vec3 surfN = surfToWorld(normal);
  vec2 surfXZ = surfWorldPos.xz;
  float surfFoot = length(fwidth(surfWorldPos));
  // Glints stretch along the view on a grazing deck, so the aggregate is filtered on the mean of the two footprint axes.
  float surfGrain = sqrt(length(dFdx(surfWorldPos)) * length(dFdy(surfWorldPos)));
  float surfDetail = 1.0 - smoothstep(0.004, 0.02, surfGrain);
  float surfUp = smoothstep(0.55, 0.9, surfN.y);
  float surfCover = 1.0 - 0.75 * surfShelterAt(surfXZ);
  float surfWet = surfRain * mix(0.8, 1.0, surfUp) * surfCover;
  float surfAgg = surfNoise2(surfXZ / 0.011, 21u);
  float surfWater = 0.0;
  float surfFringe = 0.0;
  float surfDepth = 0.0;
  vec2 surfSlope = vec2(0.0);
  #ifdef SURF_STANDING
    float surfH = surfDeckHeight(surfXZ, surfDetail);
    float surfGround = 1.0;
    #ifdef SURF_GROUNDED
      surfGround = 1.0 - smoothstep(0.01, 0.03, abs(surfWorldPos.y));
    #endif
    surfDepth = max(-surfH, 0.0);
    surfWater = surfGround * surfUp * mix(surfCover, 1.0, smoothstep(0.5, 2.0, surfDepth)) * smoothstep(0.0, -0.35, surfH);
    surfFringe = surfGround * surfUp * surfCover * (1.0 - smoothstep(0.0, 1.6, surfH)) * (1.0 - surfWater);
    if (abs(surfH) < 1.2 && surfDetail > 0.0) {
      float e = 0.006;
      float hx = surfDeckHeight(surfXZ + vec2(e, 0.0), surfDetail);
      float hz = surfDeckHeight(surfXZ + vec2(0.0, e), surfDetail);
      vec2 g = vec2(hx - surfH, hz - surfH) / e;
      float rim = exp(-pow(surfH / 0.22, 2.0)) * surfDetail * surfGround;
      surfSlope -= rim * 0.00028 * g;
    }
  #else
    float surfH = 3.0 + surfFineRelief(surfXZ, surfDetail);
  #endif
  float surfDeep = surfWater * (0.6 + 0.4 * smoothstep(1.5, 3.0, surfDepth));
  surfSlope += surfRipples(surfXZ, min(surfDeep, 1.0), surfWet * surfUp * mix(0.6, 1.0, surfWater), 0.0, surfFoot);
  float surfSlab = surfUp * (1.0 - surfWater * smoothstep(0.5, 4.0, surfDepth));
  surfSlope += surfSlab * surfUndulation(surfXZ, surfFoot);
  float surfOpen = surfDeep * surfCover;
  surfSlope += surfOpen * surfWind(surfXZ, surfFoot, surfTime);
  float surfSlopeVar = surfRingVar + surfSlab * surfSlab * surfUndulationVar + surfOpen * surfOpen * surfWindVar;
  float surfCrown = surfUp * (1.0 - surfWater * smoothstep(0.5, 3.0, surfDepth));
  surfSlope += surfCrown * surfAggregate(surfXZ, surfGrain);

  float surfDamp = clamp(surfWet + surfFringe * 0.6, 0.0, 1.0);
  float surfStain = 0.6 * surfNoise2(surfXZ / 0.35 + 9.0, 41u) + 0.4 * surfNoise2(surfXZ / 0.09 + 2.0, 42u);
  float surfDark = mix(1.0, mix(0.9, mix(0.3, 0.7, surfStain) * mix(0.92, 1.08, surfAgg), surfPorosity), surfDamp);
  surfDark *= mix(1.0, 0.82, surfFringe);
  surfDark *= mix(1.0, mix(0.55, 0.45, smoothstep(0.0, 3.0, surfDepth)), surfWater * mix(0.3, 1.0, surfPorosity));
  float surfNv = clamp(dot(surfToView(vec3(0.0, 1.0, 0.0)), normalize(vViewPosition)), 0.0, 1.0);
  float surfExit = 1.0 - (0.02 + 0.98 * pow(1.0 - surfNv, 5.0));
  surfDark *= mix(1.0, surfExit * surfExit, max(surfWater, 0.7 * surfDamp));
  float surfL = surfLuma(diffuseColor.rgb);
  diffuseColor.rgb = max(mix(vec3(surfL), diffuseColor.rgb, 1.0 + 0.15 * surfDamp), 0.0) * surfDark;
  float surfRoughWet = mix(0.18, 0.32, smoothstep(0.35, 0.75, surfAgg));
  roughnessFactor = mix(roughnessFactor, min(roughnessFactor, surfRoughWet), surfDamp);
  roughnessFactor = mix(roughnessFactor, mix(0.1, 0.04, smoothstep(1.0, 6.0, surfDepth)), surfWater);
  float surfR4 = pow(roughnessFactor, 4.0);
  roughnessFactor = sqrt(sqrt(max(surfR4 - 2.0 * surfCrown * surfCrown * surfAggregateHeld, min(surfR4, ${(aggregateFloor ** 4).toExponential(3)}))));
  roughnessFactor = sqrt(sqrt(pow(roughnessFactor, 4.0) + 2.0 * surfSlopeVar));
  vec3 surfFlat = mix(surfN, vec3(0.0, 1.0, 0.0), surfWater);
  vec3 surfWorldN = normalize(surfFlat + vec3(-surfSlope.x, 0.0, -surfSlope.y));
  normal = surfToView(surfWorldN);
  surfWaterOut = surfWater;
  vec2 surfBodyQ = abs(surfXZ - 0.5 * (surfShelter.xy + surfShelter.zw)) - 0.5 * (surfShelter.zw - surfShelter.xy) - vec2(${occlusion.margin[0].toFixed(2)}, ${occlusion.margin[1].toFixed(2)});
  float surfBodyD = length(max(surfBodyQ, 0.0)) + min(max(surfBodyQ.x, surfBodyQ.y), 0.0);
  surfAOOut = mix(${occlusion.floor.toFixed(2)}, 1.0, smoothstep(-${occlusion.inside.toFixed(2)}, ${occlusion.reach.toFixed(2)}, surfBodyD));
  surfDiagOut = vec4(mix(vec3(1.0, 0.45, 0.1) * (0.25 + 0.75 * surfDamp), vec3(0.15, 0.45, 1.0), surfWater), 1.0);
  surfDiagOut.rgb = mix(surfDiagOut.rgb, vec3(0.1, 0.25, 0.9), surfFringe * 0.4);
}
`

const bodyOcclusion = /* glsl */ `
reflectedLight.indirectDiffuse *= surfAOOut;
reflectedLight.indirectSpecular *= mix(1.0, computeSpecularOcclusion(saturate(dot(geometryNormal, geometryViewDir)), surfAOOut, material.roughness), smoothstep(0.15, 0.4, material.roughness));
`

/** Water F0 0.02 over standing water, set after the material's own specular so the surface reads as water and not as a varnish. */
const waterSpecular = /* glsl */ `
material.specularColor = mix(material.specularColor, vec3(0.02), surfWaterOut);
material.specularColorBlended = mix(material.specularColorBlended, vec3(0.02), surfWaterOut);
material.specularF90 = mix(material.specularF90, 1.0, surfWaterOut);
`

export const diagnosticFragment = /* glsl */ `
if (surfDiag > 0.5) {
  outgoingLight = surfDiagOut.rgb;
}
`

/**
 * Sealed or painted ground carries `userData.wetPorosity` below 1: it darkens less when wet and still turns glossy. Anything else
 * that lies on the deck plane, such as the bay lines, floods with the deck.
 */
export function applyPorous(material: THREE.Material, uniforms: Uniforms, deck: boolean): void {
  const porosity = typeof material.userData.wetPorosity === 'number' ? THREE.MathUtils.clamp(material.userData.wetPorosity, 0, 1) : 1
  patchMaterial(material, {
    id: deck ? 'surface water deck' : 'surface water porous',
    uniforms: { ...uniforms, surfPorosity: { value: porosity } },
    defines: deck ? { SURF_DECK: 1, SURF_STANDING: 1 } : { SURF_DECK: 1, SURF_STANDING: 1, SURF_GROUNDED: 1 },
    apply(shader) {
      shader.vertexShader = surfaceVaryingsGlsl(false) + insertAfter(shader.vertexShader, '#include <project_vertex>', surfaceVertexGlsl(false))
      let f = shader.fragmentShader
      f = surfaceVaryingsGlsl(false) + surfaceCommonGlsl + ripplesGlsl + porousGlsl + f
      f = insertBefore(f, '#include <map_fragment>', 'float surfWaterOut = 0.0;\nfloat surfAOOut = 1.0;\nvec4 surfDiagOut = vec4(0.0);')
      f = insertAfter(f, '#include <clearcoat_normal_fragment_maps>', porousFragment)
      f = insertAfter(f, '#include <lights_physical_fragment>', waterSpecular)
      f = insertBefore(f, '#include <aomap_fragment>', bodyOcclusion)
      f = insertBefore(f, '#include <opaque_fragment>', diagnosticFragment)
      shader.fragmentShader = f
    },
  })
}
