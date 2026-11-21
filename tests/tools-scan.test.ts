import { describe, expect, it } from 'vitest'
import { config } from '../src/config'
import { every, flags, lumaStats, merge, parseFrames, scaledSize, shard, shotOf, type ScanFile, type ScanFrame } from '../tools/lib/scan'

const frame = (f: number, mean: number, shot = 'return', nonFinite = 0): ScanFrame => ({ frame: f, shot, mean, p50: 0, p99: 0, nonFinite, begin: 0, seconds: 0 })
const file = (frames: ScanFrame[], over: Partial<ScanFile> = {}): ScanFile => ({ buildHash: 'h', format: '16x9', width: 240, height: 135, tier: 'draft', detail: 'full', paint: 'p', jump: 0.3, frames, flagged: [], ...over })

describe('scan', () => {
  it('measures Rec.709 luma with a histogram rank', () => {
    const px = new Uint8Array([255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0])
    const s = lumaStats(px)
    expect(s.mean).toBeCloseTo((255 + 0 + 0.2126 * 255 + 0.7152 * 255) / 4, 6)
    expect(s.p50).toBe(54)
    expect(s.p99).toBe(255)
    expect(lumaStats(new Uint8Array([10, 10, 10, 99, 20, 20, 20, 99]), 4).mean).toBeCloseTo(15, 6)
  })

  it('parses frame lists and steps', () => {
    expect(parseFrames(undefined, 4)).toEqual([0, 1, 2, 3])
    expect(parseFrames('all', 3)).toEqual([0, 1, 2])
    expect(parseFrames('5-7,2,6', 10)).toEqual([2, 5, 6, 7])
    expect(() => parseFrames('8-12', 10)).toThrow()
    expect(() => parseFrames('7-5', 10)).toThrow()
    expect(every([0, 1, 2, 3, 4, 5, 6], 3)).toEqual([0, 3, 6])
    expect(() => every([1], 0)).toThrow()
  })

  it('splits into contiguous shards that cover every frame once', () => {
    const all = parseFrames(undefined, 1350)
    const parts = [1, 2, 3, 4, 5, 6, 7].map((i) => shard(all, `${i}/7`))
    expect(parts.flat()).toEqual(all)
    for (const p of parts) expect(p[p.length - 1] - p[0]).toBe(p.length - 1)
    expect(shard(all, undefined)).toBe(all)
    expect(() => shard(all, '0/3')).toThrow()
    expect(() => shard(all, '4/3')).toThrow()
    expect(() => shard(all, '2')).toThrow()
  })

  it('names the shot by config beat', () => {
    expect(shotOf(0, config.beats)).toBe(config.beats[0].id)
    expect(shotOf(37.5, config.beats)).toBe('return')
    expect(shotOf(1e6, config.beats)).toBe(config.beats[config.beats.length - 1].id)
    for (const b of config.beats) expect(shotOf((b.start + b.end) / 2, config.beats)).toBe(b.id)
  })

  it('flags a spike against both neighbours in one shot and any non-finite pixel', () => {
    const f = flags([frame(1124, 79), frame(1125, 176), frame(1126, 80), frame(1127, 81, 'return', 2)], 0.3)
    expect(f.map((x) => x.frame)).toEqual([1125, 1127])
    expect(f[0].reasons[0]).toContain('mean 176.0')
    expect(flags([frame(1, 50), frame(2, 100), frame(3, 100)], 0.3)).toEqual([])
    expect(flags([frame(1, 50, 'a'), frame(2, 100, 'a'), frame(3, 50, 'b')], 0.3)).toEqual([])
    expect(flags([frame(2, 100), frame(1, 50), frame(3, 50)], 0.3).map((x) => x.frame)).toEqual([2])
  })

  it('merges shards, flags across the seam and refuses mixed scans', () => {
    const m = merge([file([frame(10, 50), frame(11, 120)]), file([frame(12, 50), frame(13, 50)])])
    expect(m.frames.map((x) => x.frame)).toEqual([10, 11, 12, 13])
    expect(m.flagged.map((x) => x.frame)).toEqual([11])
    for (const over of [{ buildHash: 'x' }, { width: 120 }, { tier: 'final' }, { paint: 'q' }, { detail: 'blockout' }, { format: '9x16' }]) expect(() => merge([file([]), file([], over)])).toThrow()
    expect(() => merge([])).toThrow()
  })

  it('scales a format by width', () => {
    expect(scaledSize(config.formats.master, 240)).toEqual({ width: 240, height: 135 })
    expect(scaledSize(config.formats.master, 64)).toEqual({ width: 64, height: 36 })
    expect(() => scaledSize(config.formats.master, 8)).toThrow()
    expect(() => scaledSize(config.formats.master, 4000)).toThrow()
  })
})
