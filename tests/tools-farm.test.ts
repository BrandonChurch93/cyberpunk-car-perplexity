import { describe, expect, it } from 'vitest'
import { config } from '../src/config'
import { farmJobs, jobSpec, reviewJobs, shardJobs } from '../tools/lib/farm'
import { stillName } from '../tools/lib/render'

const base = { tier: 'final' as const, paint: 'p', detail: 'full' as const }
const judged = [0, 195, 360, 1125].map((frame, i) => ({ frame, vertical: i % 2 === 0, beat: '', why: '' }))

describe('farm', () => {
  it('plans wide, tall and the two vehicle views of frames with an anchor crop', () => {
    const jobs = farmJobs(4, judged, new Set([195, 360]), [1060, 0], base)
    expect(jobs.map((j) => `${j.frame}-${j.format}-${j.diag}`)).toEqual([
      `0-${config.formats.master.id}-beauty`, `195-${config.formats.master.id}-beauty`, `360-${config.formats.master.id}-beauty`, `1125-${config.formats.master.id}-beauty`,
      `0-${config.formats.vertical.id}-beauty`, `360-${config.formats.vertical.id}-beauty`,
      `195-${config.formats.master.id}-clay`, `360-${config.formats.master.id}-clay`, `195-${config.formats.master.id}-zebra`, `360-${config.formats.master.id}-zebra`,
    ])
    for (const j of jobs) expect(stillName(jobSpec(j, base))).toBe(j.name)
    const p3 = farmJobs(3, judged.slice(1, 3), new Set([195]), [1060, 195], base)
    expect(p3.filter((j) => j.diag === 'zebra').map((j) => j.frame)).toEqual([195, 1060])
  })

  it('deals jobs round robin so the shards cover the plan once', () => {
    const jobs = Array.from({ length: 33 }, (_, i) => i)
    const parts = [1, 2, 3, 4].map((i) => shardJobs(jobs, `${i}/4`))
    expect(parts.flat().sort((a, b) => a - b)).toEqual(jobs)
    expect(parts.map((p) => p.length)).toEqual([9, 8, 8, 8])
    expect(parts[1].slice(0, 3)).toEqual([1, 5, 9])
    expect(() => shardJobs(jobs, '5/4')).toThrow()
    expect(() => shardJobs(jobs, 'x')).toThrow()
  })

  it('adds the review tier cells once each and follows a tier override', () => {
    const finals = farmJobs(4, judged, new Set(), [], base)
    const review = reviewJobs({ wide: [5, 3, 5, 195], hook: [0, 12] }, base, finals)
    expect(review.map((j) => `${j.frame}-${j.format}-${j.tier}`)).toEqual([`3-${config.formats.master.id}-review`, `5-${config.formats.master.id}-review`, `195-${config.formats.master.id}-review`, `0-${config.formats.master.id}-review`, `12-${config.formats.master.id}-review`, `0-${config.formats.vertical.id}-review`, `12-${config.formats.vertical.id}-review`])
    for (const j of review) expect(stillName(jobSpec(j, base))).toBe(j.name)
    const draft = { ...base, tier: 'draft' as const }
    const both = farmJobs(4, judged, new Set(), [], draft)
    expect(reviewJobs({ wide: [0, 3], hook: [] }, draft, both).map((j) => j.frame)).toEqual([3])
  })
})
