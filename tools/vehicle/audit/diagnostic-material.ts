import * as T from 'three'
import { patchMaterial, replaceOnce } from '../../../src/materials/patch'

function guardUndefinedNormals(material: T.Material): void {
  patchMaterial(material, {
    id: 'audit-undefined-normal',
    apply(shader) {
      // Use the actual triangle direction only if the stored normal has no direction.
      const vertex = replaceOnce(T.ShaderChunk.normal_vertex, 'vNormal = normalize( transformedNormal );', `
        vNormal = dot(transformedNormal, transformedNormal) > 1e-12 ? normalize(transformedNormal) : vec3(0.0);
      `)
      const fragment = replaceOnce(T.ShaderChunk.normal_fragment_begin, 'vec3 normal = normalize( vNormal );', `
        vec3 auditFace = cross(dFdx(vViewPosition), dFdy(vViewPosition));
        vec3 normal = dot(vNormal, vNormal) > 1e-12 ? normalize(vNormal)
          : (dot(auditFace, auditFace) > 1e-20 ? normalize(auditFace) * faceDirection : vec3(0.0, 0.0, faceDirection));
      `)
      shader.vertexShader = replaceOnce(shader.vertexShader, '#include <normal_vertex>', vertex)
      shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <normal_fragment_begin>', fragment)
      const paintNormal = 'vec3 n = normalize(carNormal);'
      if (shader.fragmentShader.includes(paintNormal)) {
        shader.fragmentShader = replaceOnce(shader.fragmentShader, paintNormal, `
          vec3 localFace = cross(dFdx(carLocal), dFdy(carLocal));
          vec3 n = dot(carNormal, carNormal) > 1e-12 ? normalize(carNormal) :
            (dot(localFace, localFace) > 1e-20 ? normalize(localFace) * (gl_FrontFacing ? 1.0 : -1.0) : vec3(0.0, 1.0, 0.0));
        `)
      }
    },
  })
}

function guardUndefinedAnisotropyFrame(material: T.MeshPhysicalMaterial): void {
  if (!(material.anisotropy > 0)) return
  patchMaterial(material, {
    id: 'audit-undefined-tangent',
    apply(shader) {
      const chunk = replaceOnce(T.ShaderChunk.normalmap_pars_fragment, 'float det = max( dot( T, T ), dot( B, B ) );', `
        float det = max( dot( T, T ), dot( B, B ) );
        float uvDet = st0.x * st1.y - st0.y * st1.x;
        if (!(det > 1e-24) || abs(uvDet) < 1e-16) {
          // A collapsed UV island has no tangent direction. Keep the shading normal;
          // use a finite orthonormal frame only for that undefined parameterization.
          vec3 axis = abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 tangent = normalize(cross(axis, N));
          return mat3(tangent, cross(N, tangent), N);
        }
      `)
      shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <normalmap_pars_fragment>', chunk)
    },
  })
}

export function auditMaterial(view: 'clay' | 'zebra', side: T.Side = T.FrontSide): T.Material {
  const material = view === 'clay'
    ? new T.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.95, side })
    : new T.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0, side })
  guardUndefinedNormals(material)
  return material
}

export function auditOverrides(root: T.Object3D, doubleSided: ReadonlySet<string>, beautyGuard: boolean) {
  const paired = new Map<T.Mesh, T.Material | T.Material[]>()
  const normal = { clay: auditMaterial('clay'), zebra: auditMaterial('zebra') }
  const rear = { clay: auditMaterial('clay', T.DoubleSide), zebra: auditMaterial('zebra', T.DoubleSide) }
  return (view: string): void => {
    for (const [mesh, material] of paired) mesh.material = material
    paired.clear()
    if (view === 'beauty' && beautyGuard) {
      root.traverse((o) => {
        const mesh = o as T.Mesh
        if (!mesh.isMesh) return
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if ((material as T.MeshStandardMaterial).isMeshStandardMaterial) guardUndefinedNormals(material)
          if ((material as T.MeshPhysicalMaterial).isMeshPhysicalMaterial) guardUndefinedAnisotropyFrame(material as T.MeshPhysicalMaterial)
        }
      })
    }
    if (view !== 'clay' && view !== 'zebra') return
    root.traverse((o) => {
      const mesh = o as T.Mesh
      if (!mesh.isMesh) return
      paired.set(mesh, mesh.material)
      mesh.material = mesh.userData.diagnosticBackfaces || doubleSided.has(mesh.name) ? rear[view] : normal[view]
    })
  }
}
