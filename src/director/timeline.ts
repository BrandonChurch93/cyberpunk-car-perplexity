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
  lampStageOne: wake.start + 0.6,
  lampStageTwo: wake.start + 1.6,
  lampStageThree: wake.start + 3,
  pushSettled: wake.start + 2.4,
  engineStart: ignition.start + 1,
  engineRunning: ignition.start + 2,
  engineStop: finale.start + 1,
  engineStopped: finale.start + 1.8,
  lampsOffStart: finale.start + 2,
  lampsOffEnd: finale.start + 5.2,
  pullStart: finale.start + 0.3,
  pullEnd: finale.end,
}

/** Lamp thresholds on the 0 to 1 lamp stage, placed so each stage lands on its time in the wake beat. */
const lampRamp = { start: events.lampStageOne - 0.2, end: events.lampStageThree + 0.2 }
export const lampThresholds = {
  running: (events.lampStageOne - lampRamp.start) / (lampRamp.end - lampRamp.start),
  beamStart: (events.lampStageTwo - lampRamp.start) / (lampRamp.end - lampRamp.start),
  beamFull: (events.lampStageThree - lampRamp.start) / (lampRamp.end - lampRamp.start),
}

export function lampStage(t: number): number {
  return ramp(t, lampRamp.start, lampRamp.end) - ramp(t, events.lampsOffStart, events.lampsOffEnd)
}

export function engine(t: number): number {
  return inOut(ramp(t, events.engineStart, events.engineRunning)) - inOut(ramp(t, events.engineStop, events.engineStopped))
}

export function vibration(t: number): number {
  const catchKick = Math.exp(-Math.pow((t - events.engineStart - 0.15) / 0.3, 2))
  const stopKick = 0.5 * Math.exp(-Math.pow((t - events.engineStop - 0.2) / 0.3, 2))
  const v = 0.35 * engine(t) + catchKick + stopKick
  return v < 1e-6 ? 0 : Math.min(1, v)
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
