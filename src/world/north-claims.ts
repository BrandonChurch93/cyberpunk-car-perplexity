export const northSector = { from: -40, to: 115, inner: 95 } as const

export function northSkylineClaims(x: number, z: number, width: number, depth: number): boolean {
  const reach = Math.hypot(width, depth) * .5
  if (Math.hypot(x, z) - reach < northSector.inner) return false
  const azimuth = Math.atan2(x, z) * 180 / Math.PI
  return azimuth > northSector.from && azimuth < northSector.to
}
