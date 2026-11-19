import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { defaultPaint, frameCount, paintById } from '../src/config.ts'
import { args, buildHash, config, ensureDir, readJson, repoRoot, workDir, writeJson } from './lib/env.ts'
import { filmMatches, filmPath, recordPathFor, type FilmRecord } from './lib/film.ts'
import { judgedFrames } from './lib/judged.ts'
import { detailFrom, recordMatches, stillName, type StillRecord, type StillSpec } from './lib/render.ts'
import { runTool } from './lib/render.ts'

const tierOrder = ['final', 'review', 'draft'] as const

void runTool(async () => {
  const a = args()
  const paint = paintById(a.paint ?? defaultPaint).id
  const hash = buildHash()
  const detail = detailFrom(a.detail)
  const outDir = ensureDir(join(repoRoot, 'out'))
  const stillsOut = join(outDir, 'stills')
  const judged = judgedFrames()
  const wanted: StillSpec[] = []
  for (const j of judged) {
    wanted.push({ frame: j.frame, tier: 'final', format: config.formats.master, diag: 'beauty', paint, detail })
    if (j.vertical) wanted.push({ frame: j.frame, tier: 'final', format: config.formats.vertical, diag: 'beauty', paint, detail })
  }
  let problems = 0
  const found: StillSpec[] = []
  const missing: string[] = []
  for (const spec of wanted) {
    const file = join(workDir, 'stills', `${stillName(spec)}.png`)
    const record = readJson<StillRecord>(file.replace(/\.png$/, '.json'))
    if (existsSync(file) && recordMatches(record, spec, hash) && record.check.ok) found.push(spec)
    else missing.push(stillName(spec))
  }
  if (judged.length === 0) {
    console.log('the judged frame table in kit/PROGRESS.md is empty, so no stills are kept. out/stills/ is left as it is')
  } else {
    ensureDir(stillsOut)
    const keepNames = new Set(found.flatMap((s) => [`${stillName(s)}.png`, `${stillName(s)}.json`]))
    if (missing.length === 0) {
      for (const name of readdirSync(stillsOut)) if (!keepNames.has(name)) rmSync(join(stillsOut, name), { force: true })
    }
    for (const spec of found) {
      const src = join(workDir, 'stills', `${stillName(spec)}.png`)
      copyFileSync(src, join(stillsOut, `${stillName(spec)}.png`))
      copyFileSync(src.replace(/\.png$/, '.json'), join(stillsOut, `${stillName(spec)}.json`))
    }
    console.log(`kept ${found.length} of ${wanted.length} judged stills in ${stillsOut}`)
    if (missing.length > 0) {
      problems++
      console.log(`MISSING ${missing.length} judged ${detail} stills with a record matching build ${hash}: ${missing.join(', ')}`)
      console.log('render them with npm run still at the final tier, then run keep again. Older files in out/stills/ were left in place')
    }
  }

  const preview = config.formats.preview
  let kept = false
  for (const tier of tierOrder) {
    const spec = { tier, format: preview, paint, diag: 'beauty', detail }
    const film = filmPath(spec)
    const record = readJson<FilmRecord>(recordPathFor(film))
    if (!existsSync(film) || !filmMatches(record, spec, hash, 0, frameCount - 1)) continue
    copyFileSync(film, join(outDir, 'preview.mp4'))
    writeJson(join(outDir, 'preview.json'), record)
    console.log(`kept ${film} as out/preview.mp4 (${tier} tier, ${detail} detail, ${record.frameCount} frames, build ${hash})`)
    kept = true
    break
  }
  if (!kept) {
    problems++
    console.log(`MISSING: no ${preview.id} ${detail} film matches build ${hash}. Run npm run film -- --format ${preview.id} --detail ${detail} --tier <tier> first. out/preview.mp4 is left as it is`)
  }
  return problems === 0 ? 0 : 2
})
