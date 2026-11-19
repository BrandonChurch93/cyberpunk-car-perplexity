import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { config } from '../src/config'
import { beadLayers, capHeight, cellDrops } from '../src/weather/surface/beads'
import { capTemplate } from '../src/weather/surface/drop-geometry'
import { surfHash3 } from '../src/weather/surface/hash'
import { heroBasin, SyntheticRelief } from '../src/weather/surface/relief'
import { RippleField } from '../src/weather/surface/ripples'

describe('surface water', () => {
  it('hashes the same way every time and spreads values over 0 to 1', () => {
    expect(surfHash3(3, -7, 2, 101)).toEqual(surfHash3(3, -7, 2, 101))
    let sum = 0
    for (let i = 0; i < 2000; i++) sum += surfHash3(i, i * 3, 1, 5)[0]
    expect(sum / 2000).toBeGreaterThan(0.45)
    expect(sum / 2000).toBeLessThan(0.55)
  })

  it('keeps every drop inside its own cell', () => {
    const bead = { contactDegrees: 100, salt: 118 }
    for (let layer = 0; layer < beadLayers.length; layer++) {
      const cell = beadLayers[layer].cellMm / 1000
      for (let i = 0; i < 400; i++) {
        for (const d of cellDrops(layer, i, -i, 1, bead, 1, 0.3)) {
          const extent = d.radius * (1 + 1.1 * 0.3)
          expect(d.u - extent).toBeGreaterThanOrEqual(i * cell - 1e-9)
          expect(d.u + extent).toBeLessThanOrEqual((i + 1) * cell + 1e-9)
        }
      }
    }
  })

  it('beads stand up on paint and flatten when large', () => {
    expect(capHeight(0.0005, 100)).toBeGreaterThan(0.0005)
    expect(capHeight(0.006, 100)).toBeLessThan(0.0035)
    const cap = capTemplate(100, 6, 12)
    cap.computeBoundingBox()
    expect(cap.boundingBox!.max.y).toBeCloseTo(1, 5)
    expect(cap.boundingBox!.max.x).toBeGreaterThan(1)
  })

  it('puts a puddle between the opening camera and the vehicle and keeps the ground under the vehicle dry', () => {
    const bounds = new THREE.Box2(new THREE.Vector2(-40, -40), new THREE.Vector2(40, 40))
    const hero = heroBasin(new THREE.Vector2(0, 0), new THREE.Vector2(2.5, 7))
    const relief = new SyntheticRelief({ bounds, basins: [hero], keepDry: [new THREE.Box2(new THREE.Vector2(-1, -2.4), new THREE.Vector2(1, 2.4))] })
    expect(relief.heightMm(hero.center.x, hero.center.y)).toBeLessThan(-1)
    expect(relief.heightMm(0, 0)).toBeGreaterThan(0)
  })

  it('ripples repeat over the film', () => {
    const a = new RippleField()
    const b = new RippleField()
    const center = new THREE.Vector2(1, 3)
    a.update(2, 2.02, center)
    b.update(2 + config.film.durationSeconds, 2.02 + config.film.durationSeconds, center)
    let same = true
    for (let i = 0; i < a.data.length; i += 997) if (Math.abs(a.data[i] - b.data[i]) > 1e-3) same = false
    expect(same).toBe(true)
    expect(Array.from(a.counts).some((c) => c > 0)).toBe(true)
  })
})
