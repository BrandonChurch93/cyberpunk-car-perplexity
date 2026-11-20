import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { defaultPaint, formatById, frameCount, isTier, paintById } from '../src/config.ts'
import { diagnosticViews } from '../src/diagnostics/views.ts'
import { args, buildHash, config, ensureDir, readJson, workDir, writeJson } from './lib/env.ts'
import { bundleFrames, emptyFrames, encodeFilm, unbundleFrames, filmMatches, filmPath, frameChecks, frameFileName, frameSpec, framesDir, missingFrames, rangeFromArgs, recordPathFor, verifyFilm, type FilmRecord, type FilmSpec } from './lib/film.ts'
import { megabytes } from './lib/probe.ts'
import { detailFrom, OutOfBudget, RenderSession, runTool, type StillRecord } from './lib/render.ts'

const freshPageEvery = 300

const help = `npm run film -- [--format preview] [--tier draft] [--detail blockout|full] [--paint id] [--diag beauty]
  [--first F --last L] [--parts P --part K] [--bundle] [--unbundle file.tar,...|folder] [--assemble] [--budget minutes] [--force]

Renders every frame as a PNG with a record, then encodes the film when the whole range is present.
A frame is a pure function of its index, so a frame rendered in any part on any machine is identical
to the same frame of a single run. Exit 75 with a CONTINUE line means the chunk budget ran out: run
the same command again and it resumes where it stopped.

Across machines, P parts of the whole film, on the machine of part K (K = 1 to P):
  npm run film -- --format preview --tier draft --detail blockout --parts P --part K --budget 0 --bundle
  This renders part K and writes tar files of at most ${config.repo.maxFileMb * 0.95} MB to out/work/parts/,
  each holding frame PNGs, their records and a bundle.json that names format, tier, detail, paint and build.
Send every tar file as an attachment to the machine that assembles. There, from the same commit:
  npm run film -- --format preview --tier draft --detail blockout --unbundle out/work/parts --assemble
  This unpacks every tar in the folder (or a comma list of files), checks each frame's record against the
  current build, encodes the film and runs G5 on every frame. Frames already rendered there are kept and
  compared byte for byte with the bundled copy; any difference stops the command. To prove two machines
  agree, render one frame on both, for example with --first and --last on the last frame of the part before.
`

