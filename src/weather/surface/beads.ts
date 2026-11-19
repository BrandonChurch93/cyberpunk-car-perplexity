import * as THREE from 'three'
import { filmLightsGlsl } from '../../core/lights'
import { insertAfter, insertBefore, patchMaterial } from '../../materials/patch'
import { surfaceCommonGlsl, surfaceVaryingsGlsl, surfaceVertexGlsl } from './glsl'
import { surfHash3 } from './hash'
import type { Uniforms } from './porous'

/**
 * One size class of the drop field. Cells hold at most one drop, kept inside the cell, so a fragment reads one cell per layer.
 * Board 08: 70 percent of drops 0.3 to 1.5 mm, 25 percent 1.5 to 6 mm, 5 percent merged 8 to 20 mm.
 */
export interface BeadLayer {
  cellMm: number
  minMm: number
  maxMm: number
  /** Chance a cell holds a drop on a level face and on a vertical face. */
  flat: number
  steep: number
  /** Number of lobes merged into one drop. */
  lobes: number
}

export const beadLayers: BeadLayer[] = [
  { cellMm: 1.1, minMm: 0.12, maxMm: 0.45, flat: 0.55, steep: 0.35, lobes: 1 },
  { cellMm: 3.4, minMm: 0.5, maxMm: 1.6, flat: 0.72, steep: 0.45, lobes: 1 },
  { cellMm: 10, minMm: 1.6, maxMm: 4.8, flat: 0.62, steep: 0.28, lobes: 1 },
  { cellMm: 36, minMm: 6, maxMm: 13, flat: 0.3, steep: 0.04, lobes: 2 },
]

/** Drops at or above this diameter are real geometry near the lens. Smaller ones stay in the shader at every distance. */
export const geometryMinMm = 0.8
/** Height a large drop levels off at, against gravity: about the capillary length of water. */
const capMm = 3

export interface BeadClass {
  /** Contact angle in degrees. Board 08: 95 to 110 on waxed paint. Board 09: under 15 on bare glass, more with a coating. */
  contactDegrees: number
  salt: number
}

export interface Drop {
  /** Center in the projected cell plane, meters. */
  u: number
  v: number
  radius: number
  height: number
  diameterMm: number
  layer: number
  lobe: number
}

const axisUV = (axis: number, p: THREE.Vector3): [number, number] => (axis === 0 ? [p.y, p.z] : axis === 1 ? [p.z, p.x] : [p.x, p.y])

export function dominantAxis(n: THREE.Vector3): number {
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  return ax > ay && ax > az ? 0 : ay > az ? 1 : 2
}

export function capHeight(radius: number, contactDegrees: number): number {
  const theta = THREE.MathUtils.degToRad(contactDegrees)
  const hs = (radius * (1 - Math.cos(theta))) / Math.sin(theta)
  const cap = capMm / 1000
  return hs / Math.sqrt(1 + (hs / cap) * (hs / cap))
}

/** The drops of one cell, exactly as the shader places them. `level` is the face's cosine against up, `slope` the sine of its tilt. */
export function cellDrops(layerIndex: number, cx: number, cy: number, axis: number, bead: BeadClass, level: number, slope: number): Drop[] {
  const layer = beadLayers[layerIndex]
  const cell = layer.cellMm / 1000
  const [hx, hy, hz] = surfHash3(cx, cy, axis * 4 + layerIndex, bead.salt)
  const density = densityFor(layer, level)
  if (hx >= density) return []
  const size = hx / density
  const diameterMm = layer.minMm + (layer.maxMm - layer.minMm) * Math.pow(size, 1.7)
  const stretch = 1 + 1.1 * slope
  let radius = Math.min(diameterMm / 2000, (0.24 * cell) / (layer.lobes > 1 ? 1.25 : 1) / stretch)
  const drops: Drop[] = []
  const u = (cx + 0.25 + 0.5 * hy) * cell
  const v = (cy + 0.25 + 0.5 * hz) * cell
  drops.push({ u, v, radius, height: capHeight(radius, bead.contactDegrees), diameterMm, layer: layerIndex, lobe: 0 })
  if (layer.lobes > 1) {
    const [lx, ly] = surfHash3(cx, cy, axis * 4 + layerIndex, bead.salt + 1)
    const angle = lx * Math.PI * 2
    radius *= 0.7
    const r2 = radius * (0.55 + 0.35 * ly)
    drops.push({ u: u + Math.cos(angle) * radius * 0.85, v: v + Math.sin(angle) * radius * 0.85, radius: r2, height: capHeight(r2, bead.contactDegrees), diameterMm: r2 * 2000, layer: layerIndex, lobe: 1 })
  }
  return drops
}

