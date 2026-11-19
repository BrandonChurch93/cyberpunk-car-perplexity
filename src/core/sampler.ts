import { frameCount } from '../config'
import { hashInts, streamSeed } from './random'

export interface SampleSet {
  pixel: [number, number]
  shutter: number
  aperture: [number, number]
  light: [number, number]
  misc: [number, number]
}

function reverseBits(x: number): number {
  x = ((x >>> 1) & 0x55555555) | ((x & 0x55555555) << 1)
  x = ((x >>> 2) & 0x33333333) | ((x & 0x33333333) << 2)
  x = ((x >>> 4) & 0x0f0f0f0f) | ((x & 0x0f0f0f0f) << 4)
  x = ((x >>> 8) & 0x00ff00ff) | ((x & 0x00ff00ff) << 8)
  return ((x >>> 16) | (x << 16)) >>> 0
}

function laineKarras(x: number, seed: number): number {
  x = (x + seed) >>> 0
  x = (x ^ Math.imul(x, 0x6c50b47c)) >>> 0
  x = (x ^ Math.imul(x, 0xb82f1e52)) >>> 0
  x = (x ^ Math.imul(x, 0xc7afe638)) >>> 0
  x = (x ^ Math.imul(x, 0x8d22f6e6)) >>> 0
  return x
}

function owen(x: number, seed: number): number {
  return reverseBits(laineKarras(reverseBits(x), seed))
}

function sobol1(index: number): number {
  let x = 0
  let v = 0x80000000
  for (let i = index; i !== 0; i >>>= 1) {
    if (i & 1) x ^= v
    v ^= v >>> 1
  }
  return x >>> 0
}

export function sobolPair(index: number, seed: number): [number, number] {
  const shuffled = owen(index, hashInts(seed, 1))
  const x = owen(reverseBits(shuffled), hashInts(seed, 2))
  const y = owen(sobol1(shuffled), hashInts(seed, 3))
  return [x / 4294967296, y / 4294967296]
}

export function tent(u: number): number {
  return u < 0.5 ? Math.sqrt(2 * u) - 1 : 1 - Math.sqrt(2 - 2 * u)
}

export function concentricDisk(u: number, v: number): [number, number] {
  const a = 2 * u - 1
  const b = 2 * v - 1
  if (a === 0 && b === 0) return [0, 0]
  let r: number
  let phi: number
  if (Math.abs(a) > Math.abs(b)) {
    r = a
    phi = (Math.PI / 4) * (b / a)
  } else {
    r = b
    phi = Math.PI / 2 - (Math.PI / 4) * (a / b)
  }
  return [r * Math.cos(phi), r * Math.sin(phi)]
}

const samplerSeed = streamSeed('sampler')

export function sampleSet(frameIndex: number, sampleIndex: number): SampleSet {
  const frameKey = ((frameIndex % frameCount) + frameCount) % frameCount
  const seed = hashInts(samplerSeed, frameKey)
  const [px, py] = sobolPair(sampleIndex, hashInts(seed, 11))
  const [ax, ay] = sobolPair(sampleIndex, hashInts(seed, 12))
  const [lx, ly] = sobolPair(sampleIndex, hashInts(seed, 13))
  const [tx, mx] = sobolPair(sampleIndex, hashInts(seed, 14))
  const [m2] = sobolPair(sampleIndex, hashInts(seed, 15))
  return {
    pixel: [tent(px), tent(py)],
    shutter: tx,
    aperture: concentricDisk(ax, ay),
    light: [lx, ly],
    misc: [mx, m2],
  }
}
