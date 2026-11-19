import { config, frameCount } from '../../config'

export interface BeatMark {
  id: string
  startFrame: number
  left: number
  width: number
}

export function beatMarks(): BeatMark[] {
  const duration = config.film.durationSeconds
  return config.beats.map((b) => ({
    id: b.id,
    startFrame: Math.round(b.start * config.film.fps),
    left: (b.start / duration) * 100,
    width: ((b.end - b.start) / duration) * 100,
  }))
}

export function beatOfFrame(frame: number): string {
  const t = (frame % frameCount) / config.film.fps
  return (config.beats.find((b) => t >= b.start && t < b.end) ?? config.beats[config.beats.length - 1]).id
}

/** Which film frame a real-time player shows after elapsedMs of wall time. The clock only picks the frame. */
export function playbackFrame(startFrame: number, elapsedMs: number): number {
  const advanced = Math.floor((Math.max(0, elapsedMs) * config.film.fps) / 1000)
  return (startFrame + advanced) % frameCount
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const two = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`
}

export function remainingSeconds(done: number, total: number, elapsedSeconds: number): number | null {
  if (done <= 0) return null
  return (elapsedSeconds / done) * (total - done)
}

export type ParamChanges = Record<string, string | null>

export function withParams(href: string, changes: ParamChanges): string {
  const url = new URL(href)
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) url.searchParams.delete(k)
    else url.searchParams.set(k, v)
  }
  return url.toString()
}

/** Keeps the live render inside a pixel budget so dragging stays responsive. Returns the scaled size, never larger. */
export function interactiveSize(width: number, height: number, budgetPixels: number): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(budgetPixels / (width * height)))
  return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) }
}