function densityFor(layer: BeadLayer, level: number): number {
  const up = THREE.MathUtils.smoothstep(level, 0.2, 0.95)
  const under = THREE.MathUtils.smoothstep(-level, 0.3, 0.9)
  return (layer.steep + (layer.flat - layer.steep) * up) * (1 - 0.8 * under)
}

export { axisUV }

const layerGlsl = beadLayers
  .map((l, i) => `  if (i == ${i}) { cellMm = ${l.cellMm.toFixed(3)}; minMm = ${l.minMm.toFixed(3)}; maxMm = ${l.maxMm.toFixed(3)}; flatD = ${l.flat.toFixed(3)}; steepD = ${l.steep.toFixed(3)}; lobes = ${l.lobes}; }`)
  .join('\n')

const beadsGlsl = /* glsl */ `
uniform float surfDiag;
uniform float surfTime;
uniform float surfVibration;
uniform float surfShakeAge;
uniform float surfRefill;
uniform float surfBeadSalt;
uniform float surfBeadContact;
uniform vec4 surfGeo;
uniform vec3 surfVehicleCenter;
${filmLightsGlsl.replaceAll("filmCompactBeamFalloff", "surfCompactBeamFalloff")}

void surfLayer(int i, out float cellMm, out float minMm, out float maxMm, out float flatD, out float steepD, out int lobes) {
  cellMm = 1.0; minMm = 0.1; maxMm = 0.2; flatD = 0.0; steepD = 0.0; lobes = 1;
${layerGlsl}
}

float surfCapHeight(float radius) {
  float theta = radians(surfBeadContact);
  float hs = radius * (1.0 - cos(theta)) / sin(theta);
  float cap = ${(capMm / 1000).toFixed(4)};
  return hs / sqrt(1.0 + (hs / cap) * (hs / cap));
}

/** Embeds a projected offset back into 3D on the tangent plane, so footprints stay round on tilted faces. */
vec3 surfLift(vec2 d, int axis, vec3 n) {
  vec3 o;
  if (axis == 0) o = vec3(0.0, d.x, d.y);
  else if (axis == 1) o = vec3(d.y, 0.0, d.x);
  else o = vec3(d.x, d.y, 0.0);
  float na = axis == 0 ? n.x : (axis == 1 ? n.y : n.z);
  float lift = -dot(o, n) / na;
  if (axis == 0) o.x = lift; else if (axis == 1) o.y = lift; else o.z = lift;
  return o;
}

struct SurfHit {
  float cover;
  float r;
  vec3 normal;
  vec3 offset;
  float radius;
  float height;
  float geometry;
  float rim;
};

void surfCap(inout SurfHit hit, vec3 d3, float radius, float height, vec3 n, vec3 down, float slope, float pix, float geometry) {
  float along = dot(d3, down);
  float stretch = along < 0.0 ? 1.0 + 1.1 * slope : 1.0 + 0.2 * slope;
  vec3 q = d3 - down * along * (1.0 - 1.0 / stretch);
  float r = length(q) / radius;
  if (r >= 1.0) return;
  float aspect = height / radius;
  float qexp = 2.0 + 3.0 * clamp(1.0 - aspect, 0.0, 1.0);
  float rq = pow(r, qexp);
  float z = height * pow(max(1.0 - rq, 1e-4), 1.0 / qexp);
  if (z <= hit.height) return;
  float grad = height / radius * pow(r, qexp - 1.0) * pow(max(1.0 - rq, 1e-4), 1.0 / qexp - 1.0);
  grad = min(grad, 6.0);
  vec3 radial = q / max(length(q), 1e-7);
  float aa = clamp(pix / radius, 0.0, 1.0);
  hit.cover = 1.0 - smoothstep(1.0 - 1.5 * aa - 0.02, 1.0, r);
  hit.r = r;
  hit.normal = normalize(n + grad * radial);
  hit.offset = d3;
  hit.radius = radius;
  hit.height = z;
  hit.geometry = geometry;
  hit.rim = smoothstep(0.62, 0.98, r);
}
`

