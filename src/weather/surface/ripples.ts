import * as THREE from 'three'
import { impactCellMeters, impactForCell, impactPeriodSeconds, impactsPerCellPeriod } from './impact-source'

/** Seconds a ring packet stays visible on standing water. Board 05: fade over 0.4 to 0.8 s, diameter capped at 100 to 180 mm. */
export const ringLifeSeconds = 0.55
/** Radial speed of the packet front in m/s. Board 05: 0.22 to 0.35, bounded by the 0.23 m/s capillary-gravity minimum. */
export const ringSpeed = 0.2
export const binMeters = 0.25
export const gridBins = 128
export const slotsPerBin = 24
/** Added to the stored diameter in mm to mark a drip impact, which brings its own water to wherever it lands. */
const ownWaterMark = 100

export interface ExtraImpact {
  x: number
  z: number
  timeSeconds: number
  diameter: number
}

/**
 * Rain impacts near the camera, binned on a grid in world X and Z once per frame and uploaded as a float texture,
 * so the deck shader only reads the few impacts whose rings can reach a fragment.
 */
export class RippleField {
  readonly data = new Float32Array(gridBins * slotsPerBin * gridBins * 4)
  readonly counts = new Uint8Array(gridBins * gridBins)
  readonly texture: THREE.DataTexture
  readonly origin = new THREE.Vector4(0, 0, binMeters, gridBins)
  overflow = 0

  constructor() {
    this.texture = new THREE.DataTexture(this.data, gridBins * slotsPerBin, gridBins, THREE.RGBAFormat, THREE.FloatType)
    this.texture.minFilter = THREE.NearestFilter
    this.texture.magFilter = THREE.NearestFilter
    this.texture.generateMipmaps = false
    this.texture.colorSpace = THREE.NoColorSpace
    this.texture.needsUpdate = true
  }

  /** Collects every impact whose ring is alive at some time in [t0, t1], centered on `center`. Times are stored against `t0`. */
  update(t0: number, t1: number, center: THREE.Vector2, extra: ExtraImpact[] = []): void {
    this.data.fill(0)
    this.counts.fill(0)
    this.overflow = 0
    const span = gridBins * binMeters
    const ox = Math.floor((center.x - span / 2) / binMeters) * binMeters
    const oz = Math.floor((center.y - span / 2) / binMeters) * binMeters
    this.origin.set(ox, oz, binMeters, gridBins)
    const earliest = t0 - ringLifeSeconds
    const add = (x: number, z: number, t: number, diameter: number, own = false): void => {
      if (t < earliest || t > t1) return
      const bx = Math.floor((x - ox) / binMeters)
      const bz = Math.floor((z - oz) / binMeters)
      if (bx < 0 || bz < 0 || bx >= gridBins || bz >= gridBins) return
      const bin = bz * gridBins + bx
      const k = this.counts[bin]
      if (k >= slotsPerBin) {
        this.overflow++
        return
      }
      this.counts[bin] = k + 1
      const at = ((bz * gridBins + bx) * slotsPerBin + k) * 4
      this.data[at] = x - ox
      this.data[at + 1] = z - oz
      this.data[at + 2] = t - t0
      this.data[at + 3] = diameter * 1000 + (own ? ownWaterMark : 0)
    }
    const c0x = Math.floor(ox / impactCellMeters)
    const c0z = Math.floor(oz / impactCellMeters)
    const c1x = Math.floor((ox + span) / impactCellMeters)
    const c1z = Math.floor((oz + span) / impactCellMeters)
    const tc0 = Math.floor(earliest / impactPeriodSeconds) - 1
    const tc1 = Math.floor(t1 / impactPeriodSeconds) + 1
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        for (let tc = tc0; tc <= tc1; tc++) {
          for (let slot = 0; slot < impactsPerCellPeriod; slot++) {
            const hit = impactForCell(cx, cz, tc, slot)
            add(hit.x, hit.z, hit.timeSeconds, hit.diameter)
          }
        }
      }
    }
    for (const e of extra) add(e.x, e.z, e.timeSeconds, e.diameter, true)
    this.texture.needsUpdate = true
  }
}

