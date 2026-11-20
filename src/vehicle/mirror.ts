import * as T from 'three'
import { add, blend, curve, joined, mix, patch, polygon, smooth, tau, vec, type Point } from './geometry'
import type { Palette } from './materials'

export function addMirrors(parent: T.Group, m: Palette, full: boolean, far: number, sill: Point, zAt: (s: number) => number): void {
  const crown: T.BufferGeometry[] = [], lower: T.BufferGeometry[] = [], stems: T.BufferGeometry[] = []
  const gaskets: T.BufferGeometry[] = [], glass: T.BufferGeometry[] = []
  const left = .895, centerX = 1.013, rearZ = zAt(.367)
  const waist = (x: number) => mix(.841, .853, smooth(x, left, far))
  const upper: Point[] = [[left, waist(left), zAt(.354)], [.920, .871, zAt(.357)], [.966, .891, zAt(.362)],
    [1.048, .890, zAt(.373)], [far - .009, .877, zAt(.378)], [far, waist(far), zAt(.377)]]
  const under: Point[] = [[left, waist(left), zAt(.354)], [.921, .812, zAt(.359)], [.961, .792, zAt(.365)],
    [1.060, .800, zAt(.374)], [far - .006, .819, zAt(.379)], [far, waist(far), zAt(.377)]]
  const arcs = [new T.CatmullRomCurve3(upper.map(vec)), new T.CatmullRomCurve3(under.map(vec))]
  const spindle = curve([[0, .980], [.09, 1], [.17, 1], [.42, .94], [.68, .79], [.86, .57], [.96, .33], [1, 0]])
  const rise = curve([[0, .95], [.09, 1], [.40, .94], [.69, .79], [.87, .59], [.96, .36], [1, 0]])
  const shell = (i: number, u: number, v: number): Point => {
    const sign = i ? -1 : 1
    const q = arcs[i].getPoint(u)
    const seat = i ? .0015 * (1 - smooth(v, .70, 1)) : 0
    const x = Math.min(centerX + (q.x - centerX) * (spindle(v) - seat / .120) - .025 * smooth(v, .19, 1), far)
    const y = mix(waist(q.x), .849, smooth(v, .3, 1)) + (q.y - waist(q.x)) * rise(v)
      + sign * .00135 * (1 - smooth(v, .94, 1))
    const z = mix(q.z, rearZ, smooth(v, .05, 1)) + (zAt(.338) - rearZ) * (.80 * v + .20 * smooth(v, 0, 1))
    return [x, y, z]
  }
  const columns = full ? 42 : 24, rows = full ? 36 : 18
  for (const side of [1, -1]) {
    const sided = (p: Point): Point => [p[0] * side, p[1], p[2]]
    for (const i of [0, 1]) {
      const geo = patch((u, v) => sided(shell(i, u, v)), columns, rows, [0, i ? -1 : 1, .15])
      const norm = geo.getAttribute('normal')
      for (let j = rows * (columns + 1); j < (rows + 1) * (columns + 1); j++) norm.setXYZ(j, 0, 0, 1)
      ;(i ? lower : crown).push(geo)
    }
    for (const e of [0, 1]) {
      gaskets.push(patch((u, v) => sided(blend(shell(0, e, u), shell(1, e, u), v)),
        rows, 2, [side * (e ? 1 : -1), 0, 0]))
    }
    const sample = (i: number, u: number): Point => shell(i, u, 0)
    const opening = [
      ...Array.from({ length: columns + 1 }, (_, j) => sample(0, j / columns)),
      ...Array.from({ length: columns + 1 }, (_, j) => sample(1, 1 - j / columns)),
    ]
    const center: Point = [centerX, .846, rearZ]
    const rim = (u: number) => {
      const t = u * opening.length, i = Math.floor(t) % opening.length
      return blend(opening[i], opening[(i + 1) % opening.length], t % 1)
    }
    const paneDepth = curve([[left, zAt(.354)], [.935, zAt(.360)], [1.003, zAt(.368)], [1.061, zAt(.374)], [far, zAt(.378)]])
    const panePoint = (u: number, v: number): Point => {
      const p = rim(u)
      const x = mix(center[0], p[0], .848 * v), y = mix(center[1], p[1], .836 * v)
      return [x, y, paneDepth(x) - .004 + .0016 * ((y - center[1]) / .047) ** 2]
    }
    gaskets.push(patch((u, v) => sided(blend(rim(u), panePoint(u, 1), v)),
      opening.length, 5, [0, 0, -1]))
    gaskets.push(polygon(opening.map(([x, y, z]) => sided([x, y, z + .024])), [0, 0, -1], .006))
    const pane = patch((u, v) => sided(panePoint(u, v)), opening.length, full ? 12 : 7, [0, 0, -1], .0018)
    const paneNormals = pane.getAttribute('normal')
    const normal = vec([side * (paneDepth(centerX + .001) - paneDepth(centerX - .001)) / .002, 0, -1]).normalize()
    for (let j = 0; j <= opening.length; j++) paneNormals.setXYZ(j, normal.x, normal.y, normal.z)
    glass.push(pane)
    const stem = new T.CatmullRomCurve3([
      [sill[0] - .030, sill[1] - .022, sill[2] - .012],
      [sill[0] + .009, sill[1] - .008, sill[2] - .012],
      [.908, .792, zAt(.354)], [.954, .814, zAt(.354)], [.997, .842, zAt(.352)],
    ].map(([x, y, z]) => new T.Vector3(x, y, z)), false, 'centripetal')
    const stemDepth = curve([[0, .027], [.29, .031], [.69, .021], [1, .025]])
    const stemRise = curve([[0, .013], [.28, .012], [.74, .007], [1, .014]])
    stems.push(patch((u, v) => {
      const p = stem.getPoint(u), t = stem.getTangent(u)
      const cos = Math.cos(tau * v)
      const seat = 1 - .92 * smooth(u, .90, 1)
      const h = stemRise(u) * Math.sin(tau * v) * (.86 - .24 * cos) * seat
      return sided([p.x - t.y * h, p.y + t.x * h, p.z + stemDepth(u) * cos * seat])
    }, full ? 34 : 18, full ? 24 : 14, [0, 0, -1]))
  }
  const undersideFinish = m.tag(m.diffuser.clone(), 'sheet')
  undersideFinish.color.setHex(full ? 0x292d32 : 0x51555b)
  undersideFinish.roughness = .35
  const group = new T.Group()
  group.name = 'door mirrors'
  add(group, 'painted upper mirror wings', joined(crown), m.paint)
  add(group, 'lower mirror shells', joined(lower), undersideFinish)
  add(group, 'mirror blade stalks', joined(stems), m.matte)
  add(group, 'mirror shell seam and rear gaskets', joined(gaskets), m.dark)
  add(group, 'mirror glass', joined(glass), m.mirror)
  parent.add(group)
}
