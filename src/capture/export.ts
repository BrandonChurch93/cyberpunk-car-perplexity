import { EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output, StreamTarget, type StreamTargetChunk, type VideoCodec } from 'mediabunny'
import { config, type FormatKey, type FormatSpec, type TierId } from '../config'
import type { AppContext } from '../director/run'
import { el } from '../director/ui/menu'
import { clock, remainingSeconds } from '../director/ui/logic'
import { loadPanelFont, nextTask } from '../director/ui/fonts'
import css from './export.module.css'

const codecNames: Record<string, VideoCodec> = { h264: 'avc', avc: 'avc', h265: 'hevc', hevc: 'hevc', vp9: 'vp9', av1: 'av1', vp8: 'vp8' }
const mimeTypes: Record<string, string> = { mp4: 'video/mp4' }
const maxEncodeQueue = 2
const outputChunkBytes = 4 * 1024 * 1024

export function codecFor(name: string): VideoCodec {
  const codec = codecNames[name.toLowerCase()]
  if (!codec) throw new Error(`The video codec ${name} is not one Export knows.`)
  return codec
}

const avcLevels: Array<[string, number, number]> = [
  ['1f', 3600, 108000],
  ['20', 3600, 108000],
  ['28', 8192, 245760],
  ['2a', 8704, 522240],
  ['32', 22080, 589824],
  ['33', 36864, 983040],
  ['34', 36864, 2073600],
]

/** WebCodecs codec strings to try, best first, for one frame size. */
export function codecStrings(codec: VideoCodec, width: number, height: number, fps: number): string[] {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16)
  if (codec === 'avc') {
    const level = (avcLevels.find(([, fs, rate]) => blocks <= fs && blocks * fps <= rate) ?? avcLevels[avcLevels.length - 1])[0]
    return [`avc1.6400${level}`, `avc1.4d00${level}`, `avc1.4200${level}`]
  }
  if (codec === 'hevc') return ['hvc1.1.6.L123.B0', 'hev1.1.6.L123.B0']
  if (codec === 'vp9') return [blocks <= 8704 ? 'vp09.00.40.08' : 'vp09.00.50.08']
  if (codec === 'av1') return [blocks <= 8704 ? 'av01.0.08M.08' : 'av01.0.12M.08']
  return ['vp8']
}

export function formatKeyOf(format: FormatSpec): FormatKey {
  const key = (Object.keys(config.formats) as FormatKey[]).find((k) => config.formats[k].id === format.id)
  if (!key) throw new Error(`unknown format ${format.id}`)
  return key
}

/** A file assembled from positioned writes without copying it into one buffer. Later writes replace earlier bytes. */
export class SegmentFile {
  private parts: Array<{ start: number; end: number; blob: Blob }> = []
  size = 0

  write(position: number, data: Uint8Array): void {
    const start = position
    const end = position + data.byteLength
    const blob = new Blob([data as Uint8Array<ArrayBuffer>])
    const next: typeof this.parts = []
    for (const p of this.parts) {
      if (p.end <= start || p.start >= end) {
        next.push(p)
        continue
      }
      if (p.start < start) next.push({ start: p.start, end: start, blob: p.blob.slice(0, start - p.start) })
      if (p.end > end) next.push({ start: end, end: p.end, blob: p.blob.slice(end - p.start) })
    }
    next.push({ start, end, blob })
    next.sort((a, b) => a.start - b.start)
    this.parts = next
    this.size = Math.max(this.size, end)
  }

  gaps(): number {
    let at = 0
    let gaps = 0
    for (const p of this.parts) {
      if (p.start > at) gaps++
      at = Math.max(at, p.end)
    }
    return gaps
  }

  toBlob(type: string): Blob {
    if (this.gaps() > 0) throw new Error('The video file has holes in it, so it was not saved.')
    return new Blob(this.parts.map((p) => p.blob), { type })
  }

  clear(): void {
    this.parts = []
    this.size = 0
  }
}

interface Job {
  format: FormatSpec
  tier: TierId
  first: number
  last: number
  codec: VideoCodec
  codecString: string
  bitrateMode: VideoEncoderBitrateMode
  fileName: string
}

interface Progress {
  done: number
  total: number
  bytes: number
}

class Stopped extends Error {}

