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
  reflectEmitters: { value: THREE.Vector4[] }
  reflectEmitterBounds: { value: THREE.Vector4[] }
  reflectEmitterPeaks: { value: number[] }
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
#if REFLECT_EMITTERS > 0
  uniform vec4 reflectEmitters[REFLECT_EMITTERS];
  uniform vec4 reflectEmitterBounds[REFLECT_EMITTERS];
  uniform float reflectEmitterPeaks[REFLECT_EMITTERS];
#endif

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

float planarDistance( vec3 p, vec2 uv ) {
  float depth = texture( reflectDepth, uv ).r;
  if ( depth >= 1.0 ) return REFLECT_FAR;
  vec4 hit = reflectInverseViewProjection * vec4( vec3( uv, depth ) * 2.0 - 1.0, 1.0 );
  return clamp( distance( hit.xyz / hit.w, p ), 0.02, REFLECT_FAR );
}

// Marginal cross-slope and conditional elevation quantiles of the GGX slope distribution.
const int planarFilmTaps = 9;
const int planarCross[planarFilmTaps] = int[planarFilmTaps]( 2, 7, 3, 0, 4, 8, 5, 1, 6 );
const float planarElevation[planarFilmTaps] = float[planarFilmTaps](
  -1.29242645, -0.66422739, -0.38192303, -0.17820084, 0.0, 0.17820084, 0.38192303, 0.66422739, 1.29242645
);

