import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { dims } from '../src/vehicle/body/shape'
import { openEdges, windingAgreement } from './vehicle-rear-mesh'
import { centreY, floorY, meshZ, sheet, strakes, tailZ, underbody, valance } from '../src/vehicle/parts/diffuser'
import { buildBody } from '../src/vehicle/body/body'
import { mainLoft } from '../src/vehicle/body/shape'
import { bumper, cornerCut, cornerFront, rearFace } from '../src/vehicle/body/tail'
import { outlets } from '../src/vehicle/parts/outlets'
import { taillamps } from '../src/vehicle/parts/taillamps'
import { engineBay } from '../src/vehicle/parts/enginebay'

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

describe('rear module', () => {
  const body = buildBody({ maxEdge: 0.08, maxAngle: 0.2, tolerance: 0.0025, edgeLength: 0.007 })
  const c = body.cuts.curves
  const ex = outlets(body.cuts.maps.rear, c.surround)
  const tl = taillamps(body.cuts.maps.rear, [c.stem, c.lampU, c.lampL, c.chev], c.lens, c.slot)
  const va = valance(c.lower, body.cuts.maps.rear)
  const bay = engineBay(c.bay, 0.02)
  const closed: Array<[string, THREE.BufferGeometry]> = [
    ['outlet lip', ex.lip], ['outlet pipes', ex.pipes], ['outlet back', ex.soot], ['outlet housing', ex.housing],
    ['lamp guide', tl.guide], ['lamp housing', tl.housing], ['valance wall', va.wall],
    ['bay covers', bay.covers], ['bay carbon', bay.carbon], ['plenum', bay.center], ['bay mesh', bay.mesh],
    ['airbox grille', bay.grille], ['grille bezel', bay.bezel], ['grille duct', bay.duct], ['grille ledge', bay.ledge],
  ]

  it.each(closed)('builds the %s as a closed solid wound outward', (_, g) => {
    expect(windingAgreement(g)).toBe(1)
    expect(openEdges(g, 1e-6)).toBe(0)
  })

  it('meets the loft at the deck edge and the side, and stays level across the centre line', () => {
    const loft = mainLoft()
    const F = rearFace(loft)
    const vK3 = loft.vAt[3]
    for (let i = 0; i <= 10; i++) {
      const t = i / 10
      const side = F(0, t)
      const want = loft.at(1, vK3 * t)
      const top = F(t, 1)
      const deck = loft.at(1, vK3 + t * (1 - vK3))
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(side[k] - want[k])).toBeLessThan(1e-6)
        expect(Math.abs(top[k] - deck[k])).toBeLessThan(1e-6)
      }
      const mid = F(1, t)
      const near = F(0.98, t)
      expect(Math.abs(mid[0])).toBeLessThan(1e-9)
      expect(Math.abs((near[2] - mid[2]) / near[0])).toBeLessThan(0.05)
    }
  })

  it('keeps the outlets inside the tail and the heat at their mouths, facing the rear', () => {
    expect(ex.normal[2]).toBeLessThan(-0.9)
    expect(ex.center[0]).toBeGreaterThan(0.05)
    expect(ex.center[0]).toBeLessThan(0.3)
    expect(ex.center[1]).toBeGreaterThan(0.6)
    expect(ex.center[1]).toBeLessThan(0.95)
    for (const g of [ex.lip, ex.pipes, ex.soot, ex.housing, tl.guide, tl.housing]) {
      g.computeBoundingBox()
      expect(g.boundingBox!.min.z).toBeGreaterThan(-dims.halfLength - 0.005)
      expect(g.boundingBox!.max.x).toBeLessThan(dims.width / 2)
    }
  })

  it('keeps every bay part under the deck and inside the opening', () => {
    for (const g of [bay.covers, bay.carbon, bay.center, bay.mesh, bay.grille, bay.bezel, bay.duct]) {
      const pos = g.getAttribute('position')
      for (let i = 0; i < pos.count; i += 7) {
        const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)]
        const uv = body.cuts.maps.main.invert('y', z, Math.abs(x), [0, 1, 0.45, 1])
        expect(y).toBeLessThan(body.cuts.maps.main.S(uv[0], uv[1])[1] - 0.01)
      }
    }
    expect(bay.grilleNormal[1]).toBeGreaterThan(0.9)
  })
  it('opens the corners behind the rear wheels below the bumper and nowhere else', () => {
    expect(cornerCut([0.8, 0.3, -2.2])).toBeGreaterThan(0.02)
    expect(cornerCut([-0.8, bumper - 0.05, cornerFront - 0.1])).toBeGreaterThan(0)
    expect(cornerCut([0.3, 0.3, -2.2])).toBeLessThan(0)
    expect(cornerCut([0.8, bumper + 0.02, -2.2])).toBeLessThan(0)
    expect(cornerCut([0.8, 0.3, cornerFront + 0.05])).toBeLessThan(0)
  })

  it('sets the lower mesh well back inside the opening, under the bumper', () => {
    va.panel.computeBoundingBox()
    const box = va.panel.boundingBox!
    expect(box.max.y).toBeLessThan(bumper + 0.01)
    expect(box.max.x).toBeLessThan(0.62)
    const pos = va.panel.getAttribute('position')
    for (let i = 0; i < pos.count; i += 11) {
      if (Math.abs(pos.getX(i)) < 0.55) expect(pos.getZ(i)).toBeGreaterThan(meshZ - 0.01)
    }
    expect(meshZ - (-dims.halfLength)).toBeGreaterThan(0.25)
  })
})
