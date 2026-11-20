import * as T from 'three'
import { describe, expect, it } from 'vitest'
import { frontCheek, frontWheel, sAt } from '../src/vehicle/body'
import { trimmedFrontSkin, type UV } from '../src/vehicle/front-domain'

const rect = (x0: number, y0: number, x1: number, y1: number): UV[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

describe('trimmed front skin', () => {
  it.each([-1, 1])('trims overlapping cuts without winding flips or cracks on side %s', side => {
    const { skin, lip } = trimmedFrontSkin((u, y) => [side * (.7 + .02 * u * u + .04 * y * y), y, 1 - u],
      rect(0, 0, 1, 1), [rect(.2, .15, .5, .55), rect(.4, .35, .7, .75)], [0, .125, .25, .5, .75, 1], .079,
      side, () => true)
    const { position, normal } = skin.attributes, index = skin.getIndex()!
    const borders = new Map<string, number>(), degree = new Map<number, number>()
    const point = (i: number) => new T.Vector3().fromBufferAttribute(position, i)
    let area = 0
    for (let i = 0; i < index.count; i += 3) {
      const face = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
      const [a, b, c] = face.map(point)
      const cross = b.sub(a).cross(c.sub(a))
      expect(cross.x * side).toBeGreaterThan(0)
      area += cross.x * side / 2
      for (let j = 0; j < 3; j++) {
        const ends = [face[j], face[(j + 1) % 3]].sort((a, b) => a - b).join(':')
        borders.set(ends, (borders.get(ends) ?? 0) + 1)
      }
    }
    expect(area).toBeCloseTo(.78, 6)
    for (const [edge, count] of borders) {
      expect(count).toBeLessThanOrEqual(2)
      if (count === 1) for (const i of edge.split(':').map(Number)) degree.set(i, (degree.get(i) ?? 0) + 1)
    }
    const { position: lipPosition, normal: lipNormal } = lip.attributes
    expect(lipPosition.count).toBe(degree.size * 5)
    const lipStarts = new Map<string, T.Vector3>()
    const key = (p: T.Vector3) => p.toArray().join(',')
    for (let i = 0; i < lipPosition.count; i += 5) {
      const p = new T.Vector3().fromBufferAttribute(lipPosition, i)
      lipStarts.set(key(p), new T.Vector3().fromBufferAttribute(lipNormal, i))
    }
    for (const [i, count] of degree) {
      expect(count).toBe(2)
      expect(lipStarts.get(key(point(i)))?.distanceTo(new T.Vector3().fromBufferAttribute(normal, i))).toBeLessThan(1e-6)
    }
  })

  it('holds the position, tangent and curvature across the former front arch join', () => {
    const join = sAt(frontWheel.z + frontWheel.arch)
    const h = .00004
    for (const y of [.260, .340, .460, .580, .690, .735]) {
      const x = (s: number) => frontCheek(s, y, 1)[0]
      const left = (x(join) - x(join - h)) / h, right = (x(join + h) - x(join)) / h
      const d2 = (s: number) => (x(s + h) - 2 * x(s) + x(s - h)) / (h * h)
      expect(Math.abs(left - right)).toBeLessThan(.009)
      expect(Math.abs(d2(join + h) - d2(join - h))).toBeLessThan(1.1)
    }
  })
})
