import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CellDrops } from '../src/weather/surface/cells'

function plate(cell: number, gauge: number): { root: THREE.Object3D; holes: number } {
  const radius = cell - gauge / Math.sqrt(3)
  const shape = new THREE.Shape([new THREE.Vector2(-0.1, -0.05), new THREE.Vector2(0.1, -0.05), new THREE.Vector2(0.1, 0.05), new THREE.Vector2(-0.1, 0.05)])
  let holes = 0
  for (let i = -8; i <= 8; i++) for (let j = -4; j <= 4; j++) {
    const x = i * cell * 1.5
    const y = (j + (i % 2 === 0 ? 0.5 : 0)) * cell * Math.sqrt(3)
    if (Math.abs(x) + radius + 0.007 >= 0.1 || Math.abs(y) + radius + 0.004 >= 0.05) continue
    shape.holes.push(new THREE.Path(Array.from({ length: 6 }, (_, k) => new THREE.Vector2(x + radius * Math.cos((k * Math.PI) / 3), y + radius * Math.sin((k * Math.PI) / 3)))))
    holes++
  }
  // The shape lies in x and y; turned so its long side runs along -z and its face looks up, as the grille does.
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  mesh.rotation.set(-Math.PI / 2, 0, Math.PI / 2)
  mesh.position.set(0, 1, -1)
  const root = new THREE.Group()
  root.add(mesh)
  return { root, holes }
}

describe('grille cell drops', () => {
  const cell = 0.0078
  const { root, holes } = plate(cell, 0.0015)
  const vehicle = { root, anchors: { detail: { position: new THREE.Vector3(0, 1, -1), normal: new THREE.Vector3(0, 1, 0), radius: 0.1 } } }

  it('finds every open cell of the plate with its spacing and size', () => {
    const drops = new CellDrops(vehicle as never, new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()) as unknown as {
      findCells(mesh: THREE.Mesh, n: THREE.Vector3, along: THREE.Vector3, across: THREE.Vector3): { cells: Array<{ apothem: number }>; pitch: number }
    }
    const n = new THREE.Vector3(0, 1, 0)
    const along = new THREE.Vector3(0, 0, -1)
    const found = drops.findCells(root.children[0] as THREE.Mesh, n, along, along.clone().cross(n))
    expect(found.cells.length).toBe(holes)
    expect(found.pitch).toBeCloseTo(cell * Math.sqrt(3), 3)
    expect(found.cells[0].apothem).toBeCloseTo(((cell - 0.0015 / Math.sqrt(3)) * Math.sqrt(3)) / 2, 3)
  })

  it('places the same drops every time, on the plate and only near the lens', () => {
    const make = () => new CellDrops(vehicle as never, new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial())
    const a = make()
    const b = make()
    const matrices = (c: CellDrops) => c.group.children.flatMap((m) => Array.from((m as THREE.InstancedMesh).instanceMatrix.array))
    expect(matrices(a).length).toBeGreaterThan(0)
    expect(matrices(a)).toEqual(matrices(b))
    for (const m of a.group.children as THREE.InstancedMesh[]) {
      const x = new THREE.Matrix4()
      for (let i = 0; i < m.count; i++) {
        const p = new THREE.Vector3().setFromMatrixPosition((m.getMatrixAt(i, x), x))
        expect(Math.abs(p.y - 1)).toBeLessThan(0.001)
        expect(Math.abs(p.x)).toBeLessThan(0.05)
        expect(Math.abs(p.z + 1)).toBeLessThan(0.1)
      }
    }
    a.beginFrame(new THREE.Vector3(0, 1.5, -1))
    expect(a.group.visible).toBe(true)
    a.beginFrame(new THREE.Vector3(0, 1, 5))
    expect(a.group.visible).toBe(false)
  })
})
