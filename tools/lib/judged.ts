import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { frameCount } from '../../src/config.ts'
import { repoRoot } from './env.ts'

export interface JudgedFrame {
  frame: number
  vertical: boolean
  beat: string
  why: string
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

const yes = /^(yes|y|true|x|vertical|both)\b/i

/** Reads the table under the "Judged frames" heading. Columns are found by their header names. */
export function parseJudged(markdown: string): JudgedFrame[] {
  const lines = markdown.split('\n')
  const start = lines.findIndex((l) => /^#{2,3}\s+Judged frames\s*$/.test(l))
  if (start < 0) throw new Error('no "Judged frames" heading')
  let header: string[] | null = null
  const out: JudgedFrame[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^#{1,3}\s/.test(line)) break
    if (!line.trim().startsWith('|')) {
      if (header) break
      continue
    }
    const row = cells(line)
    if (!header) {
      header = row.map((c) => c.toLowerCase())
      continue
    }
    if (row.every((c) => /^:?-+:?$/.test(c))) continue
    const col = (name: RegExp): number => header!.findIndex((h) => name.test(h))
    const fi = col(/frame/)
    const vi = col(/vertical/)
    const bi = col(/beat/)
    const wi = col(/why/)
    const frame = Number(row[fi]?.replace(/[`\s]/g, ''))
    if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) throw new Error(`judged frame "${row[fi]}" is not a frame index from 0 to ${frameCount - 1}`)
    if (out.some((j) => j.frame === frame)) throw new Error(`judged frame ${frame} is listed twice`)
    out.push({ frame, vertical: vi >= 0 && yes.test(row[vi] ?? ''), beat: bi >= 0 ? (row[bi] ?? '').replace(/`/g, '') : '', why: wi >= 0 ? row[wi] ?? '' : '' })
  }
  return out
}

export function judgedFrames(): JudgedFrame[] {
  return parseJudged(readFileSync(join(repoRoot, 'kit', 'PROGRESS.md'), 'utf8'))
}
