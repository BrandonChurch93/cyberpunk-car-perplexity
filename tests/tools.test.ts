import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { config, frameCount } from '../src/config'
import { createVehicle } from '../src/vehicle'
import { clampRect, gridShape, planCrops } from '../tools/lib/crops'
import { partRange } from '../tools/lib/film'
import { signProblems } from '../tools/lib/gates'
import { parseJudged } from '../tools/lib/judged'
import { beatMoments, eventRuns, extractSection, heroFrame, hookFrames, isNeutral, juryText, macroFrame, neutralName, neutralProblems, returnFormat, roundName, shuffle } from '../tools/lib/pack'
import { boardObservations } from '../tools/lib/pack-build'
import { cameraForFrame, project, rayThrough } from '../tools/lib/scene'
import { sheetFrames } from '../tools/lib/sheet'

const root = join(import.meta.dirname, '..')
const quality = readFileSync(join(root, 'kit', '07-QUALITY-BAR.md'), 'utf8')
const fps = config.film.fps
const anchors = (await createVehicle({ paint: config.paint.candidates[0], detail: 'blockout' })).anchors
const formats = [config.formats.master, config.formats.vertical, config.formats.preview]

describe('sheet and pack frame lists', () => {
  it('spreads each beat sheet from the first to the last frame of the beat', () => {
    for (const beat of config.beats) {
      const frames = sheetFrames(beat.id)
      expect(frames).toHaveLength(config.critics.contactSheetFrames)
      expect(frames[0]).toBe(Math.round(beat.start * fps))
      expect(frames[frames.length - 1]).toBe(Math.round(beat.end * fps) - 1)
      for (let i = 1; i < frames.length; i++) expect(frames[i]).toBeGreaterThan(frames[i - 1])
    }
  })

  it('crosses the loop point in the seam sheet', () => {
    const frames = sheetFrames('seam')
    expect(frames).toHaveLength(config.critics.contactSheetFrames)
    const half = Math.floor(frames.length / 2)
    expect(frames[half - 1]).toBe(frameCount - 1)
    expect(frames[half]).toBe(0)
    for (const f of frames) expect(f >= 0 && f < frameCount).toBe(true)
  })

  it('takes start, middle and end of every beat, inside the beat', () => {
    const moments = beatMoments()
    expect(moments).toHaveLength(config.beats.length * 3)
    for (const m of moments) {
      const beat = config.beats.find((b) => b.id === m.beat)!
      expect(m.frame).toBeGreaterThanOrEqual(Math.round(beat.start * fps))
      expect(m.frame).toBeLessThan(Math.round(beat.end * fps))
    }
    expect(moments[0]).toMatchObject({ beat: config.beats[0].id, moment: 'start', frame: 0 })
  })

  it('starts the hook frames at frame 0 and keeps them inside the hook', () => {
    const frames = hookFrames()
    expect(frames[0]).toBe(0)
    expect(frames[frames.length - 1]).toBe(Math.round(config.film.hookSeconds * fps) - 1)
    expect(new Set(frames).size).toBe(frames.length)
  })

  it('places hero and macro frames from the config seconds', () => {
    expect(heroFrame()).toBe(Math.round(config.film.heroFrameSeconds * fps))
    expect(macroFrame()).toBe(Math.round(config.film.macroFrameSeconds * fps))
  })

  it('gives every event a run of consecutive frames inside the film', () => {
    const runs = eventRuns()
    expect(runs.length).toBeGreaterThan(0)
    for (const r of runs) {
      expect(r.frames).toHaveLength(config.critics.contactSheetFrames)
      for (let i = 1; i < r.frames.length; i++) expect(r.frames[i]).toBe(r.frames[i - 1] + 1)
      expect(r.frames[0]).toBeGreaterThanOrEqual(0)
      expect(r.frames[r.frames.length - 1]).toBeLessThan(frameCount)
    }
  })

  it('splits a range into parts that cover it once', () => {
    for (const parts of [1, 2, 3, 7]) {
      const seen: number[] = []
      for (let p = 1; p <= parts; p++) {
        const [a, b] = partRange(0, frameCount - 1, parts, p)
        for (let f = a; f <= b; f++) seen.push(f)
      }
      expect(seen).toEqual(Array.from({ length: frameCount }, (_, i) => i))
    }
    expect(() => partRange(0, 9, 2, 0)).toThrow()
    expect(() => partRange(0, 9, 2, 3)).toThrow()
  })
})

