import * as THREE from 'three'

export const maxEmitters = 24
/** Water at n 1.33. */
export const waterF0 = 0.02
/** A bead cap that meets the paint at about 70 degrees shows normals out to this cosine. */
export const beadCapCos = 0.35

export interface EmitterUniforms {
  [name: string]: THREE.IUniform
  emitterCount: { value: number }
  /** xyz centre, w visibility from the vehicle. */
  emitterCenter: { value: THREE.Vector4[] }
  /** Half-axis vectors. The face emits toward cross(u, v). u.w is 1 for a vehicle lamp, which never glints on the vehicle itself. */
  emitterAxisU: { value: THREE.Vector4[] }
  emitterAxisV: { value: THREE.Vector4[] }
  /** Linear HDR radiance, picture units, haze between the emitter and the vehicle applied. w: cosine of the face's optic cutoff, -2 for none; axis v.w holds the full-beam cosine. */
  emitterRadiance: { value: THREE.Vector4[] }
  /** Radians per pixel of the current sub-render. */
  emitterPixelAngle: { value: number }
  /** World to vehicle space, and the half size of the vehicle's box there. */
  emitterVehicleInverse: { value: THREE.Matrix4 }
  emitterVehicleHalf: { value: THREE.Vector3 }
}

const slots = (): THREE.Vector4[] => Array.from({ length: maxEmitters }, () => new THREE.Vector4())

/** One shared block. Spread it into any shader's uniforms; the stage writes it every frame. */
export const emitterUniforms: EmitterUniforms = {
  emitterCount: { value: 0 },
  emitterCenter: { value: slots() },
  emitterAxisU: { value: slots() },
  emitterAxisV: { value: slots() },
  emitterRadiance: { value: slots() },
  emitterPixelAngle: { value: 0.0007 },
  emitterVehicleInverse: { value: new THREE.Matrix4() },
  emitterVehicleHalf: { value: new THREE.Vector3() },
}

