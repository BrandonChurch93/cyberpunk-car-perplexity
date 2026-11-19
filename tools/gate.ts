import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { frameCount, formatById } from '../src/config.ts'
import { requiredExtensions, requiredLimits } from '../src/core/requirements.ts'
import { args, buildHash, config, readJson, repoRoot, workDir } from './lib/env.ts'
import { detailFrom, RenderSession, type StillRecord } from './lib/render.ts'
import { g5, g6, g7, g8, g9, g11 } from './lib/gates.ts'

interface Result {
  ok: boolean
  detail: string
}
type Check = () => Promise<Result> | Result

function run(cmd: string, argv: string[]): { ok: boolean; tail: string } {
  const r = spawnSync(cmd, argv, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n')
  return { ok: r.status === 0, tail: text.slice(-3).join(' / ') }
}

const a = args()
const phaseArg = a.phase ?? '0'

const checks: Record<string, Check> = {
  G1: () => {
    const r = run('npm', ['run', 'build'])
    return { ok: r.ok, detail: r.ok ? 'npm run build exited clean' : r.tail }
  },
  G2: () => {
    const r = run('npm', ['test'])
    return { ok: r.ok, detail: r.tail.replace(/\u001b\[[0-9;]*m/g, '') }
  },
  G3: () => {
    const r = run('npm', ['run', 'determinism'])
    return { ok: r.ok, detail: r.tail }
  },
  G4: async () => {
    const session = await RenderSession.open({ budgetMinutes: 0 })
    const problems: string[] = []
    let count = 0
    try {
      for (const format of Object.values(config.formats)) {
        const { record } = await session.still({ frame: 0, tier: 'draft', format, diag: 'beauty', paint: config.paint.locked ?? config.paint.candidates[0].id })
        if (record.width !== format.width || record.height !== format.height) problems.push(`${format.id} still is ${record.width} x ${record.height}`)
      }
      const page = await session.pageFor({ frame: 0, tier: 'draft', format: config.formats.preview, diag: 'beauty', paint: config.paint.locked ?? config.paint.candidates[0].id })
      const info = await page.evaluate(() => window.showcase!.info())
      if (info.frameCount !== config.film.fps * config.film.durationSeconds) problems.push(`info().frameCount is ${info.frameCount}`)
      if (info.frameCount !== frameCount) problems.push('info().frameCount differs from the config')
    } finally {
      await session.close()
    }
    const dir = join(workDir, 'stills')
    if (existsSync(dir)) {
      for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        const record = readJson<StillRecord>(join(dir, name))
        if (!record || record.buildHash !== buildHash()) continue
        count++
        const format = formatById(record.format)
        if (record.width !== format.width || record.height !== format.height) problems.push(`${name} is ${record.width} x ${record.height}`)
      }
    }
    return { ok: problems.length === 0, detail: problems.length ? problems.join('; ') : `${count} current stills match their format, frameCount ${frameCount}` }
  },
  G5: () => g5(Number(phaseArg), a.paint),
  G6: () => g6(),
  G7: () => g7(),
  G8: () => g8(),
  G9: () => g9(),
  G11: () => g11(),
  R1: () => {
    const r = run('npx', ['tsx', 'tools/board.ts', 'check'])
    return { ok: r.ok, detail: r.ok ? `every board element has at least ${config.reference.minSourcesPerElement} sources with at least ${config.reference.minObservationsPerSource} observations each` : r.tail }
  },
  R2: () => {
    const ledger = readJson<{ status: string; vettings: { median: number }[] }[]>(join(repoRoot, 'reference', 'controls.json')) ?? []
    const kept = ledger.filter((c) => c.status === 'kept' && c.vettings.length > 0 && c.vettings[c.vettings.length - 1].median >= config.quality.blind.minControlMean)
    const need = config.quality.blind.minControlPool
    const board = existsSync(join(repoRoot, 'reference', 'BOARD.md')) ? readFileSync(join(repoRoot, 'reference', 'BOARD.md'), 'utf8') : ''
    const listed = kept.filter((c) => board.includes((c as unknown as { id: string }).id)).length
    const ok = kept.length >= need && listed === kept.length
    return { ok, detail: `${kept.length} vetted controls kept, ${need} needed, ${listed} listed on the board` }
  },
  R3: () => {
    const dir = join(repoRoot, 'reference', 'keyframes')
    const files = existsSync(dir) ? readdirSync(dir) : []
    const prompts = files.includes('PROMPTS.md') ? readFileSync(join(dir, 'PROMPTS.md'), 'utf8') : ''
    const bad: string[] = []
    const directions = files.filter((f) => /^direction-/.test(f))
    if (directions.length < config.keyframes.directions) bad.push(`${directions.length} directions`)
    for (const f of directions) if (!prompts.includes(f)) bad.push(`${f} has no prompt`)
    config.beats.forEach((beat, i) => {
      const f = files.find((n) => n.startsWith(`${String(i + 1).padStart(2, '0')}-${beat.id}.`))
      if (!f) bad.push(`no key frame for ${beat.id}`)
      else if (!prompts.includes(f)) bad.push(`${f} has no prompt`)
    })
    const progress = readFileSync(join(repoRoot, 'kit', 'PROGRESS.md'), 'utf8')
    if (!/K1 scores/.test(progress)) bad.push('K1 scores are not logged')
    return { ok: bad.length === 0, detail: bad.length ? bad.join('; ') : `${directions.length} directions, one key frame for each of ${config.beats.length} beats, prompts and K1 scores logged` }
  },
  R4: () => {
    const path = join(repoRoot, 'cut', 'SHOTS.md')
    if (!existsSync(path)) return { ok: false, detail: 'cut/SHOTS.md is missing' }
    const text = readFileSync(path, 'utf8')
    const sections = text.split(/^## /m)
    const bad: string[] = []
    for (const [label, key] of [['master', 'formats.master'], ['vertical', 'formats.vertical']] as const) {
      const section = sections.find((s) => s.split('\n')[0].includes(key))
      if (!section) {
        bad.push(`no ${label} section`)
        continue
      }
      for (const beat of config.beats) {
        const row = section.split('\n').find((l) => l.startsWith(`| \`${beat.id}\``))
        const cells = row ? row.split('|').map((c) => c.trim()).filter(Boolean) : []
        if (cells.length < 8) bad.push(`${label} ${beat.id}`)
        else {
          const mm = Number(/(\d+) mm/.exec(cells[1])?.[1])
          if (!config.lens.focalLengthsMm.includes(mm)) bad.push(`${label} ${beat.id} lens`)
        }
      }
    }
    return { ok: bad.length === 0, detail: bad.length ? `incomplete: ${bad.join(', ')}` : `${config.beats.length} beats in both formats, each with lens, rig, move, start, end, focus and contents` }
  },
  G10: () => {
    const p = config.platform
    const f = config.formats
    const bad: string[] = []
    if (f.master.width > p.maxWidth || f.master.height > p.maxHeight) bad.push('master size')
    if (f.vertical.width > p.maxPortraitWidth || f.vertical.height > p.maxPortraitHeight) bad.push('vertical size')
    if (config.film.fps > p.maxFps) bad.push('fps')
    if (config.export.bitrateMbps > p.maxBitrateMbps) bad.push('bitrate')
    if (config.film.durationSeconds > p.loopsAtOrUnderSeconds) bad.push('duration')
    return { ok: bad.length === 0, detail: bad.length ? `outside the platform limits: ${bad.join(', ')}` : 'formats, fps, bitrate and duration fit the platform' }
  },
  G12: () => {
    const dir = join(repoRoot, 'public', 'assets', 'third-party')
    const files: string[] = []
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) walk(p)
        else files.push(p.slice(dir.length + 1))
      }
    }
    if (existsSync(dir)) walk(dir)
    const ledger = existsSync(join(repoRoot, 'ASSETS.md')) ? readFileSync(join(repoRoot, 'ASSETS.md'), 'utf8') : ''
    const missing = files.filter((f) => !ledger.includes(`\`${f}\``) && !ledger.includes(`\`public/assets/third-party/${f}\``))
    return { ok: missing.length === 0, detail: missing.length ? `not in ASSETS.md: ${missing.slice(0, 5).join(', ')}` : `${files.length} third-party files, all listed` }
  },
  G13: () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' }).split('\n').filter(Boolean)
    const bad: string[] = []
    const secret = /(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{20,})/
    for (const f of tracked) {
      const p = join(repoRoot, f)
      if (!existsSync(p)) continue
      const size = statSync(p).size
      if (size > config.repo.maxFileMb * 1024 * 1024) bad.push(`${f} is over the size limit`)
      if (f.startsWith('reference/cache/') || f.startsWith('out/work/')) bad.push(`${f} is tracked`)
      if (/(^|\/)\.env(\..*)?$/.test(f)) bad.push(`${f} is tracked`)
      if (size < 2 * 1024 * 1024 && !/\.(png|jpg|jpeg|webp|mp4|glb|bin|hdr|exr|ktx2|woff2|ttf|otf)$/i.test(f) && secret.test(readFileSync(p, 'utf8'))) bad.push(`${f} looks like it holds a secret`)
    }
    return { ok: bad.length === 0, detail: bad.length ? bad.slice(0, 5).join('; ') : `${tracked.length} tracked files, none too large, no secret, no cache or work output` }
  },
  G14: () => {
    const caps = readJson<{ limits: Record<string, number>; extensions: string[] }>(join(repoRoot, 'config', 'webgl-caps.json'))
    if (!caps) return { ok: false, detail: 'config/webgl-caps.json is missing' }
    const bad: string[] = []
    for (const e of requiredExtensions) if (!caps.extensions.includes(e)) bad.push(e)
    for (const [k, v] of Object.entries(requiredLimits)) if (!(k in caps.limits) || caps.limits[k] < v) bad.push(`${k} ${v}`)
    const src = execFileSync('grep', ['-rhoE', "getExtension\\(['\"][A-Za-z0-9_]+['\"]\\)", join(repoRoot, 'src')], { encoding: 'utf8' }).split('\n').filter(Boolean)
    for (const hit of src) {
      const name = hit.replace(/getExtension\(['"]|['"]\)/g, '')
      if (!caps.extensions.includes(name)) bad.push(`${name} requested in src`)
    }
    return { ok: bad.length === 0, detail: bad.length ? `outside the recorded set: ${bad.join(', ')}` : `${requiredExtensions.length} extensions and ${Object.keys(requiredLimits).length} limits required, all inside the recorded set` }
  },
}

const phases: Record<string, string[]> = {
  '0': ['G1', 'G2', 'G3', 'G4'],
  '1': ['G1', 'G2', 'R1', 'R2', 'R3', 'R4', 'G12', 'G13'],
  '2': ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'],
  '3': ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14'],
  '4': ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14'],
  '5': ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14'],
}

async function main(): Promise<void> {
  const phase = phaseArg
  const only = a.only ? a.only.split(',') : null
  const skip = a.skip ? a.skip.split(',') : []
  const ids = (phases[phase] ?? []).filter((id) => (!only || only.includes(id)) && !skip.includes(id))
  if (ids.length === 0) throw new Error(`no checks for phase ${phase}`)
  console.log(`gate for phase ${phase}, build ${buildHash()}, ${detailFrom()} detail`)
  let failed = 0
  for (const id of ids) {
    const check = checks[id]
    let result: Result
    try {
      result = check ? await check() : { ok: false, detail: 'this check is not built yet' }
    } catch (error) {
      result = { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
    if (!result.ok) failed++
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${id}: ${result.detail}`)
  }
  console.log(failed === 0 ? 'GATE GREEN' : `GATE RED: ${failed} failed`)
  process.exit(failed === 0 ? 0 : 2)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
