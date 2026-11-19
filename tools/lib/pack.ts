import { frameCount } from '../../src/config.ts'
import { events } from '../../src/director/timeline.ts'
import { config } from './env.ts'

/** Words no name or caption shown to a critic may contain, as substrings. */
const forbiddenParts = [
  'render', 'real', 'photo', 'final', 'ref', 'control', 'judge', 'synth', 'generat', 'fake', 'trace', 'raster', 'shader',
  'webgl', 'opengl', 'three', 'capture', 'stock', 'blender', 'unreal', 'octane', 'vray', 'redshift', 'arnold', 'diffusion',
  'midjourney', 'model', 'sample', 'tier', 'draft', 'review', 'blockout', 'clay', 'zebra', 'beauty', 'stress', 'encode',
  'x264', 'h264', 'crf', 'test', 'camera', 'lens', 'swiftshader', 'denois', 'accumul', 'key',
]
/** Words that are only forbidden as whole tokens, since they are common inside other words. */
const forbiddenTokens = ['cg', 'cgi', 'ai', 'gan', 'gl', 'pbr', 'ray', 'path', 'sim', 'vfx', '3d', 'gpu', 'cpu', 'nerf', 'vae']

export function neutralProblems(text: string): string[] {
  const lower = text.toLowerCase()
  const found = forbiddenParts.filter((w) => lower.includes(w))
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean)
  for (const t of forbiddenTokens) if (tokens.includes(t)) found.push(t)
  return found
}

export function isNeutral(text: string): boolean {
  return neutralProblems(text).length === 0
}

export function neutralName(set: string, index: number, extension = 'png'): string {
  if (!/^[A-Z]$/.test(set)) throw new Error(`set ${set} is not one capital letter`)
  return `set-${set}-${String(index).padStart(2, '0')}.${extension}`
}

export function roundName(round: number): string {
  if (!Number.isInteger(round) || round < 1) throw new Error(`round ${round} is not a positive whole number`)
  return `round-${String(round).padStart(3, '0')}`
}

export const fps = (): number => config.film.fps

export function beatFrames(beatId: string): { first: number; middle: number; last: number } {
  const beat = config.beats.find((b) => b.id === beatId)
  if (!beat) throw new Error(`unknown beat ${beatId}`)
  const first = Math.round(beat.start * fps())
  const last = Math.round(beat.end * fps()) - 1
  return { first, middle: Math.round((first + last) / 2), last }
}

/** One frame from the start, the middle and the end of every beat. */
export function beatMoments(): Array<{ beat: string; index: number; moment: 'start' | 'middle' | 'end'; frame: number }> {
  return config.beats.flatMap((b, index) => {
    const f = beatFrames(b.id)
    return [
      { beat: b.id, index, moment: 'start' as const, frame: f.first },
      { beat: b.id, index, moment: 'middle' as const, frame: f.middle },
      { beat: b.id, index, moment: 'end' as const, frame: f.last },
    ]
  })
}

/** Frame 0 and frames spread across the hook. */
export function hookFrames(): number[] {
  const n = Math.max(2, Math.floor(config.critics.contactSheetFrames / 2))
  const last = Math.round(config.film.hookSeconds * fps()) - 1
  return Array.from({ length: n }, (_, i) => Math.round((last * i) / (n - 1)))
}

export function heroFrame(): number {
  return Math.round(config.film.heroFrameSeconds * fps())
}

export function macroFrame(): number {
  return Math.round(config.film.macroFrameSeconds * fps())
}

/** Runs of consecutive frames centered on each timeline event, never crossing the end of the film. */
export function eventRuns(): Array<{ event: string; seconds: number; frames: number[] }> {
  const n = config.critics.contactSheetFrames
  const seen = new Set<number>()
  const out: Array<{ event: string; seconds: number; frames: number[] }> = []
  for (const [event, seconds] of Object.entries(events).sort((a, b) => a[1] - b[1])) {
    const center = Math.round(seconds * fps())
    if (seen.has(center)) continue
    seen.add(center)
    const start = Math.min(Math.max(0, center - Math.floor(n / 2)), frameCount - n)
    out.push({ event, seconds, frames: Array.from({ length: n }, (_, i) => start + i) })
  }
  return out
}

/** The text under a "###" heading that starts with the given words, heading included, up to the next heading of level 3 or above. */
export function extractSection(markdown: string, headingStart: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`### ${headingStart}`))
  if (start < 0) throw new Error(`no section starting with "### ${headingStart}"`)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,3}\s/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n').trim()
}

/** The JSON return block under "The critics", fence included, and the line that defines its fields. */
export function returnFormat(markdown: string): string {
  const lines = markdown.split('\n')
  const section = lines.findIndex((l) => /^##\s+The critics\s*$/.test(l))
  if (section < 0) throw new Error('no "The critics" section')
  const open = lines.findIndex((l, i) => i > section && l.trim() === '```json')
  const close = lines.findIndex((l, i) => i > open && l.trim() === '```')
  if (open < 0 || close < 0) throw new Error('no JSON return block')
  const out = lines.slice(open, close + 1)
  const fields = lines.findIndex((l, i) => i > close && l.startsWith('- `score`'))
  if (fields > 0 && lines.slice(close + 1, fields).every((l) => l.trim() === '')) out.push('', lines[fields])
  return out.join('\n')
}

/** The jury text: the quoted block in the C1 section, without the quote marks. */
export function juryText(markdown: string): string {
  const section = extractSection(markdown, 'C1 ')
  const quoted = section.split('\n').filter((l) => l.startsWith('>'))
  if (quoted.length === 0) throw new Error('the C1 section has no quoted jury text')
  return quoted.map((l) => l.replace(/^>\s?/, '')).join('\n').trim()
}

/** Seeded Fisher-Yates. */
export function shuffle<T>(items: T[], next: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
