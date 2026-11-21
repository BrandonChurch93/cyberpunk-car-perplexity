import { cross, dist, dot, len, norm, sub, type V3 } from './vec'

export type SurfaceFn = (u: number, v: number) => V3
/** Signed distance in meters to the edge of the kept region, negative inside. */
export type TrimFn = (u: number, v: number, p: V3) => number

export interface TessOptions {
  us: number[]
  vs: number[]
  /** Longest edge allowed, meters. */
  maxEdge: number
  /** Largest bend across one cell, radians. */
  maxAngle: number
  /** Largest gap between the surface and a flat cell, meters. */
  tolerance: number
  minEdge: number
  trim?: TrimFn
  /** Edge length along trim boundaries, meters. */
  edgeLength?: number
  maxDepth?: number
  /** Flip winding so the front face is S_v x S_u instead of S_u x S_v. */
  flip?: boolean
  /**
   * Unit normal in place of S_u x S_v, for a surface whose own tangents are not reliable, such as an offset that folds
   * where a convex crease is tighter than the offset.
   */
  normal?: (u: number, v: number) => V3
}

export interface Boundary {
  /** Points along the trim edge with surface normals, kept region on the left when seen from outside. */
  points: V3[]
  normals: V3[]
  uv: Array<[number, number]>
  closed: boolean
}

export interface TessResult {
  positions: number[]
  normals: number[]
  uvs: number[]
  indices: number[]
  boundaries: Boundary[]
}

interface Vtx {
  u: number
  v: number
  p: V3
  n: V3
  d: number
  id: number
}