describe('neutral names', () => {
  it('builds set names and round names', () => {
    expect(neutralName('A', 1)).toBe('set-A-01.png')
    expect(neutralName('C', 12, 'txt')).toBe('set-C-12.txt')
    expect(roundName(7)).toBe('round-007')
    expect(() => neutralName('a', 1)).toThrow()
    expect(() => roundName(0)).toThrow()
  })

  it('accepts the names and captions packs use', () => {
    for (const t of ['set-A-01.png', 'manifest.json', 'brief.txt', 'contact sheet, 12 frames from 9.00 s to 14.97 s, beat 3 of 8 (paint)', 'full size detail of the frame at 6.50 s, centered on the wheel', 'plain gray view', 'black and white stripe view', 'target look for beat 2 of 8 (wake)']) {
      expect(neutralProblems(t), t).toEqual([])
    }
  })

  it('rejects words a critic may not see', () => {
    for (const t of ['render-01.png', 'real.png', 'photo-A.png', 'cg_frame.png', 'set final.png', 'ref-02.png', 'Reference.png', 'clay view', 'zebra', 'draft tier', 'path traced', 'AI image', 'control-03.png', 'a reflection']) {
      expect(isNeutral(t), t).toBe(false)
    }
  })
})

describe('judged frame table', () => {
  const doc = (rows: string) => `# Progress\n\n## Judged frames\n\n| Frame index | Seconds | Beat | Why this moment | Vertical too |\n| --- | --- | --- | --- | --- |\n${rows}\n## Look lock\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n`

  it('is empty when the table has no rows', () => {
    expect(parseJudged(doc(''))).toEqual([])
  })

  it('reads frames and the vertical column', () => {
    const out = parseJudged(doc('| 0 | 0.00 | `arrival` | opening | yes |\n| 195 | 6.50 | wake | hero | no |\n| `360` | 12.00 | paint | macro | Yes |\n'))
    expect(out.map((j) => [j.frame, j.vertical, j.beat])).toEqual([[0, true, 'arrival'], [195, false, 'wake'], [360, true, 'paint']])
  })

  it('finds columns by name in any order', () => {
    const text = '## Judged frames\n\n| Vertical too | Frame index |\n| --- | --- |\n| yes | 12 |\n'
    expect(parseJudged(text)).toEqual([{ frame: 12, vertical: true, beat: '', why: '' }])
  })

  it('rejects duplicates and frames outside the film', () => {
    expect(() => parseJudged(doc('| 5 | | | | |\n| 5 | | | | |\n'))).toThrow()
    expect(() => parseJudged(doc(`| ${frameCount} | | | | |\n`))).toThrow()
  })

  it('reads the real progress file', () => {
    const real = parseJudged(readFileSync(join(root, 'kit', 'PROGRESS.md'), 'utf8'))
    expect(Array.isArray(real)).toBe(true)
  })
})

