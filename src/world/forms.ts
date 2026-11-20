import * as THREE from 'three'

export type Tuple = readonly [number, number, number]
export type Tone = 'graphite' | 'slate' | 'stone' | 'chalk'
type Parent = THREE.Object3D

export interface Box {
  size: Tuple
  at: Tuple
}

export const streetY = -28
export const heroCityYaw = THREE.MathUtils.degToRad(25.1)
export const heroDrainLayout = [.82, 3.82] as const

export function group(parent: Parent, name: string, at: Tuple = [0, 0, 0]): THREE.Group {
  const assembly = new THREE.Group()
  assembly.name = name
  assembly.position.set(...at)
  parent.add(assembly)
  return assembly
}

export class Forms {
  private readonly cube = new THREE.BoxGeometry()
  private readonly tones: Record<Tone, THREE.MeshStandardMaterial> = {
    graphite: new THREE.MeshStandardMaterial({ color: 0x454545, roughness: 0.96 }),
    slate: new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.92 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x858585, roughness: 0.9 }),
    chalk: new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.88 }),
  }

  private finish<T extends THREE.Mesh>(parent: Parent, mesh: T, name: string): T {
    mesh.name = name
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  box(parent: Parent, name: string, tone: Tone, size: Tuple, at: Tuple): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
    const mesh = new THREE.Mesh(this.cube, this.tones[tone])
    mesh.position.set(...at)
    mesh.scale.set(...size)
    return this.finish(parent, mesh, name)
  }

  boxes(parent: Parent, name: string, tone: Tone, data: readonly Box[]): void {
    if (data.length === 0) return
    const mesh = new THREE.InstancedMesh(this.cube, this.tones[tone], data.length)
    const matrix = new THREE.Matrix4()
    data.forEach(({ size, at }, i) => {
      matrix.makeScale(...size).setPosition(...at)
      mesh.setMatrixAt(i, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    this.finish(parent, mesh, name)
  }

  cylinder(parent: Parent, name: string, tone: Tone, at: Tuple, height: number, base: number, top = base, segments = 10): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, base, height, segments), this.tones[tone])
    mesh.position.set(...at)
    return this.finish(parent, mesh, name)
  }

  pipe(parent: Parent, name: string, tone: Tone, from: Tuple, to: Tuple, radius: number): THREE.Mesh {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const direction = b.clone().sub(a)
    const midpoint = a.lerp(b, 0.5)
    const mesh = this.cylinder(parent, name, tone, [midpoint.x, midpoint.y, midpoint.z], direction.length(), radius)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
    return mesh
  }

  surface(parent: Parent, name: string, tone: Tone, vertices: readonly Tuple[], triangles: number[]): THREE.Mesh {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3))
    geometry.setIndex(triangles)
    const faces = geometry.toNonIndexed()
    faces.computeVertexNormals()
    return this.finish(parent, new THREE.Mesh(faces, this.tones[tone]), name)
  }
}