const beadsFragment = /* glsl */ `
SurfHit surfHit = SurfHit(0.0, 0.0, vec3(0.0), vec3(0.0), 0.0, 0.0, 0.0, 0.0);
float surfMist = 0.0;
{
  vec3 n = normalize(surfObjNormal);
  vec3 an = abs(n);
  int axis = an.x > an.y && an.x > an.z ? 0 : (an.y > an.z ? 1 : 2);
  vec3 g = normalize(surfObjGravity);
  vec3 gt = g - n * dot(g, n);
  float slope = length(gt);
  vec3 down = slope > 1e-4 ? gt / slope : vec3(0.0);
  float level = -dot(n, g);
  vec3 p = surfObjPos;
  vec2 uv = axis == 0 ? p.yz : (axis == 1 ? p.zx : p.xy);
  float pix = max(length(fwidth(p)), 1e-6);
  mat3 toView = mat3(surfObjToView0, surfObjToView1, surfObjToView2);
  float up = smoothstep(0.2, 0.95, level);
  float under = smoothstep(0.3, 0.9, -level);
  uint salt = uint(surfBeadSalt);
  float shake = surfVibration;
  for (int i = 0; i < ${beadLayers.length}; i++) {
    float cellMm, minMm, maxMm, flatD, steepD;
    int lobes;
    surfLayer(i, cellMm, minMm, maxMm, flatD, steepD, lobes);
    float cell = cellMm * 0.001;
    float density = mix(steepD, flatD, up) * (1.0 - 0.8 * under);
    if (maxMm * 0.001 < 0.6 * pix) {
      surfMist += density * 0.6 * (maxMm / cellMm) * (maxMm / cellMm);
      continue;
    }
    ivec2 c = ivec2(floor(uv / cell));
    vec3 h = surfHash3(ivec3(c, axis * 4 + i), salt);
    if (h.x >= density) continue;
    float size = h.x / density;
    float dMm = mix(minMm, maxMm, pow(size, 1.7));
    float stretch = 1.0 + 1.1 * slope;
    float radius = min(dMm * 0.0005, 0.24 * cell / (lobes > 1 ? 1.25 : 1.0) / stretch);
    vec2 center = (vec2(c) + 0.25 + 0.5 * h.yz) * cell;
    vec3 shakeH = surfHash3(ivec3(c, 97 + i), salt);
    float loose = step(shakeH.x, 0.35 * smoothstep(0.1, 0.4, slope)) * step(1.6, dMm) * smoothstep(-0.6, -1.2, surfWorldPos.z - surfVehicleCenter.z);
    vec3 d3 = surfLift(center - uv, axis, n);
    if (shake > 0.0) {
      float w = 6.2831853 * (37.0 + 11.0 * shakeH.y) * surfTime;
      d3 += 0.12 * radius * shake * (sin(w) * cross(n, down) + cos(1.3 * w) * down);
    }
    if (loose > 0.0 && surfShakeAge > 0.0) {
      float travel = 0.5 * 2.5 * surfShakeAge * surfShakeAge * mix(0.6, 1.4, shakeH.z);
      float gone = smoothstep(0.0, 0.6 * cell, travel);
      if (surfRefill > 0.0) {
        travel = 0.0;
        gone = 1.0 - surfRefill;
      }
      d3 -= down * min(travel, 0.7 * cell);
      radius *= 1.0 - 0.85 * gone;
    }
    float height = surfCapHeight(radius);
    vec3 worldCenter = surfWorldPos + (vec4(toView * d3, 0.0) * viewMatrix).xyz;
    float geometry = surfGeo.w > 0.5 && i > 0 && dMm >= ${geometryMinMm.toFixed(2)} && distance(worldCenter, surfGeo.xyz) < surfGeo.w ? 1.0 : 0.0;
    float sizeBefore = surfHit.height;
    surfCap(surfHit, d3, radius, height, n, down, slope, pix, geometry);
    if (lobes > 1) {
      vec3 lh = surfHash3(ivec3(c, axis * 4 + i), salt + 1u);
      float angle = lh.x * 6.2831853;
      float r1 = radius * 0.7;
      float r2 = r1 * (0.55 + 0.35 * lh.y);
      vec2 lc = center + vec2(cos(angle), sin(angle)) * r1 * 0.85;
      vec3 l3 = surfLift(lc - uv, axis, n);
      surfCap(surfHit, l3, r2, surfCapHeight(r2), n, down, slope, pix, geometry);
    }
  }
  surfMist = clamp(surfMist, 0.0, 1.0);
  float w = surfHit.cover;
  float shaded = w * (1.0 - surfHit.geometry);
  vec3 dropView = normalize(toView * surfHit.normal);
  diffuseColor.rgb *= mix(1.0, 0.86, surfMist);
  diffuseColor.rgb *= mix(1.0, mix(0.72, 0.3, surfHit.rim), w);
  if (shaded > 0.0) {
    vec3 tilt = dropView - normal;
    normal = normalize(normal - shaded * (0.6 + 1.2 * surfHit.r) * tilt);
    #ifdef USE_CLEARCOAT
      clearcoatNormal = normalize(mix(clearcoatNormal, dropView, shaded));
    #else
      normal = normalize(mix(normal, dropView, shaded));
    #endif
  }
  if (w > 0.0 && surfHit.radius > 0.0007) {
    vec3 nW = surfToWorld(toView * n);
    vec3 caustic = vec3(0.0);
    for (int i = 0; i < MAX_FILM_LIGHTS; i++) {
      if (i >= filmLightCount) break;
      vec3 toLight;
      vec3 e = filmLightAt(i, surfWorldPos, toLight);
      float facing = dot(nW, toLight);
      if (facing <= 0.0) continue;
      vec3 tl = toLight - nW * facing;
      vec3 rel = (vec4(toView * (-surfHit.offset), 0.0) * viewMatrix).xyz;
      vec3 focus = -tl * surfHit.radius * 0.45;
      float s = length(rel - focus) / (surfHit.radius * 0.32);
      caustic += e * facing * exp(-s * s) * 2.2;
    }
    totalEmissiveRadiance += caustic * w * (diffuseColor.rgb + 0.08);
  }
  surfBeadOut = shaded;
  surfDiagOut = vec4(vec3(1.0, 0.1, 0.9) * (0.15 + 0.85 * max(w, surfMist * 0.5)), 1.0);
}
`