async function supportFor(codec: VideoCodec, name: string, format: FormatSpec): Promise<{ codecString: string; bitrateMode: VideoEncoderBitrateMode } | string> {
  if (typeof VideoEncoder === 'undefined') {
    return 'This browser has no video encoder that a web page can use, so Export cannot run here. Use a current desktop browser and open this page from an https or localhost address.'
  }
  for (const codecString of codecStrings(codec, format.width, format.height, config.film.fps)) {
    for (const bitrateMode of ['constant', 'variable'] as const) {
      try {
        const r = await VideoEncoder.isConfigSupported(encoderConfig(codecString, format, bitrateMode))
        if (r.supported) return { codecString, bitrateMode }
      } catch {
        continue
      }
    }
  }
  return `This browser cannot encode ${name} video at ${format.width} x ${format.height}, so Export cannot run here. Try a current desktop browser on a computer with a graphics card.`
}

function encoderConfig(codecString: string, format: FormatSpec, bitrateMode: VideoEncoderBitrateMode): VideoEncoderConfig {
  return {
    codec: codecString,
    width: format.width,
    height: format.height,
    bitrate: config.export.bitrateMbps * 1_000_000,
    bitrateMode,
    framerate: config.film.fps,
    latencyMode: 'quality',
    ...(codecString.startsWith('avc1') ? { avc: { format: 'avc' as const } } : {}),
  }
}

function dequeued(encoder: VideoEncoder): Promise<void> {
  return new Promise((resolve) => encoder.addEventListener('dequeue', () => resolve(), { once: true }))
}

async function encodeFilm(context: AppContext, job: Job, file: SegmentFile, shouldStop: () => string | null, onFrame: (p: Progress) => void): Promise<Blob> {
  const { showcase, canvas } = context
  const gl = context.engine.renderer.getContext()
  const fps = config.film.fps
  const total = job.last - job.first + 1
  await showcase.setFormat(job.format.id)

  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      file.write(chunk.position, chunk.data)
    },
  })
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'reserve' }),
    target: new StreamTarget(writable, { chunked: true, chunkSize: outputChunkBytes }),
  })
  const source = new EncodedVideoPacketSource(job.codec)
  output.addVideoTrack(source, { frameRate: fps, maximumPacketCount: total })
  await output.start()

  let encoded = 0
  let failure: Error | null = null
  let muxing: Promise<void> = Promise.resolve()
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      encoded++
      const packet = EncodedPacket.fromEncodedChunk(chunk)
      muxing = muxing.then(() => source.add(packet, meta)).catch((e: unknown) => {
        failure ??= e instanceof Error ? e : new Error(String(e))
      })
    },
    error: (e) => {
      failure ??= e
    },
  })
  try {
    encoder.configure(encoderConfig(job.codecString, job.format, job.bitrateMode))
    for (let n = 0; n < total; n++) {
      const stop = shouldStop()
      if (stop) throw new Stopped(stop)
      await showcase.renderFrame(job.first + n, job.tier)
      if (gl.isContextLost()) throw new Stopped(lostMessage(n, total))
      const frame = new VideoFrame(canvas, { timestamp: Math.round((n * 1_000_000) / fps), duration: Math.round(1_000_000 / fps) })
      try {
        encoder.encode(frame, { keyFrame: n % fps === 0 })
      } finally {
        frame.close()
      }
      while (encoder.encodeQueueSize > maxEncodeQueue) await dequeued(encoder)
      await muxing
      if (failure) throw failure
      onFrame({ done: n + 1, total, bytes: file.size })
      await nextTask()
    }
    await encoder.flush()
    await muxing
    if (failure) throw failure
    if (encoded !== total) throw new Error(`The encoder returned ${encoded} of ${total} frames, so no file was saved.`)
    source.close()
    await output.finalize()
    return file.toBlob(mimeTypes[config.export.container] ?? 'video/mp4')
  } catch (error) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => undefined)
    file.clear()
    throw error
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }
}

function lostMessage(done: number, total: number): string {
  return `The graphics context was lost after ${done} of ${total} frames, so Export stopped. No file was saved. Close other heavy tabs or programs, reload this page and start again.`
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.hidden = true
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 120_000)
}

