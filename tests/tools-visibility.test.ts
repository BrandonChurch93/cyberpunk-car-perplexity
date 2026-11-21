import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { candidate, channels, collect, unsafe } from '../src/core/visibility'

const bytes = (id: number): number[] => channels(id).map((v) => Math.round(v * 255))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('visibility ids', () => {
  it('round trips ids through one sample', () => {
    const meshes: THREE.Mesh[] = []
    for (let i = 0; i < 5000; i++) meshes.push(new THREE.Mesh())
    for (const id of [1, 63, 64, 4095, 4096, 4999]) {
      const found = new Set<THREE.Object3D>()
      collect(new Uint8Array(bytes(id)), null, 1, meshes, found)
      expect([...found]).toEqual([meshes[id]])
    }
  })

  it('recovers each sample from nested coverage sums', () => {
    const meshes = Array.from({ length: 300 }, () => new THREE.Mesh())
    const ids = [7, 0, 200, 64]
    const sums: Uint8Array[] = []
    let running = [0, 0, 0, 0]
    for (const id of ids) {
      running = running.map((v, c) => v + bytes(id)[c] / 4)
      sums.push(new Uint8Array(running))
    }
    const found = new Set<THREE.Object3D>()
    sums.forEach((sum, k) => collect(sum, k > 0 ? sums[k - 1] : null, 4, meshes, found))
    expect(new Set(found)).toEqual(new Set([meshes[7], meshes[200], meshes[64]]))
  })
})

describe('visibility classes', () => {
  const box = new THREE.BoxGeometry()
  it('takes plain opaque built in meshes', () => {
    expect(candidate(new THREE.Mesh(box, new THREE.MeshStandardMaterial()))).toBe(true)
    expect(candidate(new THREE.InstancedMesh(box, new THREE.MeshPhysicalMaterial(), 3))).toBe(true)
  })

  it('leaves out what it cannot redraw exactly', () => {
    expect(candidate(new THREE.Mesh(box, new THREE.ShaderMaterial()))).toBe(false)
    expect(candidate(new THREE.Mesh(box, new THREE.MeshStandardMaterial({ transparent: true })))).toBe(false)
    expect(candidate(new THREE.Mesh(box, new THREE.MeshPhysicalMaterial({ transmission: 1 })))).toBe(false)
    expect(candidate(new THREE.Mesh(box, new THREE.MeshStandardMaterial({ alphaTest: 0.5 })))).toBe(false)
    expect(candidate(new THREE.Mesh(box, new THREE.MeshStandardMaterial({ colorWrite: false })))).toBe(false)
    const hooked = new THREE.Mesh(box, new THREE.MeshStandardMaterial())
    hooked.onBeforeRender = () => undefined
    expect(candidate(hooked)).toBe(false)
  })

  it('refuses scenes whose depth writes are not ordered overwrites', () => {
    expect(unsafe(new THREE.Mesh(box, new THREE.ShaderMaterial()))).toBe(false)
    expect(unsafe(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ depthFunc: THREE.AlwaysDepth })))).toBe(true)
    expect(unsafe(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ colorWrite: false })))).toBe(true)
    expect(unsafe(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending })))).toBe(true)
    expect(unsafe(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ transparent: true })))).toBe(false)
  })

  it('finds no material patch that moves vertices', () => {
    const moved: string[] = []
    for (const path of files('src')) {
      const source = readFileSync(path, 'utf8')
      let at = source.indexOf('.vertexShader =')
      while (at >= 0) {
        const end = source.indexOf('.fragmentShader', at)
        const text = source.slice(at, end > at ? end : at + 2000)
        if (/\btransformed\s*[-+*/]?=(?!=)|gl_Position\s*[-+*/]?=(?!=)/.test(text)) moved.push(path)
        at = source.indexOf('.vertexShader =', at + 1)
      }
    }
    expect(moved).toEqual([])
  })
})
