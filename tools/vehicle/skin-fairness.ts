import * as body from '../../src/vehicle/body'
import { mix, vec, type Point, type Surface } from '../../src/vehicle/geometry'

interface SkinProbe {
  name: string
  surface: Surface
  crease?: (p: Point) => boolean
}

type BodyProfiles = Pick<typeof body, 'bonnet' | 'bonnetCrease' | 'frontFascia' | 'sidePoint' | 'sideCrease'>

export function skinProbes(profiles: BodyProfiles = body): SkinProbe[] {
  const bonnet = (name: string, s0: number, s1: number, q0: number, q1: number): SkinProbe => ({
    name, surface: (u, v) => profiles.bonnet(mix(s0, s1, u), mix(q0, q1, v)), crease: profiles.bonnetCrease,
  })
  return [
    bonnet('bonnet', .034, .171, .04, .72),
    bonnet('foredeck', .006, .055, .08, .98),
    bonnet('front wing', .074, .248, .72, .996),
    { name: 'fascia', surface: (u, v) => profiles.frontFascia(1, mix(.08, .91, u), mix(.19, .66, v), .019) },
    {
      name: 'door and flank', surface: (u, v) => profiles.sidePoint(mix(.330, .712, u), mix(.21, .72, v), 1),
      crease: profiles.sideCrease,
    },
  ]
}

function normal(surface: Surface, u: number, v: number) {
  const h = .0001
  const du = vec(surface(Math.min(1, u + h), v)).sub(vec(surface(Math.max(0, u - h), v)))
  const dv = vec(surface(u, Math.min(1, v + h))).sub(vec(surface(u, Math.max(0, v - h))))
  return du.cross(dv).normalize()
}

export function samplePatchFairness(probe: SkinProbe) {
  const { surface, crease } = probe
  return ([0, 1] as const).map((axis) => {
    const samples: number[] = []
    let max = 0
    let at: Point | undefined
    for (let row = 1; row < 12; row++) {
      const along = (s: number): [number, number] => axis === 0 ? [s, row / 12] : [row / 12, s]
      const line = Array.from({ length: 101 }, (_, i) => along(i / 100))
      const normals = line.map(([u, v]) => crease?.(surface(u, v)) ? null : normal(surface, u, v))
      for (let i = 2; i < normals.length - 2; i++) {
        const [a, b, c] = [normals[i - 1], normals[i], normals[i + 1]]
        if (a && b && c) {
          const difference = a.clone().add(c).addScaledVector(b, -2).length()
          samples.push(difference)
          if (difference > max) {
            max = difference
            at = surface(...line[i])
          }
        }
      }
    }
    samples.sort((a, b) => a - b)
    return { count: samples.length, p95: samples[Math.floor((samples.length - 1) * .95)], max, at }
  })
}
