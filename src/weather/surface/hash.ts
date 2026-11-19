/** The same hash as `surfHash3` in glsl.ts, so drops placed on the CPU land where the shader expects them. */
export function surfHash3(cx: number, cy: number, cz: number, salt: number): [number, number, number] {
  let x = (cx ^ salt) >>> 0
  let y = (cy ^ Math.imul(salt, 747796405)) >>> 0
  let z = (cz ^ Math.imul(salt, 2891336453 | 0)) >>> 0
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0
  x = (x + Math.imul(y, z)) >>> 0
  y = (y + Math.imul(z, x)) >>> 0
  z = (z + Math.imul(x, y)) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  y = (y ^ (y >>> 16)) >>> 0
  z = (z ^ (z >>> 16)) >>> 0
  x = (x + Math.imul(y, z)) >>> 0
  y = (y + Math.imul(z, x)) >>> 0
  z = (z + Math.imul(x, y)) >>> 0
  const s = 1 / 4294967296
  return [Math.fround(x * s), Math.fround(y * s), Math.fround(z * s)]
}
