import * as THREE from 'three'

const maxSigns = 16
const signScatterGain = 11.0
const signScatterWidth = 0.84

type SignFace = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  x: number
  y: number
  width: number
  height: number
  fill: number
}

function glyphFootprint(texture: THREE.Texture) {
  const image: unknown = texture.image
  if (typeof HTMLCanvasElement === 'undefined' || !(image instanceof HTMLCanvasElement)) return null
  const { width, height } = image
  const pixels = image.getContext('2d')?.getImageData(0, 0, width, height).data
  if (!pixels) return null
  let left = width, right = 0, top = height, bottom = 0, area = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = pixels[(y * width + x) * 4 + 3]!
    if (alpha < 8) continue
    left = Math.min(left, x)
    right = Math.max(right, x + 1)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y + 1)
    area += alpha / 255
  }
  if (area === 0) return null
  return {
    x: (left + right) / (2 * width) - 0.5,
    y: 0.5 - (top + bottom) / (2 * height),
    w: (right - left) / width,
    h: (bottom - top) / height,
    fill: area / ((right - left) * (bottom - top)),
  }
}

function emittingFaces(root?: THREE.Object3D) {
  const signs: SignFace[] = []
  root?.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.PlaneGeometry)
      || !(object.material instanceof THREE.ShaderMaterial)) return
    const { uniforms } = object.material
    const tint: unknown = uniforms.tint?.value
    if (!(tint instanceof THREE.Color)) return
    const glyphs: unknown = uniforms.glyphs?.value
    const radiance: unknown = uniforms.radiance?.value
    const letters = object.name.startsWith('opal lettering ') && glyphs instanceof THREE.Texture && typeof radiance === 'number'
    const panel = object.name === 'weather-sealed opal face' && tint.b > tint.r
    if (!letters && !panel) return
    const patch = letters ? glyphFootprint(glyphs) : { x: 0, y: 0, w: 1, h: 1, fill: 1 }
    if (!patch) return
    const { width, height } = object.geometry.parameters
    signs.push({
      mesh: object as SignFace['mesh'],
      x: patch.x * width, y: patch.y * height,
      width: patch.w * width, height: patch.h * height, fill: patch.fill,
    })
  })
  return signs
}

function visible(mesh: THREE.Object3D, camera: THREE.Camera) {
  if (!camera.layers.test(mesh.layers)) return false
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) if (!node.visible) return false
  return true
}

export function createSignAir(root?: THREE.Object3D) {
  const faces = emittingFaces(root)
  const vectors = () => ({ value: Array.from({ length: maxSigns }, () => new THREE.Vector4()) })
  const uniforms = { signCount: { value: 0 }, signCenter: vectors(), signTangent: vectors(), signNormal: vectors(), signTint: vectors() }
  const center = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), normal = new THREE.Vector3()
  return {
    uniforms,
    update(camera: THREE.Camera) {
      let i = 0
      for (const face of faces) {
        if (i >= maxSigns) break
        if (!face.mesh.material.visible || !visible(face.mesh, camera)) continue
        const tint: unknown = face.mesh.material.uniforms.tint?.value
        const radiance: unknown = face.mesh.material.uniforms.radiance?.value ?? 1
        if (!(tint instanceof THREE.Color) || typeof radiance !== 'number' || !Number.isFinite(radiance) || radiance <= 0) continue
        face.mesh.updateWorldMatrix(true, false)
        const matrix = face.mesh.matrixWorld
        center.set(face.x, face.y, 0).applyMatrix4(matrix)
        u.setFromMatrixColumn(matrix, 0).multiplyScalar(face.width)
        v.setFromMatrixColumn(matrix, 1).multiplyScalar(face.height)
        const width = u.length(), height = v.length()
        const span = Math.min(width, height), length = Math.max(width, height)
        if (span <= 0) continue
        normal.crossVectors(u, v).normalize()
        const tangent = (width >= height ? u : v).normalize()
        uniforms.signCenter.value[i]!.set(center.x, center.y, center.z, span)
        uniforms.signTangent.value[i]!.set(tangent.x, tangent.y, tangent.z, (length - span) * 0.5)
        uniforms.signNormal.value[i]!.set(normal.x, normal.y, normal.z, span * Math.min(length, 2 * span))
        uniforms.signTint.value[i]!.set(tint.r, tint.g, tint.b, radiance * face.fill)
        i++
      }
      uniforms.signCount.value = i
    },
  }
}

export const signAirGlsl = /* glsl */ `
uniform int signCount;
uniform vec4 signCenter[${maxSigns}];
uniform vec4 signTangent[${maxSigns}];
uniform vec4 signNormal[${maxSigns}];
uniform vec4 signTint[${maxSigns}];

float signAirDepth(vec3 origin, vec3 ray, float cityStart, float t) {
  return heightOpticalDepth(origin.y, ray.y, min(t, localAirRange), airDensity, airHeight)
    + cityOpticalDepth(origin, ray, cityStart, t);
}

vec3 scatterSigns(vec3 origin, vec3 ray, float far, float cityStart, float deckDepth) {
  vec3 glow = vec3(0.0);
  for (int i = 0; i < ${maxSigns}; i++) {
    if (i >= signCount) break;
    vec4 center = signCenter[i];
    vec3 fromEye = center.xyz - origin;
    vec4 facing = signNormal[i];
    float t = dot(fromEye, ray);
    if (t <= 0.0 || dot(fromEye, facing.xyz) >= 0.0) continue;
    vec4 tangent = signTangent[i];
    float offset = clamp(dot(ray * t - fromEye, tangent.xyz), -tangent.w, tangent.w);
    vec3 toFace = fromEye + offset * tangent.xyz;
    t = dot(toFace, ray);
    float span = ${signScatterWidth} * (center.w + t * 0.006);
    float halfPath = 2.25 * span;
    float entry = max(0.0, t - halfPath);
    float exit = min(far, t - 0.4 * span);
    if (exit <= entry) continue;
    vec3 across = toFace - t * ray;
    float r2 = dot(across, across) / (span * span);
    float envelope = 1.0 - smoothstep(1.0, 6.25, r2);
    if (envelope <= 0.0) continue;
    float startDepth = signAirDepth(origin, ray, cityStart, entry);
    float endDepth = signAirDepth(origin, ray, cityStart, exit);
    vec3 toEmitter = toFace - 0.5 * (entry + exit) * ray;
    float distance2 = dot(toEmitter, toEmitter);
    vec3 direction = toEmitter * inversesqrt(max(distance2, 1e-6));
    float solid = facing.w * max(0.0, -dot(direction, facing.xyz)) / (distance2 + facing.w / 3.14159265);
    float air = (exp(-startDepth) - exp(-endDepth)) * exp(-deckDepth);
    glow += signTint[i].rgb * (signTint[i].a * envelope * air * solid * phase(dot(ray, direction), anisotropy));
  }
  return ${signScatterGain.toFixed(1)} * glow;
}
`
