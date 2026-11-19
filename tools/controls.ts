/**
 * The control pool for the blind test.
 *   add <folder>            read reference/cache/controls/<folder>/manifest.json, prepare each candidate, add it to the ledger
 *   vet [--count n]         issue one-image tickets for candidates that still need votes
 *   record <serial> <0-100> <why>
 *   status                  counts, kept and dropped
 *   exclude <id> <why>      drop a control that breaks a pool rule
 *   restore                 download again any image the cache has lost, from the URL in the ledger
 *   board                   print the "Controls" section for reference/BOARD.md
 * The ledger (URLs and scores, no images) is reference/controls.json. Images stay in reference/cache/.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { config, ensureDir, readJson, repoRoot, writeJson } from './lib/env.ts'
import { families, issue, jurorsPerImage, juryText, loadTickets, mean, median, record } from './lib/jury.ts'

interface Control {
  id: string
  pageUrl: string
  imageUrl: string
  source: string
  license: string
  photographer: string
  category: string
  description: string
  cacheFile: string
  /** One entry per vetting pass: the likelihoods in juror order. */
  vettings: { date: string; families: string[]; likelihoods: number[]; median: number }[]
  status: 'candidate' | 'kept' | 'dropped'
  excluded?: string
}

const ledgerPath = join(repoRoot, 'reference', 'controls.json')
const cacheDir = join(repoRoot, 'reference', 'cache', 'controls')
const poolDir = join(cacheDir, 'pool')
const limit = config.critics.maxImageLongEdgePx
const master = config.formats.master
const outW = limit
const outH = Math.round((limit * master.height) / master.width)

function load(): Control[] {
  return readJson<Control[]>(ledgerPath) ?? []
}

export function controlImage(id: string): string {
  return join(poolDir, `${id}.png`)
}

