import * as THREE from 'three'
import { config } from '../../config'
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
  /** Density scale where the coverage field is sparse and where it is dense. */
  sparse: number
  dense: number
  /** Extra chance on the rounded return of a lower edge, where water gathers and hangs before it drips. */
  hang: number
}

export const beadLayers: BeadLayer[] = [
  { cellMm: 1.1, minMm: 0.12, maxMm: 0.45, flat: 0.55, steep: 0.35, lobes: 1, sparse: 0.6, dense: 1.3, hang: 0 },
  { cellMm: 3.4, minMm: 0.5, maxMm: 1.6, flat: 0.72, steep: 0.45, lobes: 1, sparse: 0.3, dense: 1.25, hang: 0 },
  { cellMm: 10, minMm: 1.6, maxMm: 5.4, flat: 0.75, steep: 0.28, lobes: 1, sparse: 0.3, dense: 1.3, hang: 0.4 },
  { cellMm: 44, minMm: 8, maxMm: 20, flat: 0.42, steep: 0.06, lobes: 2, sparse: 0.1, dense: 2.4, hang: 1.2 },
]

/**
 * The water on the coat between resolved drops, seen from a distance. Sheets where drifts of drops merge, as octaves of
 * wavelength in meters and slope; detail finer than the footprint folds into roughness. Runs on steep faces: tracks of a width
 * and length in meters drawn down the fall line, one to a spacing in meters across it,, standing a height in meters proud of the coat.
 */
/** Fresnel of a water sphere averaged over its disk. */
const sphereFresnel = 0.066
/** Fresnel times solid angle of the cone within 30 degrees behind a drop, where its rim reflects at 75 degrees or more. */
const rimFresnel = 0.38
const coatFilm = [
  [0.003, 0.03],
  [0.008, 0.04],
  [0.02, 0.035],
]
/** The sheet on glass creeps down the pane at this speed in meters per second, a whole number of wavelengths over the film. */
const glassSheetSpeed = 0.06
const glassCycles = (w: number) => Math.max(1, Math.round((glassSheetSpeed * config.film.durationSeconds) / w))
const runTrack = { spacing: 0.03, ridge: 0.12, width: 0.004, length: 0.3, height: 0.0004 }
/** Footprints in meters over which the distant film takes over from the drops the macro lens resolves. */
const coatFade = [0.0014, 0.0026]

/** Rain leaves the beads in drifts: a slow coverage field thins some patches to mist and packs others with large drops. */
const coverageCm = [6, 2.2]
const coverageSalt = 40

function valueNoise(x: number, y: number, z: number, salt: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = surfHash3(ix, iy, z, salt)[0], b = surfHash3(ix + 1, iy, z, salt)[0]
  const c = surfHash3(ix, iy + 1, z, salt)[0], d = surfHash3(ix + 1, iy + 1, z, salt)[0]
  return a + (b - a) * ux + (c - a + (a - b - c + d) * ux) * uy
}

export function coverageAt(u: number, v: number, axis: number, salt: number): number {
  const z = axis + coverageSalt
  const n = 0.72 * valueNoise(u / (coverageCm[0] / 100), v / (coverageCm[0] / 100), z, salt) + 0.28 * valueNoise(u / (coverageCm[1] / 100), v / (coverageCm[1] / 100), z + 4, salt)
  return THREE.MathUtils.smoothstep(n, 0.28, 0.72)
}

/** The highest chance any cell of the layer holds a drop, for culling before the coverage field is read. */
export function maxDensity(layer: BeadLayer): number {
  return Math.min(0.95, Math.max(layer.flat, layer.steep) * Math.max(layer.sparse, layer.dense))
}

/** Points of the runner's track handed to the shader, and the half width it sweeps clear of beads. */
export const trackPoints = 40
export const trackClear = 0.0045

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
  const density = densityFor(layer, level, coverageAt((cx + 0.5) * cell, (cy + 0.5) * cell, axis, bead.salt))
  if (hx >= density) return []
  const size = hx / density
  const diameterMm = layer.minMm + (layer.maxMm - layer.minMm) * Math.pow(size, 1.7)
  const stretch = 1 + 1.1 * slope
  let radius = Math.min(diameterMm / 2000, (0.24 * cell) / (layer.lobes > 1 ? 1.25 : 1) / stretch)
  const drops: Drop[] = []
  const ext = radius * stretch * (layer.lobes > 1 ? 1.25 : 1)
  const u = cx * cell + ext + (cell - 2 * ext) * hy
  const v = cy * cell + ext + (cell - 2 * ext) * hz
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

