import * as THREE from 'three'

const lodMin = 3
const samples = 32

const fragment = /* glsl */ `
#define SAMPLES ${samples}u
varying vec3 vWorldDirection;
uniform samplerCube source;
uniform float roughness;
uniform float lodBias;
#include <common>

float radical( uint bits ) {
  bits = ( bits << 16u ) | ( bits >> 16u );
  bits = ( ( bits & 0x55555555u ) << 1u ) | ( ( bits & 0xAAAAAAAAu ) >> 1u );
  bits = ( ( bits & 0x33333333u ) << 2u ) | ( ( bits & 0xCCCCCCCCu ) >> 2u );
  bits = ( ( bits & 0x0F0F0F0Fu ) << 4u ) | ( ( bits & 0xF0F0F0F0u ) >> 4u );
  bits = ( ( bits & 0x00FF00FFu ) << 8u ) | ( ( bits & 0xFF00FF00u ) >> 8u );
  return float( bits ) * 2.3283064365386963e-10;
}

void main() {
  vec3 N = normalize( vWorldDirection );
  if ( roughness < 0.001 ) {
    gl_FragColor = vec4( textureLod( source, N, 0.0 ).rgb, 1.0 );
    return;
  }
  float alpha = roughness * roughness;
  float alpha2 = alpha * alpha;
  vec3 up = abs( N.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
  vec3 tangent = normalize( cross( up, N ) );
  vec3 bitangent = cross( N, tangent );
  vec3 sum = vec3( 0.0 );
  float weight = 0.0;
  for ( uint i = 0u; i < SAMPLES; i ++ ) {
    vec2 xi = vec2( ( float( i ) + 0.5 ) / float( SAMPLES ), radical( i ) );
    float invQ = 1.0 / ( 1.0 - xi.x + alpha2 * xi.x );
    float NdotL = ( 1.0 - xi.x - alpha2 * xi.x ) * invQ;
    if ( NdotL > 0.0 ) {
      float phi = 2.0 * PI * xi.y;
      float sinTheta = 2.0 * alpha * sqrt( xi.x * ( 1.0 - xi.x ) ) * invQ;
      vec3 L = N * NdotL + ( tangent * cos( phi ) + bitangent * sin( phi ) ) * sinTheta;
      float lod = max( log2( alpha2 * invQ ) + lodBias, 0.0 );
      sum += textureLod( source, L, lod ).rgb * NdotL;
      weight += NdotL;
    }
  }
  gl_FragColor = vec4( sum / weight, 1.0 );
}
`

export function lodToRoughness(lod: number, maxLod: number): number {
  return maxLod > 0 ? 1 - Math.sqrt(1 - lod / maxLod) : 0
}

/**
 * Roughness prefilter for a captured cube, laid out the way the three.js environment lookup expects a PMREM.
 * Each GGX sample reads the source mip that matches its solid angle, so a few samples per texel are enough.
 */
export class Prefilter {
  readonly target: THREE.WebGLCubeRenderTarget
  private readonly material: THREE.ShaderMaterial
  private readonly box: THREE.Mesh
  private readonly cube: THREE.CubeCamera

  constructor(private readonly renderer: THREE.WebGLRenderer, readonly size: number) {
    this.target = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    })
    const maxLod = Math.log2(size) - lodMin
    for (let lod = 0; lod <= maxLod; lod++) this.target.texture.mipmaps.push({ width: size >> lod, height: size >> lod } as never)
    this.target.texture.isPMREMTexture = true
    this.material = new THREE.ShaderMaterial({
      uniforms: { source: { value: null }, roughness: { value: 0 }, lodBias: { value: 0 } },
      vertexShader: THREE.ShaderChunk.cube_vert,
      fragmentShader: fragment,
      side: THREE.BackSide,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    })
    this.box = new THREE.Mesh(new THREE.BoxGeometry(), this.material)
    this.box.frustumCulled = false
    this.cube = new THREE.CubeCamera(0.1, 10, this.target)
  }

  get maxLod(): number {
    return this.target.texture.mipmaps.length - 1
  }

  /** `source` must carry its full mip chain. */
  run(source: THREE.Texture): THREE.Texture {
    const u = this.material.uniforms
    u.source.value = source
    for (let lod = 0; lod <= this.maxLod; lod++) {
      const roughness = lodToRoughness(lod, this.maxLod)
      u.roughness.value = roughness
      u.lodBias.value = roughness > 0 ? Math.log2(this.size) + 0.5 * Math.log2(6 / (samples * Math.pow(roughness, 4))) + 1 : 0
      const edge = this.size >> lod
      this.cube.activeMipmapLevel = lod
      this.target.viewport.set(0, 0, edge, edge)
      this.cube.update(this.renderer, this.box)
      this.target.viewport.set(0, 0, this.size, this.size)
    }
    return this.target.texture
  }
}
