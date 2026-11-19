/** Natural cubic spline through (t, value) knots. Clamped to the end values outside the knot range. */
export class Spline {
  private readonly t: number[]
  private readonly y: number[]
  private readonly m: number[]

  constructor(knots: ReadonlyArray<readonly [number, number]>, monotone = false) {
    const sorted = [...knots].sort((a, b) => a[0] - b[0])
    this.t = sorted.map((k) => k[0])
    this.y = sorted.map((k) => k[1])
    this.m = monotone ? hermiteSlopes(this.t, this.y) : naturalSlopes(this.t, this.y)
  }

  at(x: number): number {
    const { t, y, m } = this
    const n = t.length
    if (n === 1) return y[0]
    if (x <= t[0]) return y[0]
    if (x >= t[n - 1]) return y[n - 1]
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (t[mid] <= x) lo = mid
      else hi = mid
    }
    const h = t[hi] - t[lo]
    const s = (x - t[lo]) / h
    const s2 = s * s
    const s3 = s2 * s
    return (2 * s3 - 3 * s2 + 1) * y[lo] + (s3 - 2 * s2 + s) * h * m[lo] + (-2 * s3 + 3 * s2) * y[hi] + (s3 - s2) * h * m[hi]
  }
}

function naturalSlopes(t: number[], y: number[]): number[] {
  const n = t.length
  if (n < 2) return [0]
  if (n === 2) {
    const s = (y[1] - y[0]) / (t[1] - t[0])
    return [s, s]
  }
  const a = new Array<number>(n).fill(0)
  const b = new Array<number>(n).fill(0)
  const c = new Array<number>(n).fill(0)
  const d = new Array<number>(n).fill(0)
  const h = (i: number): number => t[i + 1] - t[i]
  const del = (i: number): number => (y[i + 1] - y[i]) / h(i)
  b[0] = 2 / h(0)
  c[0] = 1 / h(0)
  d[0] = (3 * del(0)) / h(0)
  for (let i = 1; i < n - 1; i++) {
    a[i] = 1 / h(i - 1)
    b[i] = 2 / h(i - 1) + 2 / h(i)
    c[i] = 1 / h(i)
    d[i] = (3 * del(i - 1)) / h(i - 1) + (3 * del(i)) / h(i)
  }
  a[n - 1] = 1 / h(n - 2)
  b[n - 1] = 2 / h(n - 2)
  d[n - 1] = (3 * del(n - 2)) / h(n - 2)
  for (let i = 1; i < n; i++) {
    const w = a[i] / b[i - 1]
    b[i] -= w * c[i - 1]
    d[i] -= w * d[i - 1]
  }
  const m = new Array<number>(n).fill(0)
  m[n - 1] = d[n - 1] / b[n - 1]
  for (let i = n - 2; i >= 0; i--) m[i] = (d[i] - c[i] * m[i + 1]) / b[i]
  return m
}

function hermiteSlopes(t: number[], y: number[]): number[] {
  const n = t.length
  if (n < 2) return [0]
  const del: number[] = []
  for (let i = 0; i < n - 1; i++) del.push((y[i + 1] - y[i]) / (t[i + 1] - t[i]))
  const m = new Array<number>(n).fill(0)
  m[0] = del[0]
  m[n - 1] = del[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (del[i - 1] * del[i] <= 0) m[i] = 0
    else {
      const w1 = 2 * (t[i + 1] - t[i]) + (t[i] - t[i - 1])
      const w2 = (t[i + 1] - t[i]) + 2 * (t[i] - t[i - 1])
      m[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i])
    }
  }
  return m
}

/** A smooth curve through 3D points, parameterized by a shared scalar. */
export class Track3 {
  private readonly sx: Spline
  private readonly sy: Spline
  private readonly sz: Spline
  readonly t0: number
  readonly t1: number

  constructor(pts: ReadonlyArray<readonly [number, number, number, number]>, monotone = false) {
    this.sx = new Spline(pts.map((p) => [p[0], p[1]] as const), monotone)
    this.sy = new Spline(pts.map((p) => [p[0], p[2]] as const), monotone)
    this.sz = new Spline(pts.map((p) => [p[0], p[3]] as const), monotone)
    this.t0 = Math.min(...pts.map((p) => p[0]))
    this.t1 = Math.max(...pts.map((p) => p[0]))
  }

  at(t: number): [number, number, number] {
    return [this.sx.at(t), this.sy.at(t), this.sz.at(t)]
  }
}

/** Scalar over a parameter: a constant, or monotone-safe smooth knots. */
export function scalar(knots: number | ReadonlyArray<readonly [number, number]>): (t: number) => number {
  if (typeof knots === 'number') return () => knots
  const s = new Spline(knots, true)
  return (t) => s.at(t)
}
