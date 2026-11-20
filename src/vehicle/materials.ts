import * as T from 'three'
import type { PaintSpec } from '../config'
import { stream } from '../core/random'
import { insertAfter, patchMaterial, replaceOnce } from '../materials/patch'
import type { VehicleModule } from './contract'
import type { Material } from './geometry'

const carbonPaths = {
  map: '/assets/third-party/textures/carbon-weave/Fabric004_2K-PNG_Color.png',
  normalMap: '/assets/third-party/textures/carbon-weave/Fabric004_2K-PNG_NormalGL.png',
  roughnessMap: '/assets/third-party/textures/carbon-weave/Fabric004_2K-PNG_Roughness.png',
}

interface FlakeSpec {
  /** Mean flake diameter in micrometres. */
  sizeUm: number
  /** Fraction of the base area the flakes cover, seen from above. */
  coverage: number
  /** Standard deviation of each flake's tilt from the panel, in degrees, inside the clear. */
  tiltDeg: number
  /** Reflectance of one flake. Aluminium near 0.9, a mica pearl lower. */
  reflectance: number
  /** Half width of one flake's own reflection lobe, in degrees inside the clear. */
  lobeDeg: number
  /** How strongly the pigmented binder around the flakes tints them, at normal incidence. */
  binder: number
}

const flakeSpecs: Record<string, FlakeSpec> = {
  'black-pearl': { sizeUm: 22, coverage: .035, tiltDeg: 5, reflectance: .45, lobeDeg: 1, binder: .25 },
  'ember-orange': { sizeUm: 30, coverage: .42, tiltDeg: 7, reflectance: .82, lobeDeg: 1, binder: .85 },
  'liquid-silver': { sizeUm: 34, coverage: .55, tiltDeg: 6.5, reflectance: .9, lobeDeg: 1, binder: .35 },
}
const fallbackFlake: FlakeSpec = { sizeUm: 26, coverage: .4, tiltDeg: 7.5, reflectance: .8, lobeDeg: 1, binder: .5 }

/** Clear coat: about 45 micrometres of clear over the base, a slight long wave in its surface, a lobe floor for compact lights. */
const coat = { ior: 1.5, thicknessUm: 45, peelWaveMm: 2.2, peelSlopeDeg: .022, roughness: .045, directRoughness: .14, flakeRoughness: .19 }

/** Flakes are dealt per cell of at most six and at most 90 micrometres, explicit up to a few cells per pixel, then a matched smooth lobe. */
const cellFlakes = 6
const cellLimit = 90e-6
const explicitUntil = [3, 6]

function flakeUniforms(spec: PaintSpec) {
  const f = flakeSpecs[spec.id] ?? fallbackFlake
  const radius = f.sizeUm * 5e-7
  const density = f.coverage / (Math.PI * radius * radius)
  const base = new T.Color(spec.base)
  const peak = Math.max(base.r, base.g, base.b, 1e-4)
  return {
    color: new T.Color(spec.flake).multiplyScalar(f.reflectance),
    binder: new T.Vector4(base.r / peak, base.g / peak, base.b / peak, f.binder),
    shape: new T.Vector4(density, T.MathUtils.degToRad(f.tiltDeg), T.MathUtils.degToRad(f.lobeDeg), radius),
    cell: new T.Vector4(Math.min(cellLimit, Math.sqrt(cellFlakes / density)), explicitUntil[0], explicitUntil[1], f.coverage),
    albedo: f.reflectance * f.coverage,
  }
}