const beadsSpecular = /* glsl */ `
#ifdef USE_CLEARCOAT
  material.clearcoat = mix(material.clearcoat, 1.0, surfBeadOut);
  material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.012, surfBeadOut);
  material.clearcoatRoughness = mix(material.clearcoatRoughness, max(material.clearcoatRoughness, 0.16), surfMist * 0.5);
#else
  material.roughness = mix(material.roughness, 0.03, surfBeadOut);
#endif
`

export function applyBeads(material: THREE.Material, uniforms: Uniforms, bead: BeadClass): void {
  patchMaterial(material, {
    id: 'surface water beads',
    uniforms: { ...uniforms, surfBeadSalt: { value: bead.salt }, surfBeadContact: { value: bead.contactDegrees } },
    apply(shader) {
      shader.vertexShader = surfaceVaryingsGlsl(true) + insertAfter(shader.vertexShader, '#include <project_vertex>', surfaceVertexGlsl(true))
      let f = shader.fragmentShader
      f = surfaceVaryingsGlsl(true) + surfaceCommonGlsl + beadsGlsl + f
      f = insertBefore(f, '#include <map_fragment>', 'float surfBeadOut = 0.0;\nvec4 surfDiagOut = vec4(0.0);')
      f = insertAfter(f, '#include <clearcoat_normal_fragment_maps>', beadsFragment)
      f = insertAfter(f, '#include <lights_physical_fragment>', beadsSpecular)
      f = insertBefore(f, '#include <opaque_fragment>', 'if (surfDiag > 0.5) { outgoingLight = surfDiagOut.rgb; }')
      shader.fragmentShader = f
    },
  })
}