export const ripplesGlsl = /* glsl */ `
uniform sampler2D surfImpacts;
uniform vec4 surfImpactGrid;
uniform float surfImpactTime;
uniform vec4 surfPulse[2];
uniform float surfPulseTime;
#define SURF_SLOTS ${slotsPerBin}
#define SURF_RING_LIFE ${ringLifeSeconds.toFixed(4)}
#define SURF_RING_SPEED ${ringSpeed.toFixed(4)}
#define SURF_OWN_WATER ${ownWaterMark.toFixed(1)}

/** Slope variance of ring detail finer than the pixel footprint, for the caller to fold into roughness. */
float surfRingVar;

/**
 * Slope of one ring packet at distance r from its center. deep: 1 on standing water, 0 on a thin film. Wave detail finer than
 * foot meters is filtered out of the slope and its energy goes to surfRingVar, so distant rings still break the reflection.
 */
float surfRing(float r, float age, float diameterMm, float deep, float foot, float radialFoot) {
  float life = mix(0.8, 1.0, deep) * SURF_RING_LIFE;
  if (age <= 0.0 || age > life) return 0.0;
  float lambda = mix(0.018, min(0.018 + 0.0018 * diameterMm, 0.027), deep);
  float width = mix(1.3, 4.0, deep * smoothstep(1.0, 4.0, diameterMm)) * lambda;
  float front = 0.002 + 0.0006 * diameterMm + SURF_RING_SPEED * age;
  float s = front - r;
  // A thin film damps the trailing crests before they form, so it carries one sharp leading crest; standing water keeps the train.
  float train = smoothstep(0.3, 0.8, deep);
  float cw = 0.3 * lambda;
  if (s < -mix(3.0 * cw, 0.6 * lambda, train) || s > max(width, 3.0 * cw)) return 0.0;
  float envelope = smoothstep(-0.6 * lambda, 0.25 * lambda, s) * (1.0 - smoothstep(0.35 * width, width, s));
  float wave = lambda * (1.0 - 0.3 * clamp(s / width, 0.0, 1.0));
  // Bottom friction damps a wave on a film of depth h in about h * h / viscosity: a quarter second at the deck's 0.5 to 1 mm.
  float tau = 0.2;
  float spread = exp(-age / tau) * sqrt(0.02 / (front + 0.02)) * smoothstep(life, life * 0.6, age);
  float ampTrain = 0.16 * (diameterMm / 2.0) * spread;
  float ampCrest = 0.2 * sqrt(diameterMm / 1.5) * spread;
  // A crest left with a third of its slope still aliases into sparkle through a sharp reflection, so the cut sits a little early.
  float filtTrain = exp(-4.5 * (radialFoot / wave) * (radialFoot / wave));
  float filtCrest = exp(-4.5 * (radialFoot / (4.4 * cw)) * (radialFoot / (4.4 * cw)));
  float x = s / cw;
  float crest = ampCrest * x * exp(0.5 * (1.0 - x * x));
  float osc = ampTrain * envelope;
  float slope = mix(crest * filtCrest, osc * filtTrain * cos(6.2831853 * s / wave), train);
  surfRingVar += mix(crest * crest * (1.0 - filtCrest * filtCrest), 0.5 * osc * osc * (1.0 - filtTrain * filtTrain), train);
  float rb = 0.0012 * diameterMm + 0.0015;
  float young = 1.0 - smoothstep(0.0, 0.07, age);
  float bump = young * 0.9 * (r / rb) * exp(-(r * r) / (rb * rb));
  float bumpFilt = exp(-2.0 * (foot / rb) * (foot / rb));
  slope += bump * bumpFilt * (age < 0.025 ? -1.0 : 1.0);
  surfRingVar += bump * bump * (1.0 - bumpFilt * bumpFilt);
  return slope;
}

/** Ripple slope (d height / dx, d height / dz) on the deck from the binned rain impacts and the exhaust pulses. */
vec2 surfRipples(vec2 p, float deep, float film, float sampleOffset, float foot) {
  surfRingVar = 0.0;
  // A crest runs across d / r, so only the footprint along the radius blurs it; on a grazing deck that is far shorter than the full footprint.
  vec2 px = dFdx(p);
  vec2 py = dFdy(p);
  vec2 slope = vec2(0.0);
  vec2 own = vec2(0.0);
  float weight = max(deep, film);
  vec2 local = p - surfImpactGrid.xy;
  vec2 g = local / surfImpactGrid.z;
  int n = int(surfImpactGrid.w);
  ivec2 b0 = ivec2(floor(g - 0.5));
  float t = surfImpactTime + sampleOffset;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 b = b0 + ivec2(i, j);
      if (b.x < 0 || b.y < 0 || b.x >= n || b.y >= n) continue;
      for (int k = 0; k < SURF_SLOTS; k++) {
        vec4 e = texelFetch(surfImpacts, ivec2(b.x * SURF_SLOTS + k, b.y), 0);
        if (e.w <= 0.0) break;
        vec2 d = local - e.xy;
        float r = length(d);
        if (r > 0.16) continue;
        vec2 u = d / max(r, 1e-5);
        float radial = min(abs(dot(px, u)) + abs(dot(py, u)), foot);
        if (e.w > SURF_OWN_WATER) {
          own += surfRing(r, t - e.z, e.w - SURF_OWN_WATER, max(deep, 0.6), foot, radial) * u;
        } else {
          slope += surfRing(r, t - e.z, e.w, deep, foot, radial) * u;
        }
      }
    }
  }
  slope = slope * weight + own * max(weight, 0.8) * 6.0;
  surfRingVar *= weight * weight;
  for (int i = 0; i < 2; i++) {
    vec4 pulse = surfPulse[i];
    if (pulse.z <= 0.0) continue;
    vec2 d = p - pulse.xy;
    float r = length(d);
    float reach = 1.0 - smoothstep(0.4, 2.6, r);
    if (reach <= 0.0) continue;
    float tt = surfPulseTime + sampleOffset;
    float surge = 0.6 + 0.4 * sin(6.2831853 * 3.0 * tt);
    float phase = 6.2831853 * (r / 0.011 - 30.0 * tt);
    slope += deep * pulse.z * surge * reach * 0.05 * cos(phase) * d / max(r, 1e-4);
  }
  return slope;
}
`