export function tessellate(S: SurfaceFn, o: TessOptions): TessResult {
  const flip = o.flip ? -1 : 1
  const verts = new Map<string, Vtx>()
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const edgeLen = o.edgeLength ?? 0.004
  const maxDepth = o.maxDepth ?? 22
  const trim = o.trim

  const normalAt = (u: number, v: number, p: V3): V3 => {
    if (o.normal) {
      const r = o.normal(u, v)
      if (len(r) > 0.5) return [r[0] * flip, r[1] * flip, r[2] * flip]
    }
    const hu = 1e-5
    const hv = 1e-5
    const u0 = Math.max(o.us[0], u - hu)
    const u1 = Math.min(o.us[o.us.length - 1], u + hu)
    const v0 = Math.max(o.vs[0], v - hv)
    const v1 = Math.min(o.vs[o.vs.length - 1], v + hv)
    let su = sub(S(u1, v), S(u0, v))
    let sv = sub(S(u, v1), S(u, v0))
    let n = cross(su, sv)
    // On a collapsed edge or a pole the tangents vanish. The normal there is the limit from inside the patch, so step
    // toward the patch centre until the tangent plane is defined again.
    const uc = (o.us[0] + o.us[o.us.length - 1]) / 2
    const vc = (o.vs[0] + o.vs[o.vs.length - 1]) / 2
    for (const step of [0.002, 0.01, 0.03, 0.1]) {
      if (len(n) > 1e-13) break
      const du = (uc - u) * step
      const dv = (vc - v) * step
      su = sub(S(u1 + du, v + dv), S(u0 + du, v + dv))
      sv = sub(S(u + du, v1 + dv), S(u + du, v0 + dv))
      n = cross(su, sv)
    }
    void p
    // The tangents are 2e-5 long in parameter, so a regular point gives |n| near 1e-10; normalise without norm()'s floor.
    const l = len(n)
    const r: V3 = l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0]
    return [r[0] * flip, r[1] * flip, r[2] * flip]
  }

  const vtx = (u: number, v: number): Vtx => {
    const key = `${u}|${v}`
    let x = verts.get(key)
    if (!x) {
      const p = S(u, v)
      x = { u, v, p, n: normalAt(u, v, p), d: trim ? trim(u, v, p) : -1, id: -1 }
      verts.set(key, x)
    }
    return x
  }

  const emit = (x: Vtx): number => {
    if (x.id < 0) {
      x.id = positions.length / 3
      positions.push(x.p[0], x.p[1], x.p[2])
      normals.push(x.n[0], x.n[1], x.n[2])
      uvs.push(x.u, x.v)
    }
    return x.id
  }

  interface Cell {
    ua: number
    ub: number
    va: number
    vb: number
  }
  const leaves: Cell[] = []
  const angle = (a: V3, b: V3): number => Math.acos(Math.max(-1, Math.min(1, dot(a, b))))

  const refine = (c: Cell, depth: number): void => {
    const { ua, ub, va, vb } = c
    const um = (ua + ub) / 2
    const vm = (va + vb) / 2
    const p00 = vtx(ua, va)
    const p10 = vtx(ub, va)
    const p01 = vtx(ua, vb)
    const p11 = vtx(ub, vb)
    const pm = vtx(um, vm)
    const pu0 = vtx(um, va)
    const pu1 = vtx(um, vb)
    const pv0 = vtx(ua, vm)
    const pv1 = vtx(ub, vm)
    const lenU = Math.max(dist(p00.p, pu0.p) + dist(pu0.p, p10.p), dist(p01.p, pu1.p) + dist(pu1.p, p11.p), dist(pv0.p, pm.p) + dist(pm.p, pv1.p))
    const lenV = Math.max(dist(p00.p, pv0.p) + dist(pv0.p, p01.p), dist(p10.p, pv1.p) + dist(pv1.p, p11.p), dist(pu0.p, pm.p) + dist(pm.p, pu1.p))
    let su = false
    let sv = false
    if (depth < maxDepth) {
      if (lenU > o.maxEdge) su = true
      if (lenV > o.maxEdge) sv = true
      const aU = Math.max(angle(p00.n, p10.n), angle(p01.n, p11.n), angle(pv0.n, pv1.n))
      const aV = Math.max(angle(p00.n, p01.n), angle(p10.n, p11.n), angle(pu0.n, pu1.n))
      if (aU > o.maxAngle && lenU > o.minEdge) su = true
      if (aV > o.maxAngle && lenV > o.minEdge) sv = true
      const devU = Math.max(chordDev(p00.p, pu0.p, p10.p), chordDev(p01.p, pu1.p, p11.p), chordDev(pv0.p, pm.p, pv1.p))
      const devV = Math.max(chordDev(p00.p, pv0.p, p01.p), chordDev(p10.p, pv1.p, p11.p), chordDev(pu0.p, pm.p, pu1.p))
      if (devU > o.tolerance && lenU > o.minEdge) su = true
      if (devV > o.tolerance && lenV > o.minEdge) sv = true
      if (trim) {
        const ds = [p00.d, p10.d, p01.d, p11.d, pm.d, pu0.d, pu1.d, pv0.d, pv1.d]
        const mixed = ds.some((d) => d < 0) && ds.some((d) => d >= 0)
        const radius = Math.max(lenU, lenV) * 0.75
        const near = Math.abs(pm.d) < radius
        if ((mixed || near) && Math.max(lenU, lenV) > edgeLen) {
          if (lenU > edgeLen) su = true
          if (lenV > edgeLen) sv = true
        }
        if (!mixed && !near && pm.d > 0) {
          su = false
          sv = false
        }
      }
    }
    if (su && sv) {
      refine({ ua, ub: um, va, vb: vm }, depth + 1)
      refine({ ua: um, ub, va, vb: vm }, depth + 1)
      refine({ ua, ub: um, va: vm, vb }, depth + 1)
      refine({ ua: um, ub, va: vm, vb }, depth + 1)
    } else if (su) {
      refine({ ua, ub: um, va, vb }, depth + 1)
      refine({ ua: um, ub, va, vb }, depth + 1)
    } else if (sv) {
      refine({ ua, ub, va, vb: vm }, depth + 1)
      refine({ ua, ub, va: vm, vb }, depth + 1)
    } else leaves.push(c)
  }

  for (let i = 0; i < o.us.length - 1; i++) for (let j = 0; j < o.vs.length - 1; j++) refine({ ua: o.us[i], ub: o.us[i + 1], va: o.vs[j], vb: o.vs[j + 1] }, 0)

  const onU = new Map<number, number[]>()
  const onV = new Map<number, number[]>()
  const reg = (m: Map<number, number[]>, k: number, x: number): void => {
    let a = m.get(k)
    if (!a) m.set(k, (a = []))
    a.push(x)
  }
  for (const c of leaves) {
    reg(onU, c.ua, c.va)
    reg(onU, c.ua, c.vb)
    reg(onU, c.ub, c.va)
    reg(onU, c.ub, c.vb)
    reg(onV, c.va, c.ua)
    reg(onV, c.va, c.ub)
    reg(onV, c.vb, c.ua)
    reg(onV, c.vb, c.ub)
  }
  for (const m of [onU, onV]) for (const [k, a] of m) m.set(k, [...new Set(a)].sort((x, y) => x - y))
  const between = (a: number[] | undefined, lo: number, hi: number): number[] => {
    if (!a) return []
    const out: number[] = []
    let l = 0
    let h = a.length
    while (l < h) {
      const mid = (l + h) >> 1
      if (a[mid] <= lo) l = mid + 1
      else h = mid
    }
    for (let i = l; i < a.length && a[i] < hi; i++) out.push(a[i])
    return out
  }

  const cutCache = new Map<string, Vtx>()
  const segs: Array<[Vtx, Vtx]> = []
  const cutPoint = (a: Vtx, b: Vtx): Vtx => {
    const ka = `${a.u}|${a.v}`
    const kb = `${b.u}|${b.v}`
    const key = ka < kb ? `${ka}#${kb}` : `${kb}#${ka}`
    let x = cutCache.get(key)
    if (x) return x
    let lo = a.d < 0 ? a : b
    let hi = a.d < 0 ? b : a
    let t0 = 0
    let t1 = 1
    const ua = lo.u
    const va = lo.v
    const du = hi.u - lo.u
    const dv = hi.v - lo.v
    let dLo = lo.d
    let dHi = hi.d
    let u = ua
    let v = va
    let p = lo.p
    for (let it = 0; it < 30; it++) {
      let t = t0 + ((t1 - t0) * -dLo) / (dHi - dLo)
      if (!(t > t0 && t < t1) || it % 3 === 2) t = (t0 + t1) / 2
      u = ua + du * t
      v = va + dv * t
      p = S(u, v)
      const d = trim ? trim(u, v, p) : -1
      if (Math.abs(d) < 1e-6) break
      if (d < 0) {
        t0 = t
        dLo = d
      } else {
        t1 = t
        dHi = d
      }
      if (t1 - t0 < 1e-9) break
    }
    void lo
    void hi
    lo = hi
    x = { u, v, p, n: normalAt(u, v, p), d: 0, id: -1 }
    cutCache.set(key, x)
    return x
  }

  // An edge whose two ends are both kept can still pass over a trimmed band narrower than itself, such as a shut gap,
  // and its triangle would bridge the band. Such an edge is split at its middle, the same way from either triangle
  // that shares it, so no crack opens, and the halves are tested again. Samples at a quarter, half and three quarters
  // of the edge find any band wider than a quarter of the edge.
  const keyOf = (x: Vtx): string => `${x.u}|${x.v}`
  const bridges = (a: Vtx, b: Vtx): boolean => {
    // The trim is a distance, so two kept ends further inside than half the edge each leave no room for a band.
    if (!trim || a.d >= 0 || b.d >= 0 || a.d + b.d + dist(a.p, b.p) < 0) return false
    const [p, q] = keyOf(a) < keyOf(b) ? [a, b] : [b, a]
    for (const t of [0.25, 0.5, 0.75]) {
      const u = p.u + (q.u - p.u) * t
      const v = p.v + (q.v - p.v) * t
      if (trim(u, v, S(u, v)) >= 0) return true
    }
    return false
  }
  const mid = (a: Vtx, b: Vtx): Vtx => vtx((a.u + b.u) / 2, (a.v + b.v) / 2)
  const tri = (a: Vtx, b: Vtx, c: Vtx, depth = 0): void => {
    if (trim && depth < 8) {
      const sab = bridges(a, b)
      const sbc = bridges(b, c)
      const sca = bridges(c, a)
      const n = Number(sab) + Number(sbc) + Number(sca)
      if (n === 3) {
        const ab = mid(a, b)
        const bc = mid(b, c)
        const ca = mid(c, a)
        tri(a, ab, ca, depth + 1)
        tri(ab, b, bc, depth + 1)
        tri(ca, bc, c, depth + 1)
        tri(ab, bc, ca, depth + 1)
        return
      }
      if (n > 0) {
        // Rotate, keeping the winding, so the first edge (p, q) is split and, when two are, the second is (q, r).
        const [p, q, r]: Vtx[] = n === 1 ? (sab ? [a, b, c] : sbc ? [b, c, a] : [c, a, b]) : !sca ? [a, b, c] : !sab ? [b, c, a] : [c, a, b]
        const pq = mid(p, q)
        if (n === 2) {
          const qr = mid(q, r)
          tri(pq, q, qr, depth + 1)
          tri(p, pq, qr, depth + 1)
          tri(p, qr, r, depth + 1)
        } else {
          tri(p, pq, r, depth + 1)
          tri(pq, q, r, depth + 1)
        }
        return
      }
    }
    if (!trim) {
      indices.push(emit(a), emit(b), emit(c))
      return
    }
    const ins = [a.d < 0, b.d < 0, c.d < 0]
    const cnt = ins.filter(Boolean).length
    if (cnt === 3) {
      indices.push(emit(a), emit(b), emit(c))
      return
    }
    if (cnt === 0) return
    const poly = [a, b, c]
    const out: Array<{ x: Vtx; cut: boolean }> = []
    for (let i = 0; i < 3; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % 3]
      const pin = p.d < 0
      const qin = q.d < 0
      if (pin) out.push({ x: p, cut: false })
      if (pin !== qin) out.push({ x: cutPoint(p, q), cut: true })
    }
    const ids = out.map((o2) => emit(o2.x))
    for (let i = 1; i < ids.length - 1; i++) indices.push(ids[0], ids[i], ids[i + 1])
    for (let i = 0; i < out.length; i++) {
      const p = out[i]
      const q = out[(i + 1) % out.length]
      if (p.cut && q.cut) segs.push([p.x, q.x])
    }
  }

  const quadTris = (a: Vtx, b: Vtx, c: Vtx, d: Vtx): void => {
    if (dist(a.p, c.p) <= dist(b.p, d.p)) {
      tri(a, b, c)
      tri(a, c, d)
    } else {
      tri(a, b, d)
      tri(b, c, d)
    }
  }

  for (const c of leaves) {
    const { ua, ub, va, vb } = c
    const bottom = between(onV.get(va), ua, ub)
    const right = between(onU.get(ub), va, vb)
    const top = between(onV.get(vb), ua, ub).reverse()
    const left = between(onU.get(ua), va, vb).reverse()
    const ring: Vtx[] = [vtx(ua, va)]
    for (const u of bottom) ring.push(vtx(u, va))
    ring.push(vtx(ub, va))
    for (const v of right) ring.push(vtx(ub, v))
    ring.push(vtx(ub, vb))
    for (const u of top) ring.push(vtx(u, vb))
    ring.push(vtx(ua, vb))
    for (const v of left) ring.push(vtx(ua, v))
    if (ring.length === 4) {
      if (flip > 0) quadTris(ring[0], ring[1], ring[2], ring[3])
      else quadTris(ring[0], ring[3], ring[2], ring[1])
      continue
    }
    const m = vtx((ua + ub) / 2, (va + vb) / 2)
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]
      const q = ring[(i + 1) % ring.length]
      if (flip > 0) tri(m, p, q)
      else tri(m, q, p)
    }
  }

  return { positions, normals, uvs, indices, boundaries: chain(segs) }
}

function chordDev(a: V3, m: V3, b: V3): number {
  return dist(m, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])
}

function chain(segs: Array<[Vtx, Vtx]>): Boundary[] {
  const next = new Map<Vtx, Vtx>()
  const hasPrev = new Set<Vtx>()
  for (const [a, b] of segs) {
    next.set(a, b)
    hasPrev.add(b)
  }
  const used = new Set<Vtx>()
  const out: Boundary[] = []
  const walk = (start: Vtx): void => {
    const pts: Vtx[] = [start]
    used.add(start)
    let cur = start
    let closed = false
    for (;;) {
      const n = next.get(cur)
      if (!n) break
      if (n === start) {
        closed = true
        break
      }
      if (used.has(n)) break
      pts.push(n)
      used.add(n)
      cur = n
    }
    if (pts.length < 2) return
    out.push({ points: pts.map((p) => p.p), normals: pts.map((p) => p.n), uv: pts.map((p) => [p.u, p.v]), closed })
  }
  for (const [a] of segs) if (!hasPrev.has(a) && !used.has(a)) walk(a)
  for (const [a] of segs) if (!used.has(a)) walk(a)
  return out
}

export const _internal = { sub, norm }
