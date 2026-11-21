import type { ProfileDraw, ProfileDump, ProfileOp } from './profile-page.ts'

export const systems = ['vehicle', 'world', 'deck', 'air', 'surface water', 'screen', 'other'] as const

export function systemColumn(system: string): (typeof systems)[number] {
  const head = system.split('/')[0]
  if (system.startsWith('world/deck')) return 'deck'
  if (head === 'vehicle' || head === 'world' || head === 'air' || head === 'surface water' || head === 'screen') return head
  return 'other'
}

export function stageOf(entry: Pick<ProfileDraw, 'path' | 'target'> & { op?: string }): string {
  const { path, target } = entry
  const parts = path.split('/')
  if (parts[0] === 'post') return 'post'
  const pass = parts.find((p) => p.startsWith('pass '))
  if (pass) return pass.slice(5)
  if (parts.includes('shade')) return path.includes('render override') ? 'shade normals' : 'shade occlusion'
  const inFrame = parts[0] === 'frame'
  const where = parts.includes('reflect') ? (inFrame ? (target.startsWith('128x128') ? 'bounce probe' : 'probe') : 'planar') : inFrame ? 'frame' : parts.includes('sample') ? 'main' : 'accumulate'
  if (parts.includes('shadow maps')) return `${where} shadow maps`
  if (path.includes('render cube lamp emitters')) return `${where} emitters`
  if (target.includes('msaa') || target.includes('transmission')) return `${where} transmission prepass`
  if (entry.op && entry.op !== 'clear') return `${where} resolve and mips`
  if (path.endsWith('render quad') && (where === 'probe' || where === 'bounce probe')) return `${where} prefilter`
  return `${where} scene`
}

export interface Row {
  stage: string
  cells: Record<string, number>
  draws: number
  total: number
}

export function tabulate(dump: Pick<ProfileDump, 'draws' | 'ops'>): Row[] {
  const rows = new Map<string, Row>()
  const add = (stage: string, column: string, ms: number, draw: boolean): void => {
    let row = rows.get(stage)
    if (!row) rows.set(stage, (row = { stage, cells: {}, draws: 0, total: 0 }))
    row.cells[column] = (row.cells[column] ?? 0) + ms
    row.total += ms
    if (draw) row.draws++
  }
  for (const d of dump.draws) add(stageOf(d), systemColumn(d.system), d.ms, true)
  for (const o of dump.ops as ProfileOp[]) add(stageOf({ ...o, op: o.op }), 'screen', o.ms, false)
  return [...rows.values()].sort((a, b) => b.total - a.total)
}

const seconds = (ms: number): string => (ms >= 50 ? (ms / 1000).toFixed(1) : ms > 0 ? '<0.1' : '')

export function markdownTable(rows: Row[], wallMs: number): string {
  const total = rows.reduce((s, r) => s + r.total, 0)
  const head = `| stage | draws | ${systems.join(' | ')} | total s | share |`
  const rule = `|${' --- |'.repeat(systems.length + 4)}`
  const lines = rows
    .filter((r) => r.total >= 1)
    .map((r) => `| ${r.stage} | ${r.draws} | ${systems.map((s) => seconds(r.cells[s] ?? 0)).join(' | ')} | ${(r.total / 1000).toFixed(2)} | ${((100 * r.total) / total).toFixed(1)}% |`)
  const sums = systems.map((s) => seconds(rows.reduce((a, r) => a + (r.cells[s] ?? 0), 0)))
  return [head, rule, ...lines, `| sum of GPU timers | ${rows.reduce((s, r) => s + r.draws, 0)} | ${sums.join(' | ')} | ${(total / 1000).toFixed(2)} | |`, `| wall clock, synced | | ${systems.map(() => '').join(' | ')} | ${(wallMs / 1000).toFixed(2)} | |`].join('\n')
}
