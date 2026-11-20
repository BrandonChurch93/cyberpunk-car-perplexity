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
  return t > config.film.durationSeconds - wrap ? 0 : glide(t, 0, events.pushSettled, 1.15, 1.5)
}

function pull(t: number): number {
  return t < wrap ? 1 : glide(t, events.pullStart, events.pullEnd, 1.3, 1.3)
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

interface Axis { eye: THREE.Vector3; look: THREE.Vector3; reach: number; travel: number; focalMm: number }

const heroAxis: Record<'master' | 'vertical', Axis> = {
  master: { eye: v(3.15, 0.79, 7.87), look: heading(205.1, -0.9), reach: 8.4, travel: 2.8, focalMm: normalMm },
  vertical: { eye: v(2.93, 0.79, 7.33), look: heading(201.8, 4.4), reach: 7.9, travel: 2.8, focalMm: normalWideMm },
}

function onAxis(axis: Axis, back: number, a: Anchors): Shot {
  const position = axis.eye.clone().addScaledVector(axis.look, -axis.travel * back)
  return {
    position,
    target: position.clone().addScaledVector(axis.look, axis.reach),
    focalMm: axis.focalMm,
    focus: mixV(a.lamp.position, nose, back),
    tStop: 2.8,
    operator: 'wide',
  }
}

function follow(t: number): number {
  return glide(t, wheel.start, wheel.end, 2.2, 1.2)
}

function grazing(t: number, a: Anchors, azimuth: number, elevation: number, reach: number, from: number, to: number, focalMm: number, side = 0, level = false): Shot {
  const p = glide(t, detail.start, detail.end, 1.5, 1.2)
  const normal = a.detail.normal
  const along = v(0, 0, -1).addScaledVector(normal, normal.z).normalize()
  const across = along.clone().cross(normal)
  const c = Math.cos(rad(elevation))
  const offset = along.clone().multiplyScalar(Math.cos(rad(azimuth)) * c)
    .addScaledVector(across, Math.sin(rad(azimuth)) * c)
    .addScaledVector(normal, Math.sin(rad(elevation)))
  const target = a.detail.position.clone().addScaledVector(along, mix(from, to, p)).addScaledVector(across, side)
  const position = target.clone().addScaledVector(offset, reach)
  const forward = target.clone().sub(position).normalize()
  const right = forward.clone().cross(v(0, 1, 0)).normalize()
  const up = right.clone().cross(forward)
  const lean = THREE.MathUtils.radToDeg(Math.atan2(across.dot(up), across.dot(right)))
  return {
    position,
    target,
    roll: level ? lean - Math.round(lean / 180) * 180 : 0,
    focalMm,
    focus: target,
    tStop: 11,
    operator: 'macro',
    near: 0.05,
  }
}

const master: Record<string, ShotMaker> = {
  establish: (t, a) => onAxis(heroAxis.master, 1 - push(t), a),
  paint: (t, a) => {
    const p = glide(t, paint.start, paint.end, 1.2, 1.2)
    const target = a.paint.position.clone().add(v(mix(-0.1097, -0.1321, p), 0.02, mix(0.16, 0.28, p)))
    return {
      position: target.clone().addScaledVector(v(0.64, 0.44, -0.26), 0.92),
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
    const angle = mix(54, 64, p)
    const target = v(w.x, w.y - 0.03, w.z - 0.27)
    return {
      position: v(w.x + Math.sin(rad(angle)) * 3.4, mix(1.5, 1.38, p), w.z + Math.cos(rad(angle)) * 3.4),
      target,
      focalMm: portraitMm,
      focus: v(w.x + 0.1, w.y, w.z),
      tStop: 4,
      operator: 'macro',
      near: 0.05,
    }
  },
  lamp: (t, a) => {
    const p = glide(t, lamp.start, lamp.end, 1.2, 2.2)
    const l = a.lamp.position
    const wide = v(l.x + 0.169 - Math.cos(rad(36)) * 0.246, l.y - 0.005, l.z - 0.126 + Math.sin(rad(36)) * 0.246)
    return {
      position: mixV(wide.clone().addScaledVector(heading(36, 8), 2.08), l.clone().addScaledVector(heading(40, 10), 0.32), p),
      target: mixV(wide, l, ease(p, 0, 1)).addScaledVector(v(0.079, -0.06, -0.062), Math.sin(Math.PI * p) ** 2),
      focalMm: portraitMm,
      focus: l,
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  detail: (t, a) => grazing(t, a, 35, 28, 0.85, 0.11, 0.21, portraitMm),
  ignition: (t, a) => {
    const p = glide(t, ignition.start + 0.8, ignition.end - 0.2, 1.5, 1.5)
    return {
      position: behind(v(0, 0, a.exhaust.position.z), mix(40, 31, p), mix(4.0, 3.6, p), 0.25),
      target: a.exhaust.position,
      screen: [0.31, 0.06],
      focalMm: normalWideMm,
      focus: a.exhaust.position,
      tStop: 2,
      operator: 'wide',
    }
  },
  crane: (t, a) => onAxis(heroAxis.master, pull(t), a),
}

const vertical: Record<string, ShotMaker> = {
  establish: (t, a) => onAxis(heroAxis.vertical, 1 - push(t), a),
  paint: (t, a) => {
    const p = glide(t, paint.start, paint.end, 1.2, 1.2)
    const target = a.paint.position.clone().add(v(mix(-0.1095, -0.1165, p), 0.006, mix(0.095, 0.165, p)))
    return {
      position: target.clone().add(v(0.3, 0.56, -0.43)),
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
    const angle = mix(48, 45, p)
    const target = v(w.x + 0.05, mix(0.47, 0.22, p), w.z + mix(0.12, 0.07, p))
    return {
      position: v(w.x + Math.sin(rad(angle)) * 1.5, mix(0.74, 0.15, p), w.z + Math.cos(rad(angle)) * 1.5),
      target,
      focalMm: portraitMm,
      focus: v(w.x + 0.1, target.y, target.z),
      tStop: 4,
      operator: 'macro',
      near: 0.05,
    }
  },
  lamp: (t, a) => {
    const p = glide(t, lamp.start, lamp.end, 1.2, 2.2)
    const l = a.lamp.position
    const wide = l.clone().add(v(0.049, -0.075, -0.086))
    const close = v(l.x - 0.022, l.y - 0.03, l.z)
    return {
      position: mixV(wide.clone().addScaledVector(heading(4, 17), 1.48), close.clone().addScaledVector(heading(14, 16), 0.62), p),
      target: mixV(wide, close, ease(p, 0, 1)).addScaledVector(v(0.05, -0.02, -0.008), Math.sin(Math.PI * p) ** 2),
      focalMm: macroMm,
      focus: l,
      tStop: 4,
      operator: 'macro',
      near: 0.02,
    }
  },
  detail: (t, a) => grazing(t, a, 180, 42, 0.36, -0.065, 0.015, portraitMm, 0, true),
  ignition: (t, a) => {
    const p = glide(t, ignition.start + 0.8, ignition.end - 0.2, 1.5, 1.5)
    return {
      position: behind(v(0, 0, a.exhaust.position.z), mix(40, 31, p), mix(3.6, 3.35, p), 0.25),
      target: mixV(v(0.3, 0.7, a.exhaust.position.z + 0.9), v(0.2, 0.7, a.exhaust.position.z + 0.9), p),
      screen: [0, -0.12],
      focalMm: wideMm,
      focus: a.exhaust.position,
      tStop: 2,
      operator: 'wide',
    }
  },
  crane: (t, a) => onAxis(heroAxis.vertical, pull(t), a),
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