function densityFor(layer: BeadLayer, level: number, coverage: number): number {
  const up = THREE.MathUtils.smoothstep(level, 0.2, 0.95)
  const under = THREE.MathUtils.smoothstep(-level, 0.3, 0.9)
  const edge = THREE.MathUtils.smoothstep(-level, 0.05, 0.4) * (1 - THREE.MathUtils.smoothstep(-level, 0.7, 0.95))
  const d = (layer.steep + (layer.flat - layer.steep) * up) * (1 - 0.8 * under + layer.hang * edge) * (layer.sparse + (layer.dense - layer.sparse) * coverage)
  return Math.min(0.95, d)
}

export { axisUV }

const layerGlsl = beadLayers
  .map((l, i) => `  if (i == ${i}) { cellMm = ${l.cellMm.toFixed(3)}; minMm = ${l.minMm.toFixed(3)}; maxMm = ${l.maxMm.toFixed(3)}; flatD = ${l.flat.toFixed(3)}; steepD = ${l.steep.toFixed(3)}; lobes = ${l.lobes}; sparseD = ${l.sparse.toFixed(3)}; denseD = ${l.dense.toFixed(3)}; }`)
  .join('\n')

const hangGlsl = beadLayers.map((l, i) => `i == ${i} ? ${l.hang.toFixed(3)} : `).join('') + '0.0'

