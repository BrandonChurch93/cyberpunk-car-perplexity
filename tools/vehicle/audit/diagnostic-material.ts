import * as T from 'three'
import { patchMaterial, replaceOnce } from '../../../src/materials/patch'

export function auditMaterial(view: 'clay' | 'zebra', side: T.Side = T.FrontSide): T.Material {
  const material = view === 'clay'
    ? new T.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.95, side })
    : new T.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0, side })
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
    },
  })
  return material
}

export function auditOverrides(root: T.Object3D, doubleSided: ReadonlySet<string>) {
  const paired = new Map<T.Mesh, T.Material | T.Material[]>()
  const normal = { clay: auditMaterial('clay'), zebra: auditMaterial('zebra') }
  const rear = { clay: auditMaterial('clay', T.DoubleSide), zebra: auditMaterial('zebra', T.DoubleSide) }
  return (view: string): void => {
    for (const [mesh, material] of paired) mesh.material = material
    paired.clear()
    if (view !== 'clay' && view !== 'zebra') return
    root.traverse((o) => {
      const mesh = o as T.Mesh
      if (!mesh.isMesh) return
      paired.set(mesh, mesh.material)
      mesh.material = mesh.userData.diagnosticBackfaces || doubleSided.has(mesh.name) ? rear[view] : normal[view]
    })
  }
}
