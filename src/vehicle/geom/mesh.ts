import * as THREE from 'three'
import type { TessResult } from './tessellate'

/** Builds a geometry from a tessellation, with an optional mirrored copy across x = 0. */
export function toGeometry(parts: TessResult[], mirror: boolean): THREE.BufferGeometry {
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const append = (t: TessResult, sign: number): void => {
    const base = pos.length / 3
    for (let i = 0; i < t.positions.length; i += 3) {
      pos.push(t.positions[i] * sign, t.positions[i + 1], t.positions[i + 2])
      nor.push(t.normals[i] * sign, t.normals[i + 1], t.normals[i + 2])
    }
    for (const x of t.uvs) uv.push(x)
    for (let i = 0; i < t.indices.length; i += 3) {
      if (sign > 0) idx.push(base + t.indices[i], base + t.indices[i + 1], base + t.indices[i + 2])
      else idx.push(base + t.indices[i], base + t.indices[i + 2], base + t.indices[i + 1])
    }
  }
  for (const t of parts) {
    append(t, 1)
    if (mirror) append(t, -1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

/** Indexed triangle soup builder for procedural parts. */
export class MeshBuilder {
  readonly pos: number[] = []
  readonly nor: number[] = []
  readonly uv: number[] = []
  readonly idx: number[] = []
  /** Vertices made without a texture coordinate. */
  private readonly unmapped: number[] = []

  vertex(p: readonly number[], n: readonly number[], u?: number, v?: number): number {
    const id = this.pos.length / 3
    this.pos.push(p[0], p[1], p[2])
    this.nor.push(n[0], n[1], n[2])
    this.uv.push(u ?? 0, v ?? 0)
    if (u === undefined && v === undefined) this.unmapped.push(id)
    return id
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c)
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d)
  }

  /** A grid of rows x cols vertices from a point and normal function, quads wound so the normal faces out. */
  grid(rows: number, cols: number, f: (i: number, j: number) => { p: readonly number[]; n: readonly number[]; u?: number; v?: number }, wrapJ = false, flip = false): void {
    const base = this.pos.length / 3
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const r = f(i, j)
        this.vertex(r.p, r.n, r.u ?? j / Math.max(1, cols - 1), r.v ?? i / Math.max(1, rows - 1))
      }
    }
    const jn = wrapJ ? cols : cols - 1
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < jn; j++) {
        const j1 = (j + 1) % cols
        const a = base + i * cols + j
        const b = base + i * cols + j1
        const c = base + (i + 1) * cols + j1
        const d = base + (i + 1) * cols + j
        if (flip) this.quad(a, d, c, b)
        else this.quad(a, b, c, d)
      }
    }
  }

  /** Final texture coordinates. */
  uvs(): number[] {
    // A vertex with no texture coordinate is mapped by box projection in metres onto the plane its normal faces most.
    // Shading that needs a tangent direction (anisotropy, normal maps) has none on a triangle with a constant coordinate.
    for (const i of this.unmapped) {
      const [x, y, z] = [this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]]
      const [ax, ay, az] = [Math.abs(this.nor[3 * i]), Math.abs(this.nor[3 * i + 1]), Math.abs(this.nor[3 * i + 2])]
      const [u, v] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y]
      this.uv[2 * i] = u
      this.uv[2 * i + 1] = v
    }
    this.unmapped.length = 0
    return this.uv
  }

  geometry(): THREE.BufferGeometry {
    this.uvs()
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setIndex(this.idx)
    return g
  }
}

export function mirrorGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone()
  m.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1))
  const index = m.getIndex()
  if (index) {
    const a = index.array as Uint32Array | Uint16Array
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1]
      a[i + 1] = a[i + 2]
      a[i + 2] = t
    }
  }
  return m
}