export function runExport(context: AppContext): void {
  const { launch, canvas } = context
  loadPanelFont()
  const params = new URLSearchParams(location.search)
  const codecName = params.get('codec') ?? config.export.videoCodec
  const tier = launch.tier
  const first = launch.first
  const last = launch.last
  const total = last - first + 1

  const choices: Array<{ key: FormatKey; label: string }> = [
    { key: 'master', label: 'Master' },
    { key: 'vertical', label: 'Vertical' },
  ]
  const launchKey = formatKeyOf(launch.format)
  if (!choices.some((c) => c.key === launchKey)) choices.push({ key: launchKey, label: 'Preview from the address' })
  let selected: FormatKey = launchKey

  const layout = el('div', css.layout)
  const stageBox = el('div', css.stage)
  const placeholder = el('p', css.placeholder, 'The picture appears here as each frame is finished. Only the picture goes into the file.')
  canvas.className = css.canvas
  canvas.hidden = true
  stageBox.append(placeholder, canvas)

  const panel = el('main', css.panel)
  panel.dataset.state = 'checking'
  panel.dataset.done = '0'
  panel.dataset.total = String(total)
  panel.append(el('h1', css.title, 'Export'), el('p', css.lead, `Renders ${config.name} on this computer and saves it as a video file.`))

  const group = el('fieldset', css.group)
  group.append(el('legend', css.legend, 'Format'))
  const radios: HTMLInputElement[] = []
  for (const c of choices) {
    const f = config.formats[c.key]
    const label = el('label', css.choice)
    const input = el('input')
    input.type = 'radio'
    input.name = 'format'
    input.value = c.key
    input.checked = c.key === selected
    input.addEventListener('change', () => {
      if (input.checked) {
        selected = c.key
        refresh()
      }
    })
    radios.push(input)
    const text = c.key === 'master' || c.key === 'vertical' ? `${c.label}, ${f.id}, ${f.width} x ${f.height}` : `${c.label}, ${f.width} x ${f.height}`
    label.append(input, document.createTextNode(text))
    group.append(label)
  }
  panel.append(group)

  const facts = el('dl', css.facts)
  const fact = (term: string): HTMLElement => {
    const v = el('dd', css.value)
    facts.append(el('dt', css.term, term), v)
    return v
  }
  const tierValue = fact('Tier')
  const framesValue = fact('Frames')
  const codecValue = fact('Video')
  const fileValue = fact('File')
  panel.append(facts)
  const n = config.tiers[tier].samplesPerFrame
  tierValue.textContent = `${tier}, ${n} ${n === 1 ? 'sample' : 'samples'} per frame`
  framesValue.textContent = `${first} to ${last}, ${total} frames, ${(total / config.film.fps).toFixed(2)} s at ${config.film.fps} fps`
  codecValue.textContent = `${codecName} at ${config.export.bitrateMbps} Mbps in ${config.export.container}`

  const support = el('p', css.support, 'Checking whether this browser can encode the video.')
  support.setAttribute('role', 'status')
  panel.append(support)

  const row = el('div', css.row)
  const start = el('button', `${css.button} ${css.primary}`, 'Start')
  const stop = el('button', css.button, 'Stop')
  start.type = 'button'
  stop.type = 'button'
  start.disabled = true
  stop.disabled = true
  row.append(start, stop)
  panel.append(row)

  const bar = el('progress', css.bar)
  bar.max = total
  bar.value = 0
  panel.append(bar)
  const progress = el('dl', css.facts)
  const p = (term: string): HTMLElement => {
    const v = el('dd', css.value, 'none yet')
    progress.append(el('dt', css.term, term), v)
    return v
  }
  const doneValue = p('Frames done')
  const elapsedValue = p('Elapsed')
  const remainingValue = p('Remaining')
  const wakeValue = p('Screen')
  doneValue.textContent = `0 of ${total}`
  elapsedValue.textContent = clock(0)
  remainingValue.textContent = 'known after the first frame'
  wakeValue.textContent = 'not requested yet'
  panel.append(progress)

  const message = el('p', css.message)
  message.setAttribute('role', 'alert')
  panel.append(message)
  panel.append(el('p', css.help, 'Keep this tab open while Export runs. The file downloads by itself once the last frame is encoded. Stop discards the run and saves nothing.'))

  layout.append(stageBox, panel)
  document.body.append(layout)

  let codec: VideoCodec | null = null
  try {
    codec = codecFor(codecName)
  } catch (e) {
    support.textContent = e instanceof Error ? e.message : String(e)
  }
  if (first > last) {
    codec = null
    support.textContent = `The address asks for frames ${first} to ${last}, which is an empty range.`
  }
  let checked: { codecString: string; bitrateMode: VideoEncoderBitrateMode } | null = null
  let checkId = 0
  let running = false
  let stopReason: string | null = null
  let lost = false

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    lost = true
  })

  function setState(state: string): void {
    panel.dataset.state = state
  }

  function refresh(): void {
    const format = config.formats[selected]
    fileValue.textContent = config.export.files[selected]
    if (!codec) {
      setState('unsupported')
      support.className = `${css.support} ${css.bad}`
      start.disabled = true
      return
    }
    const id = ++checkId
    checked = null
    start.disabled = true
    support.className = css.support
    support.textContent = 'Checking whether this browser can encode the video.'
    setState('checking')
    void supportFor(codec, codecName, format).then((r) => {
      if (id !== checkId) return
      if (typeof r === 'string') {
        support.textContent = r
        support.className = `${css.support} ${css.bad}`
        setState('unsupported')
        return
      }
      checked = r
      support.textContent = `This browser can encode ${codecName} at ${format.width} x ${format.height}.`
      support.className = `${css.support} ${css.good}`
      start.disabled = false
      setState('ready')
    })
  }

  async function wakeLock(): Promise<WakeLockSentinel | null> {
    try {
      const lock = await navigator.wakeLock.request('screen')
      wakeValue.textContent = 'kept awake'
      return lock
    } catch {
      wakeValue.textContent = 'the browser refused to keep it awake, so stop it from sleeping by hand'
      return null
    }
  }

  start.addEventListener('click', () => {
    if (running || !checked || !codec) return
    running = true
    stopReason = null
    lost = false
    start.disabled = true
    stop.disabled = false
    for (const r of radios) r.disabled = true
    message.textContent = ''
    message.className = css.message
    canvas.hidden = false
    placeholder.hidden = true
    setState('running')
    const job: Job = {
      format: config.formats[selected],
      tier,
      first,
      last,
      codec,
      codecString: checked.codecString,
      bitrateMode: checked.bitrateMode,
      fileName: config.export.files[selected],
    }
    const began = performance.now()
    let lock: WakeLockSentinel | null = null
    const relock = (): void => {
      if (running && document.visibilityState === 'visible' && (!lock || lock.released)) void wakeLock().then((l) => (lock = l))
    }
    document.addEventListener('visibilitychange', relock)
    void wakeLock().then((l) => (lock = l))
    const file = new SegmentFile()
    const show = (pr: Progress): void => {
      const elapsed = (performance.now() - began) / 1000
      const left = remainingSeconds(pr.done, pr.total, elapsed)
      bar.value = pr.done
      doneValue.textContent = `${pr.done} of ${pr.total}`
      elapsedValue.textContent = clock(elapsed)
      remainingValue.textContent = left === null ? 'known after the first frame' : `about ${clock(left)}`
      panel.dataset.done = String(pr.done)
      panel.dataset.bytes = String(pr.bytes)
    }
    const shouldStop = (): string | null => (lost ? lostMessage(Number(panel.dataset.done), total) : stopReason)
    encodeFilm(context, job, file, shouldStop, show)
      .then((blob) => {
        download(blob, job.fileName)
        elapsedValue.textContent = clock((performance.now() - began) / 1000)
        remainingValue.textContent = 'none'
        message.textContent = `Saved ${job.fileName}: ${total} frames, ${megabytes(blob.size)}.`
        message.className = `${css.message} ${css.good}`
        panel.dataset.file = job.fileName
        setState('done')
      })
      .catch((error: unknown) => {
        if (context.engine.renderer.getContext().isContextLost()) lost = true
        const text = lost
          ? lostMessage(Number(panel.dataset.done), total)
          : error instanceof Stopped
            ? error.message
            : `Export failed and saved nothing: ${error instanceof Error ? error.message : String(error)}`
        message.textContent = text
        message.className = `${css.message} ${css.bad}`
        setState(stopReason && !lost ? 'stopped' : 'failed')
      })
      .finally(() => {
        running = false
        document.removeEventListener('visibilitychange', relock)
        void lock?.release().catch(() => undefined)
        stop.disabled = true
        start.disabled = lost || !checked
        for (const r of radios) r.disabled = false
      })
  })

  stop.addEventListener('click', () => {
    if (running) stopReason = 'Export was stopped. No file was saved.'
  })

  refresh()
}