/** Declarations and helpers. World space, V points from P to the eye, N and V unit. Needs `cameraPosition`. */
export const emitterGlsl = /* glsl */ `
#ifndef EMITTER_GLSL
#define EMITTER_GLSL
#define EMITTER_MAX ${maxEmitters}
uniform int emitterCount;
uniform vec4 emitterCenter[EMITTER_MAX];
uniform vec4 emitterAxisU[EMITTER_MAX];
uniform vec4 emitterAxisV[EMITTER_MAX];
uniform vec4 emitterRadiance[EMITTER_MAX];
uniform float emitterPixelAngle;
uniform mat4 emitterVehicleInverse;
uniform vec3 emitterVehicleHalf;

float emitterOnVehicle(vec3 P) {
  vec3 q = abs((emitterVehicleInverse * vec4(P, 1.0)).xyz);
  return all(lessThanEqual(q, emitterVehicleHalf)) ? 1.0 : 0.0;
}

float emitterOptic(int i, vec3 n, vec3 D) {
  float cutoff = emitterRadiance[i].w;
  if (cutoff < -1.5) return 1.0;
  return smoothstep(cutoff, max(cutoff + 1e-5, emitterAxisV[i].w), -dot(D, n) / max(length(n), 1e-12));
}

float emitterBox(float x, float h, float s) {
  return clamp((min(x + s, h) - max(x - s, -h)) / (2.0 * s), 0.0, 1.0);
}

vec3 emitterFresnel(vec3 f0, float c) {
  float m = 1.0 - clamp(c, 0.0, 1.0);
  float m2 = m * m;
  return f0 + (1.0 - f0) * (m2 * m2 * m);
}

vec3 emitterGlintF0(vec3 P, vec3 N, vec3 V, float roughness, float curvatureRadius, vec3 f0) {
  vec3 R = reflect(-V, N);
  float a = roughness * roughness;
  float footprint = length(cameraPosition - P) * emitterPixelAngle;
  float spread = curvatureRadius > 0.0 ? footprint / curvatureRadius : 0.0;
  float s = max(sqrt(4.0 * a * a + spread * spread), 1e-5);
  float own = emitterOnVehicle(P);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < EMITTER_MAX; i++) {
    if (i >= emitterCount) break;
    if (own * emitterAxisU[i].w > 0.5) continue;
    vec3 u = emitterAxisU[i].xyz;
    vec3 v = emitterAxisV[i].xyz;
    vec3 n = cross(u, v);
    vec3 toE = emitterCenter[i].xyz - P;
    float dist = max(length(toE), 1e-4);
    vec3 D = toE / dist;
    float cr = dot(R, D);
    if (dot(D, n) >= 0.0 || dot(D, N) <= 0.0 || cr <= 1e-3) continue;
    vec3 up = u - D * dot(u, D);
    vec3 vp = v - D * dot(v, D);
    float lu = length(up);
    vec3 eu = lu > 1e-6 ? up / lu : vec3(0.0);
    vec3 vq = vp - eu * dot(vp, eu);
    float lv = length(vq);
    vec3 ev = lv > 1e-6 ? vq / lv : vec3(0.0);
    float cover = emitterBox(dot(R, eu) / cr, lu / dist, s) * emitterBox(dot(R, ev) / cr, lv / dist, s);
    sum += emitterRadiance[i].rgb * (cover * emitterCenter[i].w * emitterOptic(i, n, D) * smoothstep(0.0, 0.05, dot(D, N)));
  }
  return sum * emitterFresnel(f0, dot(N, V));
}

vec3 emitterGlint(vec3 P, vec3 N, vec3 V, float roughness, float curvatureRadius) {
  return emitterGlintF0(P, N, V, roughness, curvatureRadius, vec3(${waterF0}));
}

vec3 emitterBeadF0(vec3 P, vec3 N, vec3 V, float radius, float distance, float pixelAngle, vec3 f0, float capCos) {
  float pixel = max(distance * pixelAngle, 1e-6);
  float scale = radius * radius / (4.0 * pixel * pixel);
  float own = emitterOnVehicle(P);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < EMITTER_MAX; i++) {
    if (i >= emitterCount) break;
    if (own * emitterAxisU[i].w > 0.5) continue;
    vec3 u = emitterAxisU[i].xyz;
    vec3 v = emitterAxisV[i].xyz;
    vec3 n = cross(u, v);
    float area = length(n);
    vec3 toE = emitterCenter[i].xyz - P;
    float dist2 = max(dot(toE, toE), 1e-8);
    vec3 D = toE * inversesqrt(dist2);
    float facing = -dot(D, n) / max(area, 1e-12);
    if (facing <= 0.0 || dot(D, N) <= 0.0) continue;
    vec3 H = D + V;
    float lh = length(H);
    if (lh < 1e-4) continue;
    H /= lh;
    float omega = min(4.0 * area * facing / dist2, 6.2831853);
    float shown = min(scale * omega, 1.0) * smoothstep(capCos, capCos + 0.1, dot(H, N));
    sum += emitterRadiance[i].rgb * emitterFresnel(f0, dot(H, V)) * (shown * emitterCenter[i].w * emitterOptic(i, n, D) * smoothstep(0.0, 0.05, dot(D, N)));
  }
  return sum;
}

// One source as a bead sees it, for callers that place each source's image on the cap themselves: radiance times solid angle
// times water Fresnel, with visibility, optic and the horizon of the paint normal N; no cap and no pixel scale.
// D points to the source, H is the bead normal that shows it.
vec3 emitterSource(int i, vec3 P, vec3 N, vec3 V, out vec3 D, out vec3 H) {
  D = vec3(0.0, 0.0, 1.0);
  H = N;
  if (i >= emitterCount || emitterOnVehicle(P) * emitterAxisU[i].w > 0.5) return vec3(0.0);
  vec3 n = cross(emitterAxisU[i].xyz, emitterAxisV[i].xyz);
  float area = length(n);
  vec3 toE = emitterCenter[i].xyz - P;
  float dist2 = max(dot(toE, toE), 1e-8);
  D = toE * inversesqrt(dist2);
  float facing = -dot(D, n) / max(area, 1e-12);
  vec3 h = D + V;
  float lh = length(h);
  if (facing <= 0.0 || dot(D, N) <= 0.0 || lh < 1e-4) return vec3(0.0);
  H = h / lh;
  float omega = min(4.0 * area * facing / dist2, 6.2831853);
  return emitterRadiance[i].rgb * emitterFresnel(vec3(${waterF0}), dot(H, V)) * (omega * emitterCenter[i].w * emitterOptic(i, n, D) * smoothstep(0.0, 0.05, dot(D, N)));
}

vec3 emitterBead(vec3 P, vec3 N, vec3 V, float radius, float distance, float pixelAngle) {
  return emitterBeadF0(P, N, V, radius, distance, pixelAngle, vec3(${waterF0}), ${beadCapCos});
}
#endif
`