const beadsGlsl = /* glsl */ `
uniform float surfDiag;
uniform float surfTime;
uniform float surfVibration;
uniform float surfBeadTime;
uniform float surfFocus;
uniform float surfCocScale;
uniform float surfSampleRoot;
uniform float surfPupil;
uniform float surfShakeAge;
uniform float surfRefill;
uniform float surfBeadSalt;
uniform float surfBeadContact;
uniform vec4 surfGeo;
uniform float surfGeoAngle;
uniform vec3 surfVehicleCenter;
uniform vec4 surfTrack[${trackPoints}];
uniform vec4 surfTrackBox;
uniform float surfTrackLen;

/** Distance to the part of the runner's track it has already swept, where it took up every bead it touched. */
float surfTrackDistance(vec3 p) {
  float best = 1e9;
  for (int i = 0; i + 1 < ${trackPoints}; i++) {
    if (surfTrack[i].w >= surfTrackLen) break;
    vec3 a = surfTrack[i].xyz;
    vec3 b = surfTrack[i + 1].xyz;
    float lim = clamp((surfTrackLen - surfTrack[i].w) / max(surfTrack[i + 1].w - surfTrack[i].w, 1e-6), 0.0, 1.0);
    vec3 ab = b - a;
    float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-12), 0.0, lim);
    best = min(best, length(p - a - ab * h));
  }
  return best;
}
${filmLightsGlsl.replaceAll("filmCompactBeamFalloff", "surfCompactBeamFalloff")}

void surfLayer(int i, out float cellMm, out float minMm, out float maxMm, out float flatD, out float steepD, out int lobes, out float sparseD, out float denseD) {
  cellMm = 1.0; minMm = 0.1; maxMm = 0.2; flatD = 0.0; steepD = 0.0; lobes = 1; sparseD = 1.0; denseD = 1.0;
${layerGlsl}
}

float surfValueNoise(vec2 p, int z, uint salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = surfHash3(ivec3(c, z), salt).x;
  float b = surfHash3(ivec3(c + ivec2(1, 0), z), salt).x;
  float d = surfHash3(ivec3(c + ivec2(0, 1), z), salt).x;
  float e = surfHash3(ivec3(c + ivec2(1, 1), z), salt).x;
  return a + (b - a) * u.x + (d - a + (a - b - d + e) * u.x) * u.y;
}

/** Drifts are a near-field look: from a distance the eye averages them, so the field relaxes toward its mean as the footprint grows. */
float surfCoverFlat = 0.0;

float surfCoverage(vec2 uv, int axis, uint salt) {
  int z = axis + ${coverageSalt};
  float n = 0.72 * surfValueNoise(uv / ${(coverageCm[0] / 100).toFixed(4)}, z, salt) + 0.28 * surfValueNoise(uv / ${(coverageCm[1] / 100).toFixed(4)}, z + 4, salt);
  return mix(smoothstep(0.28, 0.72, n), 0.5, surfCoverFlat);
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

vec3 surfGradNoise(vec2 p, int z, uint salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  ivec2 c = ivec2(i);
  float a = surfHash3(ivec3(c, z), salt).x;
  float b = surfHash3(ivec3(c + ivec2(1, 0), z), salt).x;
  float d = surfHash3(ivec3(c + ivec2(0, 1), z), salt).x;
  float e = surfHash3(ivec3(c + ivec2(1, 1), z), salt).x;
  return vec3(mix(mix(a, b, u.x), mix(d, e, u.x), u.y), du.x * mix(b - a, e - d, u.y), du.y * mix(d - a, e - b, u.x));
}

vec3 surfGradNoiseWrap(vec2 p, int period, int z, uint salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  ivec2 c = ivec2(i);
  int y0 = ((c.y % period) + period) % period;
  int y1 = (y0 + 1) % period;
  float a = surfHash3(ivec3(c.x, y0, z), salt).x;
  float b = surfHash3(ivec3(c.x + 1, y0, z), salt).x;
  float d = surfHash3(ivec3(c.x, y1, z), salt).x;
  float e = surfHash3(ivec3(c.x + 1, y1, z), salt).x;
  return vec3(mix(mix(a, b, u.x), mix(d, e, u.x), u.y), du.x * mix(b - a, e - d, u.y), du.y * mix(d - a, e - b, u.x));
}

float surfCoatVar = 0.0;
float surfRunLine = 0.0;
float surfPixA = 1.0;

/** Slope of the water on the coat, in object space on the tangent plane. coverage: the drift field, 1 where drops pack densest. */
vec3 surfCoatSlope(vec3 p, vec3 n, vec3 down, float slope, float pix, float coverage, uint salt) {
  vec3 a = slope > 0.05 ? down : normalize(cross(n, abs(n.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0)));
  vec3 b = normalize(cross(n, a));
  vec2 q = vec2(dot(p, b), dot(p, a));
  vec2 s = vec2(0.0);
  surfCoatVar = 0.0;
  float glass = step(surfBeadContact, 85.0);
  // Between the drops a waxed coat is a clean mirror; water sheets only where drifts merge, and as a thin creeping film on glass.
  float sheet = max(smoothstep(0.6, 0.95, coverage), 0.6 * glass);
  float flow = glass * surfTime / ${config.film.durationSeconds.toFixed(3)};
  ${coatFilm.map(([w, amp], i) => `{
    vec3 g = surfGradNoiseWrap(vec2(q.x / ${w.toFixed(4)}, q.y / ${w.toFixed(4)} - flow * ${glassCycles(w)}.0), ${glassCycles(w)}, ${60 + i}, salt);
    float filt = exp(-2.0 * pow(pix / ${w.toFixed(4)}, 2.0));
    s += sheet * ${amp.toFixed(3)} * filt * g.yz;
    surfCoatVar += sheet * sheet * ${(amp * amp * 0.4).toFixed(6)} * (1.0 - filt * filt);
  }`).join('\n  ')}
  float steep = smoothstep(0.15, 0.6, slope);
  if (steep > 0.0) {
    vec2 scale = vec2(${runTrack.spacing.toFixed(4)}, ${runTrack.length.toFixed(4)});
    vec3 t = surfGradNoise(q / scale, 63, salt);
    float live = smoothstep(0.45, 0.7, surfGradNoise(q / (scale * vec2(2.0, 1.5)), 64, salt).x);
    float d = (t.x - 0.5) / ${runTrack.ridge.toFixed(3)};
    vec2 grad = live * ${runTrack.height.toFixed(5)} * step(abs(d), 1.0) * (-2.0 * d / ${runTrack.ridge.toFixed(3)}) * t.yz / scale;
    float filt = exp(-2.0 * pow(pix / ${runTrack.width.toFixed(4)}, 2.0));
    s += steep * filt * grad;
    // Past the lens a run is a thin cylinder across the pixel: it keeps its share of the pixel and sends out its own glint line.
    float lane = q.x / ${runTrack.spacing.toFixed(4)} + 0.8 * surfGradNoise(vec2(0.0, q.y / ${(runTrack.length * 0.5).toFixed(4)}), 65, salt).x;
    float laneId = floor(lane);
    float across = abs(fract(lane) - 0.5) * ${runTrack.spacing.toFixed(4)};
    float run = step(0.65, surfHash3(ivec3(int(laneId), 5, 0), salt).x) * smoothstep(0.4, 0.6, surfGradNoise(vec2(laneId * 1.7, q.y / ${runTrack.length.toFixed(4)}), 66, salt).x);
    float band = max(surfPixA, ${runTrack.width.toFixed(4)});
    surfRunLine = steep * run * (1.0 - filt) * min(${runTrack.width.toFixed(4)} / surfPixA, 1.0) * (1.0 - smoothstep(0.5 * band, band, across));
    surfCoatVar += steep * steep * live * ${(((2 * runTrack.height) / runTrack.width) ** 2 * 0.5).toFixed(6)} * (1.0 - filt * filt);
  }
  return b * s.x + a * s.y;
}

/** Contact shadow just outside the foot of the drops near this fragment: the meniscus blocks the low sky. */
float surfHalo = 0.0;

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

vec3 surfSafeNormalize(vec3 v, vec3 fallback) {
  float l = length(v);
  return l > 1e-8 ? v / l : fallback;
}

void surfCap(inout SurfHit hit, vec3 d3, float radius, float height, vec3 n, vec3 down, float slope, float pix, float geometry) {
  float along = dot(d3, down);
  float stretch = along < 0.0 ? 1.0 + 1.1 * slope : 1.0 + 0.2 * slope;
  vec3 q = d3 - down * along * (1.0 - 1.0 / stretch);
  float r = length(q) / radius;
  if (r < 1.3) surfHalo = max(surfHalo, (1.0 - smoothstep(0.92, 1.3, r)) * clamp(height / radius, 0.0, 1.0));
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
float surfLane = 0.0;
float surfGlint = 0.0;
{
  vec3 n = surfObjNormal / max(length(surfObjNormal), 1e-8);
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
  surfCoverFlat = 0.7 * smoothstep(0.0012, 0.004, pix);
  // At a glancing view the footprint is long and thin; a drop is judged against the pixel's area, not its longest side.
  float pixA = min(pix, 1.4142 * sqrt(max(length(cross(dFdx(p), dFdy(p))), 1e-12)));
  surfPixA = pixA;
  mat3 toView = mat3(surfObjToView0, surfObjToView1, surfObjToView2);
  float up = smoothstep(0.2, 0.95, level);
  float under = smoothstep(0.3, 0.9, -level);
  float surfEdge = smoothstep(0.05, 0.4, -level) * (1.0 - smoothstep(0.7, 0.95, -level));
  uint salt = uint(surfBeadSalt);
  float shake = surfVibration;
  float laneDistance = surfTrackLen > 0.0 && distance(surfWorldPos, surfTrackBox.xyz) < surfTrackBox.w ? surfTrackDistance(surfWorldPos) : 1e9;
  bool nearTrack = laneDistance < ${trackClear} + 0.007;
  // The runner leaves a thin, level film where it took up the mist, so its lane is darker and glossier than the beaded paint.
  surfLane = 1.0 - smoothstep(${trackClear} * 0.55, ${trackClear}, laneDistance);
  for (int i = 0; i < ${beadLayers.length}; i++) {
    float cellMm, minMm, maxMm, flatD, steepD, sparseD, denseD;
    int lobes;
    surfLayer(i, cellMm, minMm, maxMm, flatD, steepD, lobes, sparseD, denseD);
    float cell = cellMm * 0.001;
    float density = mix(steepD, flatD, up) * (1.0 - 0.8 * under + (${hangGlsl}) * surfEdge);
    if (cellMm * 0.001 < 2.5 * pixA) {
      float fill = density * mix(sparseD, denseD, surfCoverage(uv, axis, salt));
      surfMist += fill * 0.6 * (maxMm / cellMm) * (maxMm / cellMm);
      float meanR = 0.25 * (minMm + maxMm) / cellMm;
      surfGlint += fill * 0.25 * meanR * meanR;
      continue;
    }
    ivec2 c = ivec2(floor(uv / cell));
    density = min(0.95, density * mix(sparseD, denseD, surfCoverage((vec2(c) + 0.5) * cell, axis, salt)));
    vec3 h = surfHash3(ivec3(c, axis * 4 + i), salt);
    if (h.x >= density) continue;
    float size = h.x / density;
    float dMm = mix(minMm, maxMm, pow(size, 1.7));
    float stretch = 1.0 + 1.1 * slope;
    float radius = min(dMm * 0.0005, 0.24 * cell / (lobes > 1 ? 1.25 : 1.0) / stretch);
    float ext = radius * stretch * (lobes > 1 ? 1.25 : 1.0);
    vec2 center = vec2(c) * cell + ext + (cell - 2.0 * ext) * h.yz;
    vec3 shakeH = surfHash3(ivec3(c, 97 + i), salt);
    float loose = step(shakeH.x, 0.35 * smoothstep(0.1, 0.4, slope)) * step(1.6, dMm) * smoothstep(-0.6, -1.2, surfWorldPos.z - surfVehicleCenter.z);
    vec3 d3 = surfLift(center - uv, axis, n);
    if (shake > 0.0) {
      float w = 6.2831853 * (37.0 + 11.0 * shakeH.y) * surfBeadTime;
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
    if (nearTrack && surfTrackDistance(worldCenter) < ${trackClear} + radius) continue;
    float geometry = surfGeo.w > 0.5 && i > 0 && dMm >= ${geometryMinMm.toFixed(2)} && distance(worldCenter, surfGeo.xyz) < surfGeo.w && dMm * 0.001 >= surfGeoAngle * distance(worldCenter, surfGeo.xyz) ? 1.0 : 0.0;
    // Drops under two pixels across alias into glitter: they join the mist sheen instead of drawing a sharp lens.
    float resolved = smoothstep(0.6 * pixA, 1.4 * pixA, radius);
    if (resolved < 1.0) {
      surfMist += density * (1.0 - resolved) * 0.6 * (dMm / cellMm) * (dMm / cellMm);
      // A drop under a pixel is a convex mirror that sends each light's irradiance out as E F r^2 / 4 per steradian: it lands as one point.
      float spot = 0.5 * pixA;
      surfGlint += (1.0 - resolved) * radius * radius / (12.566371 * spot * spot) * exp(-dot(d3, d3) / (spot * spot));
    }
    if (resolved <= 0.0) continue;
    surfCap(surfHit, d3, radius, height * resolved, n, down, slope, pix, geometry);
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
  surfMist = clamp(surfMist, 0.0, 1.0) * (1.0 - surfLane);
  float coatFar = smoothstep(${coatFade[0].toFixed(4)}, ${coatFade[1].toFixed(4)}, pix) * (1.0 - 0.7 * surfLane);
  vec3 coatTilt = coatFar > 0.0 ? toView * surfCoatSlope(p, n, down, slope, pix, surfCoverage(uv, axis, salt), salt) * coatFar : vec3(0.0);
  surfCoatVar *= coatFar * coatFar;
  surfRunLine *= coatFar;
  surfGlint += surfRunLine * ${(runTrack.width / 2).toFixed(4)} / (6.2831853 * pixA);
  #ifdef USE_CLEARCOAT
    clearcoatNormal = surfSafeNormalize(clearcoatNormal - coatTilt, clearcoatNormal);
  #else
    normal = surfSafeNormalize(normal - coatTilt, normal);
  #endif
  // Out of focus, the samples of a frame land a defocus cell apart; a highlight tighter than that sums to separate copies.
  float surfCell = surfPupil * surfCocScale * abs(1.0 / surfFocus - 1.0 / max(vViewPosition.z, 1e-3)) / surfSampleRoot;
  float surfSpread = surfCell * pix / max(surfHit.radius, 1e-6);
  // A bead much smaller than the cell would sum to faint copies; true defocus spreads it to almost nothing, so it fades into the film.
  float w = surfHit.cover * (1.0 - 0.8 * smoothstep(1.0, 3.0, surfSpread));
  float shaded = w * (1.0 - surfHit.geometry);
  vec3 dropView = surfSafeNormalize(toView * surfHit.normal, normal);
  diffuseColor.rgb *= mix(1.0, 0.86, surfMist) * mix(1.0, 0.8, surfLane) * (1.0 - 0.55 * surfHalo * (1.0 - w));
  diffuseColor.rgb *= mix(1.0, mix(0.72, 0.3, surfHit.rim), w);
  if (shaded > 0.0) {
    vec3 tilt = dropView - normal;
    normal = surfSafeNormalize(normal - shaded * (0.6 + 1.2 * surfHit.r) * tilt, normal);
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
  if (surfGlint > 0.0) {
    vec3 nW = surfToWorld(toView * n);
    vec3 vW = normalize(cameraPosition - surfWorldPos);
    vec3 glint = vec3(0.0);
    for (int i = 0; i < MAX_FILM_LIGHTS; i++) {
      if (i >= filmLightCount) break;
      vec3 toLight;
      vec3 e = filmLightAt(i, surfWorldPos, toLight);
      vec3 hw = normalize(toLight + vW);
      float nh = dot(nW, hw);
      if (nh <= 0.0 || dot(nW, toLight) <= -0.2) continue;
      float vh = clamp(dot(vW, hw), 0.0, 1.0);
      glint += e * (0.02 + 0.98 * pow(1.0 - vh, 5.0)) * smoothstep(0.0, 0.25, nh);
    }
    #ifdef USE_ENVMAP
      // A sphere sends out r^2 / 4 of everything that falls on it with no cosine, each direction weighted by its Fresnel. Four side
      // lobes carry the horizon a single upward lobe misses, and light from just behind the drop meets its rim at grazing Fresnel.
      vec3 nV = normalize(toView * n);
      vec3 t1 = normalize(cross(nV, abs(nV.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      vec3 t2 = cross(nV, t1);
      vec3 around = getIBLIrradiance(nV) + 0.5 * (getIBLIrradiance(t1) + getIBLIrradiance(-t1) + getIBLIrradiance(t2) + getIBLIrradiance(-t2));
      vec3 vV = normalize(vViewPosition);
      vec3 across = normalize(cross(vV, abs(vV.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      float open = mix(0.3, 1.0, smoothstep(-0.3, 0.1, dot(-vV, nV)));
      glint += ${sphereFresnel.toFixed(4)} * around + ${rimFresnel.toFixed(3)} * open * getIBLRadiance(vV, across, 0.35);
    #endif
    totalEmissiveRadiance += glint * surfGlint * (1.0 - surfLane);
  }
  surfBeadOut = shaded;
  // A dome a few pixels across holds every normal inside one pixel: spread its highlight, as a prefiltered normal map would.
  surfBeadRough = mix(0.26, 0.045, smoothstep(1.5 * pix, 9.0 * pix, surfHit.radius));
  surfBeadRough = max(surfBeadRough, 0.85 * smoothstep(0.15, 0.8, surfSpread));
  surfDiagOut = vec4(vec3(1.0, 0.1, 0.9) * (0.15 + 0.85 * max(w, surfMist * 0.5)), 1.0);
}
`

