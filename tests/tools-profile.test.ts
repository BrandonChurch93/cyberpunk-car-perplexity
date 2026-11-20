import { describe, expect, it } from 'vitest'
import { markdownTable, stageOf, systemColumn, tabulate } from '../tools/lib/profile-report'

const draw = (path: string, system: string, target: string, ms: number) => ({ path, system, target, ms, object: 'o', material: 'm', program: 0, camera: 'c' })

describe('profile report', () => {
  it('names the stage of a draw from its section path and target', () => {
    expect(stageOf({ path: 'add/sample/render scene', target: '1920x1080' })).toBe('main scene')
    expect(stageOf({ path: 'add/sample/render scene', target: '1920x1080 msaa4' })).toBe('main transmission prepass')
    expect(stageOf({ path: 'add/sample/render scene/shadow maps', target: '2048x2048' })).toBe('main shadow maps')
    expect(stageOf({ path: 'add/sample/reflect/render scene', target: '960x540' })).toBe('planar scene')
    expect(stageOf({ path: 'frame/reflect/render scene', target: '128x128 cube2' })).toBe('bounce probe scene')
    expect(stageOf({ path: 'frame/reflect/render quad', target: '1024x1024 cube2' })).toBe('probe prefilter')
    expect(stageOf({ path: 'frame/reflect/render cube lamp emitters', target: '1024x1024 cube0' })).toBe('probe emitters')
    expect(stageOf({ path: 'add/sample/shade/render override', target: '960x540' })).toBe('shade normals')
    expect(stageOf({ path: 'add/sample/pass haze/render quad', target: '960x540' })).toBe('haze')
    expect(stageOf({ path: 'post/render quad', target: 'canvas' })).toBe('post')
  })

  it('puts the deck in its own column', () => {
    expect(systemColumn('world/deck')).toBe('deck')
    expect(systemColumn('world/city')).toBe('world')
    expect(systemColumn('surface water/drops')).toBe('surface water')
    expect(systemColumn('rig')).toBe('other')
  })

  it('sums rows and checks against the wall clock', () => {
    const rows = tabulate({ draws: [draw('add/sample/render scene', 'vehicle/body', '1920x1080', 300), draw('add/sample/render scene', 'world/deck', '1920x1080', 100)], ops: [] })
    expect(rows).toHaveLength(1)
    expect(rows[0].cells.vehicle).toBe(300)
    expect(rows[0].cells.deck).toBe(100)
    const table = markdownTable(rows, 420)
    expect(table).toContain('| main scene | 2 | 0.3 |  | 0.1 |')
    expect(table).toContain('| wall clock, synced |')
  })
})