const paintPars = /* glsl */ `
varying vec3 carLocal;
varying vec3 carNormal;
uniform mat3 normalMatrix;
uniform vec3 carFlakeColor;
uniform vec4 carBinder;
uniform vec4 carFlakeShape;
uniform vec4 carFlakeCell;
uniform vec4 carCoat;
uniform float carFlakeSeed;
vec3 paintT;
vec3 paintB;
vec3 paintCoatNormal;
vec2 paintUv;
float paintFootprint;
float paintCosAxis;
uint paintAxis;
vec2 paintSlope[PAINT_MAX_FLAKES];
int paintFlakes;
float paintFlakeArea;
bool paintExplicit;

uvec4 paintHash(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}

vec3 paintNoise(vec2 p, uint salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  uvec2 c = uvec2(ivec2(i));
  uint s = salt ^ floatBitsToUint(carFlakeSeed);
  float a = float(paintHash(uvec4(c, s, 7u)).x) / 4294967295.0;
  float b = float(paintHash(uvec4(c + uvec2(1u, 0u), s, 7u)).x) / 4294967295.0;
  float d = float(paintHash(uvec4(c + uvec2(0u, 1u), s, 7u)).x) / 4294967295.0;
  float e = float(paintHash(uvec4(c + uvec2(1u, 1u), s, 7u)).x) / 4294967295.0;
  float k = a - b - d + e;
  return vec3(a + (b - a) * u.x + (d - a) * u.y + k * u.x * u.y, du * (vec2(b - a, d - a) + k * u.yx));
}

void paintSurface(vec3 viewNormal) {
  vec3 n = normalize(carNormal);
  vec3 an = abs(n);
  vec3 axisU;
  if (an.x >= an.y && an.x >= an.z) { paintAxis = 0u; paintUv = carLocal.yz; axisU = vec3(0.0, 1.0, 0.0); paintCosAxis = an.x; }
  else if (an.y >= an.z) { paintAxis = 1u; paintUv = carLocal.zx; axisU = vec3(0.0, 0.0, 1.0); paintCosAxis = an.y; }
  else { paintAxis = 2u; paintUv = carLocal.xy; axisU = vec3(1.0, 0.0, 0.0); paintCosAxis = an.z; }
  vec3 t = normalize(normalMatrix * (axisU - n * dot(n, axisU)));
  paintT = normalize(t - viewNormal * dot(viewNormal, t));
  paintB = cross(viewNormal, paintT);
  paintFootprint = sqrt(max(length(cross(dFdx(carLocal), dFdy(carLocal))), 1e-16));
}

vec3 paintPeel(vec3 coatNormal) {
  float wave = carCoat.y;
  float fade = 1.0 - smoothstep(0.2 * wave, 0.7 * wave, paintFootprint);
  if (fade <= 0.0) return coatNormal;
  vec2 q = paintUv / wave;
  vec3 a = paintNoise(q, 11u);
  vec3 b = paintNoise(q * 2.03 + 17.1, 12u);
  vec2 slope = (a.yz + 0.45 * b.yz * 2.03) * (carCoat.x * fade / 1.25);
  return normalize(coatNormal - slope.x * paintT - slope.y * paintB);
}

void paintCells(vec3 viewDir, vec3 viewNormal) {
  float nv = max(dot(viewNormal, viewDir), 1e-3);
  vec3 vi = (viewDir - viewNormal * nv) / carCoat.w;
  float ci = sqrt(max(1.0 - dot(vi, vi), 1e-3));
  vec2 uv = paintUv - carCoat.z * vec2(dot(vi, paintT), dot(vi, paintB)) / ci;
  float side = carFlakeCell.x;
  float area = side * side / paintCosAxis;
  float lambda = carFlakeShape.x * area;
  paintFlakeArea = 3.14159265 * carFlakeShape.w * carFlakeShape.w / area;
  paintFlakes = 0;
  float keep = 1.0 - smoothstep(carFlakeCell.y, carFlakeCell.z, paintFootprint / side);
  uint seed = floatBitsToUint(carFlakeSeed);
  float pick = float(paintHash(uvec4(floatBitsToUint(carLocal), seed)).x) / 4294967295.0;
  paintExplicit = pick < keep;
  if (!paintExplicit) return;
  uvec2 cid = uvec2(ivec2(floor(uv / side)) + 1048576);
  float u = float(paintHash(uvec4(cid, paintAxis, seed ^ 0x9e3779b9u)).x) / 4294967295.0;
  float p = exp(-lambda);
  float F = p;
  int count = 0;
  for (int i = 1; i <= PAINT_MAX_FLAKES; i++) {
    if (u <= F) break;
    count = i;
    p *= lambda / float(i);
    F += p;
  }
  paintFlakes = count;
  for (int i = 0; i < PAINT_MAX_FLAKES; i++) {
    if (i >= count) break;
    uvec4 h = paintHash(uvec4(cid, paintAxis | (uint(i + 1) << 4u), seed));
    float r = sqrt(-2.0 * log(max(float(h.x) / 4294967295.0, 1e-7)));
    float t = 6.2831853 * float(h.y) / 4294967295.0;
    paintSlope[i] = carFlakeShape.y * r * vec2(cos(t), sin(t));
  }
}

vec3 paintBinder(float cosIn, float cosOut) {
  float path = 0.5 * (1.0 / max(cosIn, 0.05) + 1.0 / max(cosOut, 0.05));
  return pow(carBinder.rgb, vec3(carBinder.w * path));
}

vec3 paintInside(vec3 d, vec3 n) {
  vec3 t = (d - n * dot(n, d)) / carCoat.w;
  return t + n * sqrt(max(1.0 - dot(t, t), 0.0));
}

void paintFlakeDirect(const in IncidentLight light, const in vec3 n, const in vec3 v, inout ReflectedLight reflected) {
  float nl = dot(n, light.direction);
  if (nl <= 0.0) return;
  vec3 li = paintInside(light.direction, n);
  vec3 vi = paintInside(v, n);
  vec3 h = normalize(li + vi);
  float hn = dot(h, n);
  vec2 s = vec2(dot(h, paintT), dot(h, paintB)) / hn;
  float sigma = carFlakeShape.y;
  float w = carFlakeShape.z;
  float spread = sigma * sigma + w * w;
  if (dot(s, s) > 16.0 * spread) return;
  float lobe = 0.0;
  if (paintExplicit) {
    float k = 0.5 / (w * w);
    for (int i = 0; i < PAINT_MAX_FLAKES; i++) {
      if (i >= paintFlakes) break;
      vec2 d = s - paintSlope[i];
      lobe += exp(-dot(d, d) * k);
    }
    lobe *= paintFlakeArea / (6.2831853 * w * w);
  } else {
    lobe = carFlakeCell.w * exp(-0.5 * dot(s, s) / spread) / (6.2831853 * spread);
  }
  if (lobe <= 0.0) return;
  float cl = max(dot(li, n), 1e-3);
  float cv = max(dot(vi, n), 1e-3);
  float through = (1.0 - F_Schlick(vec3(0.04), 1.0, nl).x) * (1.0 - F_Schlick(vec3(0.04), 1.0, dot(n, v)).x);
  float hn2 = hn * hn;
  reflected.directSpecular += light.color * nl * carFlakeColor * paintBinder(cl, cv) * (through * lobe / (hn2 * hn2 * 4.0 * cl * cv * carCoat.w * carCoat.w));
}

vec3 paintFlakeEnv(vec3 n, vec3 v) {
  float nv = saturate(dot(n, v));
  vec3 vi = paintInside(v, n);
  float cv = max(dot(vi, n), 1e-3);
  vec3 sum = vec3(0.0);
  if (paintExplicit) {
    for (int i = 0; i < PAINT_MAX_FLAKES; i++) {
      if (i >= paintFlakes) break;
      vec3 m = normalize(n + paintSlope[i].x * paintT + paintSlope[i].y * paintB);
      vec3 ri = 2.0 * dot(vi, m) * m - vi;
      float cr = dot(ri, n);
      if (cr <= 0.0) continue;
      vec3 t = (ri - n * cr) * carCoat.w;
      float tt = dot(t, t);
      if (tt >= 1.0) continue;
      float co = sqrt(1.0 - tt);
      vec3 ro = t + n * co;
      vec3 mo = normalize(v + ro);
      sum += getIBLRadiance(v, mo, PAINT_FLAKE_ROUGHNESS) * paintBinder(cr, cv) * (1.0 - F_Schlick(vec3(0.04), 1.0, co).x);
    }
    sum *= paintFlakeArea;
  } else {
    float sigma = sqrt(carFlakeShape.y * carFlakeShape.y + carFlakeShape.z * carFlakeShape.z);
    float alpha = min(1.0, carCoat.w * 1.4142 * sigma * (1.0 + 0.6 * (1.0 - nv)));
    sum = carFlakeCell.w * getIBLRadiance(v, n, sqrt(alpha)) * paintBinder(cv, cv) * (1.0 - F_Schlick(vec3(0.04), 1.0, nv).x);
  }
  return sum * carFlakeColor * (1.0 - F_Schlick(vec3(0.04), 1.0, nv).x);
}

void RE_Direct_Paint(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  PhysicalMaterial coated = material;
  #ifdef USE_CLEARCOAT
    float film = smoothstep(0.996, 0.9999, dot(geometryClearcoatNormal, paintCoatNormal));
    coated.clearcoatRoughness = mix(coated.clearcoatRoughness, max(coated.clearcoatRoughness, PAINT_DIRECT_COAT), film);
  #endif
  RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, coated, reflectedLight);
  paintFlakeDirect(directLight, geometryNormal, geometryViewDir, reflectedLight);
}
#undef RE_Direct
#define RE_Direct RE_Direct_Paint
`

