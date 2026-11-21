import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { dims } from '../src/vehicle/body/shape'
import { openEdges, windingAgreement } from './vehicle-rear-mesh'
import { centreY, floorY, meshZ, sheet, strakes, tailZ, underbody, valance } from '../src/vehicle/parts/diffuser'
import { buildBody } from '../src/vehicle/body/body'
import { mainLoft } from '../src/vehicle/body/shape'
import { bumper, cornerCut, cornerFront, lensEdge, rearFace } from '../src/vehicle/body/tail'
import { lampWrap } from '../src/vehicle/body/cuts'
import { createVehicle } from '../src/vehicle'
import { defaultPaint, paintById } from '../src/config'
import { outlets } from '../src/vehicle/parts/outlets'
import { taillamps } from '../src/vehicle/parts/taillamps'
import { engineBay, grilleFrame } from '../src/vehicle/parts/enginebay'

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

  it('hangs each strake at least 125 mm off the ground, climbing to 150 to 160 mm at the exit, deepest at the tail', () => {
    const pos = u.strakes.getAttribute('position')
    let low = Infinity
    let exitLow = Infinity
    for (let i = 0; i < pos.count; i++) {
      low = Math.min(low, pos.getY(i))
      if (pos.getZ(i) < -2.3) exitLow = Math.min(exitLow, pos.getY(i))
    }
    expect(low).toBeGreaterThan(0.125)
    expect(exitLow).toBeGreaterThan(0.15)
    for (const s of strakes) {
      expect(s.exit).toBeGreaterThan(s.toe)
      expect(s.exit).toBeLessThanOrEqual(0.16)
      expect(centreY(tailZ(s.x)) + sheet - s.exit).toBeGreaterThan(0.17)
    }
  })

  it('keeps the inner strakes wedge shaped, shallow at the toe so the gaps between them stay open', () => {
    for (const s of strakes.filter((k) => k.rise)) {
      const foot = s.lead - s.rake
      expect(centreY(foot) + sheet - s.toe).toBeLessThan(0.6 * (centreY(tailZ(s.x)) + sheet - s.exit))
    }
  })

  it('runs the diffuser at 11 degrees in the centre', () => {
    const slope = (centreY(-2.2) - centreY(-2.0)) / 0.2
    expect((Math.atan(slope) * 180) / Math.PI).toBeCloseTo(11, 1)
  })
  it('spaces the strakes evenly, below the plate except where they rise through the open tail in front of the mesh', () => {
    const gaps = strakes.slice(1).map((s, i) => s.x - strakes[i].x)
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6)
    expect(strakes[0].x).toBeCloseTo(gaps[0], 6)
    const pos = u.strakes.getAttribute('position')
    let risen = 0
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < centreY(pos.getZ(i)) + sheet + 0.006) continue
      risen++
      expect(pos.getZ(i)).toBeLessThan(meshZ)
      expect(pos.getY(i)).toBeLessThan(bumper + 0.006)
      expect(Math.abs(pos.getX(i))).toBeLessThan(0.6)
    }
    expect(risen).toBeGreaterThan(0)
  })

  it('leaves the corner open outboard of the outer strakes behind the rear tyre', () => {
    const pos = u.floor.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) < cornerFront) expect(Math.abs(pos.getX(i))).toBeLessThan(strakes[strakes.length - 1].x + 0.01)
    }
  })
})

