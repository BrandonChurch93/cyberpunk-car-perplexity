import { config, defaultPaint, formatById, frameCount, isTier, type FormatSpec, type TierId } from '../config'

export type Mode = 'live' | 'autopilot' | 'capture' | 'export'
const modes: Mode[] = ['live', 'autopilot', 'capture', 'export']

export interface Launch {
  mode: Mode
  format: FormatSpec
  formatGiven: boolean
  tier: TierId
  tierGiven: boolean
  frame: number
  first: number
  last: number
  diagnostic: string
  paint: string
}

function integer(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > frameCount) throw new Error(`The frame number ${value} is outside 0 to ${frameCount}.`)
  return n
}

export function parseLaunch(search: string): Launch {
  const p = new URLSearchParams(search)
  const mode = (p.get('mode') ?? 'live') as Mode
  if (!modes.includes(mode)) throw new Error(`Unknown mode ${mode}.`)
  const formatId = p.get('format')
  const tierId = p.get('tier')
  if (tierId !== null && !isTier(tierId)) throw new Error(`Unknown tier ${tierId}.`)
  const defaults: Record<Mode, { format: FormatSpec; tier: TierId }> = {
    live: { format: config.formats.preview, tier: 'draft' },
    autopilot: { format: config.formats.preview, tier: 'draft' },
    capture: { format: config.formats.master, tier: 'draft' },
    export: { format: config.formats.master, tier: 'final' },
  }
  return {
    mode,
    format: formatId ? formatById(formatId) : defaults[mode].format,
    formatGiven: formatId !== null,
    tier: (tierId as TierId | null) ?? defaults[mode].tier,
    tierGiven: tierId !== null,
    frame: integer(p.get('frame'), 0),
    first: integer(p.get('first'), 0),
    last: integer(p.get('last'), frameCount - 1),
    diagnostic: p.get('diag') ?? 'beauty',
    paint: p.get('paint') ?? defaultPaint,
  }
}
