import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { dims } from '../src/vehicle/body/shape'
import { openEdges, windingAgreement } from './vehicle-rear-mesh'
import { centreY, floorY, sheet, strakes, tailZ, underbody } from '../src/vehicle/parts/diffuser'

describe('rear underbody', () => {
  const u = underbody()

  it('winds every face of the floor and strakes outward', () => {
    expect(windingAgreement(u.floor)).toBe(1)
    expect(windingAgreement(u.strakes)).toBe(1)
  })

  it('builds the floor and strakes as closed solids, open only on the centre line', () => {
    expect(openEdges(u.strakes)).toBe(0)
    expect(openEdges(u.floor, 1e-6)).toBe(0)
  })

  it('keeps everything inside the body width, behind the nose, ahead of the tail and off the ground', () => {
    for (const g of [u.floor, u.strakes]) {
      g.computeBoundingBox()
      const box = g.boundingBox!
      expect(box.max.x).toBeLessThan(dims.width / 2 - 0.05)
      expect(box.min.y).toBeGreaterThanOrEqual(floorY - 1e-6)
      expect(box.min.z).toBeGreaterThan(-dims.halfLength + 0.03)
    }
  })

  it('keeps the diffuser behind the rear tyre inside the body corner', () => {
    for (const g of [u.floor, u.strakes]) {
      const pos = g.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) > dims.rearHubZ - dims.rearTire.radius) continue
        expect(pos.getX(i)).toBeLessThan(0.91)
        expect(pos.getZ(i)).toBeGreaterThan(tailZ(Math.min(0.95, pos.getX(i))) - 0.011)
      }
    }
  })

  it('hangs each strake at least 125 mm off the ground, deepest at the tail', () => {
    const pos = u.strakes.getAttribute('position')
    let low = Infinity
    for (let i = 0; i < pos.count; i++) low = Math.min(low, pos.getY(i))
    expect(low).toBeGreaterThan(0.125)
    for (const s of strakes) {
      const tail = tailZ(s.x)
      expect(centreY(tail) + sheet - s.low).toBeGreaterThan(0.18)
    }
  })

  it('runs the diffuser at 11 degrees in the centre', () => {
    const slope = (centreY(-2.2) - centreY(-2.0)) / 0.2
    expect((Math.atan(slope) * 180) / Math.PI).toBeCloseTo(11, 1)
  })
})