describe('rear module', () => {
  const body = buildBody({ maxEdge: 0.08, maxAngle: 0.2, tolerance: 0.0025, edgeLength: 0.007 })
  const c = body.cuts.curves
  const ex = outlets(body.cuts.maps.rear, c.surround)
  const tl = taillamps(body.cuts.maps.rear, [c.stem, c.lampU, c.lampL], c.lens, c.slot, { map: body.cuts.maps.main, curve: c.lampWrap })
  const va = valance(c.lower, body.cuts.maps.rear)
  const bay = engineBay(c.bay, 0.02)
  const closed: Array<[string, THREE.BufferGeometry]> = [
    ['outlet lip', ex.lip], ['outlet pipes', ex.pipes], ['outlet back', ex.soot], ['outlet housing', ex.housing],
    ['lamp guide', tl.guide], ['lamp housing', tl.housing], ['lamp reflector', tl.reflector], ['lamp optic', tl.optic], ['valance wall', va.wall],
    ['bay covers', bay.covers], ['bay carbon', bay.carbon], ['plenum', bay.center], ['bay mesh', bay.mesh],
    ['airbox grille', bay.grille], ['grille bezel', bay.bezel], ['grille duct', bay.duct], ['bay core', bay.core], ['grille ledge', bay.ledge], ['bay shelf', bay.shelf],
    ['intake hose', bay.hose], ['hose clamp', bay.clamp],
  ]

  it.each(closed)('builds the %s as a closed solid wound outward', (_, g) => {
    expect(windingAgreement(g)).toBe(1)
    expect(openEdges(g, 1e-6)).toBe(0)
  })

  const ub = underbody()
  const every: Array<[string, THREE.BufferGeometry]> = [...closed, ['diffuser floor', ub.floor], ['diffuser strakes', ub.strakes], ['valance panel', va.panel], ['bay tub', bay.tub]]
  it.each(every)('leaves no triangle of the %s without area', (_, g) => {
    const p = g.getAttribute('position')
    const ix = g.getIndex()!
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    let zero = 0
    for (let t = 0; t < ix.count; t += 3) {
      const [i, j, k] = [ix.getX(t), ix.getX(t + 1), ix.getX(t + 2)]
      a.fromBufferAttribute(p, i)
      b.fromBufferAttribute(p, j).sub(a)
      c.fromBufferAttribute(p, k).sub(a)
      if (i === j || j === k || i === k || b.cross(c).length() / 2 < 1e-12) zero++
    }
    expect(zero).toBe(0)
  })

  it.each(closed)('gives every vertex of the %s a unit normal', (_, g) => {
    const n = g.getAttribute('normal')
    for (let i = 0; i < n.count; i++) expect(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1)).toBeLessThan(1e-4)
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

  it('sets the reflector into the slot behind the paint flange', () => {
    const pos = tl.reflector.getAttribute('position')
    const rm = body.cuts.maps.rear
    for (let i = 0; i < pos.count; i += 7) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const [uu, vv] = rm.invert('-z', x, y)
      expect(pos.getZ(i)).toBeGreaterThan(rm.S(uu, vv)[2] + 0.012)
    }
  })

  it('runs the lamp lens off the tail edge at the corner hole heights and the guide round the corner', () => {
    expect(lensEdge.top).toBe(lampWrap.top)
    expect(lensEdge.bottom).toBe(lampWrap.bottom)
    const edge = c.lens.p.filter((_, i) => c.lens.uv[i][0] < 1e-4).map((p) => p[1])
    expect(Math.min(...edge)).toBeCloseTo(lampWrap.bottom, 3)
    expect(Math.max(...edge)).toBeCloseTo(lampWrap.top, 3)
    for (const g of [tl.guide, tl.housing]) {
      g.computeBoundingBox()
      expect(g.boundingBox!.max.x).toBeGreaterThan(lampWrap.outX - 0.03)
    }
  })

  it('keeps every bay part under the deck and inside the opening', () => {
    for (const g of [bay.covers, bay.carbon, bay.center, bay.mesh, bay.grille, bay.bezel, bay.duct, bay.core, bay.ledge, bay.shelf, bay.hose, bay.clamp]) {
      const pos = g.getAttribute('position')
      for (let i = 0; i < pos.count; i += 7) {
        const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)]
        const uv = body.cuts.maps.main.invert('y', z, Math.abs(x), [0, 1, 0.45, 1])
        expect(y).toBeLessThan(body.cuts.maps.main.S(uv[0], uv[1])[1] - 0.01)
      }
    }
    expect(bay.grilleNormal[1]).toBeGreaterThan(0.9)
  }, 30000)

  it('runs the carbon brace the length of the bay with its weave at 3.5 mm tows', () => {
    const pos = bay.carbon.getAttribute('position')
    const uv = bay.carbon.getAttribute('uv')
    let zMin = Infinity
    let zMax = -Infinity
    let uMax = 0
    for (let i = 0; i < pos.count; i++) {
      zMin = Math.min(zMin, pos.getZ(i))
      zMax = Math.max(zMax, pos.getZ(i))
      uMax = Math.max(uMax, uv.getX(i))
    }
    expect(zMax - zMin).toBeGreaterThan(1.1)
    expect(uMax).toBeCloseTo((zMax - zMin) / 0.995 / (620 * 0.0035), 1)
  })

  it('sinks the airbox well deep enough that the grille cells read open', () => {
    bay.duct.computeBoundingBox()
    bay.grille.computeBoundingBox()
    expect(bay.grille.boundingBox!.min.y - bay.duct.boundingBox!.min.y).toBeGreaterThan(0.06)
  })
  it('hangs the louvred core inside the well, clear of the grille and above the floor', () => {
    const f = grilleFrame(1)
    const pos = bay.core.getAttribute('position')
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < pos.count; i++) {
      const d = (pos.getX(i) - f.c[0]) * f.n[0] + (pos.getY(i) - f.c[1]) * f.n[1] + (pos.getZ(i) - f.c[2]) * f.n[2]
      lo = Math.min(lo, d)
      hi = Math.max(hi, d)
    }
    expect(hi).toBeLessThan(-0.02)
    expect(lo).toBeGreaterThan(-0.073)
    expect(pos.count).toBeGreaterThan(400)
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

describe('anisotropic tangent frames', () => {
  const known = new Set(['cabin-carbon', 'front rolled splitter'])
  it('keeps tangent and bitangent apart on every face of every anisotropic vehicle material', async () => {
    const v = await createVehicle({ paint: paintById(defaultPaint), detail: 'full' })
    const e1 = new THREE.Vector3()
    const e2 = new THREE.Vector3()
    const t = new THREE.Vector3()
    const b = new THREE.Vector3()
    const bad: string[] = []
    v.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || known.has(o.name)) return
      const mat = o.material as THREE.MeshPhysicalMaterial
      if (!(mat.anisotropy > 0)) return
      const g = o.geometry as THREE.BufferGeometry
      const p = g.getAttribute('position')
      const uv = g.getAttribute('uv')
      const idx = g.getIndex()
      if (!uv) return void bad.push(`${o.name} has no uv`)
      const n = idx ? idx.count : p.count
      for (let f = 0; f < n; f += 3) {
        const [i0, i1, i2] = [0, 1, 2].map((k) => (idx ? idx.getX(f + k) : f + k))
        e1.set(p.getX(i1) - p.getX(i0), p.getY(i1) - p.getY(i0), p.getZ(i1) - p.getZ(i0))
        e2.set(p.getX(i2) - p.getX(i0), p.getY(i2) - p.getY(i0), p.getZ(i2) - p.getZ(i0))
        if (t.copy(e1).cross(e2).length() < 1e-12) continue
        const du1 = uv.getX(i1) - uv.getX(i0)
        const dv1 = uv.getY(i1) - uv.getY(i0)
        const du2 = uv.getX(i2) - uv.getX(i0)
        const dv2 = uv.getY(i2) - uv.getY(i0)
        if (Math.abs(du1 * dv2 - du2 * dv1) < 1e-14) continue
        t.copy(e1).multiplyScalar(dv2).addScaledVector(e2, -dv1).normalize()
        b.copy(e2).multiplyScalar(du1).addScaledVector(e1, -du2).normalize()
        if (Math.abs(t.dot(b)) > 0.9) bad.push(`${o.name} face ${f / 3}`)
      }
    })
    expect(bad.slice(0, 8)).toEqual([])
  }, 120000)
})
