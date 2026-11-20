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

const nose = v(0, 0.45, 2.3)
const center = v(0, 0.55, 0)

function drip(t: number): number {
  return ease(t, wheel.start + 2.6, wheel.start + 2.9) - ease(t, wheel.start + 3.2, wheel.start + 4)
}

const master: Record<string, ShotMaker> = {
  establish: (t, a) => {
    const u = push(t)
    return {
      position: frontOf(26, mix(7.2, 4.6, u), 0.2),
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
    const position = a.paint.position.clone().add(mixV(v(0.923, 0.127, -0.45), v(0.923, 0.127, -0.17), p))
    return {
      position,
      target: a.paint.position.clone().add(v(0, 0.07, -0.03)),
      focalMm: macroMm,
      focus: a.paint.position,
      focusOffset: 0.06 * ease(t, paint.start + 2.4, paint.start + 3),
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  wheel: (t, a) => {
    const p = glide(t, wheel.start, wheel.end, 1, 1)
    const w = a.wheel.position
    const angle = mix(62, 76, p)
    const reach = mix(2.2, 2.1, p)
    return {
      position: v(w.x + Math.sin(rad(angle)) * reach, mix(0.46, 0.44, p), w.z + Math.cos(rad(angle)) * reach),
      target: v(w.x, 0.3, w.z - 0.08),
      focalMm: normalMm,
      focus: v(w.x + 0.12, w.y, w.z),
      focusOffset: -0.12 * drip(t),
      tStop: 2.8,
      operator: 'macro',
      near: 0.05,
    }
  },
  lamp: (t, a) => {
    const p = glide(t, lamp.start, lamp.end, 1.2, 1.2)
    const l = a.lamp.position
    return {
      position: l.clone().addScaledVector(heading(35, 4), mix(1.3, 0.8, p)),
      target: mixV(l.clone().add(v(0, 0.035, 0)), l.clone().add(v(0.035, 0.006, -0.04)), p),
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
    const d = a.detail.position
    return {
      position: v(d.x + mix(0.46, 0.4, p), d.y + mix(0.4, 0.29, p), d.z + mix(-0.62, -0.38, p)),
      target: v(d.x + 0.01, d.y, d.z + mix(-0.02, 0.2, p)),
      focalMm: normalMm,
      focus: v(d.x + 0.1, d.y, d.z + mix(-0.08, 0.05, p)),
      tStop: 2.8,
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
      position: frontOf(mix(46, 26, q), mix(4.9, 7.2, q), mix(1.25, 0.2, q)),
      target: mixV(v(0, 0.45, 0.3), center, q),
      screen: [0, mix(0, -0.05, q)],
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
      position: frontOf(30, mix(7.6, 6.6, u), 0.2),
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
    const position = a.paint.position.clone().add(mixV(v(0.47, 0.397, -0.3), v(0.47, 0.397, -0.56), p))
    return {
      position,
      target: a.paint.position.clone().add(v(-0.03, 0.017, 0.03)),
      focalMm: portraitMm,
      focus: a.paint.position,
      focusOffset: 0.06 * ease(t, paint.start + 2.4, paint.start + 3),
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  wheel: (t, a) => {
    const p = glide(t, wheel.start, wheel.end, 1, 1)
    const w = a.wheel.position
    const angle = mix(52, 58, p)
    const reach = mix(1.72, 1.62, p)
    return {
      position: v(w.x + Math.sin(rad(angle)) * reach, mix(0.5, 0.24, p), w.z + Math.cos(rad(angle)) * reach),
      target: v(w.x, mix(0.38, 0.3, p), w.z + 0.05),
      focalMm: normalMm,
      focus: v(w.x + 0.12, w.y, w.z),
      focusOffset: -0.12 * drip(t),
      tStop: 2.8,
      operator: 'macro',
      near: 0.05,
    }
  },
  lamp: (t, a) => {
    const p = glide(t, lamp.start, lamp.end, 1.2, 1.2)
    const lens = a.lamp.position.clone().add(v(0.071, 0.032, -0.107))
    return {
      position: lens.clone().addScaledVector(heading(mix(22, 38, p), 6), mix(0.68, 0.46, p)),
      target: lens.clone().add(v(0, -0.012, 0)),
      focalMm: macroMm,
      focus: lens,
      focusOffset: 0.05 * ease(t, lamp.start + 1.5, lamp.start + 3.5),
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  detail: (t, a) => {
    const p = glide(t, detail.start, detail.end, 1, 1)
    const d = a.detail.position
    return {
      position: v(d.x + 0.15, d.y + 0.45, d.z + mix(-0.72, -0.4, p)),
      target: v(d.x + 0.15, d.y, d.z + mix(-0.12, 0.2, p)),
      focalMm: portraitMm,
      focus: v(d.x + 0.15, d.y, d.z + mix(-0.12, 0.2, p)),
      tStop: 2.8,
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
      position: frontOf(mix(50, 30, q), mix(6.9, 7.6, q), mix(1.5, 0.2, q)),
      target: mixV(v(0.15, 0.55, 0.5), v(0.2, 0.55, 0.8), q),
      screen: [0, mix(0, -0.36, q)],
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
