import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { config, paintById } from '../src/config'
import { stateAt } from '../src/director/timeline'
import { createVehicle } from '../src/vehicle'

describe('vehicle module', () => {
  it('builds blockout and full vehicles within factory dimensions and triangle budgets', async () => {
    const blockout = await createVehicle({ paint: config.paint.candidates[0], detail: 'blockout' })
    const full = await createVehicle({ paint: config.paint.candidates[0], detail: 'full' })

    const measure = (root: THREE.Object3D): { tris: number; fullBox: THREE.Box3; bodyBox: THREE.Box3 } => {
      root.updateWorldMatrix(true, true)
      const fullBox = new THREE.Box3()
      const bodyBox = new THREE.Box3()
      const v = new THREE.Vector3()
      let tris = 0
      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return
        const geom = obj.geometry as THREE.BufferGeometry
        const pos = geom.getAttribute('position')
        if (!pos) return
        const idx = geom.getIndex()
        tris += idx ? idx.count / 3 : pos.count / 3
        let isMirror = false
        let cur: THREE.Object3D | null = obj
        while (cur) {
          if (cur.name.includes('mirror')) isMirror = true
          cur = cur.parent
        }
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld)
          fullBox.expandByPoint(v)
          if (!isMirror) bodyBox.expandByPoint(v)
        }
      })
      return { tris, fullBox, bodyBox }
    }

    const bStat = measure(blockout.root)
    const fStat = measure(full.root)

    expect(bStat.tris).toBeGreaterThan(20_000)
    expect(bStat.tris).toBeLessThanOrEqual(400_000)
    expect(fStat.tris).toBeGreaterThan(bStat.tris)
    expect(fStat.tris).toBeLessThanOrEqual(2_000_000)

    const fullSize = fStat.fullBox.getSize(new THREE.Vector3())
    const bodySize = fStat.bodyBox.getSize(new THREE.Vector3())
    expect(Math.abs(fullSize.z - 4.947)).toBeLessThan(0.03)
    expect(Math.abs(fullSize.x - 2.266)).toBeLessThan(0.03)
    expect(Math.abs(bodySize.x - 2.033)).toBeLessThan(0.03)
    expect(Math.abs(fullSize.y - 1.16)).toBeLessThan(0.02)
    expect(Math.abs(fStat.fullBox.min.y)).toBeLessThan(0.006)
  })

  it('exposes valid anchors, lamps, heat sources, paint switching, and periodic loop state', async () => {
    const vehicle = await createVehicle({ paint: paintById('black-pearl'), detail: 'full' })

    for (const id of ['paint', 'wheel', 'lamp', 'detail', 'exhaust'] as const) {
      const a = vehicle.anchors[id]
      expect(a.radius).toBeGreaterThan(0.1)
      expect(Math.abs(a.normal.length() - 1)).toBeLessThan(1e-4)
    }

    const beams = vehicle.lamps.filter((l) => l.beam)
    expect(beams.length).toBeGreaterThan(0)
    expect(beams.length).toBeLessThanOrEqual(4)
    expect(vehicle.heatSources.length).toBe(2)
    expect(vehicle.surfaces.length).toBeGreaterThanOrEqual(8)

    const tWake = 7.5
    const sWake = stateAt(tWake)
    vehicle.update({ timeSeconds: tWake, lampStage: sWake.lampStage, engine: sWake.engine, vibration: sWake.vibration })
    for (const lamp of vehicle.lamps) {
      expect(lamp.level).toBeDefined()
      expect(lamp.level).toBeGreaterThanOrEqual(0)
      expect(lamp.level).toBeLessThanOrEqual(1)
    }
    expect(beams[0].level).toBeGreaterThan(0.95)

    const s0 = stateAt(0)
    vehicle.update({ timeSeconds: 0, lampStage: s0.lampStage, engine: s0.engine, vibration: s0.vibration })
    const startMatrix = vehicle.root.children[0].matrix.clone()

    const dur = config.film.durationSeconds
    const sEnd = stateAt(dur)
    vehicle.update({ timeSeconds: dur, lampStage: sEnd.lampStage, engine: sEnd.engine, vibration: sEnd.vibration })
    vehicle.root.updateMatrixWorld(true)
    for (let i = 0; i < 16; i++) {
      expect(vehicle.root.children[0].matrix.elements[i]).toBeCloseTo(startMatrix.elements[i], 6)
    }

    vehicle.setPaint(paintById('ember-orange'))
    const paintMat = vehicle.surfaces[0].material as THREE.MeshPhysicalMaterial
    expect(paintMat.color.r).toBeGreaterThan(paintMat.color.b)
  })
})