vec3 planarRadiance( vec3 normalView, float roughness, vec3 fallback ) {
  if ( reflectOn < 0.5 || roughness >= REFLECT_ROUGH_END ) return fallback;
  vec3 p = vReflectWorld;
  vec3 n = normalize( transformDirectionByInverseViewMatrix( normalView, viewMatrix ) );
  #ifdef REFLECT_DECK_DETAIL
    if ( abs( p.y ) > 0.02 || n.y < 0.7 ) return fallback;
  #endif
  vec3 v = normalize( cameraPosition - p );
  float dist = planarDistance( p, reflectUv( p ) );
  float a = roughness * roughness;
  vec3 t = cross( n, v );
  t = dot( t, t ) > 1e-8 ? normalize( t ) : normalize( cross( n, vec3( 0.0, 0.0, 1.0 ) ) );
  vec3 b = cross( t, n );
  vec2 uvCenter = reflectUv( p + planarRay( v, n ) * dist );
  vec2 uvSide = reflectUv( p + planarRay( v, normalize( n + a * t ) ) * dist );
  vec2 acrossPx = ( uvSide - uvCenter ) * reflectSize;
  float minor = length( acrossPx );
  vec2 acrossDir = minor > 1e-4 ? acrossPx / minor : vec2( 1.0, 0.0 );
  float lod = clamp( log2( max( minor * REFLECT_FILTER, 1.0 ) ), 0.0, reflectLodMax );
  float filmBlend = smoothstep( REFLECT_FILM_START, REFLECT_FILM_END, roughness );
  float mipBlend = smoothstep( REFLECT_MIP_START, REFLECT_MIP_END, roughness );
  vec2 centerEdge = min( uvCenter, 1.0 - uvCenter );
  float fireflyBlend = smoothstep( REFLECT_FIREFLY_START, REFLECT_FIREFLY_END, roughness )
    * smoothstep( 0.0, 0.02, min( centerEdge.x, centerEdge.y ) );
  float tapLimit = REFLECT_FIREFLY_FLOOR;
  if ( fireflyBlend > 0.0 ) {
    vec2 uvLong = reflectUv( p + planarRay( v, normalize( n + a * b ) ) * dist );
    float major = length( ( uvLong - uvCenter ) * reflectSize );
    float refLod = clamp( log2( max( max( minor, major ) * REFLECT_FILTER, 1.0 ) ), 0.0, reflectLodMax );
    vec3 center = textureLod( reflectMap, uvCenter, refLod ).rgb;
    tapLimit += REFLECT_FIREFLY_RATIO * max( 0.0, planarLuma( center ) );
  }
  vec2 jitter = filmBlend < 1.0 ? vec2( reflectHash( gl_FragCoord.xy ), reflectHash( gl_FragCoord.yx + 71.0 ) ) : vec2( 0.0 );
  vec3 sum = vec3( 0.0 );
  float count = 0.0;
  for ( int k = 0; k < max( planarFilmTaps, REFLECT_TAPS ); k ++ ) {
    float weight = mix( k < REFLECT_TAPS ? 1.0 : 0.0, k < planarFilmTaps ? 1.0 : 0.0, filmBlend );
    if ( weight <= 0.0 ) continue;
    vec3 h = n;
    if ( filmBlend < 1.0 ) {
      vec2 u = fract( jitter + float( k ) * vec2( 0.7548776662, 0.5698402910 ) );
      float phi = 6.28318530718 * u.x;
      float cos2 = ( 1.0 - u.y ) / ( 1.0 + ( a * a - 1.0 ) * u.y );
      float sinT = sqrt( max( 0.0, 1.0 - cos2 ) );
      h = normalize( t * ( cos( phi ) * sinT ) + b * ( sin( phi ) * sinT ) + n * sqrt( cos2 ) );
    }
    if ( filmBlend > 0.0 && k < planarFilmTaps ) {
      float u = 2.0 * ( float( planarCross[k] ) + 0.5 ) / float( planarFilmTaps ) - 1.0;
      float s = inversesqrt( 1.0 - u * u );
      vec3 filmH = normalize( n + a * s * ( u * t + planarElevation[k] * b ) );
      h = normalize( mix( h, filmH, filmBlend ) );
    }
    vec3 r = reflect( - v, h );
    if ( dot( r, n ) <= 0.0 ) continue;
    r.y = abs( r.y );
    float tapDistance = dist;
    if ( mipBlend > 0.0 ) {
      // A near center hit must not collapse the angular spread of rays that reach the city.
      vec2 farUv = reflectUv( p + r * REFLECT_FAR );
      if ( all( greaterThan( farUv, vec2( 0.0 ) ) ) && all( lessThan( farUv, vec2( 1.0 ) ) ) ) {
        tapDistance = mix( dist, planarDistance( p, farUv ), mipBlend );
      }
    }
    vec2 uv = reflectUv( p + r * tapDistance );
    vec2 delta = ( uv - uvCenter ) * reflectSize;
    float spread = mix( length( delta ), abs( dot( delta, acrossDir ) ), filmBlend ) * REFLECT_TAIL;
    vec2 edge = min( uv, 1.0 - uv );
    float inside = smoothstep( 0.0, 0.02, min( edge.x, edge.y ) );
    vec3 env = inside < 1.0 ? reflectEnvironment( r, roughness * 0.5 ) : vec3( 0.0 );
    vec3 mirror = inside > 0.0 ? textureLod( reflectMap, clamp( uv, 0.0, 1.0 ), mipBlend * clamp( max( lod, log2( max( spread, 1.0 ) ) ), 0.0, reflectLodMax ) ).rgb : vec3( 0.0 );
    float luma = planarLuma( mirror );
    float ceiling = tapLimit;
    #if REFLECT_EMITTERS > 0
      if ( fireflyBlend > 0.0 && luma > ceiling ) {
        for ( int j = 0; j < REFLECT_EMITTERS; j ++ ) {
          vec4 bounds = reflectEmitterBounds[j];
          if ( all( greaterThanEqual( uv, bounds.xy ) ) && all( lessThanEqual( uv, bounds.zw ) ) ) ceiling = max( ceiling, reflectEmitterPeaks[j] );
        }
      }
    #endif
    float excess = max( luma - ceiling, 0.0 ) / max( REFLECT_FIREFLY_FLOOR, luma );
    mirror *= 1.0 - fireflyBlend * excess;
    sum += weight * mix( env, mirror, inside );
    count += weight;
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
  const lighting = THREE.ShaderChunk.lights_fragment_begin
  const start = lighting.indexOf(spotStart)
  if (start < 0) throw new Error('deck area shading requires a spot light block')
  return lighting.slice(0, start) + /* glsl */ `
  float deckMirrorCoverage = 0.0;
  #if REFLECT_EMITTERS > 0
    if ( reflectOn > 0.5 ) {
      vec3 worldNormal = transformDirectionByInverseViewMatrix( geometryNormal, viewMatrix );
      vec2 uv = reflectUv( vReflectWorld );
      vec2 edge = min( uv, 1.0 - uv );
      deckMirrorCoverage = smoothstep( 0.0, 0.02, min( edge.x, edge.y ) ) * smoothstep( 0.6, 0.8, worldNormal.y );
      #ifdef REFLECT_DECK_DETAIL
        if ( abs( vReflectWorld.y ) > 0.02 || worldNormal.y < 0.7 ) deckMirrorCoverage = 0.0;
      #endif
    }
  #endif
  ` + replaceOnce(lighting.slice(start), spotDirect, /* glsl */ `
    {
      vec3 beforeSpecular = reflectedLight.directSpecular;
      #ifdef USE_CLEARCOAT
        vec3 beforeCoat = clearcoatSpecularDirect;
      #endif
      ${spotDirect}
      #if REFLECT_EMITTERS > 0
        if ( deckMirrorCoverage > 0.0 && directLight.visible ) {
          vec3 spotWorld = ( spotLight.position - viewMatrix[3].xyz ) * mat3( viewMatrix );
          for ( int j = 0; j < REFLECT_EMITTERS; j ++ ) {
            if ( reflectEmitters[j].w < 0.5 ) continue;
            vec3 delta = spotWorld - reflectEmitters[j].xyz;
            if ( dot( delta, delta ) >= 0.000004 ) continue;
            reflectedLight.directSpecular = mix( reflectedLight.directSpecular, beforeSpecular, deckMirrorCoverage );
            #ifdef USE_CLEARCOAT
              clearcoatSpecularDirect = mix( clearcoatSpecularDirect, beforeCoat, deckMirrorCoverage );
            #endif
            break;
          }
        }
      #endif
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
  filmStart: number
  filmEnd: number
  mipStart: number
  mipEnd: number
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
      REFLECT_EMITTERS: uniforms.reflectEmitters.value.length,
      REFLECT_FILTER: f(tuning.filter),
      REFLECT_ROUGH_START: f(tuning.roughStart),
      REFLECT_ROUGH_END: f(tuning.roughEnd),
      REFLECT_FAR: f(tuning.far),
      REFLECT_TAIL: f(tuning.tail),
      REFLECT_FILM_START: f(tuning.filmStart),
      REFLECT_FILM_END: f(tuning.filmEnd),
      REFLECT_MIP_START: f(tuning.mipStart),
      REFLECT_MIP_END: f(tuning.mipEnd),
      REFLECT_FIREFLY_START: f(tuning.fireflyStart),
      REFLECT_FIREFLY_END: f(tuning.fireflyEnd),
      REFLECT_FIREFLY_RATIO: f(tuning.fireflyRatio),
      REFLECT_FIREFLY_FLOOR: f(tuning.fireflyFloor),
      ...(deckDetail ? { REFLECT_DECK_DETAIL: 1 } : {}),
    },
    apply(shader) {
      shader.fragmentShader = insertBefore(shader.fragmentShader, 'void main() {', planarPars)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <lights_fragment_maps>', planarApply)
      if (uniforms.reflectEmitters.value.length > 0) {
        shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <lights_fragment_begin>', deckDirectChunk())
      }
    },
  }
}
