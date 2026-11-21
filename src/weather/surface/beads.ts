import * as THREE from 'three'
import { config } from '../../config'
import { withEmitters, waterF0 } from '../../core/emitters'
import { filmLightsGlsl } from '../../core/lights'
import { insertAfter, insertBefore, patchMaterial } from '../../materials/patch'
import { surfaceCommonGlsl, surfaceVaryingsGlsl, surfaceVertexGlsl } from './glsl'
import { dripAttribute } from './drip-edges'
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
  { cellMm: 1.1, minMm: 0.12, maxMm: 0.45, flat: 0.15, steep: 0.35, lobes: 1, sparse: 0.5, dense: 0.9, hang: 0 },
  { cellMm: 3.4, minMm: 0.5, maxMm: 1.6, flat: 0.2, steep: 0.3, lobes: 1, sparse: 0.05, dense: 0.7, hang: 0 },
  { cellMm: 6.4, minMm: 1.5, maxMm: 3.1, flat: 0.25, steep: 0.15, lobes: 1, sparse: 0.05, dense: 0.8, hang: 0.4 },
  { cellMm: 16, minMm: 2.4, maxMm: 5.5, flat: 0.4, steep: 0.05, lobes: 1, sparse: 0, dense: 1.3, hang: 0.3 },
  { cellMm: 36, minMm: 4, maxMm: 11, flat: 0.25, steep: 0.03, lobes: 2, sparse: 0, dense: 1.2, hang: 1.2 },
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
/** Roll waves of the draining film on glass: spacing along the fall line and width across it in meters, and their slope. */
const glassRoll = { along: 0.04, across: 0.12, slope: 0.06 }
const glassCycles = (w: number) => Math.max(1, Math.round((glassSheetSpeed * config.film.durationSeconds) / w))
const runTrack = { spacing: 0.03, width: 0.004, length: 0.3, height: 0.00015, live: 0.8 }
/** Water held along a lower edge: a line of it on the lip and pendant drops hanging from it, spaced about two diameters apart. */
const drip = { spacing: 0.009, live: 0.7, minMm: 2.0, maxMm: 4.8, lineWidth: 0.0012, lineHeight: 0.0005 }
/** A bead under a pixel lands as a spot this many pixels wide (Gaussian sigma), each light at its own place on the cap. */
export const splatSigma = 0.7
/** With many jittered samples a frame filters its own pixels, so the spot narrows toward this. */
const splatSigmaFine = 0.35
/** Ratios of cell to footprint over which a layer hands over from its mean to single drops. */
const splatBand = [0.7, 1.3]
/** Spread of contact angle in degrees, random lean and downhill sag of the cap normal, from drop to drop. */
const beadJitter = { contact: 30, lean: 0.35, sag: 0.25 }
/** A rivulet seen from afar: stretches of this length in meters, the share of them holding water, their meander lean, and their area relative to a disk per stretch. */
const runChain = { spacing: 0.005, live: 0.75, lean: 0.5, share: 1.3 }
/** A lane this live has gathered the beads in its path. */
const runLive = 0.5
/** The body's 'gap' attribute: 1 on a shut gap's edges and walls, falling to 0 over this many meters onto the panel. */
export const gapAttribute = 'gap'
export const gapReach = 0.003
/** Beads pinned along a gap's edge: spacing in meters, the share of places holding one, and their diameters in millimeters. */
const gapPin = { spacing: 0.006, live: 0.6, minMm: 1.0, maxMm: 2.6 }
/** Footprints in meters over which the distant film takes over from the drops the macro lens resolves. */
const coatFade = [0.0014, 0.0026]

/** Rain leaves the beads in drifts: a slow coverage field thins some patches to mist and packs others with large drops. */
const coverageCm = [18, 6, 2.2]
const coverageWeights = [0.45, 0.4, 0.15]
/** Where the drift is dense its drops have run together into larger ones: the power that skews sizes, sparse to dense. */
const sizeSkew = [2.2, 1.2]
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
  let n = 0
  coverageCm.forEach((cm, k) => (n += coverageWeights[k] * valueNoise(u / (cm / 100), v / (cm / 100), z + 4 * k, salt)))
  return THREE.MathUtils.smoothstep(n, 0.3, 0.7)
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
/** Capillary length of water. A puddle levels off at 2 l sin(theta / 2), about 4.2 mm at 100 degrees. */
const capillaryMm = 2.71

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
  const cap = (2 * capillaryMm * Math.sin(theta / 2)) / 1000
  return hs / Math.sqrt(1 + (hs / cap) * (hs / cap))
}

