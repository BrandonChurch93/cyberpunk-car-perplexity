import gsap from 'gsap'
import { config, type BeatSpec } from '../config'

const duration = config.film.durationSeconds
const inOut = gsap.parseEase('power2.inOut')

export interface BeatPosition {
  beat: BeatSpec
  index: number
  local: number
}

export function loopPhase(timeSeconds: number): number {
  return timeSeconds - duration * Math.floor(timeSeconds / duration)
}

export function beatAt(timeSeconds: number): BeatPosition {
  const t = loopPhase(timeSeconds)
  const beats = config.beats
  for (let index = 0; index < beats.length; index++) {
    const beat = beats[index]
    if (t < beat.end) return { beat, index, local: (t - beat.start) / (beat.end - beat.start) }
  }
  const index = beats.length - 1
  return { beat: beats[index], index, local: 1 }
}

export function beatById(id: string): BeatSpec {
  const beat = config.beats.find((b) => b.id === id)
  if (!beat) throw new Error(`unknown beat ${id}`)
  return beat
}

function ramp(t: number, start: number, end: number): number {
  return Math.min(1, Math.max(0, (t - start) / (end - start)))
}

const wake = beatById('wake')
const ignition = beatById('ignition')
const finale = beatById('return')

export const events = {
  lampsOnStart: wake.start + 0.1 * (wake.end - wake.start),
  lampsOnEnd: wake.start + 0.75 * (wake.end - wake.start),
  engineStart: ignition.start + 0.12 * (ignition.end - ignition.start),
  engineRunning: ignition.start + 0.3 * (ignition.end - ignition.start),
  engineStop: finale.start + 0.08 * (finale.end - finale.start),
  engineStopped: finale.start + 0.3 * (finale.end - finale.start),
  lampsOffStart: finale.start + 0.3 * (finale.end - finale.start),
  lampsOffEnd: finale.start + 0.6 * (finale.end - finale.start),
}

export function lampStage(timeSeconds: number): number {
  const t = loopPhase(timeSeconds)
  return ramp(t, events.lampsOnStart, events.lampsOnEnd) - ramp(t, events.lampsOffStart, events.lampsOffEnd)
}

export function engine(timeSeconds: number): number {
  const t = loopPhase(timeSeconds)
  return inOut(ramp(t, events.engineStart, events.engineRunning)) - inOut(ramp(t, events.engineStop, events.engineStopped))
}

export function vibration(timeSeconds: number): number {
  const t = loopPhase(timeSeconds)
  const catchKick = Math.exp(-Math.pow((t - events.engineRunning) / 0.35, 2))
  const stopKick = 0.5 * Math.exp(-Math.pow((t - events.engineStop) / 0.3, 2))
  return Math.min(1, 0.35 * engine(timeSeconds) + catchKick + stopKick)
}

export interface TimelineState {
  timeSeconds: number
  beat: BeatPosition
  lampStage: number
  engine: number
  vibration: number
}

export function stateAt(timeSeconds: number): TimelineState {
  return {
    timeSeconds,
    beat: beatAt(timeSeconds),
    lampStage: lampStage(timeSeconds),
    engine: engine(timeSeconds),
    vibration: vibration(timeSeconds),
  }
}
