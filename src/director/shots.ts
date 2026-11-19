import * as THREE from 'three'
import { config, type FormatSpec } from '../config'
import type { CameraState } from '../core/lens'
import type { Anchor, AnchorId } from '../vehicle/contract'
import { ease, glide, mix, mixV, resolveShot, type Shot } from './rig'
import { beatAt, beatById, events, loopPhase } from './timeline'

type Anchors = Record<AnchorId, Anchor>
type ShotMaker = (t: number, anchors: Anchors) => Shot

const [wideMm, normalWideMm, normalMm, portraitMm, macroMm] = config.lens.focalLengthsMm
const rad = THREE.MathUtils.degToRad
const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z)

const wake = beatById('wake')
const paint = beatById('paint')
const wheel = beatById('wheel')
const lamp = beatById('lamp')
const detail = beatById('detail')
const ignition = beatById('ignition')
const finale = beatById('return')

/** 0 at the opening position, 1 at the settled hero position. The same path is run in reverse in the last beat. */
export function push(t: number): number {
  return glide(t, 0, events.pushSettled, 2, 1.5) - glide(t, events.pullStart, events.pullEnd, 1.5, 2)
}

function frontOf(degreesOffNose: number, distance: number, height: number): THREE.Vector3 {
  return v(Math.sin(rad(degreesOffNose)) * distance, height, Math.cos(rad(degreesOffNose)) * distance)
}

function behind(tail: THREE.Vector3, degreesOffTail: number, distance: number, height: number): THREE.Vector3 {
  return v(tail.x + Math.sin(rad(degreesOffTail)) * distance, height, tail.z - Math.cos(rad(degreesOffTail)) * distance)
}

function heading(yawDegrees: number, pitchDegrees: number): THREE.Vector3 {
  const c = Math.cos(rad(pitchDegrees))
  return v(Math.sin(rad(yawDegrees)) * c, Math.sin(rad(pitchDegrees)), Math.cos(rad(yawDegrees)) * c)
}

const nose = v(0, 0.45, 2.3)

