import * as THREE from 'three'
import { insertAfter, patchMaterial } from '../../materials/patch'
import { layers } from '../contract'
import { FullscreenPass, passMaterial } from '../fullscreen'
import { patchFilmLighting } from '../lights'
import type { StageDeps, StagePart } from '../parts'

const aoFragment = /* glsl */ `
uniform sampler2D geomNormals;
uniform sampler2D geomDepth;
uniform mat4 inverseProjection;
uniform float projectionScale;
uniform vec2 jitter;
in vec2 vUv;
out vec4 outColor;

vec3 positionAt(vec2 uv, float d) {
  vec4 q = inverseProjection * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return q.xyz / q.w;
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(geomDepth, 0);
  float d = texelFetch(geomDepth, texel, 0).r;
  if (d >= 1.0) {
    outColor = vec4(1.0, 65000.0, 0.0, 1.0);
    return;
  }
  vec3 p = positionAt(vUv, d);
  float z = -p.z;
  if (z > 55.0) {
    outColor = vec4(1.0, z, 0.0, 1.0);
    return;
  }
  vec3 n = normalize(texelFetch(geomNormals, texel, 0).rgb * 2.0 - 1.0);
  float pxPerMeter = projectionScale / z;
  float radiusPx = clamp(pxPerMeter * 0.93, 2.0, 92.0);
  float pixelNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float rotation = (pixelNoise + jitter.x) * 6.2831853;
  vec2 direction = vec2(cos(rotation), sin(rotation));
  float ao = 0.0;
  for (int k = 0; k < 6; k++) {
    float horizon = 0.0;
    for (int j = 0; j < 4; j++) {
      float f = (float(j) + 0.55 + jitter.y * 0.7) * 0.25;
      float radius = 1.2 + f * f * radiusPx;
      ivec2 t = texel + ivec2(round(direction * radius));
      if (any(lessThan(t, ivec2(0))) || any(greaterThanEqual(t, size))) continue;
      float qDepth = texelFetch(geomDepth, t, 0).r;
      if (qDepth >= 1.0) continue;
      vec2 uv = (vec2(t) + 0.5) / vec2(size);
      vec3 delta = positionAt(uv, qDepth) - p;
      float distance2 = dot(delta, delta);
      float h = dot(n, delta) * inversesqrt(max(distance2, 1e-8));
      float w = 1.0 - smoothstep(0.06, 1.05, distance2);
      horizon = max(horizon, max(h - 0.055, 0.0) * w);
    }
    ao += horizon;
    direction = mat2(0.5, 0.8660254, -0.8660254, 0.5) * direction;
  }
  float visibility = exp(-0.43 * ao);
  outColor = vec4(mix(visibility, 1.0, smoothstep(28.0, 55.0, z)), z, 0.0, 1.0);
}
`

const aoLookup = /* glsl */ `
uniform sampler2D filmOcclusion;
uniform vec2 filmAoRatio;
uniform mat4 filmAoView;
uniform float filmAoReady;

float filmAmbientVisibility(float viewDepth) {
  if (filmAoReady < 0.5 || distance(viewMatrix[2], filmAoView[2]) > 1e-5 ||
      distance(viewMatrix[3], filmAoView[3]) > 1e-5) return 1.0;
  vec2 pixel = gl_FragCoord.xy * filmAoRatio - 0.5;
  ivec2 q = ivec2(floor(pixel));
  vec2 f = fract(pixel);
  ivec2 hi = textureSize(filmOcclusion, 0) - 1;
  vec2 sum = vec2(0.0);
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      ivec2 t = clamp(q + ivec2(x, y), ivec2(0), hi);
      vec2 tap = texelFetch(filmOcclusion, t, 0).rg;
      float w = (x == 0 ? 1.0 - f.x : f.x) * (y == 0 ? 1.0 - f.y : f.y);
      w *= 1.0 - smoothstep(0.014, max(0.055, viewDepth * 0.019), abs(tap.y - viewDepth));
      sum += vec2(tap.x, 1.0) * w;
    }
  }
  return mix(1.0, sum.x / max(sum.y, 1e-5), smoothstep(0.015, 0.17, sum.y));
}
`

