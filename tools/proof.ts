import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { defaultPaint } from '../src/config.ts'
import { args, config, distDir, ensureBuild, ensureDir, renderLock, workDir, writeJson } from './lib/env.ts'
import { launchBrowser } from './lib/browser.ts'
import { startHarness } from './lib/server.ts'
import { decode } from './lib/image.ts'
import { RenderSession, runTool } from './lib/render.ts'
import { eachFrame, ffprobe, memoryVerdict, probeCodecName, psnr, runExportPage, type MemorySample } from './lib/proof.ts'

function table(samples: MemorySample[]): string {
  const head = ['s', 'frames', 'heap MB', 'browser PSS MB', 'browser RSS MB', 'encoded MB']
  const rows = samples.map((s) => [s.seconds, s.framesDone, s.heapUsedMb, s.browserPssMb, s.browserRssMb, s.encodedMb].map(String))
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (cells: string[]): string => cells.map((c, i) => c.padStart(widths[i])).join('  ')
  return [line(head), ...rows.map(line)].join('\n')
}

void runTool(async () => {
  const a = args()
  const memory = a.memory === 'true'
  const format = config.formats.preview
  const tier = 'draft'
  const seconds = memory ? config.export.memoryTestSeconds : config.export.proofSeconds
  const frames = Math.round(seconds * config.film.fps)
  const first = a.first !== undefined ? Number(a.first) : 0
  const last = first + frames - 1
  const dir = ensureDir(join(workDir, 'export'))
  const fileName = memory ? 'memory-test.mp4' : config.export.files.preview
  const file = join(dir, fileName)
  const buildHash = ensureBuild()
  const release = await renderLock()
  rmSync(file, { force: true })

  const harness = await startHarness(distDir)
  const browser = await launchBrowser()
  let run
  try {
    console.log(`export: ${frames} frames (${first} to ${last}) at ${format.id} and the ${tier} tier`)
    run = await runExportPage(browser, harness, { format: format.id, tier, first, last, saveAs: file, memoryEverySeconds: memory ? 1 : 0 })
    await run.page.context().close()
  } finally {
    await browser.close().catch(() => undefined)
    await harness.close()
  }
  if (run.pageBuildHash !== buildHash) throw new Error(`the page reports build ${run.pageBuildHash}, the harness expected ${buildHash}`)
  console.log(`export finished in ${run.seconds.toFixed(1)} s: ${run.message}`)

  const probe = ffprobe(file)
  const problems: string[] = []
  const wantCodec = probeCodecName(run.codec)
  if (probe.codec !== wantCodec) problems.push(`codec is ${probe.codec}, expected ${wantCodec}`)
  if (probe.width !== format.width || probe.height !== format.height) problems.push(`size is ${probe.width} x ${probe.height}, expected ${format.width} x ${format.height}`)
  if (probe.frames !== frames) problems.push(`${probe.frames} frames, expected ${frames}`)
  if (Math.abs(probe.fps - config.film.fps) > 1e-6) problems.push(`frame rate is ${probe.frameRate}, expected ${config.film.fps}`)
  console.log(`ffprobe: ${probe.codec} ${probe.profile}, ${probe.width} x ${probe.height}, ${probe.frames} frames, ${probe.frameRate} fps, ${probe.durationSeconds} s, ${Math.round(probe.bitRate / 1000)} kb/s, ${probe.pixFmt}, ${probe.formatName}`)

  const base = {
    buildHash,
    format: format.id,
    tier,
    paint: defaultPaint,
    diagnostic: 'beauty',
    first,
    last,
    frames: probe.frames,
    fps: probe.fps,
    width: probe.width,
    height: probe.height,
    codec: probe.codec,
    requestedCodec: config.export.videoCodec,
    codecProven: run.codecProven,
    bitrateMbps: config.export.bitrateMbps,
    seconds: Math.round(run.seconds * 10) / 10,
    ffprobe: probe,
  }

  if (memory) {
    const verdict = memoryVerdict(run.samples, frames)
    writeJson(join(dir, 'memory.json'), { ...base, samples: run.samples, verdict, ok: problems.length === 0 && verdict.flat })
    console.log(table(run.samples))
    console.log(`${verdict.flat ? 'FLAT' : 'NOT FLAT'}: ${verdict.reason}`)
    for (const p of problems) console.log(`FAIL ${p}`)
    release()
    return problems.length === 0 && verdict.flat ? 0 : 1
  }

  release()
  const session = await RenderSession.open({ budgetMinutes: 0 })
  const perFrame: number[] = []
  try {
    const captureDir = ensureDir(join(dir, 'capture'))
    const count = await eachFrame(file, format.width, format.height, async (index, raw) => {
      const frame = first + index
      const spec = { frame, tier: tier as 'draft', format, diag: 'beauty', paint: defaultPaint }
      const png = join(captureDir, `f${String(frame).padStart(5, '0')}.png`)
      await session.renderTo(spec, png)
      perFrame.push(Math.round(psnr(raw, await decode(png)) * 100) / 100)
    })
    if (count !== frames) problems.push(`ffmpeg decoded ${count} frames, expected ${frames}`)
  } finally {
    await session.close()
  }
  const minPsnr = perFrame.length ? Math.min(...perFrame) : 0
  const ok = problems.length === 0
  writeJson(file.replace(/\.mp4$/, '.json'), { ...base, minPsnrAgainstCapture: minPsnr, meanPsnrAgainstCapture: Math.round((perFrame.reduce((s, x) => s + x, 0) / Math.max(1, perFrame.length)) * 100) / 100, psnrPerFrame: perFrame, ok, problems })
  console.log(`PSNR against capture: lowest ${minPsnr} dB over ${perFrame.length} frames`)
  if (!run.codecProven) console.log(`NOTE ${config.export.videoCodec} is unproven in this workspace; the pipeline was proven with ${run.codec}`)
  for (const p of problems) console.log(`FAIL ${p}`)
  console.log(ok ? `PASS ${file}` : `FAIL ${file}`)
  return ok ? 0 : 1
})
