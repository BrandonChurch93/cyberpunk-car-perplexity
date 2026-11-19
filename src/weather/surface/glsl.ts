export const surfaceCommonGlsl = /* glsl */ `
#ifndef SURFACE_COMMON
#define SURFACE_COMMON
uvec3 surfPcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 surfHash3(ivec3 c, uint salt) {
  uvec3 h = surfPcg3(uvec3(c) ^ uvec3(salt, salt * 747796405u, salt * 2891336453u));
  return vec3(h) * (1.0 / 4294967296.0);
}
vec3 surfHash2(ivec2 c, uint salt) {
  return surfHash3(ivec3(c, int(salt & 1023u)), salt);
}
float surfNoise2(vec2 p, uint salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = surfHash2(c, salt).x;
  float b = surfHash2(c + ivec2(1, 0), salt).x;
  float d = surfHash2(c + ivec2(0, 1), salt).x;
  float e = surfHash2(c + ivec2(1, 1), salt).x;
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}
/** Value noise that repeats every period cells along y. */
float surfNoise2Periodic(vec2 p, int period, uint salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  ivec2 c0 = ivec2(c.x, ((c.y % period) + period) % period);
  ivec2 c1 = ivec2(c.x, (((c.y + 1) % period) + period) % period);
  float a = surfHash2(c0, salt).x;
  float b = surfHash2(c0 + ivec2(1, 0), salt).x;
  float d = surfHash2(c1, salt).x;
  float e = surfHash2(c1 + ivec2(1, 0), salt).x;
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}
vec3 surfToView(vec3 worldDir) {
  return normalize((viewMatrix * vec4(worldDir, 0.0)).xyz);
}
vec3 surfToWorld(vec3 viewDir) {
  return normalize((vec4(viewDir, 0.0) * viewMatrix).xyz);
}
float surfLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
#endif
`

/** Varyings for world position and, with `object`, the object frame a drop field is fixed to. */
export function surfaceVaryingsGlsl(object: boolean): string {
  return object
    ? 'varying vec3 surfWorldPos;\nvarying vec3 surfObjPos;\nvarying vec3 surfObjNormal;\nvarying vec3 surfObjGravity;\nvarying vec3 surfObjToView0;\nvarying vec3 surfObjToView1;\nvarying vec3 surfObjToView2;\n'
    : 'varying vec3 surfWorldPos;\n'
}

export function surfaceVertexGlsl(object: boolean): string {
  const common = /* glsl */ `
  vec4 surfP = vec4(transformed, 1.0);
  mat3 surfBasis = mat3(modelMatrix);
  #ifdef USE_INSTANCING
    surfP = instanceMatrix * surfP;
    surfBasis = surfBasis * mat3(instanceMatrix);
  #endif
  surfWorldPos = (modelMatrix * surfP).xyz;
`
  const extra = /* glsl */ `
  float surfScale = length(surfBasis[0]);
  surfObjPos = transformed * surfScale;
  surfObjNormal = normalize(objectNormal);
  surfObjGravity = normalize(transpose(surfBasis) * vec3(0.0, -1.0, 0.0));
  mat3 surfView = mat3(viewMatrix) * surfBasis;
  surfObjToView0 = normalize(surfView[0]);
  surfObjToView1 = normalize(surfView[1]);
  surfObjToView2 = normalize(surfView[2]);
`
  return '{\n' + common + (object ? extra : '') + '}\n'
}
