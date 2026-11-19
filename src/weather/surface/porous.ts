import * as THREE from 'three'
import { insertAfter, insertBefore, patchMaterial } from '../../materials/patch'
import { surfaceCommonGlsl, surfaceVaryingsGlsl, surfaceVertexGlsl } from './glsl'
import { ripplesGlsl } from './ripples'

export type Uniforms = Record<string, THREE.IUniform>

/**
 * Wet porous ground. Board 01: concrete darkens to 0.5 to 0.6 of dry and gains saturation, roughness falls to 0.15 to 0.3,
 * aggregate keeps 5 to 20 mm patches rougher. Board 02: standing water is a level near-mirror with F0 0.02 and roughness
 * 0.02 to 0.05, a 2 to 5 mm meniscus, a darker damp halo outside it, and depth that hides the aggregate over the first 3 mm.
 */
const porousGlsl = /* glsl */ `
uniform float surfDiag;
uniform float surfRain;
uniform sampler2D surfRelief;
uniform vec4 surfReliefBounds;
uniform float surfReliefScale;
uniform float surfReliefOffset;
uniform vec4 surfShelter;
uniform float surfPorosity;

float surfFineRelief(vec2 p, float detail) {
  float h = 1.2 * (surfNoise2(p / 0.55, 11u) - 0.5) + 0.5 * (surfNoise2(p / 0.17 + 3.1, 12u) - 0.5);
  h += detail * (0.7 * (surfNoise2(p / 0.016, 13u) - 0.5) + 0.35 * (surfNoise2(p / 0.0065 + 7.7, 14u) - 0.5));
  return h;
}

/** Height of the surface against the water line in millimeters. Negative is under water. */
float surfDeckHeight(vec2 p, float detail) {
  float h = 3.0;
  #ifdef SURF_DECK
    vec2 uv = (p - surfReliefBounds.xy) / surfReliefBounds.zw;
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
      h = texture2D(surfRelief, uv).r * surfReliefScale + surfReliefOffset;
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
  float surfDetail = 1.0 - smoothstep(0.004, 0.02, surfFoot);
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
    surfWater = surfUp * surfCover * smoothstep(0.0, -0.35, surfH);
    surfDepth = max(-surfH, 0.0);
    surfFringe = surfUp * surfCover * (1.0 - smoothstep(0.0, 1.6, surfH)) * (1.0 - surfWater);
    if (abs(surfH) < 1.2 && surfDetail > 0.0) {
      float e = 0.006;
      float hx = surfDeckHeight(surfXZ + vec2(e, 0.0), surfDetail);
      float hz = surfDeckHeight(surfXZ + vec2(0.0, e), surfDetail);
      vec2 g = vec2(hx - surfH, hz - surfH) / e;
      float rim = exp(-pow(surfH / 0.22, 2.0)) * surfDetail;
      surfSlope -= rim * 0.00028 * g;
    }
  #else
    float surfH = 3.0 + surfFineRelief(surfXZ, surfDetail);
  #endif
  float surfDeep = surfWater * smoothstep(1.5, 3.0, surfDepth) + surfWater * 0.25;
  surfSlope += surfRipples(surfXZ, min(surfDeep, 1.0), surfWet * surfUp * (1.0 - surfWater) * 0.6, 0.0) * surfDetail;

  float surfDamp = clamp(surfWet + surfFringe * 0.6, 0.0, 1.0);
  float surfDark = mix(1.0, mix(0.9, mix(0.5, 0.6, surfAgg), surfPorosity), surfDamp);
  surfDark *= mix(1.0, 0.82, surfFringe);
  surfDark *= mix(1.0, mix(0.55, 0.3, smoothstep(0.0, 3.0, surfDepth)), surfWater);
  float surfL = surfLuma(diffuseColor.rgb);
  diffuseColor.rgb = max(mix(vec3(surfL), diffuseColor.rgb, 1.0 + 0.15 * surfDamp), 0.0) * surfDark;
  float surfRoughWet = mix(0.16, 0.3, smoothstep(0.35, 0.75, surfAgg));
  roughnessFactor = mix(roughnessFactor, min(roughnessFactor, surfRoughWet), surfDamp);
  roughnessFactor = mix(roughnessFactor, 0.035, surfWater);
  vec3 surfFlat = mix(surfN, vec3(0.0, 1.0, 0.0), surfWater);
  vec3 surfWorldN = normalize(surfFlat + vec3(-surfSlope.x, 0.0, -surfSlope.y));
  normal = surfToView(surfWorldN);
  surfWaterOut = surfWater;
  surfDiagOut = vec4(mix(vec3(1.0, 0.45, 0.1) * (0.25 + 0.75 * surfDamp), vec3(0.15, 0.45, 1.0), surfWater), 1.0);
  surfDiagOut.rgb = mix(surfDiagOut.rgb, vec3(0.1, 0.25, 0.9), surfFringe * 0.4);
}
`

/** Water F0 0.02 over standing water, set after the material's own specular so the surface reads as water and not as a varnish. */
const waterSpecular = /* glsl */ `
material.specularColor = mix(material.specularColor, vec3(0.02), surfWaterOut);
material.specularF90 = mix(material.specularF90, 1.0, surfWaterOut);
`

export const diagnosticFragment = /* glsl */ `
if (surfDiag > 0.5) {
  outgoingLight = surfDiagOut.rgb;
}
`

/** Sealed or painted ground carries `userData.wetPorosity` below 1: it darkens less when wet and still turns glossy. */
export function applyPorous(material: THREE.Material, uniforms: Uniforms, deck: boolean): void {
  const porosity = typeof material.userData.wetPorosity === 'number' ? THREE.MathUtils.clamp(material.userData.wetPorosity, 0, 1) : 1
  patchMaterial(material, {
    id: deck ? 'surface water deck' : 'surface water porous',
    uniforms: { ...uniforms, surfPorosity: { value: porosity } },
    defines: deck ? { SURF_DECK: 1, SURF_STANDING: 1 } : {},
    apply(shader) {
      shader.vertexShader = surfaceVaryingsGlsl(false) + insertAfter(shader.vertexShader, '#include <project_vertex>', surfaceVertexGlsl(false))
      let f = shader.fragmentShader
      f = surfaceVaryingsGlsl(false) + surfaceCommonGlsl + ripplesGlsl + porousGlsl + f
      f = insertBefore(f, '#include <map_fragment>', 'float surfWaterOut = 0.0;\nvec4 surfDiagOut = vec4(0.0);')
      f = insertAfter(f, '#include <clearcoat_normal_fragment_maps>', porousFragment)
      f = insertAfter(f, '#include <lights_physical_fragment>', waterSpecular)
      f = insertBefore(f, '#include <opaque_fragment>', diagnosticFragment)
      shader.fragmentShader = f
    },
  })
}