/** Adds the uniforms and helpers to a shader inside `onBeforeCompile`. */
export function withEmitters(shader: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string }): void {
  Object.assign(shader.uniforms, emitterUniforms)
  if (shader.fragmentShader.includes('#define EMITTER_GLSL')) return
  const at = shader.fragmentShader.indexOf('void main()')
  if (at < 0) throw new Error('emitters: no main() in fragment shader')
  shader.fragmentShader = shader.fragmentShader.slice(0, at) + emitterGlsl + '\n' + shader.fragmentShader.slice(at)
}

export interface GlintEmitter {
  center: THREE.Vector3
  u: THREE.Vector3
  v: THREE.Vector3
  radiance: THREE.Color
  visibility: number
  /** A vehicle lamp: skipped for points on the vehicle. */
  lamp?: boolean
  /** The face is the exit of a spot light's optic: cosines of the cutoff and the full beam, around the face normal. */
  cone?: [number, number]
}

const box = (x: number, h: number, s: number): number => Math.min(1, Math.max(0, (Math.min(x + s, h) - Math.max(x - s, -h)) / (2 * s)))
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/** How much of the face's own beam reaches `at`: 1 inside the full beam, 0 past the cutoff, 1 when it has no optic. */
export function opticFactor(e: GlintEmitter, at: THREE.Vector3): number {
  if (!e.cone) return 1
  const n = e.u.clone().cross(e.v).normalize()
  return smooth(e.cone[0], Math.max(e.cone[0] + 1e-5, e.cone[1]), at.clone().sub(e.center).normalize().dot(n))
}

const fresnel = (f0: number, c: number): number => f0 + (1 - f0) * (1 - Math.min(1, Math.max(0, c))) ** 5