function paintStack(paint: T.MeshPhysicalMaterial, spec: PaintSpec) {
  const start = flakeUniforms(spec)
  const uniforms = {
    carFlakeColor: { value: start.color },
    carBinder: { value: start.binder },
    carFlakeShape: { value: start.shape },
    carFlakeCell: { value: start.cell },
    carCoat: { value: new T.Vector4(T.MathUtils.degToRad(coat.peelSlopeDeg), coat.peelWaveMm * 1e-3, coat.thicknessUm * 1e-6, coat.ior) },
    carFlakeSeed: { value: stream('vehicle paint flakes').range(1, 1000) },
  }
  patchMaterial(paint, {
    id: 'vehicle paint stack',
    uniforms,
    defines: { PAINT_DIRECT_COAT: coat.directRoughness.toFixed(3), PAINT_MAX_FLAKES: 16, PAINT_FLAKE_ROUGHNESS: coat.flakeRoughness.toFixed(3) },
    apply(shader) {
      shader.vertexShader = 'varying vec3 carLocal;\nvarying vec3 carNormal;\n' + insertAfter(shader.vertexShader, '#include <begin_vertex>', 'carLocal = position;\ncarNormal = objectNormal;')
      let f = insertAfter(shader.fragmentShader, '#include <lights_physical_pars_fragment>', paintPars)
      f = insertAfter(f, '#include <clearcoat_normal_fragment_begin>', `
        paintSurface(normal);
        #ifdef USE_CLEARCOAT
          clearcoatNormal = paintPeel(clearcoatNormal);
          paintCoatNormal = clearcoatNormal;
        #endif
      `)
      f = replaceOnce(f, '#include <lights_fragment_begin>', `
        paintT = normalize(paintT - normal * dot(normal, paintT));
        paintB = cross(normal, paintT);
        paintCells(normalize(vViewPosition), normal);
        #include <lights_fragment_begin>
      `)
      shader.fragmentShader = insertAfter(f, '#include <lights_fragment_maps>', `
        #ifdef USE_ENVMAP
          reflectedLight.indirectSpecular += paintFlakeEnv(geometryNormal, geometryViewDir);
        #endif
      `)
    },
  })
  return (next: PaintSpec): void => {
    const u = flakeUniforms(next)
    uniforms.carFlakeColor.value.copy(u.color)
    uniforms.carBinder.value.copy(u.binder)
    uniforms.carFlakeShape.value.copy(u.shape)
    uniforms.carFlakeCell.value.copy(u.cell)
    paint.color.set(next.base).multiplyScalar(1 - u.albedo)
  }
}

