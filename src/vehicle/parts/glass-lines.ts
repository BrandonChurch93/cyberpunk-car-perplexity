import type { Surface } from '../geom/cuts'
import type { V3 } from '../geom/vec'
import { planLines, sideLines } from '../body/lines'

/** The A pillar and roof rail ridge: the main surface's rail key. */
export const ridgeV = 0.6

/** Glass edges at a constant distance across the surface from the ridge: the screen inboard, the side glass below. */
export const glassLines = { screen: 0.012, dlo: 0.09, step: 0.04 }

/** The point `d` across the surface from the ridge at u, toward the screen for d > 0 and down the side for d < 0. */
export function offRidge(S: Surface, u: number, d: number): V3 {
  const k = 400
  const dv = (Math.sign(d) * 0.3) / k
  let p = S(u, ridgeV)
  let v = ridgeV
  let L = 0
  for (let i = 0; i < k; i++) {
    const q = S(u, v + dv)
    const l = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
    if (L + l >= Math.abs(d)) return S(u, v + (dv * (Math.abs(d) - L)) / l)
    L += l
    v += dv
    p = q
  }
  return p
}

/** The parameter u where the ridge reaches z. */
export function ridgeU(S: Surface, z: number): number {
  let a = 0
  let b = 1
  const z0 = S(0, ridgeV)[2]
  for (let i = 0; i < 50; i++) {
    const m = (a + b) / 2
    if (S(m, ridgeV)[2] > z === z0 > z) a = m
    else b = m
  }
  return (a + b) / 2
}

function run(S: Surface, d: number, z0: number, z1: number, step: number): V3[] {
  const n = Math.max(2, Math.ceil(Math.abs(z1 - z0) / step))
  return Array.from({ length: n + 1 }, (_, i) => offRidge(S, ridgeU(S, z0 + ((z1 - z0) * i) / n), d))
}

/** The windscreen in plan (z, x): the cowl and its round lower corner as drawn, the sides a constant distance inboard of
 * the A pillar ridge from the pillar base to the header, the header as drawn. */
export function screenPlan(S: Surface, g = glassLines): Array<[number, number]> {
  const w = planLines.windscreen
  const side = run(S, g.screen, 1.2, 0.5, g.step).map((p): [number, number] => [p[2], p[0]])
  const top = offRidge(S, ridgeU(S, w[w.length - 1][0]), g.screen)
  return [...w.slice(0, 6), ...side, [w[w.length - 1][0], top[0]], ...w.slice(-2)]
}

/** The side glass in side view (z, y): the front tip, the leading edge and the bottom as drawn, the top a constant
 * distance below the A pillar ridge and roof rail. */
export function dloSide(S: Surface, g = glassLines): Array<[number, number]> {
  const s = sideLines.glass
  const top = run(S, -g.dlo, 1.0, -0.29, g.step).map((p): [number, number] => [p[2], p[1]])
  return [s[0], ...top, ...s.slice(11)]
}