/** Centre crop to the master aspect at the pack size. No metadata survives the raw round trip. */
async function prepare(src: string, dst: string): Promise<void> {
  const { data, info } = await sharp(src).rotate().resize(outW, outH, { fit: 'cover', position: 'centre', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png({ compressionLevel: 6 }).toFile(dst)
}

async function add(folder: string): Promise<void> {
  const controls = load()
  const manifest = JSON.parse(readFileSync(join(cacheDir, folder, 'manifest.json'), 'utf8')) as Record<string, string>[]
  ensureDir(poolDir)
  let added = 0
  for (const row of manifest) {
    const src = join(cacheDir, folder, row.file)
    if (!existsSync(src)) {
      console.log(`missing ${folder}/${row.file}`)
      continue
    }
    const id = 'k' + createHash('sha256').update(row.imageUrl ?? row.pageUrl).digest('hex').slice(0, 8)
    if (controls.some((c) => c.id === id || c.pageUrl === row.pageUrl)) continue
    await prepare(src, controlImage(id))
    controls.push({
      id,
      pageUrl: row.pageUrl,
      imageUrl: row.imageUrl,
      source: row.source,
      license: row.license,
      photographer: row.photographer,
      category: row.category,
      description: row.description,
      cacheFile: `${folder}/${row.file}`,
      vettings: [],
      status: 'candidate',
    })
    added++
  }
  writeJson(ledgerPath, controls)
  console.log(`added ${added}, ledger holds ${controls.length}`)
}

/** Fold finished tickets into the ledger. A candidate is settled when every juror of its vetting pass has answered. */
async function restore(): Promise<void> {
  ensureDir(poolDir)
  let fetched = 0
  let failed = 0
  for (const c of load()) {
    if (existsSync(controlImage(c.id))) continue
    const src = join(cacheDir, c.cacheFile)
    if (!existsSync(src)) {
      try {
        const res = await fetch(c.imageUrl, { redirect: 'follow', signal: AbortSignal.timeout(60000), headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } })
        if (!res.ok) throw new Error(String(res.status))
        ensureDir(dirname(src))
        writeFileSync(src, Buffer.from(await res.arrayBuffer()))
      } catch (e) {
        failed++
        console.log(`could not fetch ${c.id}: ${(e as Error).message}`)
        continue
      }
    }
    await prepare(src, controlImage(c.id))
    fetched++
  }
  console.log(`restored ${fetched}, failed ${failed}`)
}

function fold(): Control[] {
  const controls = load()
  const tickets = loadTickets().filter((t) => t.run.startsWith('vet:'))
  const groups = new Map<string, typeof tickets>()
  for (const t of tickets) {
    const key = `${t.run}|${t.subject}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  for (const [key, group] of groups) {
    if (group.some((t) => t.likelihood === undefined)) continue
    const [run, id] = key.split('|')
    const control = controls.find((c) => c.id === id)
    if (!control) continue
    const date = run.slice(4)
    if (control.vettings.some((v) => v.date === date)) continue
    const likelihoods = group.map((t) => t.likelihood as number)
    const med = median(likelihoods)
    control.vettings.push({ date, families: group.map((t) => t.family), likelihoods, median: med })
    control.status = !control.excluded && med >= config.quality.blind.minControlMean ? 'kept' : 'dropped'
  }
  writeJson(ledgerPath, controls)
  return controls
}

function vet(count: number, pass: string, only: string | undefined): void {
  const controls = fold()
  const run = `vet:${pass}`
  const open = new Set(loadTickets().filter((t) => t.run === run).map((t) => t.subject))
  const want = controls.filter((c) => !open.has(c.id) && !c.vettings.some((v) => v.date === pass) && (only ? c.status === only : c.status === 'candidate')).slice(0, count)
  const tickets = issue(
    run,
    want.map((c, i) => ({
      subject: c.id,
      image: controlImage(c.id),
      // Two fixed families and a rotating third, so no family carries every call.
      families: [families[0], families[1], families[2 + (i % (families.length - 2))]].slice(0, jurorsPerImage),
    })),
  )
  console.log(JSON.stringify(tickets.map((t) => ({ agent: t.agent, model: t.family, file: t.file }))))
  console.log(`TEXT: ${juryText}`)
}

function status(): void {
  const controls = fold()
  const kept = controls.filter((c) => c.status === 'kept')
  const dropped = controls.filter((c) => c.status === 'dropped')
  const waiting = loadTickets().filter((t) => t.likelihood === undefined)
  console.log(`candidates ${controls.length}, kept ${kept.length}, dropped ${dropped.length}, not yet vetted ${controls.length - kept.length - dropped.length}`)
  console.log(`pool needs ${config.quality.blind.minControlPool}; kept mean of medians ${mean(kept.map((c) => c.vettings.at(-1)!.median)).toFixed(1)}`)
  console.log(`open tickets: ${waiting.map((t) => t.serial).join(' ') || 'none'}`)
  const by = new Map<string, number>()
  for (const c of kept) by.set(c.category, (by.get(c.category) ?? 0) + 1)
  console.log('kept by category: ' + [...by].map(([k, v]) => `${k} ${v}`).join(', '))
}

function board(): void {
  const controls = fold()
  const rows = controls
    .filter((c) => c.status !== 'candidate')
    .map((c) => {
      const v = c.vettings.at(-1)!
      return `| ${c.id} | [${c.source}: ${c.description.replace(/\|/g, '/')}](${c.pageUrl}) | ${c.category} | ${c.license} | ${v.likelihoods.join(', ')} | ${v.median} | ${c.status}${c.excluded ? '. ' + c.excluded : ''} |`
    })
  console.log('| Id | Photograph | Kind | License | Juror likelihoods | Median | Result |\n| --- | --- | --- | --- | --- | --- | --- |\n' + rows.join('\n'))
}

const [command, ...rest] = process.argv.slice(2)
const flag = (name: string, fallback: string): string => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : fallback
}
if (command === 'add') await add(rest[0])
else if (command === 'vet') vet(Number(flag('count', '10')), flag('pass', '1'), rest.includes('--again') ? 'kept' : undefined)
else if (command === 'record') {
  const t = record(Number(rest[0]), Number(rest[1]), rest.slice(2).join(' '))
  console.log(`recorded ${t.agent} ${t.subject} ${t.likelihood}`)
  fold()
} else if (command === 'exclude') {
  const controls = load()
  const control = controls.find((c) => c.id === rest[0])
  if (!control) throw new Error(`no control ${rest[0]}`)
  control.status = 'dropped'
  control.excluded = rest.slice(1).join(' ')
  writeJson(ledgerPath, controls)
  console.log(`excluded ${control.id}`)
} else if (command === 'restore') await restore()
else if (command === 'status') status()
else if (command === 'board') board()
else console.log('usage: controls add|vet|record|status|board')