export function palette(spec: PaintSpec, full: boolean) {
  const paint = new T.MeshPhysicalMaterial({
    color: full ? spec.base : 0x93989f, metalness: full ? 0 : .13,
    roughness: full ? .5 : .36, clearcoat: full ? 1 : .48, clearcoatRoughness: full ? coat.roughness : .22,
    ior: coat.ior, specularIntensity: full ? 0 : .7, envMapIntensity: 1.15,
  })
  const repaint = full ? paintStack(paint, spec) : null
  repaint?.(spec)
  const glass = new T.MeshPhysicalMaterial({
    color: full ? 0xb6c2c7 : 0x30383f, metalness: full ? 0 : .1, roughness: full ? .084 : .17,
    ior: 1.51, clearcoat: .8, clearcoatRoughness: .07, transmission: full ? .92 : 0,
    thickness: full ? .006 : 0, attenuationColor: new T.Color(0x7a9a9c), attenuationDistance: .009,
    opacity: full ? 1 : .87, transparent: !full, depthWrite: full, side: T.FrontSide,
  })
  const windscreen = glass.clone()
  windscreen.color.setHex(full ? 0x789199 : 0x273038)
  windscreen.attenuationColor.setHex(0x35515b)
  windscreen.clearcoat = .47
  windscreen.specularIntensity = .74
  const optics = new T.MeshPhysicalMaterial({
    color: full ? 0xedf0f3 : 0x858e99, metalness: full ? 0 : .1, roughness: full ? .071 : .105,
    opacity: full ? 1 : .36, transparent: !full, depthWrite: full, ior: 1.59, clearcoat: .95, clearcoatRoughness: .09,
    transmission: full ? .93 : 0, thickness: full ? .0018 : 0, attenuationColor: new T.Color(0xaabcc7), attenuationDistance: .016,
  })
  const rearOptics = optics.clone()
  rearOptics.color.setHex(full ? 0xe6a4a4 : 0x51373a)
  rearOptics.opacity = full ? 1 : .30
  rearOptics.thickness = full ? .0038 : 0
  rearOptics.attenuationColor.setHex(0xad2828)
  rearOptics.attenuationDistance = .013
  const projector = new T.MeshPhysicalMaterial({
    color: 0xe8ecee, roughness: .106, ior: 1.49, clearcoat: .11, clearcoatRoughness: .14,
    transmission: full ? .97 : 0, thickness: full ? .0018 : 0,
    attenuationColor: new T.Color(0xe2e8eb), attenuationDistance: .038,
    opacity: full ? 1 : .11, transparent: !full, depthWrite: full,
  })
  const brushed = new T.MeshPhysicalMaterial({
    color: full ? 0x899496 : 0x7f858c, metalness: full ? .79 : .45, roughness: .32, anisotropy: full ? .69 : .2,
  })
  const forged = new T.MeshPhysicalMaterial({
    color: full ? 0x484b51 : 0x777c83, metalness: full ? .69 : .46, roughness: .25,
    clearcoat: .67, clearcoatRoughness: .18, anisotropy: full ? .32 : 0,
  })
  const spoke = new T.MeshPhysicalMaterial({
    color: full ? 0x747982 : 0x777c83, metalness: full ? .62 : .46, roughness: .30,
    clearcoat: .5, clearcoatRoughness: .20, anisotropy: full ? .31 : 0,
  })
  const brake = new T.MeshStandardMaterial({ color: full ? 0x373c3f : 0x4e5154, roughness: .78, metalness: .24 })
  const caliper = new T.MeshPhysicalMaterial({
    color: full ? 0x9a2520 : 0x64676c, metalness: .30, roughness: .34, clearcoat: .65, clearcoatRoughness: .22,
  })
  const matte = new T.MeshPhysicalMaterial({ color: full ? 0x22252a : 0x32363b, roughness: .72, metalness: .09 })
  const dark = new T.MeshStandardMaterial({ color: full ? 0x131518 : 0x26292d, roughness: .83 })
  const diffuser = new T.MeshPhysicalMaterial({ color: full ? 0x303236 : 0x414346, roughness: .55, metalness: .17, clearcoat: .3, clearcoatRoughness: .36 })
  const tire = new T.MeshPhysicalMaterial({ color: full ? 0x252629 : 0x2d3032, roughness: .81, specularIntensity: .68 })
  const carbon = new T.MeshPhysicalMaterial({
    color: full ? 0x34383b : 0x363a3f, metalness: .17, roughness: .43, clearcoat: .45, clearcoatRoughness: .19, anisotropy: full ? .32 : 0,
  })
  const bayCover = carbon.clone()
  bayCover.color.setHex(full ? 0xa6aab1 : 0x55595f)
  bayCover.roughness = .58
  bayCover.specularIntensity = .54
  bayCover.clearcoat = .12
  const ventCarbon = carbon.clone()
  ventCarbon.color.setHex(full ? 0x33363a : 0x414346)
  ventCarbon.roughness = .61
  ventCarbon.specularIntensity = .50
  ventCarbon.clearcoat = .14
  ventCarbon.clearcoatRoughness = .34
  const rearVent = ventCarbon.clone()
  rearVent.vertexColors = true
  rearVent.roughness = .86
  rearVent.metalness = .035
  rearVent.specularIntensity = .085
  rearVent.clearcoat = 0
  const mirror = new T.MeshPhysicalMaterial({ color: 0x57636b, metalness: .94, roughness: .096, clearcoat: .72 })
  const hot = new T.MeshPhysicalMaterial({ color: full ? 0x494241 : 0x626367, metalness: .72, roughness: .4, anisotropy: full ? .38 : 0 })
  const engine = new T.MeshStandardMaterial({ color: full ? 0x2b2d31 : 0x55595f, metalness: .38, roughness: .59 })
  const cabin = new T.MeshStandardMaterial({ color: 0x2e2b2a, metalness: 0, roughness: .84 })
  if (full) {
    const seeded = (name: string) => ({ value: stream(name).range(.1, 21) })
    const grain = (m: Material, name: string, color: string, roughness = '') => patchMaterial(m, {
      id: name,
      uniforms: { carFinishSeed: seeded(name) },
      apply(shader) {
        shader.vertexShader = 'varying vec3 carFinishPoint;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncarFinishPoint = position;')
        shader.fragmentShader = `varying vec3 carFinishPoint;
          uniform float carFinishSeed;
          float finishCell(vec3 p) {
            p = fract(p * vec3(0.1031, 0.0973, 0.1099));
            p += dot(p, p.yzx + carFinishSeed + 19.19);
            return fract((p.x + p.y) * p.z);
          }
        ` + shader.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\n' + color)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + roughness)
      },
    })
    grain(brake, 'carbon ceramic porosity', `
      vec3 cell = floor(carFinishPoint * vec3(160.0, 710.0, 710.0));
      float grain = finishCell(cell);
      float r = length(carFinishPoint.yz);
      float band = sin(r * 1716.0 + 0.5 * sin(r * 527.0));
      float carGrainWeight = 1.0 - smoothstep(0.00045, 0.0028, length(fwidth(carFinishPoint.yz)));
      diffuseColor.rgb *= 1.0 + (grain - 0.5) * 0.28 * carGrainWeight + 0.045 * band * carGrainWeight;
    `, 'roughnessFactor += (grain - 0.5) * 0.19 * carGrainWeight;')
    grain(tire, 'mold rubber grain', `
      vec3 cell = floor(carFinishPoint * 1450.0);
      float grain = finishCell(cell);
      float carGrainWeight = 1.0 - smoothstep(0.00035, 0.0022, length(fwidth(carFinishPoint)));
      diffuseColor.rgb *= 1.0 + (grain - 0.5) * 0.13 * carGrainWeight;
    `, 'roughnessFactor += (grain - 0.5) * 0.10 * carGrainWeight;')
    grain(hot, 'heat tint and drawn alloy', `
      float shape = carFinishPoint.z + 2.40 + 0.006 * sin(carFinishPoint.x * 22.0);
      float oxide = smoothstep(0.011, 0.035, shape) - smoothstep(0.051, 0.08, shape);
      float temper = smoothstep(-0.025, 0.015, shape) - smoothstep(0.015, 0.048, shape);
      float rough = finishCell(floor(carFinishPoint * vec3(480.0, 660.0, 580.0)));
      diffuseColor.rgb *= 1.0 + (rough - 0.5) * 0.07;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.082, 0.027), oxide * 0.42);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.060, 0.071, 0.14), temper * 0.36);
    `, 'roughnessFactor += 0.12 * oxide;')
  }
  const surfaces: VehicleModule['surfaces'] = []
  const tag = (material: Material, wetness: VehicleModule['surfaces'][number]['wetness']) => {
    surfaces.push({ material, wetness })
    return material
  }
  for (const m of [paint, glass, windscreen, optics, rearOptics, carbon, bayCover, ventCarbon, mirror]) tag(m, 'beads')
  tag(rearVent, 'none')
  for (const m of [matte, tire, diffuser]) tag(m, 'sheet')
  for (const m of [projector, brushed, forged, spoke, brake, caliper, dark, hot, engine]) tag(m, 'none')
  if (full) tag(cabin, 'none')
  const setPaint = (next: PaintSpec): void => {
    repaint?.(next)
  }
  const load = async (): Promise<void> => {
    if (!full || typeof document === 'undefined') return
    const loader = new T.TextureLoader()
    await Promise.all(Object.entries(carbonPaths).map(async ([key, path]) => {
      const tex = await loader.loadAsync(import.meta.env.BASE_URL + path.slice(1))
      tex.wrapS = tex.wrapT = T.RepeatWrapping
      tex.repeat.set(31, 31)
      tex.anisotropy = 4
      tex.colorSpace = key === 'map' ? T.SRGBColorSpace : T.NoColorSpace
      for (const finish of [carbon, bayCover, ventCarbon, rearVent]) finish[key as keyof typeof carbonPaths] = tex
    }))
    carbon.normalScale.setScalar(.2)
    carbon.needsUpdate = true
    bayCover.normalScale.setScalar(.16)
    bayCover.needsUpdate = true
    ventCarbon.normalScale.setScalar(.16)
    ventCarbon.needsUpdate = true
    rearVent.normalScale.setScalar(.14)
    rearVent.needsUpdate = true
  }
  return { paint, glass, windscreen, optics, rearOptics, projector, brushed, forged, spoke, brake, caliper, matte, dark, diffuser, tire, carbon, bayCover, ventCarbon, rearVent, mirror, hot, engine, cabin, surfaces, tag, setPaint, load }
}

export type Palette = ReturnType<typeof palette>
