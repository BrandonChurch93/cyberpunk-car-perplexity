import { describe, expect, it } from 'vitest'
import recorded from '../config/webgl-caps.json'
import { compareCaps } from '../src/diagnostics/caps'

describe('caps diagnostic', () => {
  it('reports no difference on the recorded machine', () => {
    const report = compareCaps(recorded.limits, recorded.extensions, 'recorded')
    expect(report.differing).toBe(0)
    expect(report.limits.length).toBe(Object.keys(recorded.limits).length)
    expect(report.extensions.length).toBe(recorded.extensions.length)
  })

  it('marks a changed limit, a missing extension and an extra extension', () => {
    const limits = { ...recorded.limits, MAX_TEXTURE_SIZE: 16384 }
    const extensions = [...recorded.extensions.slice(1), 'EXT_made_up']
    const report = compareCaps(limits, extensions, 'other')
    expect(report.differing).toBe(3)
    expect(report.limits.find((l) => l.name === 'MAX_TEXTURE_SIZE')).toMatchObject({ here: '16384', differs: true, required: true })
    expect(report.extensions.find((l) => l.name === recorded.extensions[0])).toMatchObject({ here: 'no', recorded: 'yes', differs: true })
    expect(report.extensions.find((l) => l.name === 'EXT_made_up')).toMatchObject({ here: 'yes', recorded: 'no', differs: true })
  })
})