describe('briefs from the quality bar', () => {
  it('extracts each critic section word for word', () => {
    for (const heading of ['C2 ·', 'C3 ·', 'C4 ·', 'C5 ·', 'C5 blockout ·', 'C6 ·', 'C7 ·', 'C8 ·', 'C8 blockout ·']) {
      const s = extractSection(quality, heading)
      expect(s.startsWith(`### ${heading}`)).toBe(true)
      expect(quality.includes(s)).toBe(true)
      expect(s.split('\n').slice(1).some((l) => /^#{1,3}\s/.test(l))).toBe(false)
    }
    expect(extractSection(quality, 'C5 ·')).not.toContain('Phase 2 only')
  })

  it('extracts the return format block', () => {
    const r = returnFormat(quality)
    expect(r.startsWith('```json')).toBe(true)
    expect(r).toContain('"score"')
    expect(quality.includes(r.split('\n\n')[0])).toBe(true)
  })

  it('takes the jury text without quote marks', () => {
    const j = juryText(quality)
    expect(j.length).toBeGreaterThan(20)
    expect(j.split('\n').some((l) => l.startsWith('>'))).toBe(false)
  })

  it('keeps board sources and sizes but drops links and build notes', () => {
    const board = '## Puddles\n\nWhat to learn: depth\n\n### Sources\n\n#### S1 · One\n- URL: https://a\n- Image: https://b\n- Shows: a puddle\n- Observations:\n  1. dark\n\n### Real-world sizes\n- 5 mm\n\n### Build notes\n- secret\n\n## Other\n\n### Sources\n'
    const out = boardObservations(board, ['Puddles'])
    expect(out).toContain('What to learn: depth')
    expect(out).toContain('- Shows: a puddle')
    expect(out).toContain('- 5 mm')
    expect(out).not.toContain('https://')
    expect(out).not.toContain('secret')
    expect(out).not.toContain('Other')
  })
})

describe('shuffle', () => {
  it('is a seeded permutation', () => {
    let s = 1
    const next = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const items = Array.from({ length: 20 }, (_, i) => i)
    const a = shuffle(items, next)
    expect([...a].sort((x, y) => x - y)).toEqual(items)
    s = 1
    expect(shuffle(items, next)).toEqual(a)
    expect(items).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })
})

describe('crop planning', () => {
  it('tiles the whole frame with grid crops under the long edge limit', () => {
    for (const format of formats) {
      const plans = planCrops(cameraForFrame(heroFrame(), format, anchors), format, anchors)
      const grid = plans.filter((p) => p.kind === 'grid')
      const { columns, rows } = gridShape(format)
      expect(grid).toHaveLength(columns * rows)
      expect(grid.reduce((s, p) => s + p.rect.width * p.rect.height, 0)).toBe(format.width * format.height)
      for (const p of plans) {
        expect(Math.max(p.rect.width, p.rect.height)).toBeLessThanOrEqual(config.critics.maxImageLongEdgePx)
        expect(p.rect.left).toBeGreaterThanOrEqual(0)
        expect(p.rect.top).toBeGreaterThanOrEqual(0)
        expect(p.rect.left + p.rect.width).toBeLessThanOrEqual(format.width)
        expect(p.rect.top + p.rect.height).toBeLessThanOrEqual(format.height)
      }
    }
  })

  it('crops the macro frame around its anchor', () => {
    const format = config.formats.master
    const plans = planCrops(cameraForFrame(macroFrame(), format, anchors), format, anchors)
    expect(plans.some((p) => p.kind === 'anchor')).toBe(true)
  })

  it('keeps clamped rects inside the frame', () => {
    const f = config.formats.master
    expect(clampRect(-50, -50, 400, 400, f)).toEqual({ left: 0, top: 0, width: 400, height: 400 })
    expect(clampRect(f.width + 9, f.height + 9, 400, 400, f)).toEqual({ left: f.width - 400, top: f.height - 400, width: 400, height: 400 })
  })

  it('projects a ray back to the pixel it came from', () => {
    for (const format of formats) {
      const state = cameraForFrame(heroFrame(), format, anchors)
      for (const [x, y] of [[format.width / 2, format.height / 2], [10, 20], [format.width - 30, format.height - 5]]) {
        const { origin, direction } = rayThrough(state, format, x, y)
        const p = project(state, format, origin.clone().add(direction.clone().multiplyScalar(7)))!
        expect(p.x).toBeCloseTo(x, 6)
        expect(p.y).toBeCloseTo(y, 6)
      }
      const ahead = new THREE.Vector3(0, 0, -5).applyQuaternion(state.quaternion).add(state.position)
      const c = project(state, format, ahead)!
      expect(c.x).toBeCloseTo(format.width / 2, 6)
      expect(c.y).toBeCloseTo(format.height / 2, 6)
      const behind = new THREE.Vector3(0, 0, 5).applyQuaternion(state.quaternion).add(state.position)
      expect(project(state, format, behind)).toBeNull()
    }
  })
})

describe('signage check', () => {
  it('flags strings outside the config', () => {
    expect(signProblems([config.signage.generic[0], config.signage.invented[0]])).toEqual([])
    expect(signProblems(['PARKING', 'NOT A SIGN', 'NOT A SIGN'])).toEqual(['NOT A SIGN'])
  })
})
