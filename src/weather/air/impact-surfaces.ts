import * as THREE from 'three'
import type { WetSurface } from '../../core/contract'

interface Face {
  x: number
  y: number
  z: number
  ab: THREE.Vector3
  ac: THREE.Vector3
  invDet: number
  up: THREE.Vector3
  mesh: THREE.Mesh
  inverse: THREE.Matrix4
}

export interface ImpactSurfacePoint {
  y: number
  face: Face
}

export class ImpactSurfaces {
  private readonly bins = new Map<number, Face[]>()
  readonly meshes = new Set<THREE.Mesh>()

  constructor(root: THREE.Object3D, surfaces: WetSurface[], private readonly binSize: number) {
    const wet = new Set(surfaces.filter((surface) => surface.wetness !== 'none').map((surface) => surface.material))
    root.updateWorldMatrix(true, true)
    root.traverse((candidate) => {
      const mesh = candidate as THREE.Mesh
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (!mats.some((m) => wet.has(m))) return
      const geometry = mesh.geometry as THREE.BufferGeometry
      const position = geometry.getAttribute('position')
      if (!position) return
      const index = geometry.getIndex()
      const length = index?.count ?? position.count
      const a = new THREE.Vector3()
      const b = new THREE.Vector3()
      const c = new THREE.Vector3()
      const ab = new THREE.Vector3()
      const ac = new THREE.Vector3()
      const up = new THREE.Vector3()
      const inverse = mesh.matrixWorld.clone().invert()
      const groups = mats.length > 1 ? geometry.groups : [{ start: 0, count: length, materialIndex: 0 }]
      for (const group of groups) {
        if (!wet.has(mats[group.materialIndex ?? 0])) continue
        const end = Math.min(group.start + group.count, length)
        for (let i = group.start; i + 2 < end; i += 3) {
          a.fromBufferAttribute(position, index?.getX(i) ?? i).applyMatrix4(mesh.matrixWorld)
          b.fromBufferAttribute(position, index?.getX(i + 1) ?? i + 1).applyMatrix4(mesh.matrixWorld)
          c.fromBufferAttribute(position, index?.getX(i + 2) ?? i + 2).applyMatrix4(mesh.matrixWorld)
          ab.subVectors(b, a)
          ac.subVectors(c, a)
          up.crossVectors(ab, ac)
          if (up.y <= 1e-7 || up.y < up.length() * 0.34) continue
          const face = { x: a.x, y: a.y, z: a.z, ab: ab.clone(), ac: ac.clone(), invDet: -1 / up.y, up: up.clone().normalize(), mesh, inverse }
          this.meshes.add(mesh)
          const minX = Math.floor(Math.min(a.x, b.x, c.x) / binSize)
          const maxX = Math.floor(Math.max(a.x, b.x, c.x) / binSize)
          const minZ = Math.floor(Math.min(a.z, b.z, c.z) / binSize)
          const maxZ = Math.floor(Math.max(a.z, b.z, c.z) / binSize)
          for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
              const key = this.key(x, z)
              const bin = this.bins.get(key)
              if (bin) bin.push(face)
              else this.bins.set(key, [face])
            }
          }
        }
      }
    })
  }

  private key(x: number, z: number): number {
    return x * 65_536 + z
  }

  at(x: number, z: number, result: ImpactSurfacePoint): boolean {
    const bin = this.bins.get(this.key(Math.floor(x / this.binSize), Math.floor(z / this.binSize)))
    if (!bin) return false
    let highest = -Infinity
    for (const face of bin) {
      const px = x - face.x
      const pz = z - face.z
      const u = (px * face.ac.z - pz * face.ac.x) * face.invDet
      const v = (face.ab.x * pz - face.ab.z * px) * face.invDet
      if (u < 0 || v < 0 || u + v > 1) continue
      const y = face.y + u * face.ab.y + v * face.ac.y
      if (y <= highest) continue
      highest = y
      result.y = y
      result.face = face
    }
    return Number.isFinite(highest)
  }
}