export function createShade({ renderer, scene, world, vehicle, rig }: StageDeps): StagePart {
  renderer.shadowMap.type = THREE.PCFShadowMap
  const normals = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  })
  const occlusion = new THREE.WebGLRenderTarget(1, 1, {
    format: THREE.RGFormat,
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  })
  const normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide, toneMapped: false })
  const materialSet = new Set<THREE.Material>()
  const ignore = new Map<THREE.Object3D, boolean>()
  const screenUniforms = {
    filmOcclusion: { value: occlusion.texture },
    filmAoRatio: { value: new THREE.Vector2() },
    filmAoView: { value: new THREE.Matrix4() },
    filmAoReady: { value: 0 },
  }
  const passUniforms = {
    geomNormals: { value: normals.texture },
    geomDepth: { value: normals.depthTexture },
    inverseProjection: { value: new THREE.Matrix4() },
    projectionScale: { value: 1 },
    jitter: { value: new THREE.Vector2() },
  }
  const pass = new FullscreenPass(passMaterial(aoFragment, passUniforms, { blending: THREE.NoBlending }))
  const clearColor = new THREE.Color()
  let normalDiagnostic = false

  function addMaterial(material: THREE.Material): void {
    if (!(material instanceof THREE.MeshStandardMaterial) || materialSet.has(material)) return
    materialSet.add(material)
    patchFilmLighting(material)
    patchMaterial(material, {
      id: 'film-indirect-occlusion',
      uniforms: screenUniforms,
      apply(shader) {
        shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', aoLookup)
        shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <aomap_fragment>', `
          float filmAo = filmAmbientVisibility(vViewPosition.z);
          reflectedLight.indirectDiffuse *= filmAo;
          reflectedLight.indirectSpecular *= filmAo;
          #ifdef USE_CLEARCOAT
            clearcoatSpecularIndirect *= filmAo;
          #endif
          #ifdef USE_SHEEN
            sheenSpecularIndirect *= filmAo;
          #endif
        `)
      },
    })
  }

  scene.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.every((m) => !m.depthWrite || m.transparent || (m instanceof THREE.MeshPhysicalMaterial && m.transmission > 0))) {
      ignore.set(mesh, false)
    }
    materials.forEach(addMaterial)
  })

  return {
    resize(format) {
      const width = Math.ceil(format.width / 2)
      const height = Math.ceil(format.height / 2)
      normals.setSize(width, height)
      occlusion.setSize(width, height)
      screenUniforms.filmAoRatio.value.set(width / format.width, height / format.height)
    },
    beginFrame() {
      screenUniforms.filmAoReady.value = 0
      rig.fitContactRegion(vehicle.root, world.deck.bounds)
    },
    setDiagnostic(view) {
      normalDiagnostic = view === 'normals'
      screenUniforms.filmAoReady.value = 0
      if (view === 'clay' && scene.overrideMaterial) addMaterial(scene.overrideMaterial)
    },
    beforeSample({ camera, sample }) {
      if (normalDiagnostic) return
      const override = scene.overrideMaterial
      const background = scene.background
      const target = renderer.getRenderTarget()
      const face = renderer.getActiveCubeFace()
      const mip = renderer.getActiveMipmapLevel()
      const alpha = renderer.getClearAlpha()
      const mask = camera.layers.mask
      const shadows = renderer.shadowMap.enabled
      renderer.getClearColor(clearColor)
      try {
        for (const object of ignore.keys()) {
          ignore.set(object, object.visible)
          object.visible = false
        }
        camera.layers.set(layers.scene)
        renderer.shadowMap.enabled = false
        scene.overrideMaterial = normalMaterial
        scene.background = null
        renderer.setClearColor(0, 0)
        renderer.setRenderTarget(normals)
        renderer.clear(true, true, false)
        renderer.render(scene, camera)
        passUniforms.inverseProjection.value.copy(camera.projectionMatrixInverse)
        passUniforms.projectionScale.value = camera.projectionMatrix.elements[5] * normals.height * 0.5
        passUniforms.jitter.value.set(...sample.misc)
        pass.render(renderer, occlusion)
        screenUniforms.filmAoView.value.copy(camera.matrixWorldInverse)
        screenUniforms.filmAoReady.value = 1
      } finally {
        for (const [object, visible] of ignore) object.visible = visible
        scene.overrideMaterial = override
        scene.background = background
        camera.layers.mask = mask
        renderer.shadowMap.enabled = shadows
        renderer.setRenderTarget(target, face, mip)
        renderer.setClearColor(clearColor, alpha)
      }
    },
  }
}
