import raw from '../config/showcase.json'

export interface FormatSpec { id: string; width: number; height: number }
export interface BeatSpec { id: string; start: number; end: number }
export interface PaintSpec { id: string; base: string; flake: string; finish: string }
export interface TierSpec { samplesPerFrame: number }

export interface ShowcaseConfig {
  name: string
  seed: number
  repo: { url: string; branch: string; maxFileMb: number }
  film: {
    fps: number; durationSeconds: number; shutterDegrees: number; loopSeamless: boolean
    hookSeconds: number; heroFrameSeconds: number; macroFrameSeconds: number
  }
  formats: { master: FormatSpec; vertical: FormatSpec; preview: FormatSpec }
  platform: {
    name: string; maxWidth: number; maxHeight: number; maxPortraitWidth: number; maxPortraitHeight: number
    maxFps: number; maxBitrateMbps: number; loopsAtOrUnderSeconds: number
  }
  export: {
    container: string; videoCodec: string; bitrateMbps: number; audio: string
    proofSeconds: number; memoryTestSeconds: number
    files: { master: string; vertical: string; preview: string }
  }
  tiers: { draft: TierSpec; review: TierSpec; final: TierSpec }
  beats: BeatSpec[]
  lens: { focalLengthsMm: number[]; anamorphic: boolean }
  paint: { locked: string | null; candidates: PaintSpec[] }
  signage: { generic: string[]; invented: string[] }
  reference: { minSourcesPerElement: number; minObservationsPerSource: number }
  keyframes: { directions: number; minImageModels: number }
  quality: {
    passScore: number; blockoutCompositionPass: number; plateauRounds: number; judgedFramesPerBeat: number; loopSeamMinSsim: number
    compressionStressMbps: number
    stress: { seconds: number; beats: string[]; tier: string; confirmTier: string }
    blind: {
      jurors: number; controlsPerRender: number; minControlPool: number; maxInvalidRuns: number
      maxGapPoints: number; minControlMean: number; minRenderMedian: number
    }
  }
  critics: { maxImageLongEdgePx: number; contactSheetFrames: number; phonePreviewWidthPx: number }
  sandbox: { stepTimeoutMinutes: number; chunkBudgetMinutes: number; previewFilmMaxHours: number; maxRenderProcesses: number }
}

type Kind = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'nullable-string'

const required: Array<[string, Kind]> = [
  ['name', 'string'], ['seed', 'number'],
  ['repo.url', 'string'], ['repo.branch', 'string'], ['repo.maxFileMb', 'number'],
  ['film.fps', 'number'], ['film.durationSeconds', 'number'], ['film.shutterDegrees', 'number'],
  ['film.loopSeamless', 'boolean'], ['film.hookSeconds', 'number'], ['film.heroFrameSeconds', 'number'],
  ['film.macroFrameSeconds', 'number'],
  ...(['master', 'vertical', 'preview'] as const).flatMap((f): Array<[string, Kind]> => [
    [`formats.${f}.id`, 'string'], [`formats.${f}.width`, 'number'], [`formats.${f}.height`, 'number'],
  ]),
  ['platform.name', 'string'], ['platform.maxWidth', 'number'], ['platform.maxHeight', 'number'],
  ['platform.maxPortraitWidth', 'number'], ['platform.maxPortraitHeight', 'number'], ['platform.maxFps', 'number'],
  ['platform.maxBitrateMbps', 'number'], ['platform.loopsAtOrUnderSeconds', 'number'],
  ['export.container', 'string'], ['export.videoCodec', 'string'], ['export.bitrateMbps', 'number'],
  ['export.audio', 'string'], ['export.proofSeconds', 'number'], ['export.memoryTestSeconds', 'number'],
  ['export.files.master', 'string'], ['export.files.vertical', 'string'], ['export.files.preview', 'string'],
  ['tiers.draft.samplesPerFrame', 'number'], ['tiers.review.samplesPerFrame', 'number'],
  ['tiers.final.samplesPerFrame', 'number'],
  ['beats', 'array'],
  ['lens.focalLengthsMm', 'array'], ['lens.anamorphic', 'boolean'],
  ['paint.locked', 'nullable-string'], ['paint.candidates', 'array'],
  ['signage.generic', 'array'], ['signage.invented', 'array'],
  ['reference.minSourcesPerElement', 'number'], ['reference.minObservationsPerSource', 'number'],
  ['keyframes.directions', 'number'], ['keyframes.minImageModels', 'number'],
  ['quality.passScore', 'number'], ['quality.blockoutCompositionPass', 'number'], ['quality.plateauRounds', 'number'], ['quality.judgedFramesPerBeat', 'number'],
  ['quality.loopSeamMinSsim', 'number'], ['quality.compressionStressMbps', 'number'],
  ['quality.stress.seconds', 'number'], ['quality.stress.beats', 'array'], ['quality.stress.tier', 'string'],
  ['quality.stress.confirmTier', 'string'],
  ['quality.blind.jurors', 'number'], ['quality.blind.controlsPerRender', 'number'],
  ['quality.blind.minControlPool', 'number'], ['quality.blind.maxInvalidRuns', 'number'],
  ['quality.blind.maxGapPoints', 'number'], ['quality.blind.minControlMean', 'number'],
  ['quality.blind.minRenderMedian', 'number'],
  ['critics.maxImageLongEdgePx', 'number'], ['critics.contactSheetFrames', 'number'],
  ['critics.phonePreviewWidthPx', 'number'],
  ['sandbox.stepTimeoutMinutes', 'number'], ['sandbox.chunkBudgetMinutes', 'number'],
  ['sandbox.previewFilmMaxHours', 'number'], ['sandbox.maxRenderProcesses', 'number'],
]

