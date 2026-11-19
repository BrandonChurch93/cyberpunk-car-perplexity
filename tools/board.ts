/**
 * The reference board.
 *   assemble   join reference/board/NN-*.md and the control ledger into reference/BOARD.md
 *   check      count sources and observations per element against the config
 *   links      request every source URL once and report the ones that do not answer
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config, readJson, repoRoot, writeJson, workDir } from './lib/env.ts'

const boardDir = join(repoRoot, 'reference', 'board')
const boardPath = join(repoRoot, 'reference', 'BOARD.md')

export interface Source {
  id: string
  title: string
  url: string
  observations: number
}
export interface Element {
  title: string
  sources: Source[]
}

export function parseBoard(text: string): Element[] {
  const elements: Element[] = []
  let element: Element | null = null
  let source: Source | null = null
  let inObservations = false
  for (const line of text.split('\n')) {
    const h2 = /^## (.+)$/.exec(line)
    if (h2) {
      element = { title: h2[1].trim(), sources: [] }
      elements.push(element)
      source = null
      continue
    }
    const h4 = /^#### (S\d+) · (.+)$/.exec(line)
    if (h4 && element) {
      source = { id: h4[1], title: h4[2].trim(), url: '', observations: 0 }
      element.sources.push(source)
      inObservations = false
      continue
    }
    if (/^### /.test(line)) {
      source = null
      continue
    }
    if (!source) continue
    const url = /^- URL: (\S+)/.exec(line)
    if (url) source.url = url[1]
    if (/^- Observations:/.test(line)) inObservations = true
    else if (inObservations && /^\s+\d+\. \S/.test(line)) source.observations++
    else if (/^- /.test(line)) inObservations = false
  }
  return elements
}

export const elementTitles = [
  'Wet asphalt and concrete at night under colored light',
  'Puddles in rain',
  'Rooftop car park decks',
  'Rain lit from behind',
  'Rain hitting hard surfaces',
  'Neon and LED signage in rain and haze',
  'A dense city at night in rain',
  'Water on glossy coated paint, macro',
  'Water on glass',
  'Steam and heat shimmer in rain',
  'Night automotive photography and film',
  'Wet metal, wet rubber, wet painted steel',
  'Real camera moves on vehicles',
]

export function checkBoard(text: string): string[] {
  const problems: string[] = []
  const elements = parseBoard(text)
  for (const title of elementTitles) {
    const element = elements.find((e) => e.title === title)
    if (!element) {
      problems.push(`missing element: ${title}`)
      continue
    }
    const good = element.sources.filter((s) => /^https?:\/\//.test(s.url) && s.observations >= config.reference.minObservationsPerSource)
    if (good.length < config.reference.minSourcesPerElement) problems.push(`${title}: ${good.length} complete sources, needs ${config.reference.minSourcesPerElement}`)
    for (const s of element.sources) {
      if (!/^https?:\/\//.test(s.url)) problems.push(`${title} ${s.id}: no URL`)
      else if (s.observations < config.reference.minObservationsPerSource) problems.push(`${title} ${s.id}: ${s.observations} observations`)
    }
  }
  return problems
}

interface Control {
  id: string
  pageUrl: string
  source: string
  license: string
  category: string
  description: string
  status: string
  excluded?: string
  vettings: { date: string; families: string[]; likelihoods: number[]; median: number }[]
}

function controlsSection(): string {
  const controls = (readJson<Control[]>(join(repoRoot, 'reference', 'controls.json')) ?? []).filter((c) => c.status !== 'candidate')
  const kept = controls.filter((c) => c.status === 'kept')
  const rows = controls.map((c) => {
    const v = c.vettings.at(-1)!
    return `| ${c.id} | [${c.description.replace(/\|/g, '/')}](${c.pageUrl}) | ${c.source}, ${c.license} | ${c.category} | ${v.likelihoods.join(', ')} | ${v.median} | ${c.status}${c.excluded ? '. ' + c.excluded : ''} |`
  })
  return [
    '## Controls',
    '',
    'Photographs for the blind test. The images stay in `reference/cache/controls/`. The ledger behind this table is `reference/controls.json`.',
    '',
    `- Vetting: each candidate went, one image per call, to ${config.quality.blind.jurors} fresh jurors on different model families with the C1 text. A candidate is kept when its median likelihood is at least ${config.quality.blind.minControlMean}.`,
    `- Kept: ${kept.length}. The pool needs at least ${config.quality.blind.minControlPool}.`,
    '- Every candidate was prepared the way a judged frame is: centre crop to the master aspect, resized to the critic limit, PNG, no metadata.',
    '',
    '| Id | Photograph | Source and license | Kind | Juror likelihoods | Median | Result |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

function assemble(): void {
  const files = readdirSync(boardDir).filter((f) => /^\d\d-.*\.md$/.test(f)).sort()
  const parts = files.map((f) => readFileSync(join(boardDir, f), 'utf8').trim())
  const head = [
    '# Reference board',
    '',
    'One section per element in `kit/06-REFERENCE.md`. Every source has its URL, what it shows, and observations specific enough to check a still against. Sizes carry the source they came from. Downloaded copies live in `reference/cache/`, which git ignores.',
    '',
    'This file is assembled by `npx tsx tools/board.ts assemble` from `reference/board/` and `reference/controls.json`. Edit those, not this file.',
    '',
    'What the vehicle is, and its own sources, are in `reference/vehicle/`.',
    '',
  ].join('\n')
  const text = head + '\n' + parts.join('\n\n') + '\n\n' + controlsSection()
  writeFileSync(boardPath, text)
  const problems = checkBoard(text)
  console.log(`wrote reference/BOARD.md: ${files.length} elements, ${parseBoard(text).reduce((n, e) => n + e.sources.length, 0)} sources`)
  for (const p of problems) console.log('PROBLEM ' + p)
}

async function links(): Promise<void> {
  const elements = parseBoard(readFileSync(boardPath, 'utf8'))
  const all = elements.flatMap((e) => e.sources.map((s) => ({ element: e.title, ...s })))
  const results: { element: string; id: string; url: string; status: number | string }[] = []
  let next = 0
  async function worker(): Promise<void> {
    while (next < all.length) {
      const s = all[next++]
      let status: number | string
      try {
        const res = await fetch(s.url, { redirect: 'follow', signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', accept: 'text/html,*/*' } })
        status = res.status
        await res.body?.cancel()
      } catch (e) {
        status = String((e as Error).name)
      }
      results.push({ element: s.element, id: s.id, url: s.url, status })
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  writeJson(join(workDir, 'board-links.json'), results)
  const bad = results.filter((r) => r.status !== 200)
  console.log(`${results.length} links, ${results.length - bad.length} answered 200`)
  for (const r of bad) console.log(`${r.status} ${r.element} ${r.id} ${r.url}`)
}

const command = process.argv[2]
if (command === 'assemble') assemble()
else if (command === 'check') {
  const problems = checkBoard(readFileSync(boardPath, 'utf8'))
  for (const p of problems) console.log('PROBLEM ' + p)
  console.log(problems.length ? 'BOARD FAIL' : 'BOARD PASS')
  process.exit(problems.length ? 1 : 0)
} else if (command === 'links') await links()
