import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { config, ensureDir, readJson, workDir, writeJson } from './env.ts'

/** Ledger for one-image calls. One ticket is one fresh agent that sees one file. */
export interface Ticket {
  serial: number
  agent: string
  file: string
  run: string
  subject: string
  family: string
  likelihood?: number
  why?: string
}

export const juryText =
  'You will see one image. It is either a photograph or a computer generated image. Give a likelihood from 0 to 100 that it is a photograph, and the one thing that most influenced your answer.'

/** Model families with image input, as verified in the workspace record. The first `quality.blind.jurors` are the default set. */
export const families = ['claude_opus_5_5', 'gpt_6_2_sol', 'gemini_4_carbon', 'pplx_computer_glm_5_3_1009', 'kimi_k3', 'grok_4_7']

const juryDir = join(workDir, 'jury')
const ledgerPath = join(juryDir, 'tickets.json')

export function loadTickets(): Ticket[] {
  return readJson<Ticket[]>(ledgerPath) ?? []
}

function saveTickets(tickets: Ticket[]): void {
  writeJson(ledgerPath, tickets)
}

/** Issue one ticket per (subject, family). The image is copied under a neutral name that carries only the serial. */
export function issue(run: string, items: { subject: string; image: string; families: string[] }[]): Ticket[] {
  const tickets = loadTickets()
  let serial = tickets.reduce((m, t) => Math.max(m, t.serial), 0)
  const made: Ticket[] = []
  for (const item of items) {
    for (const family of item.families) {
      serial++
      const tag = String(serial).padStart(4, '0')
      const dir = ensureDir(join(juryDir, 'files'))
      const file = join(dir, `set-Q-${tag}.png`)
      copyFileSync(item.image, file)
      const ticket: Ticket = { serial, agent: `reviewer_${tag}`, file, run, subject: item.subject, family }
      tickets.push(ticket)
      made.push(ticket)
    }
  }
  saveTickets(tickets)
  return made
}

export function record(serial: number, likelihood: number, why: string): Ticket {
  const tickets = loadTickets()
  const ticket = tickets.find((t) => t.serial === serial)
  if (!ticket) throw new Error(`no ticket ${serial}`)
  if (!(likelihood >= 0 && likelihood <= 100)) throw new Error(`likelihood out of range: ${likelihood}`)
  ticket.likelihood = likelihood
  ticket.why = why
  saveTickets(tickets)
  return ticket
}

export function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b)
  const n = v.length
  return n === 0 ? NaN : n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2
}

export function mean(values: number[]): number {
  return values.length === 0 ? NaN : values.reduce((a, b) => a + b, 0) / values.length
}

export const jurorsPerImage = config.quality.blind.jurors
