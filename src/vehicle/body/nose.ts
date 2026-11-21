import type { Loft } from '../geom/loft'
import { projectCurve, smin, type SurfaceCurve, type SurfaceMap } from '../geom/cuts'
import { mix, type V3 } from '../geom/vec'
import type { Cuts } from './cuts'
import { elev, map } from './lines'

export function frontFace(loft: Loft): (a: number, b: number) => V3 {
  const split = loft.vAt[3]
  const base = loft.at(0, 0)
  const cheek = loft.at(0, split)
  const tip = loft.at(0, 1)
  const setback = .109
  const centerZ = tip[2] - setback
  const rise = setback / (tip[1] - base[1])
  const hub = lines.drlLower[0]
  const upper = lines.drlUpper[0], lower = lines.drlLower.at(-1)!, stem = lines.drlStem.at(-1)!
  const upperSlope = (upper[0] - hub[0]) / (upper[1] - hub[1])
  const lowerSlope = (lower[0] - hub[0]) / (hub[1] - lower[1])
  const stemSlope = (stem[1] - hub[1]) / (stem[0] - hub[0])
  const angle = .45
  const outerHigh = -angle * (1 + lowerSlope * stemSlope) / (lowerSlope + upperSlope)
  const outerLow = outerHigh + angle * stemSlope
  const cutsAt = (x: number, y: number) => {
    const dx = x - hub[0], dy = y - hub[1]
    return [-angle * (dy - stemSlope * dx), outerLow * (dx + lowerSlope * dy)]
  }
  const shieldWidth = (y: number) => .17 + .49 * (y - base[1])
  const intakeSweep = (centerZ + Math.min(0, ...cutsAt(base[0], base[1])) - base[2]) / (base[0] - shieldWidth(base[1]))
  const baseZ = (x: number, y: number) => {
    const shield = centerZ + rise * (y - base[1])
    const intake = shield - intakeSweep * (x - shieldWidth(y))
    const [top, cheek] = cutsAt(x, y)
    return smin(shield, smin(intake, smin(intake + top, intake + cheek, .0026), .0026), .0035)
  }
  const cheekResidual = cheek[2] - baseZ(cheek[0], cheek[1])
  const railAt = (a: number) => loft.at(0, mix(1, split, a))
  const count = 14
  const residuals = Array.from({ length: count + 1 }, (_, i) => {
    let lo = 0, hi = 1
    const x = cheek[0] * i / count
    for (let j = 0; j < 20; j++) {
      const m = (lo + hi) / 2
      if (railAt(m)[0] < x) lo = m
      else hi = m
    }
    const [px, y, z] = railAt(i === 0 ? 0 : i === count ? 1 : (lo + hi) / 2)
    return z - baseZ(px, y)
  })
  const residualAt = (i: number): number => i < 0 ? 2 * residuals[0] - residuals[1]
    : i > count ? 2 * residuals[count] - residuals[count - 1] : residuals[i]
  const sweep = (x: number) => {
    const q = count * x / cheek[0], i = Math.min(count - 1, Math.floor(q)), t = q - i
    const a = residualAt(i - 1), b = residualAt(i), c = residualAt(i + 1), d = residualAt(i + 2)
    return ((1 - t) ** 3 * a + (4 - 6 * t * t + 3 * t ** 3) * b
      + (1 + 3 * t + 3 * t * t - 3 * t ** 3) * c + t ** 3 * d) / 6
  }
  return (a, b) => {
    if (a === 1) return loft.at(0, split * b)
    const rail = railAt(a)
    if (b === 1) return rail
    const side = loft.at(0, split * b)
    const station = rail[0] / cheek[0]
    const along = station * station
    const x = mix(station * base[0], rail[0], b) + along * (side[0] - mix(base[0], cheek[0], b))
    const y = mix(base[1], rail[1], b) + along * (side[1] - mix(base[1], cheek[1], b))
    const top = rail[2] - baseZ(rail[0], rail[1])
    const broad = sweep(rail[0])
    const outer = side[2] - baseZ(side[0], side[1]) - cheekResidual * b
    // The broad sweep carries the fit without dragging every bonnet crease across the fascia.
    return [x, y, baseZ(x, y) + broad * b + (top - broad) * b ** 6 * (7 - 6 * b) + outer * along * along]
  }
}

const junction: [number, number] = [192, 445]

export const lines = {
  eye: map(elev, [[193, 378], [254, 394], [318, 410], [328, 416], [320, 429], [254, 425], [205, 423], [189, 404]]),
  outerIntake: map(elev, [[218, 490], [318, 490], [424, 480], [481, 469], [461, 522], [416, 615], [329, 620], [235, 620], [208, 557]]),
  centerIntake: map(elev, [[575, 520], [745, 520], [745, 612], [600, 612], [570, 570]]),
  drlUpper: map(elev, [[175, 394], junction]),
  drlLower: map(elev, [junction, [158, 608]]),
  drlStem: map(elev, [junction, [387, 461]]),
}

export function noseCuts(fm: SurfaceMap): { cuts: Cuts; curves: Record<'eye' | 'outer' | 'center' | 'drlU' | 'drlL' | 'drlS', SurfaceCurve> } {
  const eye = projectCurve(fm, 'z', lines.eye, true, 0.005, undefined, false, 0.009)
  const outer = projectCurve(fm, 'z', lines.outerIntake, true, 0.006, undefined, false, 0.02)
  const center = projectCurve(fm, 'z', lines.centerIntake, true, 0.006, undefined, true, 0.02)
  const drlU = projectCurve(fm, 'z', lines.drlUpper, false, 0.004, undefined, false, 0.01)
  const drlL = projectCurve(fm, 'z', lines.drlLower, false, 0.004, undefined, false, 0.01)
  const drlS = projectCurve(fm, 'z', lines.drlStem, false, 0.004, undefined, false, 0.01)
  return {
    cuts: { holes: [{ c: eye, inset: 0 }, { c: outer, inset: 0 }, { c: center, inset: 0 }], gaps: [], glass: [], bands: [{ c: drlU, half: 0.011 }, { c: drlL, half: 0.011 }, { c: drlS, half: 0.011 }] },
    curves: { eye, outer, center, drlU, drlL, drlS },
  }
}