void runTool(async () => {
  const a = args()
  if (a.help === 'true') {
    console.log(help)
    return 0
  }
  if (a.unbundle !== undefined) {
    const list = existsSync(a.unbundle) && statSync(a.unbundle).isDirectory() ? readdirSync(a.unbundle).filter((n) => n.endsWith('.tar')).sort().map((n) => join(a.unbundle, n)) : a.unbundle.split(',')
    if (list.length === 0) throw new Error(`no tar files in ${a.unbundle}`)
    let differing = 0
    for (const u of unbundleFrames(list)) {
      console.log(`unpacked ${u.file}: frames ${u.record.frames[0]} to ${u.record.frames[u.record.frames.length - 1]} of build ${u.record.buildHash} into ${u.dir}. ${u.added} added, ${u.same} already here and identical${u.differing.length ? `, ${u.differing.length} already here and DIFFERENT: ${u.differing.slice(0, 10).join(', ')}` : ''}`)
      differing += u.differing.length
      if (u.record.buildHash !== buildHash()) console.log(`WARNING: ${u.file} holds frames of build ${u.record.buildHash}, the current build is ${buildHash()}. Those frames will not count. Check out the same commit on both machines`)
    }
    if (differing > 0) throw new Error(`${differing} frames differ between machines. The renders are not identical, so the parts cannot be joined`)
  }
  const tier = a.tier ?? 'draft'
  if (!isTier(tier)) throw new Error(`unknown tier ${tier}`)
  const diag = a.diag ?? 'beauty'
  if (!diagnosticViews.includes(diag)) throw new Error(`unknown diagnostic view ${diag}`)
  const spec: FilmSpec = { tier, format: a.format ? formatById(a.format) : config.formats.preview, paint: paintById(a.paint ?? defaultPaint).id, diag, detail: detailFrom(a.detail) }
  const { first, last, slice } = rangeFromArgs(a)
  const assemble = a.assemble === 'true'
  const out = filmPath(spec, first, last)
  const dir = ensureDir(framesDir(spec))

  let hash = buildHash()
  const existing = readJson<FilmRecord>(recordPathFor(out))
  if (filmMatches(existing, spec, hash, first, last) && a.force !== 'true') {
    console.log(`reused ${out}: ${existing.frameCount} frames, ${megabytes(existing.bytes).toFixed(1)} MB, G5 ${existing.g5.ok ? 'clean' : `failed on ${existing.g5.failed.length} frames`}`)
    return existing.g5.ok ? 0 : 2
  }

  if (!assemble) {
    const todo = missingFrames(spec, slice[0], slice[1], hash)
    console.log(`${spec.format.id} ${spec.tier} ${spec.detail} ${spec.paint} ${spec.diag}: frames ${slice[0]} to ${slice[1]}, ${todo.length} to render into ${dir}`)
    if (todo.length > 0) {
      const session = await RenderSession.open({ budgetMinutes: a.budget !== undefined ? Number(a.budget) : undefined })
      hash = session.buildHash
      let slowest = 0
      let done = 0
      const t0 = Date.now()
      try {
        for (const f of todo) {
          if (slowest > 0 && session.timeLeftMs() < slowest * 1.5 + 20_000) {
            throw new OutOfBudget(`film ${spec.format.id} ${spec.tier}: ${done} frames rendered this chunk, ${todo.length - done} left in frames ${slice[0]} to ${slice[1]}. Run the command again to continue.`)
          }
          const s0 = Date.now()
          const { record } = await session.renderTo(frameSpec(spec, f), join(dir, frameFileName(f)), { force: true, fresh: done % freshPageEvery === 0 })
          slowest = Math.max(slowest, Date.now() - s0)
          done++
          if (!record.check.ok) console.log(`G5 problem on frame ${f}: blank ${record.check.blank}, flat ${record.check.flat}, invalid pixels ${record.check.invalidPixels}`)
          if (done % 30 === 0 || done === todo.length) {
            const rate = (Date.now() - t0) / 1000 / done
            console.log(`frame ${f}: ${done} of ${todo.length} this run, ${rate.toFixed(2)} s per frame, about ${Math.round(((todo.length - done) * rate) / 60)} min left`)
          }
        }
      } finally {
        await session.close()
      }
    }
  }

  const bundleSlice = (): void => {
    const gap = missingFrames(spec, slice[0], slice[1], hash)
    if (gap.length > 0) throw new Error(`cannot bundle: ${gap.length} frames of ${slice[0]} to ${slice[1]} are missing`)
    const label = `frames-${spec.format.id}-${spec.tier}-${spec.detail}-${first}-${last}${a.parts !== undefined ? `-part-${a.part}-of-${a.parts}` : ''}`
    for (const f of bundleFrames(spec, slice[0], slice[1], hash, join(workDir, 'parts'), label)) console.log(`bundled ${f}: ${megabytes(statSync(f).size).toFixed(1)} MB`)
  }
  const missing = missingFrames(spec, first, last, hash)
  if (missing.length > 0) {
    if (assemble) {
      console.error(`cannot assemble: ${missing.length} frames are missing or do not match build ${hash}, first ${missing.slice(0, 10).join(', ')}`)
      return 1
    }
    if (a.bundle === 'true') bundleSlice()
    console.log(`slice ${slice[0]} to ${slice[1]} is done. ${missing.length} frames of ${first} to ${last} are still missing here, first ${missing.slice(0, 10).join(', ')}`)
    console.log(`copy the f*.png and f*.json files of every part into ${dir}, then run again with --assemble`)
    return 0
  }

  if (a.bundle === 'true' && !assemble) bundleSlice()
  const { crf, probe: p } = encodeFilm(dir, first, last, out)
  const count = last - first + 1
  const bad = verifyFilm(p, spec.format, count)
  if (bad.length > 0) throw new Error(`ffprobe disagrees with the film: ${bad.join(', ')}. The frames are kept in ${dir}`)
  const frames = frameChecks(spec, first, last)
  const failed = frames.filter((c) => c.blank || c.flat || c.invalidPixels > 0).map((c) => c.frame)
  let renderSeconds = 0
  for (let f = first; f <= last; f++) renderSeconds += readJson<StillRecord>(join(dir, frameFileName(f)).replace(/\.png$/, '.json'))?.seconds ?? 0
  const record: FilmRecord = {
    buildHash: hash,
    format: spec.format.id,
    tier: spec.tier,
    paint: spec.paint,
    diagnostic: spec.diag,
    detail: spec.detail,
    first,
    last,
    frameCount: count,
    fps: config.film.fps,
    crf,
    bytes: p.bytes,
    probe: p,
    g5: { ok: failed.length === 0, failed, frames },
    renderSeconds: Math.round(renderSeconds),
  }
  writeJson(recordPathFor(out), record)
  console.log(`encoded ${out}: ${p.frames} frames, ${p.width} x ${p.height}, ${p.fps} fps, ${p.codec} ${p.pixelFormat}, crf ${crf}, ${megabytes(p.bytes).toFixed(2)} MB`)
  console.log(`G5 on every frame: ${failed.length === 0 ? 'no frame blank, flat or holding invalid pixels' : `failed on frames ${failed.slice(0, 20).join(', ')}`}`)
  if (first === 0 && last === frameCount - 1) {
    emptyFrames(spec)
    console.log(`emptied ${dir}`)
  } else {
    console.log(`kept the frames in ${dir}, since this is a partial range`)
  }
  return failed.length === 0 ? 0 : 2
})