// Three's own floor on roughness is applied before this chunk; a tighter lobe under a compact light blows up into fireflies.
const beadsSpecular = /* glsl */ `
surfBeadRough = min(max(surfBeadRough, 0.045) + geometryRoughness, 1.0);
#ifdef USE_CLEARCOAT
  material.clearcoat *= 1.0 - 0.6 * surfHalo * (1.0 - surfBeadOut);
  material.clearcoat = mix(material.clearcoat, 1.0, surfBeadOut);
  material.clearcoatRoughness = mix(material.clearcoatRoughness, surfBeadRough, surfBeadOut);
  // Unresolved drops cover part of the pixel: the coat between them stays sharp, and their own light comes back as glint.
  material.clearcoat *= 1.0 - 0.5 * surfMist * (1.0 - surfBeadOut);
  material.clearcoatRoughness = mix(material.clearcoatRoughness, min(material.clearcoatRoughness, 0.03), surfLane);
  material.clearcoatRoughness = sqrt(sqrt(pow(material.clearcoatRoughness, 4.0) + 2.0 * surfCoatVar));
#else
  material.roughness = sqrt(sqrt(pow(material.roughness, 4.0) + 2.0 * surfCoatVar));
  material.roughness = mix(material.roughness, surfBeadRough, surfBeadOut);
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
      f = insertBefore(f, '#include <map_fragment>', 'float surfBeadOut = 0.0;\nfloat surfBeadRough = 0.045;\nvec4 surfDiagOut = vec4(0.0);')
      f = insertAfter(f, '#include <clearcoat_normal_fragment_maps>', beadsFragment)
      f = insertAfter(f, '#include <lights_physical_fragment>', beadsSpecular)
      f = insertBefore(f, '#include <opaque_fragment>', 'if (surfDiag > 0.5) { outgoingLight = surfDiagOut.rgb; }')
      shader.fragmentShader = f
    },
  })
}
