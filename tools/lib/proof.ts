import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import type { Browser, Page } from 'playwright'
import { config } from './env.ts'
import { decode, type Raw } from './image.ts'
import { driverTimeoutMs } from './browser.ts'
import type { Harness } from './server.ts'

export interface InterfaceCheck {
  ok: boolean
  visible: boolean
  detail: string
  elements: string[]
  differingPixels: number
  maxDelta: number
}

interface PageLayout {
  elements: string[]
  text: string
  background: [number, number, number]
  rect: { x: number; y: number; width: number; height: number }
  canvas: { width: number; height: number }
  dataUrl: string
}

async function layout(page: Page): Promise<PageLayout> {
  return page.evaluate(() => {
    const canvas = document.getElementById('stage') as HTMLCanvasElement
    const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'TITLE'])
    const elements: string[] = []
    for (const node of Array.from(document.body.querySelectorAll('*'))) {
      if (node === canvas || skip.has(node.tagName)) continue
      const cs = getComputedStyle(node)
      if (cs.display === 'none' || cs.visibility !== 'visible' || Number(cs.opacity) === 0) continue
      const r = node.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue
      const cls = typeof node.className === 'string' && node.className ? `.${node.className.split(/\s+/).join('.')}` : ''
      elements.push(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${cls}`)
    }
    const bg = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0]
    const box = canvas.getBoundingClientRect()
    const cs = getComputedStyle(canvas)
    let rect = { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height }
    if (cs.objectFit === 'contain') {
      const s = Math.min(box.width / canvas.width, box.height / canvas.height)
      const w = canvas.width * s
      const h = canvas.height * s
      rect = { x: rect.x + (box.width - w) / 2, y: rect.y + (box.height - h) / 2, width: w, height: h }
    }
    const shown = cs.display !== 'none' && cs.visibility === 'visible'
    return {
      elements,
      text: Array.from(document.body.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim(),
      background: [bg[0], bg[1], bg[2]] as [number, number, number],
      rect: shown ? rect : { x: 0, y: 0, width: 0, height: 0 },
      canvas: { width: canvas.width, height: canvas.height },
      dataUrl: canvas.toDataURL('image/png'),
    }
  })
}

function compare(shot: Raw, canvas: Raw, rect: PageLayout['rect'], background: [number, number, number], scaled: boolean): { differing: number; maxDelta: number; inside: number } {
  const x0 = Math.round(rect.x)
  const y0 = Math.round(rect.y)
  const x1 = x0 + canvas.width
  const y1 = y0 + canvas.height
  const tolerance = scaled ? 40 : 2
  let differing = 0
  let maxDelta = 0
  let inside = 0
  for (let y = 0; y < shot.height; y++) {
    for (let x = 0; x < shot.width; x++) {
      const i = (y * shot.width + x) * 3
      let ref: [number, number, number] = background
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        const j = ((y - y0) * canvas.width + (x - x0)) * 3
        ref = [canvas.data[j], canvas.data[j + 1], canvas.data[j + 2]]
        inside++
      }
      const d = Math.max(Math.abs(shot.data[i] - ref[0]), Math.abs(shot.data[i + 1] - ref[1]), Math.abs(shot.data[i + 2] - ref[2]))
      if (d > maxDelta) maxDelta = d
      if (d > tolerance) differing++
    }
  }
  return { differing, maxDelta, inside }
}

/**
 * Whether any interface element is visible on a page in capture or autopilot mode. A full page screenshot is compared
 * with the canvas pixels read back at the same moment, and the DOM is walked for any visible element other than the canvas.
 */
export async function checkInterface(page: Page, attempts = 10): Promise<InterfaceCheck> {
  await holdFrames(page, true)
  try {
    return await inspect(page, attempts)
  } finally {
    await holdFrames(page, false)
  }
}

/** Pauses animation frame callbacks so a page that plays in real time holds still while it is compared. */
async function holdFrames(page: Page, hold: boolean): Promise<void> {
  await page.evaluate((on) => {
    type Held = { real: typeof requestAnimationFrame; queue: FrameRequestCallback[] }
    const w = window as unknown as { __heldFrames?: Held; requestAnimationFrame: typeof requestAnimationFrame }
    if (on && !w.__heldFrames) {
      const held: Held = { real: w.requestAnimationFrame.bind(window), queue: [] }
      w.__heldFrames = held
      w.requestAnimationFrame = (cb) => {
        held.queue.push(cb)
        return 0
      }
      return new Promise<void>((resolve) => held.real(() => held.real(() => resolve())))
    }
    if (!on && w.__heldFrames) {
      const held = w.__heldFrames
      delete w.__heldFrames
      w.requestAnimationFrame = held.real
      for (const cb of held.queue) held.real(cb)
    }
    return undefined
  }, hold)
}

async function inspect(page: Page, attempts: number): Promise<InterfaceCheck> {
  let a = await layout(page)
  let shot: Buffer | null = null
  for (let k = 0; k < attempts; k++) {
    shot = await page.screenshot({ fullPage: true, scale: 'css', animations: 'disabled', caret: 'hide' })
    const b = await layout(page)
    if (b.dataUrl === a.dataUrl) break
    a = b
    shot = null
  }
  if (!shot) return { ok: false, visible: true, detail: 'the canvas kept changing during the screenshot, so the check could not run', elements: a.elements, differingPixels: -1, maxDelta: -1 }
  const screen = await decode(shot)
  const scaled = Math.abs(a.rect.width - a.canvas.width) > 0.5 || Math.abs(a.rect.height - a.canvas.height) > 0.5
  let pixels = await decode(Buffer.from(a.dataUrl.split(',')[1], 'base64'))
  if (scaled && a.rect.width >= 1 && a.rect.height >= 1) {
    const w = Math.round(a.rect.width)
    const h = Math.round(a.rect.height)
    const { data, info } = await sharp(pixels.data, { raw: { width: pixels.width, height: pixels.height, channels: 3 } }).resize(w, h, { fit: 'fill', kernel: 'linear' }).raw().toBuffer({ resolveWithObject: true })
    pixels = { width: info.width, height: info.height, data }
  }
  if (a.rect.width < 1) pixels = { width: 0, height: 0, data: Buffer.alloc(0) }
  const c = compare(screen, pixels, a.rect, a.background, scaled)
  const allowed = scaled ? Math.floor(c.inside * 0.005) : 0
  const problems: string[] = []
  if (a.elements.length > 0) problems.push(`visible elements: ${a.elements.join(', ')}`)
  if (a.text) problems.push(`loose text on the page: ${a.text.slice(0, 80)}`)
  if (c.differing > allowed) problems.push(`${c.differing} screenshot pixels differ from the canvas or the page background, largest step ${c.maxDelta}`)
  const ok = problems.length === 0
  const detail = ok
    ? `no interface element; the ${screen.width} x ${screen.height} screenshot matches the canvas${scaled ? ' scaled to fit' : ' exactly'} and the background (largest step ${c.maxDelta})`
    : problems.join('; ')
  return { ok, visible: !ok, detail, elements: a.elements, differingPixels: c.differing, maxDelta: c.maxDelta }
}

export interface ProbeFacts {
  codec: string
  profile: string
  width: number
  height: number
  pixFmt: string
  frames: number
  frameRate: string
  avgFrameRate: string
  fps: number
  durationSeconds: number
  bitRate: number
  colorSpace: string | null
  colorRange: string | null
  formatName: string
  sizeBytes: number
}

export function ffprobe(file: string): ProbeFacts {
  const raw = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' })
  const j = JSON.parse(raw) as { streams: Array<Record<string, string | number | undefined>>; format: Record<string, string | undefined> }
  const s = j.streams[0]
  if (!s) throw new Error(`ffprobe found no video stream in ${file}`)
  const rate = String(s.r_frame_rate ?? '0/1')
  const [num, den] = rate.split('/').map(Number)
  return {
    codec: String(s.codec_name),
    profile: String(s.profile ?? ''),
    width: Number(s.width),
    height: Number(s.height),
    pixFmt: String(s.pix_fmt ?? ''),
    frames: Number(s.nb_read_frames ?? s.nb_frames ?? 0),
    frameRate: rate,
    avgFrameRate: String(s.avg_frame_rate ?? ''),
    fps: den ? num / den : 0,
    durationSeconds: Number(s.duration ?? j.format.duration ?? 0),
    bitRate: Number(s.bit_rate ?? j.format.bit_rate ?? 0),
    colorSpace: (s.color_space as string | undefined) ?? null,
    colorRange: (s.color_range as string | undefined) ?? null,
    formatName: String(j.format.format_name ?? ''),
    sizeBytes: Number(j.format.size ?? 0),
  }
}

const probeNames: Record<string, string> = { h264: 'h264', avc: 'h264', h265: 'hevc', hevc: 'hevc', vp9: 'vp9', av1: 'av1', vp8: 'vp8' }

export function probeCodecName(name: string): string {
  return probeNames[name.toLowerCase()] ?? name
}

/** Decodes every frame of a video to RGB with ffmpeg, one callback per frame, without holding the whole film. */
export async function eachFrame(file: string, width: number, height: number, onFrame: (index: number, raw: Raw) => Promise<void>): Promise<number> {
  const size = width * height * 3
  const child = spawn('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'inherit'] })
  let pending: Buffer = Buffer.alloc(0)
  let index = 0
  for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
    while (pending.length >= size) {
      await onFrame(index++, { width, height, data: Buffer.from(pending.subarray(0, size)) })
      pending = pending.subarray(size)
    }
  }
  const code = await new Promise<number>((resolve) => (child.exitCode !== null ? resolve(child.exitCode) : child.on('close', (c) => resolve(c ?? 1))))
  if (code !== 0) throw new Error(`ffmpeg could not decode ${file}`)
  return index
}

export function psnr(a: Raw, b: Raw): number {
  if (a.width !== b.width || a.height !== b.height) return 0
  let sum = 0
  for (let i = 0; i < a.data.length; i++) {
    const d = a.data[i] - b.data[i]
    sum += d * d
  }
  const mse = sum / a.data.length
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse)
}

function descendants(root: number): number[] {
  const parents = new Map<number, number>()
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8')
      const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      parents.set(Number(name), Number(after[1]))
    } catch {
      continue
    }
  }
  const out: number[] = []
  const queue = [root]
  while (queue.length) {
    const p = queue.shift()!
    for (const [pid, ppid] of parents) if (ppid === p) {
      out.push(pid)
      queue.push(pid)
    }
  }
  return out
}

function kb(text: string, key: string): number {
  const m = text.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'))
  return m ? Number(m[1]) : 0
}

/** Resident and proportional memory of every browser process started by this node process, in megabytes. */
export function browserMemory(): { rssMb: number; pssMb: number; processes: number } {
  let rss = 0
  let pss = 0
  let processes = 0
  for (const pid of descendants(process.pid)) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      if (!/chrom|headless_shell/i.test(cmd)) continue
      rss += kb(readFileSync(`/proc/${pid}/status`, 'utf8'), 'VmRSS')
      pss += existsSync(`/proc/${pid}/smaps_rollup`) ? kb(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'), 'Pss') : 0
      processes++
    } catch {
      continue
    }
  }
  return { rssMb: rss / 1024, pssMb: pss / 1024, processes }
}

export interface MemorySample {
  seconds: number
  framesDone: number
  heapUsedMb: number
  heapTotalMb: number
  browserRssMb: number
  browserPssMb: number
  encodedMb: number
}

export interface ExportRun {
  file: string
  seconds: number
  state: string
  message: string
  codec: string
  codecProven: boolean
  samples: MemorySample[]
  pageBuildHash: string
}

export interface ExportOptions {
  format: string
  tier: string
  first: number
  last: number
  saveAs: string
  memoryEverySeconds?: number
  log?: (line: string) => void
}

const fallbackCodecs = ['vp9', 'av1', 'h264']

async function panel(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => ({ ...(document.querySelector('main')?.dataset ?? {}), message: document.querySelector('[role=alert]')?.textContent ?? '', support: document.querySelector('[role=status]')?.textContent ?? '' }))
}

async function openExport(browser: Browser, harness: Harness, options: ExportOptions, codec: string | null): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true })
  const page = await context.newPage()
  page.setDefaultTimeout(driverTimeoutMs)
  const q = new URLSearchParams({ mode: 'export', format: options.format, tier: options.tier, first: String(options.first), last: String(options.last) })
  if (codec) q.set('codec', codec)
  await page.goto(`${harness.url}index.html?${q.toString()}`)
  await page.waitForFunction(() => {
    const s = document.querySelector('main')?.dataset.state
    return s !== undefined && s !== 'checking'
  }, undefined, { timeout: 120_000 })
  return page
}

/** Runs Export end to end in the page, as a person would: pick nothing, press Start, wait for the download. */
export async function runExportPage(browser: Browser, harness: Harness, options: ExportOptions): Promise<ExportRun & { page: Page }> {
  const log = options.log ?? ((line: string) => console.log(line))
  let codec = config.export.videoCodec
  let proven = true
  let page = await openExport(browser, harness, options, null)
  if ((await panel(page)).state !== 'ready') {
    log(`this browser cannot encode ${codec}: ${(await panel(page)).support}`)
    proven = false
    let found = false
    for (const alt of fallbackCodecs.filter((c) => probeCodecName(c) !== probeCodecName(codec))) {
      await page.context().close()
      page = await openExport(browser, harness, options, alt)
      if ((await panel(page)).state === 'ready') {
        codec = alt
        found = true
        log(`proving the pipeline with ${alt} instead; ${config.export.videoCodec} is unproven here`)
        break
      }
    }
    if (!found) throw new Error('this browser can encode none of the codecs Export knows')
  }
  const pageBuildHash = await page.evaluate(() => window.showcase?.info().buildHash ?? '')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const samples: MemorySample[] = []
  const t0 = Date.now()
  const sample = async (): Promise<void> => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined)
    const metrics = (await cdp.send('Performance.getMetrics')).metrics
    const m = (name: string): number => metrics.find((x) => x.name === name)?.value ?? 0
    const p = await panel(page)
    const mem = browserMemory()
    samples.push({
      seconds: Math.round((Date.now() - t0) / 100) / 10,
      framesDone: Number(p.done ?? 0),
      heapUsedMb: Math.round((m('JSHeapUsedSize') / 1048576) * 10) / 10,
      heapTotalMb: Math.round((m('JSHeapTotalSize') / 1048576) * 10) / 10,
      browserRssMb: Math.round(mem.rssMb * 10) / 10,
      browserPssMb: Math.round(mem.pssMb * 10) / 10,
      encodedMb: Math.round((Number(p.bytes ?? 0) / 1048576) * 10) / 10,
    })
  }
  const downloaded = page.waitForEvent('download', { timeout: driverTimeoutMs })
  await page.getByRole('button', { name: 'Start' }).click()
  let finished = false
  const result = downloaded.then((d) => d).finally(() => (finished = true))
  result.catch(() => undefined)
  const every = options.memoryEverySeconds ?? 0
  let lastLog = 0
  while (!finished) {
    const p = await panel(page)
    if (p.state === 'failed' || p.state === 'stopped') throw new Error(`Export did not finish: ${p.message}`)
    if (every > 0) await sample()
    if (Date.now() - lastLog > 10_000) {
      log(`export: ${p.done} of ${p.total} frames, ${Math.round((Date.now() - t0) / 1000)} s`)
      lastLog = Date.now()
    }
    await Promise.race([result.catch(() => undefined), new Promise((r) => setTimeout(r, (every > 0 ? every : 2) * 1000))])
  }
  const download = await result
  await download.saveAs(options.saveAs)
  if (every > 0) await sample()
  const p = await panel(page)
  return { page, file: options.saveAs, seconds: (Date.now() - t0) / 1000, state: p.state, message: p.message, codec, codecProven: proven, samples, pageBuildHash }
}

export interface MemoryVerdict {
  flat: boolean
  framesConsidered: number
  heapGrowthMb: number
  browserPssGrowthMb: number
  browserPssGrowthLessEncodedMb: number
  encodedGrowthMb: number
  heapLimitMb: number
  browserLimitMb: number
  reason: string
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

/**
 * Splits the samples after warm-up into an early and a late half and compares their medians. The encoded file is held
 * in the page until it downloads and grows at the bitrate on purpose, so it is subtracted from the browser figure.
 */
export function memoryVerdict(samples: MemorySample[], totalFrames: number): MemoryVerdict {
  const warm = samples.filter((s) => s.framesDone >= Math.max(1, Math.round(totalFrames * 0.1)) && s.framesDone < totalFrames)
  const half = Math.floor(warm.length / 2)
  const early = warm.slice(0, half)
  const late = warm.slice(half)
  const heapLimitMb = 8
  const base = median(early.map((s) => s.browserPssMb))
  const browserLimitMb = Math.max(48, base * 0.1)
  if (early.length < 2 || late.length < 2) {
    return { flat: false, framesConsidered: warm.length, heapGrowthMb: 0, browserPssGrowthMb: 0, browserPssGrowthLessEncodedMb: 0, encodedGrowthMb: 0, heapLimitMb, browserLimitMb, reason: 'too few samples to judge' }
  }
  const heap = median(late.map((s) => s.heapUsedMb)) - median(early.map((s) => s.heapUsedMb))
  const pss = median(late.map((s) => s.browserPssMb)) - base
  const encoded = median(late.map((s) => s.encodedMb)) - median(early.map((s) => s.encodedMb))
  const adjusted = pss - encoded
  const flat = heap < heapLimitMb && adjusted < browserLimitMb
  const r = (x: number): number => Math.round(x * 10) / 10
  return {
    flat,
    framesConsidered: warm.length,
    heapGrowthMb: r(heap),
    browserPssGrowthMb: r(pss),
    browserPssGrowthLessEncodedMb: r(adjusted),
    encodedGrowthMb: r(encoded),
    heapLimitMb,
    browserLimitMb: r(browserLimitMb),
    reason: flat
      ? `heap grew ${r(heap)} MB (limit ${heapLimitMb}), browser grew ${r(adjusted)} MB beyond the encoded file (limit ${r(browserLimitMb)})`
      : `memory grows: heap ${r(heap)} MB (limit ${heapLimitMb}), browser ${r(adjusted)} MB beyond the encoded file (limit ${r(browserLimitMb)})`,
  }
}