/** The same math as `emitterGlintF0`, for tests and tools. */
export function glintReference(emitters: readonly GlintEmitter[], P: THREE.Vector3, N: THREE.Vector3, V: THREE.Vector3, roughness: number, curvatureRadius: number, eye: THREE.Vector3, pixelAngle: number, f0 = waterF0, onVehicle = false): THREE.Color {
  const R = V.clone().negate().reflect(N)
  const a = roughness * roughness
  const spread = curvatureRadius > 0 ? eye.distanceTo(P) * pixelAngle / curvatureRadius : 0
  const s = Math.max(Math.sqrt(4 * a * a + spread * spread), 1e-5)
  const sum = new THREE.Color(0, 0, 0)
  for (const e of emitters.slice(0, maxEmitters)) {
    if (onVehicle && e.lamp) continue
    const n = e.u.clone().cross(e.v)
    const toE = e.center.clone().sub(P)
    const dist = Math.max(toE.length(), 1e-4)
    const D = toE.divideScalar(dist)
    const cr = R.dot(D)
    if (D.dot(n) >= 0 || D.dot(N) <= 0 || cr <= 1e-3) continue
    const up = e.u.clone().addScaledVector(D, -e.u.dot(D))
    const vp = e.v.clone().addScaledVector(D, -e.v.dot(D))
    const lu = up.length()
    const eu = lu > 1e-6 ? up.divideScalar(lu) : new THREE.Vector3()
    const vq = vp.clone().addScaledVector(eu, -vp.dot(eu))
    const lv = vq.length()
    const ev = lv > 1e-6 ? vq.divideScalar(lv) : new THREE.Vector3()
    const cover = box(R.dot(eu) / cr, lu / dist, s) * box(R.dot(ev) / cr, lv / dist, s)
    sum.add(e.radiance.clone().multiplyScalar(cover * e.visibility * opticFactor(e, P) * smooth(0, 0.05, D.dot(N))))
  }
  return sum.multiplyScalar(fresnel(f0, N.dot(V)))
}

/** The same math as `emitterBeadF0`. */
export function beadReference(emitters: readonly GlintEmitter[], P: THREE.Vector3, N: THREE.Vector3, V: THREE.Vector3, radius: number, distance: number, pixelAngle: number, f0 = waterF0, capCos = beadCapCos, onVehicle = false): THREE.Color {
  const pixel = Math.max(distance * pixelAngle, 1e-6)
  const scale = radius * radius / (4 * pixel * pixel)
  const sum = new THREE.Color(0, 0, 0)
  for (const e of emitters.slice(0, maxEmitters)) {
    if (onVehicle && e.lamp) continue
    const n = e.u.clone().cross(e.v)
    const area = n.length()
    const toE = e.center.clone().sub(P)
    const dist2 = Math.max(toE.lengthSq(), 1e-8)
    const D = toE.divideScalar(Math.sqrt(dist2))
    const facing = -D.dot(n) / Math.max(area, 1e-12)
    if (facing <= 0 || D.dot(N) <= 0) continue
    const H = D.clone().add(V)
    const lh = H.length()
    if (lh < 1e-4) continue
    H.divideScalar(lh)
    const omega = Math.min(4 * area * facing / dist2, 2 * Math.PI)
    const shown = Math.min(scale * omega, 1) * smooth(capCos, capCos + 0.1, H.dot(N))
    sum.add(e.radiance.clone().multiplyScalar(fresnel(f0, H.dot(V)) * shown * e.visibility * opticFactor(e, P) * smooth(0, 0.05, D.dot(N))))
  }
  return sum
}

/** The same math as `emitterSource`, for one emitter. */
export function sourceReference(e: GlintEmitter, P: THREE.Vector3, N: THREE.Vector3, V: THREE.Vector3, onVehicle = false): { energy: THREE.Color; D: THREE.Vector3; H: THREE.Vector3 } {
  const none = { energy: new THREE.Color(0, 0, 0), D: new THREE.Vector3(0, 0, 1), H: N.clone() }
  if (onVehicle && e.lamp) return none
  const n = e.u.clone().cross(e.v)
  const area = n.length()
  const toE = e.center.clone().sub(P)
  const dist2 = Math.max(toE.lengthSq(), 1e-8)
  const D = toE.divideScalar(Math.sqrt(dist2))
  const facing = -D.dot(n) / Math.max(area, 1e-12)
  const h = D.clone().add(V)
  if (facing <= 0 || D.dot(N) <= 0 || h.length() < 1e-4) return { ...none, D }
  const H = h.normalize()
  const omega = Math.min(4 * area * facing / dist2, 2 * Math.PI)
  return { energy: e.radiance.clone().multiplyScalar(fresnel(waterF0, H.dot(V)) * omega * e.visibility * opticFactor(e, P) * smooth(0, 0.05, D.dot(N))), D, H }
}