const master: Record<string, ShotMaker> = {
  establish: (t, a) => {
    const u = push(t)
    return {
      position: frontOf(20, mix(7.5, 5.3, u), 0.2),
      target: mixV(v(0, 0.55, 0), v(0, 0.55, 0.2), u),
      screen: [mix(0, 0.16, u), mix(0.27, 0.2, u)],
      focalMm: wideMm,
      focus: mixV(nose, a.lamp.position, u),
      tStop: 2,
      operator: 'wide',
    }
  },
  paint: (t, a) => {
    const direction = heading(180 + 35, -12)
    const travel = mix(0.275, -0.275, glide(t, paint.start, paint.end, 1.2, 1.2))
    const position = a.paint.position.clone().addScaledVector(direction, -0.45).add(v(0, 0.03, travel))
    return {
      position,
      target: position.clone().add(direction),
      focalMm: macroMm,
      focus: 0.45,
      focusOffset: 0.06 * ease(t, paint.start + 2.4, paint.start + 3),
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  wheel: (t, a) => {
    const p = glide(t, wheel.start, wheel.end, 1, 1)
    const w = a.wheel.position
    const drip = ease(t, wheel.start + 2.6, wheel.start + 2.9) - ease(t, wheel.start + 3.2, wheel.start + 4)
    return {
      position: v(w.x + 3.4, 0.3, w.z + mix(0.45, 0.05, p)),
      target: v(w.x, 0.36, w.z + mix(0.2, 0, p)),
      screen: [mix(0.1, 0, p), 0],
      focalMm: portraitMm,
      focus: v(w.x - 0.05, w.y, w.z),
      focusOffset: -0.12 * drip,
      tStop: 2.8,
      operator: 'macro',
      near: 0.05,
    }
  },
  lamp: (t, a) => {
    const p = glide(t, lamp.start, lamp.end, 1.2, 1.2)
    const l = a.lamp.position
    return {
      position: l.clone().addScaledVector(heading(35, 4), mix(0.9, 0.6, p)),
      target: l,
      focalMm: macroMm,
      focus: l,
      focusOffset: 0.05 * ease(t, lamp.start + 1.5, lamp.start + 3.5),
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  detail: (t, a) => {
    const p = glide(t, detail.start, detail.end, 1, 1)
    const direction = heading(mix(-22, 0, p), -32)
    const position = a.detail.position.clone().add(v(mix(0.8, 0, p), 0.38, -0.6))
    return {
      position,
      target: position.clone().add(direction),
      focalMm: portraitMm,
      focus: 0.75,
      tStop: 2.8,
      operator: 'macro',
      near: 0.05,
    }
  },
  ignition: (t, a) => {
    const p = glide(t, ignition.start + 0.8, ignition.end - 0.2, 1.5, 1.5)
    return {
      position: behind(v(0, 0, a.exhaust.position.z), mix(38, 26, p), mix(5.2, 4.7, p), 0.25),
      target: a.exhaust.position,
      screen: [0.16, -0.1],
      focalMm: normalWideMm,
      focus: a.exhaust.position,
      tStop: 2,
      operator: 'wide',
    }
  },
}

const vertical: Record<string, ShotMaker> = {
  establish: (t, a) => {
    const u = push(t)
    return {
      position: frontOf(10, mix(6.1, 4.5, u), 0.2),
      target: v(0, 0.55, 0.2),
      screen: [0, mix(-0.2, -0.24, u)],
      focalMm: wideMm,
      focus: mixV(nose, a.lamp.position, u),
      tStop: 2,
      operator: 'wide',
    }
  },
  paint: (t, a) => {
    const direction = heading(180 + 25, -40)
    const shoulder = a.paint.position.clone().add(v(0.12, -0.04, -1))
    const travel = mix(0.225, -0.225, glide(t, paint.start, paint.end, 1.2, 1.2))
    const position = shoulder.addScaledVector(direction, -0.45).add(v(0, 0, travel))
    return {
      position,
      target: position.clone().add(direction),
      focalMm: macroMm,
      focus: 0.45,
      focusOffset: 0.05 * ease(t, paint.start + 2.4, paint.start + 3),
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  wheel: (t, a) => {
    const p = glide(t, wheel.start, wheel.end, 1, 1)
    const w = a.wheel.position
    const drip = ease(t, wheel.start + 2.6, wheel.start + 2.9) - ease(t, wheel.start + 3.2, wheel.start + 4)
    return {
      position: v(w.x + 1.8, mix(0.22, 0.52, p), w.z + 0.05),
      target: v(w.x, mix(0.16, 0.36, p), w.z),
      screen: [0, -0.1],
      focalMm: normalMm,
      focus: v(w.x - 0.05, w.y, w.z),
      focusOffset: -0.12 * drip,
      tStop: 2.8,
      operator: 'macro',
      near: 0.05,
    }
  },
  lamp: (t, a) => {
    const p = glide(t, lamp.start, lamp.end, 1.2, 1.2)
    const l = a.lamp.position
    return {
      position: l.clone().addScaledVector(heading(35, 4), mix(0.95, 0.65, p)),
      target: l,
      screen: [0, mix(0, -0.12, p)],
      focalMm: macroMm,
      focus: l,
      focusOffset: 0.05 * ease(t, lamp.start + 1.5, lamp.start + 3.5),
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  detail: (t, a) => {
    const p = glide(t, detail.start, detail.end, 1, 1)
    const direction = heading(0, -38)
    const position = a.detail.position.clone().add(v(0, 0.4, mix(-0.95, -0.25, p)))
    return {
      position,
      target: position.clone().add(direction),
      focalMm: portraitMm,
      focus: 0.8,
      tStop: 2.8,
      operator: 'macro',
      near: 0.05,
    }
  },
  ignition: (t, a) => {
    const p = glide(t, ignition.start + 0.8, ignition.end - 0.2, 1.5, 1.5)
    return {
      position: behind(v(0, 0, a.exhaust.position.z), mix(24, 14, p), mix(7.6, 7, p), 0.25),
      target: a.exhaust.position,
      screen: [0, -0.16],
      focalMm: normalWideMm,
      focus: a.exhaust.position,
      tStop: 2,
      operator: 'wide',
    }
  },
}

const shotForBeat: Record<string, string> = {
  arrival: 'establish',
  [wake.id]: 'establish',
  [paint.id]: 'paint',
  [wheel.id]: 'wheel',
  [lamp.id]: 'lamp',
  [detail.id]: 'detail',
  [ignition.id]: 'ignition',
  [finale.id]: 'establish',
}

/** The shot is chosen by the frame's own time, so the samples of one exposure never straddle a cut. */
export function shotAt(timeSeconds: number, format: FormatSpec, anchors: Anchors, frameSeconds = timeSeconds): Shot {
  const set = format.width >= format.height ? master : vertical
  return set[shotForBeat[beatAt(frameSeconds).beat.id]](loopPhase(timeSeconds), anchors)
}

export function cameraAt(timeSeconds: number, format: FormatSpec, anchors: Anchors, frameSeconds = timeSeconds): CameraState {
  return resolveShot(shotAt(timeSeconds, format, anchors, frameSeconds), format, timeSeconds)
}
