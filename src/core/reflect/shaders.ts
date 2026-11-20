import * as THREE from 'three'
import { insertAfter, insertBefore, replaceOnce, type MaterialPatch } from '../../materials/patch'

export interface BoxUniforms {
  reflectBoxMin: { value: THREE.Vector3 }
  reflectBoxMax: { value: THREE.Vector3 }
  reflectProbe: { value: THREE.Vector3 }
  reflectBoxOn: { value: number }
}

export interface PlanarUniforms {
  reflectMap: { value: THREE.Texture | null }
  reflectDepth: { value: THREE.Texture | null }
  reflectViewProjection: { value: THREE.Matrix4 }
  reflectInverseViewProjection: { value: THREE.Matrix4 }
  reflectSize: { value: THREE.Vector2 }
  reflectLodMax: { value: number }
  reflectSeed: { value: number }
  reflectOn: { value: number }
  reflectBillboard: { value: THREE.Vector4 }
}

const worldVarying = 'varying vec3 vReflectWorld;'

const worldVertex = /* glsl */ `
vec4 reflectWorld = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  reflectWorld = batchingMatrix * reflectWorld;
#endif
#ifdef USE_INSTANCING
  reflectWorld = instanceMatrix * reflectWorld;
#endif
vReflectWorld = ( modelMatrix * reflectWorld ).xyz;
`

const boxPars = /* glsl */ `
${worldVarying}
uniform vec3 reflectBoxMin;
uniform vec3 reflectBoxMax;
uniform vec3 reflectProbe;
uniform float reflectBoxOn;

vec3 reflectBoxProject( vec3 dir ) {
  vec3 p = vReflectWorld;
  if ( reflectBoxOn < 0.5 || any( lessThan( p, reflectBoxMin ) ) || any( greaterThan( p, reflectBoxMax ) ) ) return dir;
  vec3 safe = mix( vec3( 1e-6 ), dir, step( vec3( 1e-6 ), abs( dir ) ) );
  vec3 t = max( ( reflectBoxMax - p ) / safe, ( reflectBoxMin - p ) / safe );
  float hit = min( min( t.x, t.y ), t.z );
  return normalize( p + dir * hit - reflectProbe );
}
`

/** Parallax correction of the environment lookup to the reflection box. Applies to every standard and physical material. */
export function boxPatch(uniforms: BoxUniforms): MaterialPatch {
  return {
    id: 'reflect-box',
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    apply(shader) {
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', worldVarying)
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <project_vertex>', worldVertex)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', boxPars)
      const chunk = replaceOnce(
        THREE.ShaderChunk.envmap_physical_pars_fragment,
        'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );',
        'reflectVec = reflectBoxProject( transformDirectionByInverseViewMatrix( reflectVec, viewMatrix ) );',
      )
      shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <envmap_physical_pars_fragment>', chunk)
    },
  }
}