/** The drops of one cell, exactly as the shader places them. `level` is the face's cosine against up, `slope` the sine of its tilt. */
export function cellDrops(layerIndex: number, cx: number, cy: number, axis: number, bead: BeadClass, level: number, slope: number): Drop[] {
  const layer = beadLayers[layerIndex]
  const cell = layer.cellMm / 1000
  const [hx, hy, hz] = surfHash3(cx, cy, axis * 4 + layerIndex, bead.salt)
  const coverage = coverageAt((cx + 0.5) * cell, (cy + 0.5) * cell, axis, bead.salt)
  const density = densityFor(layer, level, coverage)
  if (hx >= density) return []
  const size = hx / density
  const diameterMm = layer.minMm + (layer.maxMm - layer.minMm) * Math.pow(size, THREE.MathUtils.lerp(sizeSkew[0], sizeSkew[1], coverage))
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

function gradNoise(x: number, y: number, z: number, salt: number): [number, number, number] {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const dx = 6 * fx * (1 - fx), dy = 6 * fy * (1 - fy)
  const a = surfHash3(ix, iy, z, salt)[0], b = surfHash3(ix + 1, iy, z, salt)[0]
  const d = surfHash3(ix, iy + 1, z, salt)[0], e = surfHash3(ix + 1, iy + 1, z, salt)[0]
  const lerp = (p: number, q: number, t: number) => p + (q - p) * t
  return [lerp(lerp(a, b, ux), lerp(d, e, ux), uy), dx * lerp(b - a, e - d, uy), dy * lerp(d - a, e - b, ux)]
}

/** The shader's rivulet lanes on the CPU: true where a live lane has taken up a drop of this radius centred at p, in the object's meter frame. */
export function runSwept(p: THREE.Vector3, n: THREE.Vector3, down: THREE.Vector3, slope: number, salt: number, radius: number, layer: number): boolean {
  const steep = THREE.MathUtils.smoothstep(slope, 0.15, 0.6)
  if (steep <= 0) return false
  const b = new THREE.Vector3().crossVectors(n, down).normalize()
  const qx = p.dot(b), qy = p.dot(down)
  const m = gradNoise(0, qy / (runTrack.length * 0.5), 65, salt)
  const w = gradNoise(0, qy / (runTrack.length * 0.12), 67, salt)
  const lane = qx / runTrack.spacing + 0.8 * m[0] + 0.2 * w[0]
  const gy = (0.8 * m[2]) / (runTrack.length * 0.5) + (0.2 * w[2]) / (runTrack.length * 0.12)
  const id = Math.floor(lane)
  const run = steep * (surfHash3(id, 5, 0, salt)[0] >= runTrack.live ? 1 : 0) * THREE.MathUtils.smoothstep(gradNoise(id * 1.7, qy / runTrack.length, 66, salt)[0], 0.4, 0.6)
  if (run <= runLive) return false
  const rh = (runTrack.width / 2) * (0.6 + 0.8 * surfHash3(id, 6, 0, salt)[0])
  const u = (lane - id - 0.5) / Math.hypot(1 / runTrack.spacing, gy)
  return Math.abs(u) < rh + (layer > 0 ? radius : 0)
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

float surfCoverage(vec2 uv, int axis, uint salt) {
  int z = axis + ${coverageSalt};
  float n = ${coverageCm.map((cm, k) => `${coverageWeights[k].toFixed(2)} * surfValueNoise(uv / ${(cm / 100).toFixed(4)}, z + ${4 * k}, salt)`).join(' + ')};
  return smoothstep(0.3, 0.7, n);
}

float surfCapHeight(float radius) {
  float theta = radians(surfBeadContact);
  float hs = radius * (1.0 - cos(theta)) / sin(theta);
  float cap = ${((2 * capillaryMm) / 1000).toFixed(5)} * sin(0.5 * theta);
  return hs / sqrt(1.0 + (hs / cap) * (hs / cap));
}

// Fit to a 3D trace through the cap profile: the share of a bead's silhouette whose rays leave through its far side
// without reaching the paint, by aspect h/r and view elevation. Flattened puddles send nearly every ray into the paint.
float surfLensExit(float aspect, float sinE) {
  float elevMax = radians(mix(4.0, 24.0, smoothstep(0.75, 1.0, aspect)));
  return 0.85 * smoothstep(0.45, 0.75, aspect) * max(0.0, 1.0 - asin(sinE) / elevMax);
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
float surfLensW = 0.0;
float surfSinE = 1.0;
float surfLensOpen = 0.0;
float surfCapBelow = 0.0;

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
  if (glass > 0.0) {
    // A film draining down a pane gathers into roll waves: fronts wide across the fall line, close along it, riding down with the flow.
    vec3 g = surfGradNoiseWrap(vec2(q.x / ${glassRoll.across.toFixed(4)}, q.y / ${glassRoll.along.toFixed(4)} - flow * ${glassCycles(glassRoll.along)}.0), ${glassCycles(glassRoll.along)}, 63, salt);
    float filt = exp(-2.0 * pow(pix / ${glassRoll.along.toFixed(4)}, 2.0));
    s += ${glassRoll.slope.toFixed(3)} * filt * vec2(g.y * ${(glassRoll.along / glassRoll.across).toFixed(4)}, g.z);
    surfCoatVar += ${(glassRoll.slope ** 2 * 0.4).toFixed(6)} * (1.0 - filt * filt);
  }
  return b * s.x + a * s.y;
}

/** A rivulet is a cylinder of water down a lane: its ridge tilts the coat across the lane where the lens resolves it, and past that it is a glint line. */
float surfRunVar = 0.0;
float surfRunSteep = 0.0;
float surfRunLaneP = 0.0;
vec2 surfRunGl = vec2(1.0);
vec2 surfRunQ = vec2(0.0);
vec3 surfRunA = vec3(0.0);
vec3 surfRunB = vec3(0.0);
uint surfRunSalt = 0u;
void surfRunSetup(vec3 p, vec3 n, vec3 down, float slope, uint salt) {
  surfRunSteep = smoothstep(0.15, 0.6, slope);
  if (surfRunSteep <= 0.0) return;
  surfRunA = down;
  surfRunB = normalize(cross(n, down));
  surfRunQ = vec2(dot(p, surfRunB), dot(p, surfRunA));
  surfRunSalt = salt;
  vec3 m = surfGradNoise(vec2(0.0, surfRunQ.y / ${(runTrack.length * 0.5).toFixed(4)}), 65, salt);
  vec3 w = surfGradNoise(vec2(0.0, surfRunQ.y / ${(runTrack.length * 0.12).toFixed(4)}), 67, salt);
  surfRunLaneP = surfRunQ.x / ${runTrack.spacing.toFixed(4)} + 0.8 * m.x + 0.2 * w.x;
  surfRunGl = vec2(1.0 / ${runTrack.spacing.toFixed(4)}, 0.8 * m.z / ${(runTrack.length * 0.5).toFixed(4)} + 0.2 * w.z / ${(runTrack.length * 0.12).toFixed(4)});
}
/** The lane under an offset from the fragment: signed distance from its centre line in meters, how live it is, and its half width. */
vec3 surfRunAt(vec3 d) {
  if (surfRunSteep <= 0.0) return vec3(1.0, 0.0, 0.0);
  float lane = surfRunLaneP + dot(surfRunGl, vec2(dot(d, surfRunB), dot(d, surfRunA)));
  float id = floor(lane);
  float run = surfRunSteep * step(${runTrack.live.toFixed(2)}, surfHash3(ivec3(int(id), 5, 0), surfRunSalt).x) * smoothstep(0.4, 0.6, surfGradNoise(vec2(id * 1.7, (surfRunQ.y + dot(d, surfRunA)) / ${runTrack.length.toFixed(4)}), 66, surfRunSalt).x);
  float rh = ${(runTrack.width / 2).toFixed(4)} * (0.6 + 0.8 * surfHash3(ivec3(int(id), 6, 0), surfRunSalt).x);
  return vec3((fract(lane) - 0.5) / length(surfRunGl), run, rh);
}
/** A live lane has taken up every bead whose foot it touches; the finest mist survives along its banks. */
bool surfRunSwept(vec3 d, float radius, int layer) {
  vec3 r = surfRunAt(d);
  return r.y > ${runLive} && abs(r.x) < r.z + (layer > 0 ? radius : 0.0);
}
vec3 surfRunSlope(float pix) {
  surfRunLine = 0.0;
  surfRunVar = 0.0;
  vec3 r = surfRunAt(vec3(0.0));
  float run = r.y;
  if (run <= 0.0) return vec3(0.0);
  float u = r.x;
  float rh = r.z;
  vec2 gl = surfRunGl / length(surfRunGl);
  float filt = exp(-2.0 * pow(pix / ${runTrack.width.toFixed(4)}, 2.0));
  float inside = step(abs(u), rh);
  vec2 s = run * filt * inside * (-2.0 * ${runTrack.height.toFixed(5)} * u / (rh * rh)) * gl;
  float band = max(surfPixA, ${runTrack.width.toFixed(4)});
  float near = 1.0 - smoothstep(0.5 * band, band, abs(u));
  surfRunLine = run * (1.0 - filt) * min(${runTrack.width.toFixed(4)} / surfPixA, 1.0) * near;
  surfRunVar = run * run * ${(((2 * runTrack.height) / runTrack.width) ** 2 * 0.5).toFixed(6)} * (1.0 - filt * filt) * near;
  return surfRunB * s.x + surfRunA * s.y;
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
  // The meniscus shades the paint on the low side; on a drop a few pixels wide it would only print a dark dot.
  float low = mix(1.0, smoothstep(-0.3, 0.5, -along / max(length(d3), 1e-7)), min(slope * 4.0, 1.0));
  if (r < 1.3) surfHalo = max(surfHalo, (1.0 - smoothstep(0.92, 1.3, r)) * clamp(height / radius, 0.0, 1.0) * low * smoothstep(2.0 * pix, 5.0 * pix, radius));
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
float surfOcc = 0.0;
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
  // At a glancing view the footprint is long and thin; a drop is judged against the pixel's area, not its longest side.
  float pixA = min(pix, 1.4142 * sqrt(max(length(cross(dFdx(p), dFdy(p))), 1e-12)));
  surfPixA = pixA;
  mat3 toView = mat3(surfObjToView0, surfObjToView1, surfObjToView2);
  float up = smoothstep(0.2, 0.95, level);
  surfSinE = max(abs(dot(normalize(toView * n), normalize(vViewPosition))), 0.03);
  float cotE = sqrt(1.0 - surfSinE * surfSinE) / surfSinE;
  float screenCover = 0.0;
  float under = smoothstep(0.3, 0.9, -level);
  float surfEdge = smoothstep(0.05, 0.4, -level) * (1.0 - smoothstep(0.7, 0.95, -level));
  uint salt = uint(surfBeadSalt);
  float shake = surfVibration;
  float laneDistance = surfTrackLen > 0.0 && distance(surfWorldPos, surfTrackBox.xyz) < surfTrackBox.w ? surfTrackDistance(surfWorldPos) : 1e9;
  bool nearTrack = laneDistance < ${trackClear} + 0.007;
  // The runner leaves a thin, level film where it took up the mist, so its lane is darker and glossier than the beaded paint.
  surfLane = 1.0 - smoothstep(${trackClear} * 0.55, ${trackClear}, laneDistance);
  // No water stands in a shut gap: its beads keep clear of the edge or pin along it.
  float gapHere = surfGapV;
  float gapKeep = 1.0 - step(0.999, gapHere);
  vec3 gapGrad = vec3(0.0);
  {
    vec3 dpx = dFdx(p), dpy = dFdy(p);
    vec3 ns = cross(dpx, dpy);
    gapGrad = (dFdx(gapHere) * cross(dpy, ns) + dFdy(gapHere) * cross(ns, dpx)) / max(dot(ns, ns), 1e-20);
    gapGrad -= n * dot(gapGrad, n);
  }
  surfRunSetup(p, n, down, slope, salt);
  surfRunSteep *= 1.0 - step(1e-4, gapHere);
  vec3 laneHere = surfRunAt(vec3(0.0));
  float laneBand = max(pixA, 2.0 * laneHere.z);
  float laneCover = step(${runLive}, laneHere.y) * min(2.0 * laneHere.z / pixA, 1.0) * (1.0 - smoothstep(0.5 * laneBand, laneBand, abs(laneHere.x)));
  vec3 nW = surfToWorld(toView * n);
  vec3 vW = normalize(cameraPosition - surfWorldPos);
  vec3 surfSkyGlint = vec3(0.0);
  vec3 surfLensCol = vec3(0.0);
  #ifdef USE_ENVMAP
  {
    // A sphere sends out r^2 / 4 of everything that falls on it with no cosine, each direction weighted by its Fresnel. Four side
    // lobes carry the horizon a single upward lobe misses, and light from just behind the drop meets its rim at grazing Fresnel.
    vec3 nV = normalize(toView * n);
    vec3 t1 = normalize(cross(nV, abs(nV.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(nV, t1);
    vec3 around = getIBLIrradiance(nV) + 0.5 * (getIBLIrradiance(t1) + getIBLIrradiance(-t1) + getIBLIrradiance(t2) + getIBLIrradiance(-t2));
    vec3 vV = normalize(vViewPosition);
    vec3 across = normalize(cross(vV, abs(vV.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    float open = mix(0.3, 1.0, smoothstep(-0.3, 0.1, dot(-vV, nV)));
    surfSkyGlint = ${sphereFresnel.toFixed(4)} * around + ${rimFresnel.toFixed(3)} * open * getIBLRadiance(vV, across, 0.35);
    // Unresolved beads: the rays that cross a bead leave heading down into the coat just behind it, so each bead carries a
    // small image of the sky ahead and above, at about 13 degrees plus twice the view elevation, through the coat's Fresnel.
    vec3 ahead = surfSafeNormalize(-vV - nV * dot(-vV, nV), nV);
    float rise = radians(13.0) + 2.0 * asin(surfSinE);
    float sinRise = sin(min(rise, 1.5));
    vec3 dir = normalize(ahead * cos(min(rise, 1.5)) + nV * sinRise);
    float coat = 0.04 + 0.96 * pow(1.0 - sinRise, 5.0);
    // Each unresolved bead sends a compact light out over its whole exit cone, as the resolved lens does once R is under a pixel.
    surfLensCol = 0.9 * coat * max(getIBLRadiance(dir, dir, 0.45), emitterGlintF0(surfWorldPos, surfToWorld(dir), surfToWorld(dir), 1.0, -1.0, vec3(1.0)));
  }
  #endif
  float eyeD = length(cameraPosition - surfWorldPos);
  float unit = 2.0 * eyeD * emitterPixelAngle;
  // Per unit glint weight a bead returns E F for each sign; the mean Fresnel share of the signs is already in the cube terms.
  vec3 signShare = emitterBeadF0(surfWorldPos, nW, vW, unit, eyeD, emitterPixelAngle, vec3(${sphereFresnel.toFixed(4)}), -1.0);
  float surfCell = surfPupil * surfCocScale * abs(1.0 / surfFocus - 1.0 / max(vViewPosition.z, 1e-3)) / surfSampleRoot;
  surfSplatSetup(surfWorldPos, nW, vW, max(max(${splatSigma.toFixed(2)} / sqrt(surfSampleRoot), ${splatSigmaFine.toFixed(2)}), 0.5 * surfCell), max(surfSkyGlint - signShare, vec3(0.0)));
  vec3 tW1 = normalize(cross(nW, abs(nW.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 tW2 = cross(nW, tW1);
  vec3 downW = slope > 1e-4 ? surfToWorld(toView * down) : vec3(0.0);
  float proj = surfSinE;
  for (int i = 0; i < ${beadLayers.length}; i++) {
    float cellMm, minMm, maxMm, flatD, steepD, sparseD, denseD;
    int lobes;
    surfLayer(i, cellMm, minMm, maxMm, flatD, steepD, lobes, sparseD, denseD);
    float cell = cellMm * 0.001;
    float density = mix(steepD, flatD, up) * (1.0 - 0.8 * under + (${hangGlsl}) * surfEdge) * gapKeep;
    float perCell = smoothstep(${splatBand[0].toFixed(2)}, ${splatBand[1].toFixed(2)}, cell / pixA);
    if (perCell < 1.0) {
      float fill = (1.0 - perCell) * density * mix(sparseD, denseD, surfCoverage(uv, axis, salt)) * (1.0 - laneCover);
      float meanR = 0.25 * (minMm + maxMm) / cellMm;
      float meanA = surfCapHeight(meanR * cell) / (meanR * cell);
      float side = 1.0 + 0.5 * meanA * cotE;
      screenCover += fill * 3.14159 * meanR * meanR * side;
      // The drops a pixel holds are a Poisson count, not the mean: a fixed grid near the pixel's footprint carries the spread.
      float lod = log2(max(pixA / cell, 1.0));
      float l0 = floor(lod);
      float count = 0.0;
      for (int k = 0; k < 2; k++) {
        float g = cell * exp2(l0 + float(k));
        vec3 rh = surfHash3(ivec3(ivec2(floor(uv / g)), 211 + 8 * i + k), salt);
        float expect = max(fill * (g / cell) * (g / cell), 1e-4);
        float z = sqrt(-2.0 * log(max(rh.x, 1e-6))) * cos(6.2831853 * rh.y);
        count += (k == 0 ? 1.0 - (lod - l0) : lod - l0) * max(0.0, expect + sqrt(expect) * z) / expect;
      }
      float pointsHere = fill * 0.25 * meanR * meanR * side * count;
      surfMist += fill * 0.6 * (maxMm / cellMm) * (maxMm / cellMm) * count;
      surfGlint += pointsHere;
      surfLensW += pointsHere * 12.566371 * surfLensExit(meanA, surfSinE);
    }
    if (perCell <= 0.0) continue;
    ivec2 cHere = ivec2(floor(uv / cell));
    // A bead under a pixel is drawn as a spread spot that may reach past its own cell, so the neighbours are read for it.
    int span = ${(0.5).toFixed(1)} * maxMm * 0.001 < 2.6 * pixA ? 1 : 0;
    float reachUV = (3.0 * surfSplatSigma + 1.0) * pix;
    for (int cy = -1; cy <= 1; cy++) {
    for (int cx = -1; cx <= 1; cx++) {
    if (max(abs(cx), abs(cy)) > span) continue;
    ivec2 c = cHere + ivec2(cx, cy);
    bool own = cx == 0 && cy == 0;
    vec2 gap = max(abs(uv - (vec2(c) + 0.5) * cell) - 0.5 * cell, 0.0);
    if (!own && dot(gap, gap) > reachUV * reachUV) continue;
    float covC = surfCoverage((vec2(c) + 0.5) * cell, axis, salt);
    float densityC = min(0.95, density * mix(sparseD, denseD, covC));
    float meanR = 0.25 * (minMm + maxMm) * 0.001;
    float meanCover = densityC * 3.14159 * meanR * meanR / (cell * cell) * (1.0 + 0.5 * surfCapHeight(meanR) / meanR * cotE);
    if (own) screenCover += meanCover;
    // A drop about a pixel wide hides the coat's mirror over its share of the pixels around it, not as one black pixel.
    if (own) surfOcc += perCell * meanCover * (1.0 - smoothstep(1.0 * pixA, 2.6 * pixA, meanR));
    vec3 h = surfHash3(ivec3(c, axis * 4 + i), salt);
    if (h.x >= densityC) continue;
    float size = h.x / densityC;
    float dMm = mix(minMm, maxMm, pow(size, mix(${sizeSkew[0].toFixed(2)}, ${sizeSkew[1].toFixed(2)}, covC)));
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
    // Seen low across the panel a bead shows its side as well as its foreshortened base.
    float side = 1.0 + 0.5 * height / radius * cotE;
    vec3 dW = (vec4(toView * d3, 0.0) * viewMatrix).xyz;
    vec3 worldCenter = surfWorldPos + dW;
    if (nearTrack && surfTrackDistance(worldCenter) < ${trackClear} + radius) continue;
    if (surfRunSwept(d3, radius, i)) continue;
    if (gapHere > 0.0 && (1.0 - gapHere - dot(gapGrad, d3)) * ${gapReach.toFixed(4)} < radius) continue;
    // Drops under five pixels across alias into dark dots and glitter: they join the mist sheen instead of drawing a sharp lens.
    float resolved = smoothstep(1.2 * pixA, 2.6 * pixA, radius);
    if (resolved < 1.0) {
      surfOcc += perCell * (1.0 - resolved) * smoothstep(1.0 * pixA, 2.6 * pixA, radius) * surfSplatCover(dW, radius, side * proj);
      // No two drops share a shape: the contact angle and the lean of each one decide which lights its cap can show.
      vec3 jh = surfHash3(ivec3(c, 151 + i), salt);
      float capCos = cos(radians(surfBeadContact + ${beadJitter.contact.toFixed(1)} * (jh.x - 0.5)));
      vec3 nb = normalize(nW + ${beadJitter.lean.toFixed(2)} * ((jh.y - 0.5) * tW1 + (jh.z - 0.5) * tW2) + ${beadJitter.sag.toFixed(2)} * slope * downW);
      vec3 extra = proj * side * (surfSplatSky + surfLensCol * 12.566371 * surfLensExit(height / radius, surfSinE));
      surfSplat(dW, radius, height, capCos, nb, extra, perCell * (1.0 - resolved));
    }
    if (!own || resolved <= 0.0) continue;
    float geometry = surfGeo.w > 0.5 && i > 0 && dMm >= ${geometryMinMm.toFixed(2)} && distance(worldCenter, surfGeo.xyz) < surfGeo.w && dMm * 0.001 >= surfGeoAngle * distance(worldCenter, surfGeo.xyz) ? 1.0 : 0.0;
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
    }
  }
  vec3 dripTilt = vec3(0.0);
  float dripD = surfDripV.x;
  if (surfDripV.y > 0.5 && level > -0.3 && dripD < ${(drip.maxMm * 0.001).toFixed(4)} + pixA) {
    vec3 dpx = dFdx(p), dpy = dFdy(p);
    vec3 ns = cross(dpx, dpy);
    vec3 gd = (dFdx(dripD) * cross(dpy, ns) + dFdy(dripD) * cross(ns, dpx)) / max(dot(ns, ns), 1e-20);
    gd -= n * dot(gd, n);
    vec3 away = dot(gd, gd) > 1e-6 ? normalize(gd) : (slope > 1e-4 ? -down : vec3(0.0));
    if (dot(away, away) > 0.5) {
      vec3 e = normalize(cross(n, away));
      float along = dot(p, e);
      // The line the edge holds: a half cylinder lying on the lip.
      float wl = ${drip.lineWidth.toFixed(4)};
      float filt = exp(-2.0 * pow(pix / (2.0 * wl), 2.0));
      dripTilt = away * (-2.0 * ${drip.lineHeight.toFixed(5)} * dripD / (wl * wl)) * step(dripD, wl) * filt;
      float band = max(pixA, wl);
      float near = 1.0 - smoothstep(0.5 * band, band, dripD);
      surfGlint += (1.0 - filt) * min(wl / pixA, 1.0) * near * wl / (6.2831853 * pixA);
      surfCoatVar += (1.0 - filt * filt) * near * ${(((2 * drip.lineHeight) / drip.lineWidth) ** 2 * 0.5).toFixed(6)};
      float k = floor(along / ${drip.spacing.toFixed(4)});
      for (int j = -1; j <= 1; j++) {
        float id = k + float(j);
        vec3 h = surfHash3(ivec3(int(id), 7, axis), salt);
        if (h.x >= ${drip.live.toFixed(2)}) continue;
        float r = mix(${(drip.minMm * 0.0005).toFixed(5)}, ${(drip.maxMm * 0.0005).toFixed(5)}, h.y);
        float ac = (id + 0.25 + 0.5 * h.z) * ${drip.spacing.toFixed(4)};
        vec3 d3 = e * (ac - along) + away * (0.75 * r - dripD);
        float height = surfCapHeight(r);
        float side = 1.0 + 0.5 * height / r * cotE;
        float resolved = smoothstep(1.2 * pixA, 2.6 * pixA, r);
        if (resolved < 1.0) {
          vec3 extra = proj * side * (surfSplatSky + surfLensCol * 12.566371 * surfLensExit(height / r, surfSinE));
          surfSplat((vec4(toView * d3, 0.0) * viewMatrix).xyz, r, height, cos(radians(surfBeadContact)), normalize(nW + 0.3 * downW), extra, 1.0 - resolved);
        }
        if (resolved > 0.0) surfCap(surfHit, d3, r, height * resolved, n, down, slope, pix, 0.0);
      }
    }
  }
  if (gapHere > 0.0 && gapKeep > 0.0 && level > -0.3 && dot(gapGrad, gapGrad) > 1.0) {
    vec3 toward = normalize(gapGrad);
    vec3 e = normalize(cross(n, toward));
    float dE = (1.0 - gapHere) * ${gapReach.toFixed(4)};
    float along = dot(p, e);
    float k = floor(along / ${gapPin.spacing.toFixed(4)});
    for (int j = -1; j <= 1; j++) {
      float id = k + float(j);
      vec3 h = surfHash3(ivec3(int(id), 13, axis), salt);
      if (h.x >= ${gapPin.live.toFixed(2)}) continue;
      float r = mix(${(gapPin.minMm * 0.0005).toFixed(5)}, ${(gapPin.maxMm * 0.0005).toFixed(5)}, h.y * h.y);
      float ac = (id + 0.25 + 0.5 * h.z) * ${gapPin.spacing.toFixed(4)};
      vec3 d3 = e * (ac - along) + toward * (dE - 1.05 * r);
      float height = surfCapHeight(r);
      float side = 1.0 + 0.5 * height / r * cotE;
      float resolved = smoothstep(1.2 * pixA, 2.6 * pixA, r);
      if (resolved < 1.0) {
        vec3 extra = proj * side * (surfSplatSky + surfLensCol * 12.566371 * surfLensExit(height / r, surfSinE));
        surfSplat((vec4(toView * d3, 0.0) * viewMatrix).xyz, r, height, cos(radians(surfBeadContact)), nW, extra, 1.0 - resolved);
      }
      if (resolved > 0.0) surfCap(surfHit, d3, r, height * resolved, n, down, slope, pix, 0.0);
    }
  }
  surfMist = clamp(surfMist, 0.0, 1.0) * (1.0 - surfLane);
  surfOcc = min(surfOcc, 0.9) * (1.0 - surfLane);
  // Beads in front hide beads behind once their silhouettes fill the view.
  float hidden = screenCover > 1e-4 ? (1.0 - exp(-screenCover)) / screenCover : 1.0;
  surfGlint *= hidden;
  surfLensW *= hidden;
  float coatFar = smoothstep(${coatFade[0].toFixed(4)}, ${coatFade[1].toFixed(4)}, pix) * (1.0 - 0.7 * surfLane);
  // The drifts keep their beads at any distance, but a merged sheet reads only up close: far off, a dense drift as a sheet would
  // turn the clean coat between its drops into a broad glossy lobe under every compact light.
  float sheetCover = mix(surfCoverage(uv, axis, salt), 0.5, 0.7 * smoothstep(0.0012, 0.004, pix));
  vec3 coatTilt = coatFar > 0.0 ? toView * surfCoatSlope(p, n, down, slope, pix, sheetCover, salt) * coatFar : vec3(0.0);
  surfCoatVar *= coatFar * coatFar;
  coatTilt += toView * (surfRunSlope(pix) + dripTilt);
  surfCoatVar += surfRunVar;
  if (surfRunSteep > 0.0) {
    // Past the lens's reach a rivulet is a chain of shallow lenses: its meander turns each stretch to a different light, so
    // from a distance it reads as a broken track rather than a line.
    vec3 r = surfRunAt(vec3(0.0));
    float far = r.y * (1.0 - exp(-2.0 * pow(pix / ${runTrack.width.toFixed(4)}, 2.0)));
    float reachUV = (3.0 * surfSplatSigma + 1.0) * pix;
    if (far > 0.0 && abs(r.x) < r.z + reachUV) {
      vec2 gl = surfRunGl / length(surfRunGl);
      vec3 acr = surfRunB * gl.x + surfRunA * gl.y;
      vec3 alongV = surfRunA * gl.x - surfRunB * gl.y;
      float along = dot(p, alongV);
      float k = floor(along / ${runChain.spacing.toFixed(4)});
      int lane = int(floor(surfRunLaneP));
      int reachK = int(min(ceil(reachUV / ${runChain.spacing.toFixed(4)}), 3.0));
      for (int j = -3; j <= 3; j++) {
        if (abs(j) > reachK) continue;
        float id = k + float(j);
        vec3 hr = surfHash3(ivec3(lane, int(id), 9), salt);
        if (hr.x >= ${runChain.live.toFixed(2)}) continue;
        vec3 hl = surfHash3(ivec3(lane, int(id), 10), salt);
        float rr = r.z * (0.7 + 0.5 * hr.y);
        float hh = ${runTrack.height.toFixed(5)} * (0.6 + 0.8 * hr.z);
        float Rs = (rr * rr + hh * hh) / (2.0 * hh);
        vec3 d3 = -acr * r.x + alongV * ((id + 0.5) * ${runChain.spacing.toFixed(4)} - along);
        vec3 nb = normalize(nW + ${runChain.lean.toFixed(2)} * ((hl.x - 0.5) * tW1 + (hl.y - 0.5) * tW2));
        vec3 extra = proj * (surfSplatSky + surfLensCol * 12.566371 * surfLensExit(hh / rr, surfSinE));
        surfSplat((vec4(toView * d3, 0.0) * viewMatrix).xyz, rr, hh, sqrt(max(1.0 - rr * rr / (Rs * Rs), 0.0)), nb, extra, far * ${runChain.share.toFixed(2)});
      }
    }
  }
  #ifdef USE_CLEARCOAT
    clearcoatNormal = surfSafeNormalize(clearcoatNormal - coatTilt, clearcoatNormal);
  #else
    normal = surfSafeNormalize(normal - coatTilt, normal);
  #endif
  // Out of focus, the samples of a frame land a defocus cell apart; a highlight tighter than that sums to separate copies.
  float surfSpread = surfCell * pix / max(surfHit.radius, 1e-6);
  // A bead much smaller than the cell would sum to faint copies; true defocus spreads it to almost nothing, so it fades into the film.
  float w = surfHit.cover * (1.0 - 0.8 * smoothstep(1.0, 3.0, surfSpread));
  float shaded = w * (1.0 - surfHit.geometry);
  vec3 dropView = surfSafeNormalize(toView * surfHit.normal, normal);
  #ifdef USE_ENVMAP
  if (shaded > 0.0) {
    // A resolved bead is a lens: refract in, cross the water, refract out. The ray either reaches the paint under the bead,
    // the dark crescent, or leaves through the far side carrying an inverted image of the city, bouncing once off the coat
    // behind the bead when it leaves heading down.
    vec3 nV = normalize(toView * n);
    vec3 vIn = -normalize(vViewPosition);
    float R = surfHit.radius;
    float h = max(surfCapHeight(R), surfHit.height + 1e-6);
    vec3 x0 = toView * (-surfHit.offset) + nV * surfHit.height;
    vec3 t = refract(vIn, dropView, 0.7519);
    if (dot(t, t) > 0.0) {
      float k = R / h - 1.0;
      vec3 xs = x0 + nV * dot(x0, nV) * k;
      vec3 ts = t + nV * dot(t, nV) * k;
      float qa = dot(ts, ts), qb = dot(xs, ts), qc = dot(xs, xs) - R * R;
      float s = (-qb + sqrt(max(qb * qb - qa * qc, 0.0))) / qa;
      float tn = dot(t, nV);
      float sBase = tn < 0.0 ? -dot(x0, nV) / tn : 1e9;
      if (sBase > s) {
        vec3 xe = x0 + s * t;
        float en = dot(xe, nV);
        vec3 ne = normalize((xe - nV * en) / (R * R) + nV * en / (h * h));
        vec3 o = refract(t, -ne, 1.33);
        if (dot(o, o) > 0.0) {
          float carry = 0.9;
          float on = dot(o, nV);
          if (on < 0.0) {
            o = reflect(o, nV);
            carry *= 0.04 + 0.96 * pow(1.0 - min(-on, 1.0), 5.0);
          }
          float lensRough = max(0.12, mix(0.26, 0.045, smoothstep(1.5 * pix, 9.0 * pix, R)));
          // Across the disk the exit ray sweeps about half the sky, some 1.6 radians, so one pixel holds 1.6 pix / R of it.
          // The jittered samples of a frame resolve that much finer between them.
          lensRough = max(lensRough, sqrt(min(0.8 * pix / (R * surfSampleRoot), 1.0)));
          surfLensOpen = shaded * smoothstep(0.0, 0.08, 1.0 - surfHit.r);
          vec3 oW = surfToWorld(o);
          // The cube holds the signs blurred; where one sits inside the exit cone its sharp face replaces it.
          totalEmissiveRadiance += surfLensOpen * carry * max(getIBLRadiance(o, o, lensRough), emitterGlintF0(surfWorldPos, oW, oW, max(lensRough, 0.85 * smoothstep(0.15, 0.8, surfSpread)), R, vec3(1.0)));
        }
      } else {
        // A ray that reaches the coat under the drop meets a weak water to coat interface and comes back off it through the cap.
        vec3 xb = x0 + sBase * t;
        vec3 tb = reflect(t, nV);
        vec3 xs2 = xb + nV * dot(xb, nV) * k;
        vec3 ts2 = tb + nV * dot(tb, nV) * k;
        float qa2 = dot(ts2, ts2), qb2 = dot(xs2, ts2), qc2 = dot(xs2, xs2) - R * R;
        float s2 = (-qb2 + sqrt(max(qb2 * qb2 - qa2 * qc2, 0.0))) / qa2;
        vec3 xe = xb + s2 * tb;
        float en = dot(xe, nV);
        vec3 ne = normalize((xe - nV * en) / (R * R) + nV * en / (h * h));
        vec3 o = refract(tb, -ne, 1.33);
        if (dot(o, o) > 0.0) {
          float waterCoat = 0.0036 + 0.9964 * pow(1.0 - clamp(-tn, 0.0, 1.0), 5.0);
          float lensRough = max(0.12, sqrt(min(0.8 * pix / (R * surfSampleRoot), 1.0)));
          surfLensOpen = shaded * smoothstep(0.0, 0.08, 1.0 - surfHit.r);
          vec3 oW = surfToWorld(o);
          totalEmissiveRadiance += surfLensOpen * 0.9 * waterCoat * max(getIBLRadiance(o, o, lensRough), emitterGlintF0(surfWorldPos, oW, oW, max(lensRough, 0.85 * smoothstep(0.15, 0.8, surfSpread)), R, vec3(1.0)));
        }
      }
    }
  }
  #endif
  diffuseColor.rgb *= mix(1.0, 0.86, surfMist) * mix(1.0, 0.8, surfLane) * (1.0 - 0.35 * surfHalo * (1.0 - w));
  diffuseColor.rgb *= mix(1.0, mix(0.72, 0.3, surfHit.rim), w) * (1.0 - surfLensOpen);
  if (shaded > 0.0) {
    vec3 tilt = dropView - normal;
    normal = surfSafeNormalize(normal - shaded * (0.6 + 1.2 * surfHit.r) * tilt, normal);
    #ifdef USE_CLEARCOAT
      clearcoatNormal = normalize(mix(clearcoatNormal, dropView, shaded));
    #else
      normal = normalize(mix(normal, dropView, shaded));
    #endif
    #ifdef USE_ENVMAP
      vec3 vV = -normalize(vViewPosition);
      float capRough = min(max(mix(0.26, 0.045, smoothstep(1.5 * pix, 9.0 * pix, surfHit.radius)), 0.85 * smoothstep(0.15, 0.8, surfSpread)), 1.0);
      float fw = ${waterF0} + ${(1 - waterF0).toFixed(2)} * pow(1.0 - clamp(dot(dropView, vV), 0.0, 1.0), 5.0);
      vec3 sharp = emitterGlint(surfWorldPos, surfToWorld(dropView), surfToWorld(vV), capRough, surfHit.radius);
      totalEmissiveRadiance += shaded * max(sharp - fw * getIBLRadiance(vV, dropView, capRough), vec3(0.0));
      // Where the cap turns away it mirrors a ray down into the coat just beside it, which sends it back up through its own mirror.
      vec3 nP = normalize(toView * n);
      vec3 rc = reflect(-vV, dropView);
      float rn = dot(rc, nP);
      surfCapBelow = shaded * smoothstep(0.0, 0.04, -rn);
      if (surfCapBelow > 0.0) {
        vec3 r2 = reflect(rc, nP);
        vec3 r2W = surfToWorld(r2);
        float fc = 0.04 + 0.96 * pow(1.0 - min(-rn, 1.0), 5.0);
        totalEmissiveRadiance += surfCapBelow * fw * fc * max(getIBLRadiance(r2, r2, capRough), emitterGlintF0(surfWorldPos, r2W, r2W, capRough, surfHit.radius, vec3(1.0)));
      }
    #endif
  }
  if (w > 0.0 && surfHit.radius > 0.0007) {
    vec3 caustic = vec3(0.0);
    for (int i = 0; i < MAX_FILM_LIGHTS; i++) {
      if (i >= filmLightCount) break;
      vec3 toLight;
      if (filmLightShape[i].x < 0.0) continue;
      vec3 e = filmLightAt(i, surfWorldPos, toLight);
      float facing = dot(nW, toLight);
      if (facing <= 0.0) continue;
      vec3 tl = toLight - nW * facing;
      vec3 rel = (vec4(toView * (-surfHit.offset), 0.0) * viewMatrix).xyz;
      vec3 focus = -tl * surfHit.radius * 0.45;
      float s = length(rel - focus) / (surfHit.radius * 0.32);
      caustic += e * facing * exp(-s * s) * 2.2;
    }
    for (int i = 0; i < EMITTER_MAX; i++) {
      if (i >= emitterCount) break;
      vec3 face = cross(emitterAxisU[i].xyz, emitterAxisV[i].xyz);
      vec3 toE = emitterCenter[i].xyz - surfWorldPos;
      float d2 = max(dot(toE, toE), 1e-6);
      vec3 toLight = toE * inversesqrt(d2);
      float front = -dot(toLight, face);
      float facing = dot(nW, toLight);
      if (front <= 0.0 || facing <= 0.0) continue;
      vec3 e = emitterRadiance[i].rgb * emitterCenter[i].w * min(4.0 * front / d2, 6.2831853);
      vec3 tl = toLight - nW * facing;
      vec3 rel = (vec4(toView * (-surfHit.offset), 0.0) * viewMatrix).xyz;
      vec3 focus = -tl * surfHit.radius * 0.45;
      float s = length(rel - focus) / (surfHit.radius * 0.32);
      caustic += e * facing * exp(-s * s) * 2.2;
    }
    totalEmissiveRadiance += caustic * w * (diffuseColor.rgb + 0.08);
  }
  if (surfGlint > 0.0) {
    vec3 glint = surfSkyGlint;
    glint += max(emitterBead(surfWorldPos, nW, vW, unit, eyeD, emitterPixelAngle) - signShare, vec3(0.0));
    totalEmissiveRadiance += glint * surfGlint * (1.0 - surfLane);
  }
  totalEmissiveRadiance += surfSplatSum * hidden * (1.0 - surfLane);
  if (surfLensW > 0.0) totalEmissiveRadiance += surfLensCol * surfLensW * (1.0 - surfLane);
  surfBeadOut = shaded;
  // A dome a few pixels across holds every normal inside one pixel: spread its highlight, as a prefiltered normal map would.
  surfBeadRough = mix(0.26, 0.045, smoothstep(1.5 * pix, 9.0 * pix, surfHit.radius));
  // A pixel on a small dome spans pix / R radians of normals; a GGX lobe of alpha 0.56 times that holds a point light's image at
  // the energy the dome sends, instead of a hot pixel tens of times too bright.
  float spanNormals = pix / max(surfHit.radius, 1e-6);
  surfBeadRough = max(surfBeadRough, sqrt(min(0.56 * spanNormals, 1.0)) * (1.0 - smoothstep(3.0 * pix, 6.0 * pix, surfHit.radius)));
  surfBeadRough = max(surfBeadRough, 0.85 * smoothstep(0.15, 0.8, surfSpread));
  surfDiagOut = vec4(vec3(1.0, 0.1, 0.9) * (0.15 + 0.85 * max(w, surfMist * 0.5)), 1.0);
}
`

// Three's own floor on roughness is applied before this chunk; a tighter lobe under a compact light blows up into fireflies.
const beadsSpecular = /* glsl */ `
surfBeadRough = min(max(surfBeadRough, 0.045), 1.0);
material.specularColor *= 1.0 - surfLensOpen;
#ifdef USE_CLEARCOAT
  material.clearcoat *= 1.0 - 0.35 * surfHalo * (1.0 - surfBeadOut);
  material.clearcoat = mix(material.clearcoat, 1.0, surfBeadOut) * (1.0 - surfCapBelow);
  material.clearcoatF0 = mix(material.clearcoatF0, vec3(${waterF0}), surfBeadOut);
  material.clearcoatRoughness = mix(material.clearcoatRoughness, surfBeadRough, surfBeadOut);
  // Unresolved drops cover part of the pixel: the coat between them stays sharp, and their own light comes back as glint.
  material.clearcoat *= 1.0 - 0.5 * surfMist * (1.0 - surfBeadOut);
  // A drop under a pixel covers its share of it, and over that share the coat's mirror is replaced by the drop's own spot.
  material.clearcoat *= 1.0 - surfOcc * (1.0 - surfBeadOut);
  material.clearcoatRoughness = mix(material.clearcoatRoughness, min(material.clearcoatRoughness, 0.03), surfLane);
  material.clearcoatRoughness = sqrt(sqrt(pow(material.clearcoatRoughness, 4.0) + 2.0 * surfCoatVar * (1.0 - surfBeadOut)));
#else
  material.roughness = sqrt(sqrt(pow(material.roughness, 4.0) + 2.0 * surfCoatVar * (1.0 - surfBeadOut)));
  material.roughness = mix(material.roughness, surfBeadRough, surfBeadOut);
#endif
`

const splatGlsl = /* glsl */ `
#define SURF_SRC_MAX EMITTER_MAX
vec3 surfSrcC[SURF_SRC_MAX];
vec3 surfSrcH[SURF_SRC_MAX];
vec3 surfSrcQ[SURF_SRC_MAX];
int surfSrcN = 0;
vec3 surfSplatSky = vec3(0.0);
vec3 surfSplatN = vec3(0.0);
vec3 surfSplatV = vec3(0.0, 0.0, 1.0);
float surfSplatPix = 1.0;
float surfSplatSigma = ${splatSigma.toFixed(2)};
vec3 surfSplatSum = vec3(0.0);

vec3 surfSplatProj(vec3 v) {
  return (v - surfSplatV * dot(v, surfSplatV)) / surfSplatPix;
}

// The share of this pixel a drop's projected area covers, spread with the same spot as its light.
float surfSplatCover(vec3 dW, float r, float projected) {
  vec3 c0 = surfSplatProj(dW);
  float inv = 1.0 / (surfSplatSigma * surfSplatSigma);
  return projected * r * r / (surfSplatPix * surfSplatPix) * inv * exp(-dot(c0, c0) * inv);
}

/**
 * Every light a bead here can show, from the emitter table of faces the picture draws: its radiance times solid angle times
 * Fresnel, and the half vector where its cap shows it. Film lights light the scene; the faces that emit them are in the table.
 */
void surfSplatSetup(vec3 P, vec3 N, vec3 V, float sigma, vec3 sky) {
  surfSplatV = V;
  surfSplatPix = max(length(cameraPosition - P) * emitterPixelAngle, 1e-6);
  surfSplatSigma = sigma;
  surfSplatSky = sky;
  surfSplatN = surfSplatProj(N);
  surfSrcN = 0;
  for (int i = 0; i < EMITTER_MAX; i++) {
    if (i >= emitterCount) break;
    vec3 D, H;
    vec3 c = emitterSource(i, P, N, V, D, H);
    if (max(c.r, max(c.g, c.b)) < 1e-6) continue;
    surfSrcC[surfSrcN] = c;
    surfSrcH[surfSrcN] = H;
    surfSrcQ[surfSrcN] = surfSplatProj(H);
    surfSrcN++;
  }
}

// A bead of base radius r and height h, its base center dW from this fragment in world space, shows each light as a mirror
// image of r^2 / 4 times its radiance and solid angle, at the point of its cap that faces the half vector. The spot is a unit
// Gaussian in pixels, so a pixel grid sums it to the same energy wherever it falls.
void surfSplat(vec3 dW, float r, float h, float capCos, vec3 nb, vec3 extra, float weight) {
  vec3 c0 = surfSplatProj(dW);
  float reach = 3.0 * surfSplatSigma + (r + h) / surfSplatPix;
  if (weight <= 0.0 || dot(c0, c0) > reach * reach) return;
  float inv = 1.0 / (surfSplatSigma * surfSplatSigma);
  float Rs = (r * r + h * h) / max(2.0 * h, 1e-7);
  vec3 base = c0 + surfSplatN * (h - Rs);
  vec3 sum = vec3(0.0);
  for (int s = 0; s < SURF_SRC_MAX; s++) {
    if (s >= surfSrcN) break;
    float m = smoothstep(capCos, capCos + 0.08, dot(surfSrcH[s], nb));
    if (m <= 0.0) continue;
    vec3 q = base + Rs * surfSrcQ[s];
    sum += surfSrcC[s] * (m * exp(-dot(q, q) * inv));
  }
  vec3 a = c0 + surfSplatN * h;
  sum += extra * exp(-dot(a, a) * inv);
  surfSplatSum += sum * (weight * r * r / (4.0 * surfSplatPix * surfSplatPix) * inv / 3.14159265);
}
`

export function applyBeads(material: THREE.Material, uniforms: Uniforms, bead: BeadClass): void {
  patchMaterial(material, {
    id: 'surface water beads',
    uniforms: { ...uniforms, surfBeadSalt: { value: bead.salt }, surfBeadContact: { value: bead.contactDegrees } },
    apply(shader) {
      shader.vertexShader = surfaceVaryingsGlsl(true) + `attribute vec2 ${dripAttribute};\nattribute float ${gapAttribute};\nvarying vec2 surfDripV;\nvarying float surfGapV;\n` + insertAfter(shader.vertexShader, '#include <project_vertex>', surfaceVertexGlsl(true) + `surfDripV = ${dripAttribute};\nsurfGapV = ${gapAttribute};\n`)
      let f = shader.fragmentShader
      f = surfaceVaryingsGlsl(true) + 'varying vec2 surfDripV;\nvarying float surfGapV;\n' + surfaceCommonGlsl + beadsGlsl + f
      f = insertBefore(f, '#include <map_fragment>', 'float surfBeadOut = 0.0;\nfloat surfBeadRough = 0.045;\nvec4 surfDiagOut = vec4(0.0);')
      f = insertAfter(f, '#include <clearcoat_normal_fragment_maps>', beadsFragment)
      f = insertAfter(f, '#include <lights_physical_fragment>', beadsSpecular)
      f = insertBefore(f, '#include <opaque_fragment>', 'if (surfDiag > 0.5) { outgoingLight = surfDiagOut.rgb; }')
      shader.fragmentShader = f
      withEmitters(shader)
      shader.fragmentShader = insertBefore(shader.fragmentShader, 'void main()', splatGlsl)
    },
  })
}
