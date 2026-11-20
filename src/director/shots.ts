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

const wrap = 1

function push(t: number): number {
  return t > config.film.durationSeconds - wrap ? 0 : glide(t, 0, events.pushSettled, 1.2, 1.5)
}

function pull(t: number): number {
  return t < wrap ? 1 : glide(t, events.pullStart, events.pullEnd, 1.3, 1.6)
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

const wideAngle = 26
const nose = v(0, 0.45, 2.3)
const center = v(0, 0.55, 0)

function follow(t: number): number {
  return glide(t, wheel.start + 0.4, wheel.end - 0.2, 1.2, 1.2)
}

const master: Record<string, ShotMaker> = {
  establish: (t, a) => {
    const u = push(t)
    return {
      position: frontOf(wideAngle, mix(7.2, 4.6, u), 0.2),
      target: mixV(center, v(0, 0.55, 0.2), u),
      screen: [mix(0, 0.14, u), mix(-0.05, -0.14, u)],
      focalMm: wideMm,
      focus: mixV(nose, a.lamp.position, u),
      tStop: 2,
      operator: 'wide',
    }
  },
  paint: (t, a) => {
    const p = glide(t, paint.start, paint.end, 1.2, 1.2)
    const target = a.paint.position.clone().add(v(-0.1, 0, mix(-0.075, 0.075, p)))
    return {
      position: target.clone().add(v(0.64, 0.44, -0.26)),
      target,
      focalMm: macroMm,
      focus: target,
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  wheel: (t, a) => {
    const p = follow(t)
    const w = a.wheel.position
    const angle = mix(42, 46, p)
    const target = v(w.x + 0.05, w.y + mix(0.22, -0.2, p), w.z + 0.16)
    return {
      position: v(w.x + Math.sin(rad(angle)) * 1.5, mix(0.62, 0.2, p), w.z + Math.cos(rad(angle)) * 1.5),
      target,
      focalMm: portraitMm,
      focus: v(w.x + 0.1, target.y, w.z + 0.16),
      tStop: 4,
      operator: 'macro',
      near: 0.05,
    }
  },
  lamp: (t, a) => {
    const p = glide(t, lamp.start, lamp.end, 1.2, 1.2)
    const l = a.lamp.position
    const target = l.clone().add(v(0.004, mix(-0.035, -0.025, p), -0.066))
    return {
      position: target.clone().addScaledVector(heading(mix(20, 26, p), 8), mix(1.7, 1.42, p)),
      target,
      focalMm: portraitMm,
      focus: l,
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  detail: (t, a) => {
    const p = glide(t, detail.start, detail.end, 1, 1)
    const target = a.detail.position.clone().add(v(0, 0, mix(0.115, -0.06, p)))
    return {
      position: target.clone().add(v(0.3, 0.52, 0)),
      target,
      focalMm: portraitMm,
      focus: target,
      tStop: 11,
      operator: 'macro',
      near: 0.05,
    }
  },
  ignition: (t, a) => {
    const p = glide(t, ignition.start + 0.8, ignition.end - 0.2, 1.5, 1.5)
    return {
      position: behind(v(0, 0, a.exhaust.position.z), mix(38, 26, p), mix(4.0, 3.5, p), 0.25),
      target: a.exhaust.position,
      screen: [0.16, -0.1],
      focalMm: normalWideMm,
      focus: a.exhaust.position,
      tStop: 2,
      operator: 'wide',
    }
  },
  crane: (t, a) => {
    const q = pull(t)
    return {
      position: frontOf(mix(wideAngle + 20, wideAngle, q), mix(4.9, 7.2, q), mix(0.7, 0.2, q)),
      target: mixV(v(0, 0.55, 0.3), center, q),
      screen: [0, mix(-0.2, -0.05, q)],
      focalMm: wideMm,
      focus: mixV(a.lamp.position, nose, q),
      tStop: 2,
      operator: 'wide',
    }
  },
}

const vertical: Record<string, ShotMaker> = {
  establish: (t, a) => {
    const u = push(t)
    return {
      position: frontOf(30, mix(9.4, 6.4, u), 0.2),
      target: v(0.2, 0.55, 0.8),
      screen: [0, -0.36],
      focalMm: wideMm,
      focus: mixV(nose, a.lamp.position, u),
      tStop: 2,
      operator: 'wide',
    }
  },
  paint: (t, a) => {
    const p = glide(t, paint.start, paint.end, 1.2, 1.2)
    const target = a.paint.position.clone().add(v(-0.03, 0.017, 0.03))
    return {
      position: a.paint.position.clone().add(v(0.47, 0.397, mix(-0.36, -0.15, p))),
      target,
      focalMm: portraitMm,
      focus: target,
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  wheel: (t, a) => {
    const p = follow(t)
    const w = a.wheel.position
    const angle = mix(48, 44, p)
    const target = v(w.x + 0.05, w.y + mix(0.1, -0.08, p), w.z + 0.06)
    return {
      position: v(w.x + Math.sin(rad(angle)) * 1.9, mix(0.5, 0.24, p), w.z + Math.cos(rad(angle)) * 1.9),
      target,
      focalMm: portraitMm,
      focus: v(w.x + 0.1, target.y, w.z + 0.06),
      tStop: 4,
      operator: 'macro',
      near: 0.05,
    }
  },
  lamp: (t, a) => {
    const p = glide(t, lamp.start, lamp.end, 1.2, 1.2)
    const l = a.lamp.position
    const target = l.clone().add(v(0.049, -0.005, -0.086))
    return {
      position: target.clone().addScaledVector(heading(mix(-8, 0, p), 14), mix(1.32, 1.18, p)),
      target,
      focalMm: macroMm,
      focus: l,
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  detail: (t, a) => {
    const p = glide(t, detail.start, detail.end, 1, 1)
    const target = a.detail.position.clone().add(v(0, 0, mix(-0.075, 0.05, p)))
    return {
      position: target.clone().add(v(0, 0.58, -0.15)),
      target,
      focalMm: portraitMm,
      focus: target,
      tStop: 11,
      operator: 'macro',
      near: 0.05,
    }
  },
  ignition: (t, a) => {
    const p = glide(t, ignition.start + 0.8, ignition.end - 0.2, 1.5, 1.5)
    return {
      position: behind(v(0, 0, a.exhaust.position.z), mix(32, 22, p), mix(5.0, 4.5, p), 0.25),
      target: mixV(v(0.45, 0.7, a.exhaust.position.z + 0.82), v(0.25, 0.7, a.exhaust.position.z + 0.67), p),
      screen: [0, -0.1],
      focalMm: normalWideMm,
      focus: a.exhaust.position,
      tStop: 2,
      operator: 'wide',
    }
  },
  crane: (t, a) => {
    const q = pull(t)
    return {
      position: frontOf(mix(40, 30, q), mix(6.8, 9.4, q), mix(0.8, 0.2, q)),
      target: mixV(v(0.1, 0.55, 0.1), v(0.2, 0.55, 0.8), q),
      screen: [0, mix(-0.42, -0.36, q)],
      focalMm: wideMm,
      focus: mixV(a.lamp.position, nose, q),
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
  [finale.id]: 'crane',
}

/** The shot is chosen by the frame's own time, so the samples of one exposure never straddle a cut. */
export function shotAt(timeSeconds: number, format: FormatSpec, anchors: Anchors, frameSeconds = timeSeconds): Shot {
  const set = format.width >= format.height ? master : vertical
  return set[shotForBeat[beatAt(frameSeconds).beat.id]](loopPhase(timeSeconds), anchors)
}

export function cameraAt(timeSeconds: number, format: FormatSpec, anchors: Anchors, frameSeconds = timeSeconds): CameraState {
  return resolveShot(shotAt(timeSeconds, format, anchors, frameSeconds), format, timeSeconds)
}