const planarPars = /* glsl */ `
uniform sampler2D reflectMap;
uniform sampler2D reflectDepth;
uniform mat4 reflectViewProjection;
uniform mat4 reflectInverseViewProjection;
uniform vec2 reflectSize;
uniform float reflectLodMax;
uniform float reflectSeed;
uniform float reflectOn;
uniform vec4 reflectBillboard;

vec2 reflectUv( vec3 x ) {
  vec4 c = reflectViewProjection * vec4( x, 1.0 );
  return c.w > 1e-5 ? c.xy / c.w * 0.5 + 0.5 : vec2( -1.0 );
}

float reflectHash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 + reflectSeed );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}

vec3 reflectEnvironment( vec3 dir, float roughness ) {
  #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
    return textureLod( envMap, envMapRotation * reflectBoxProject( dir ), roughnessToMip( roughness ) ).rgb * envMapIntensity;
  #else
    return vec3( 0.0 );
  #endif
}

vec3 planarRay( vec3 v, vec3 normal ) {
  vec3 r = reflect( - v, normal );
  r.y = abs( r.y );
  return r;
}

float planarLuma( vec3 c ) {
  return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
}

// GGX lobe sampled per sub-render with the distance to the reflected object read from the mirror depth.
// The lobe's footprint on screen comes out long and vertical at grazing view, and grows with that distance.
vec3 planarRadiance( vec3 normalView, float roughness, vec3 fallback ) {
  if ( reflectOn < 0.5 ) return fallback;
  vec3 p = vReflectWorld;
  vec3 n = normalize( transformDirectionByInverseViewMatrix( normalView, viewMatrix ) );
  #ifdef REFLECT_DECK_DETAIL
    if ( abs( p.y ) > 0.02 || n.y < 0.7 ) return fallback;
  #endif
  vec3 v = normalize( cameraPosition - p );
  vec2 uv0 = reflectUv( p );
  float depth = texture( reflectDepth, uv0 ).r;
  vec4 hitClip = reflectInverseViewProjection * vec4( vec3( uv0, depth ) * 2.0 - 1.0, 1.0 );
  float dist = depth >= 1.0 ? REFLECT_FAR : clamp( distance( hitClip.xyz / hitClip.w, p ), 0.02, REFLECT_FAR );
  float a = roughness * roughness;
  vec3 t = cross( n, v );
  t = dot( t, t ) > 1e-8 ? normalize( t ) : normalize( cross( n, vec3( 0.0, 0.0, 1.0 ) ) );
  vec3 b = cross( t, n );
  vec2 uvCenter = reflectUv( p + planarRay( v, n ) * dist );
  vec2 uvSide = reflectUv( p + planarRay( v, normalize( n + a * t ) ) * dist );
  float minor = length( ( uvSide - uvCenter ) * reflectSize );
  float lod = clamp( log2( max( minor * REFLECT_FILTER, 1.0 ) ), 0.0, reflectLodMax );
  vec2 centerEdge = min( uvCenter, 1.0 - uvCenter );
  float fireflyBlend = smoothstep( REFLECT_FIREFLY_START, REFLECT_FIREFLY_END, roughness )
    * smoothstep( 0.0, 0.02, min( centerEdge.x, centerEdge.y ) );
  float tapLimit = 0.0;
  if ( fireflyBlend > 0.0 ) {
    vec2 uvLong = reflectUv( p + planarRay( v, normalize( n + a * b ) ) * dist );
    float major = length( ( uvLong - uvCenter ) * reflectSize );
    float refLod = clamp( log2( max( max( minor, major ) * REFLECT_FILTER, 1.0 ) ), 0.0, reflectLodMax );
    vec3 center = textureLod( reflectMap, uvCenter, refLod ).rgb;
    tapLimit = REFLECT_FIREFLY_FLOOR + REFLECT_FIREFLY_RATIO * planarLuma( center );
  }
  vec2 jitter = vec2( reflectHash( gl_FragCoord.xy ), reflectHash( gl_FragCoord.yx + 71.0 ) );
  vec3 sum = vec3( 0.0 );
  float count = 0.0;
  for ( int k = 0; k < REFLECT_TAPS; k ++ ) {
    vec2 u = fract( jitter + float( k ) * vec2( 0.7548776662, 0.5698402910 ) );
    float phi = 6.28318530718 * u.x;
    float cos2 = ( 1.0 - u.y ) / ( 1.0 + ( a * a - 1.0 ) * u.y );
    float sinT = sqrt( max( 0.0, 1.0 - cos2 ) );
    vec3 h = normalize( t * ( cos( phi ) * sinT ) + b * ( sin( phi ) * sinT ) + n * sqrt( cos2 ) );
    vec3 r = reflect( - v, h );
    if ( dot( r, n ) <= 0.0 ) continue;
    r.y = abs( r.y );
    vec2 uv = reflectUv( p + r * dist );
    float spread = length( ( uv - uvCenter ) * reflectSize ) * REFLECT_TAIL;
    vec2 edge = min( uv, 1.0 - uv );
    float inside = smoothstep( 0.0, 0.02, min( edge.x, edge.y ) );
    vec3 env = inside < 1.0 ? reflectEnvironment( r, roughness * 0.5 ) : vec3( 0.0 );
    vec3 mirror = inside > 0.0 ? textureLod( reflectMap, clamp( uv, 0.0, 1.0 ), clamp( max( lod, log2( max( spread, 1.0 ) ) ), 0.0, reflectLodMax ) ).rgb : vec3( 0.0 );
    if ( fireflyBlend > 0.0 ) mirror *= mix( 1.0, min( 1.0, tapLimit / max( 1e-5, planarLuma( mirror ) ) ), fireflyBlend );
    sum += mix( env, mirror, inside );
    count += 1.0;
  }
  vec3 planar = count > 0.0 ? sum / count : fallback;
  return mix( fallback, planar, 1.0 - smoothstep( REFLECT_ROUGH_START, REFLECT_ROUGH_END, roughness ) );
}
`