function lookup(root: unknown, path: string): unknown {
  let node: unknown = root
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in (node as Record<string, unknown>))) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

function fail(message: string): never {
  throw new Error(`config/showcase.json: ${message}`)
}

export function validateConfig(input: unknown): ShowcaseConfig {
  if (input === null || typeof input !== 'object') fail('the file is not an object')
  for (const [path, kind] of required) {
    const value = lookup(input, path)
    if (value === undefined) fail(`missing key ${path}`)
    const ok =
      kind === 'array' ? Array.isArray(value)
      : kind === 'nullable-string' ? value === null || typeof value === 'string'
      : kind === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : typeof value === kind
    if (!ok) fail(`key ${path} must be ${kind}`)
  }
  const cfg = input as ShowcaseConfig
  if (cfg.beats.length === 0) fail('beats is empty')
  const ids = new Set<string>()
  cfg.beats.forEach((b, i) => {
    if (typeof b?.id !== 'string' || typeof b.start !== 'number' || typeof b.end !== 'number') fail(`beat ${i} is malformed`)
    if (ids.has(b.id)) fail(`beat id ${b.id} is repeated`)
    ids.add(b.id)
    if (!(b.end > b.start)) fail(`beat ${b.id} has no length`)
  })
  if (cfg.beats[0].start !== 0) fail('beats do not start at 0')
  for (let i = 1; i < cfg.beats.length; i++) {
    const prev = cfg.beats[i - 1]
    const next = cfg.beats[i]
    if (next.start > prev.end) fail(`gap between beats ${prev.id} and ${next.id}`)
    if (next.start < prev.end) fail(`beats ${prev.id} and ${next.id} overlap`)
  }
  const last = cfg.beats[cfg.beats.length - 1]
  if (last.end !== cfg.film.durationSeconds) fail('the last beat does not end at film.durationSeconds')
  if (!Number.isInteger(cfg.film.fps * cfg.film.durationSeconds)) fail('film.fps times film.durationSeconds is not a whole number')
  for (const t of ['draft', 'review', 'final'] as const) {
    const n = cfg.tiers[t].samplesPerFrame
    if (!Number.isInteger(n) || n < 1) fail(`tiers.${t}.samplesPerFrame must be a positive integer`)
  }
  if (cfg.paint.candidates.length === 0) fail('paint.candidates is empty')
  for (const p of cfg.paint.candidates) {
    if (typeof p?.id !== 'string' || typeof p.base !== 'string' || typeof p.flake !== 'string') fail('a paint candidate is malformed')
  }
  if (cfg.paint.locked !== null && !cfg.paint.candidates.some((p) => p.id === cfg.paint.locked)) {
    fail(`paint.locked ${cfg.paint.locked} is not in paint.candidates`)
  }
  if (cfg.lens.focalLengthsMm.length === 0) fail('lens.focalLengthsMm is empty')
  for (const b of cfg.quality.stress.beats) if (!ids.has(b)) fail(`quality.stress.beats names unknown beat ${b}`)
  for (const t of [cfg.quality.stress.tier, cfg.quality.stress.confirmTier]) {
    if (!(t in cfg.tiers)) fail(`quality.stress names unknown tier ${t}`)
  }
  return cfg
}

export const config: ShowcaseConfig = validateConfig(raw)

export type TierId = keyof ShowcaseConfig['tiers']
export type FormatKey = keyof ShowcaseConfig['formats']

export const frameCount = config.film.fps * config.film.durationSeconds
export const shutterSeconds = config.film.shutterDegrees / 360 / config.film.fps

export function formatById(id: string): FormatSpec {
  const hit = Object.values(config.formats).find((f) => f.id === id)
  if (!hit) throw new Error(`unknown format ${id}`)
  return hit
}

export function isTier(id: string): id is TierId {
  return id in config.tiers
}

export function paintById(id: string): PaintSpec {
  const hit = config.paint.candidates.find((p) => p.id === id)
  if (!hit) throw new Error(`unknown paint ${id}`)
  return hit
}

export const defaultPaint = config.paint.locked ?? config.paint.candidates[0].id
