import { config } from '../config'

export function hashString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return mix32(h)
}

export function mix32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  return (x ^ (x >>> 16)) >>> 0
}

export function hashInts(...values: number[]): number {
  let h = 0x9e3779b9
  for (const v of values) h = mix32(h ^ mix32((v | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2)))
  return h >>> 0
}

export function hash01(...values: number[]): number {
  return hashInts(...values) / 4294967296
}

export class Rng {
  private a: number
  private b: number
  private c: number
  private d: number

  constructor(seed: number) {
    this.a = mix32(seed)
    this.b = mix32(seed ^ 0x68bc21eb)
    this.c = mix32(seed ^ 0x02e5be93)
    this.d = 1
    for (let i = 0; i < 12; i++) this.uint()
  }

  uint(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0
    this.d = (this.d + 1) | 0
    this.a = this.b ^ (this.b >>> 9)
    this.b = (this.c + (this.c << 3)) | 0
    this.c = (this.c << 21) | (this.c >>> 11)
    this.c = (this.c + t) | 0
    return t >>> 0
  }

  next(): number {
    return this.uint() / 4294967296
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]
  }

  gauss(): number {
    const u = Math.max(this.next(), 1e-12)
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}

export function streamSeed(name: string): number {
  return hashInts(config.seed, hashString(name))
}

export function stream(name: string): Rng {
  return new Rng(streamSeed(name))
}