const planarApply = /* glsl */ `
radiance = planarRadiance( geometryNormal, material.roughness, radiance );
#ifdef USE_CLEARCOAT
  clearcoatRadiance = planarRadiance( geometryClearcoatNormal, material.clearcoatRoughness, clearcoatRadiance );
#endif
`

const spotStart = '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )'
const spotDirect = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );'

function deckDirectChunk(): string {
  // The resolved billboard image supplies specular on the mirrored deck, not the analytic light sample.
  const lighting = THREE.ShaderChunk.lights_fragment_begin
  const start = lighting.indexOf(spotStart)
  if (start < 0) throw new Error('deck area shading requires a spot light block')
  return lighting.slice(0, start) + replaceOnce(lighting.slice(start), spotDirect, /* glsl */ `
    {
      vec3 beforeSpecular = reflectedLight.directSpecular;
      #ifdef USE_CLEARCOAT
        vec3 beforeCoat = clearcoatSpecularDirect;
      #endif
      ${spotDirect}
      vec3 billboardView = ( viewMatrix * vec4( reflectBillboard.xyz, 1.0 ) ).xyz;
      if ( reflectOn > 0.5 && reflectBillboard.w > 0.5 && distance( spotLight.position, billboardView ) < 0.002 ) {
        vec3 worldNormal = transformDirectionByInverseViewMatrix( geometryNormal, viewMatrix );
        vec2 uv = reflectUv( vReflectWorld );
        vec2 edge = min( uv, 1.0 - uv );
        float covered = smoothstep( 0.0, 0.02, min( edge.x, edge.y ) ) * smoothstep( 0.6, 0.8, worldNormal.y );
        float areaSpecular = 1.0 - covered * ( 1.0 - smoothstep( 0.12, 0.35, material.roughness ) );
        reflectedLight.directSpecular = mix( beforeSpecular, reflectedLight.directSpecular, areaSpecular );
        #ifdef USE_CLEARCOAT
          float coatAreaSpecular = 1.0 - covered * ( 1.0 - smoothstep( 0.12, 0.35, material.clearcoatRoughness ) );
          clearcoatSpecularDirect = mix( beforeCoat, clearcoatSpecularDirect, coatAreaSpecular );
        #endif
      }
    }
  `)
}

export interface PlanarTuning {
  taps: number
  filter: number
  roughStart: number
  roughEnd: number
  far: number
  tail: number
  fireflyStart: number
  fireflyEnd: number
  fireflyRatio: number
  fireflyFloor: number
}

/** Replaces the specular environment term of the deck with the planar reflection. Must follow `boxPatch` on the same material. */
export function planarPatch(uniforms: PlanarUniforms, tuning: PlanarTuning, deckDetail = false): MaterialPatch {
  const f = (x: number): string => x.toFixed(4)
  return {
    id: deckDetail ? 'reflect-planar-deck-detail' : 'reflect-planar',
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    defines: {
      REFLECT_TAPS: tuning.taps,
      REFLECT_FILTER: f(tuning.filter),
      REFLECT_ROUGH_START: f(tuning.roughStart),
      REFLECT_ROUGH_END: f(tuning.roughEnd),
      REFLECT_FAR: f(tuning.far),
      REFLECT_TAIL: f(tuning.tail),
      REFLECT_FIREFLY_START: f(tuning.fireflyStart),
      REFLECT_FIREFLY_END: f(tuning.fireflyEnd),
      REFLECT_FIREFLY_RATIO: f(tuning.fireflyRatio),
      REFLECT_FIREFLY_FLOOR: f(tuning.fireflyFloor),
      ...(deckDetail ? { REFLECT_DECK_DETAIL: 1 } : {}),
    },
    apply(shader) {
      shader.fragmentShader = insertBefore(shader.fragmentShader, 'void main() {', planarPars)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <lights_fragment_maps>', planarApply)
      if (!deckDetail) shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <lights_fragment_begin>', deckDirectChunk())
    },
  }
}
