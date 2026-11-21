import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { runSwept } from '../src/weather/surface/beads'
import { dripReach, lowerEdgeDistance } from '../src/weather/surface/drip-edges'

/** A door skin 0.3 m tall facing +x, turning under at its foot into a 14 mm return that faces down. */
function sill(): THREE.BufferGeometry {
  const rows = 31
  const cols = 11
  const pos: number[] = []
  const nrm: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    pos.push(0, 0.3 - 0.01 * r, 0.02 * c)
    nrm.push(1, 0, 0)
  }
  for (let c = 0; c < cols; c++) {
    pos.push(-0.014, 0, 0.02 * c)
    nrm.push(0, -1, 0)
  }
  const index: number[] = []
  const at = (r: number, c: number) => r * cols + c
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols - 1; c++) {
    const a = at(r, c), b = at(r, c + 1), d = at(r + 1, c), e = at(r + 1, c + 1)
    index.push(a, d, b, b, d, e)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setIndex(index)
  return g
}

describe('drip edges', () => {
  it('finds the foot of a panel that turns under and measures up from it', () => {
    const { distance, valid } = lowerEdgeDistance(sill(), new THREE.Matrix4())
    const cols = 11
    expect(distance[30 * cols + 5]).toBe(0)
    expect(distance[28 * cols + 5]).toBeCloseTo(0.02, 5)
    expect(distance[0]).toBeCloseTo(dripReach, 6)
    expect([...valid].every((v) => v === 1)).toBe(true)
  })

  it('finds no lower edge on a flat level panel', () => {
    const g = new THREE.PlaneGeometry(0.4, 0.4, 8, 8).rotateX(-Math.PI / 2)
    const { distance } = lowerEdgeDistance(g, new THREE.Matrix4())
    expect(Math.min(...distance)).toBeCloseTo(dripReach, 6)
  })

  it('is the same every run', () => {
    const a = lowerEdgeDistance(sill(), new THREE.Matrix4()).distance
    const b = lowerEdgeDistance(sill(), new THREE.Matrix4()).distance
    expect([...a]).toEqual([...b])
  })
})

describe('rivulet lanes', () => {
  const n = new THREE.Vector3(1, 0, 0)
  const down = new THREE.Vector3(0, -1, 0)
  it('sweep beads only on steep panels, along a minority of the width', () => {
    let swept = 0
    const total = 4000
    for (let i = 0; i < total; i++) {
      const p = new THREE.Vector3(0, -0.005 * (i % 200), 0.0153 * Math.floor(i / 200))
      if (runSwept(p, n, down, 1, 118, 0.001, 1)) swept++
      expect(runSwept(p, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 0, 118, 0.001, 1)).toBe(false)
    }
    expect(swept / total).toBeGreaterThan(0.01)
    expect(swept / total).toBeLessThan(0.3)
  })
})
