import * as THREE from 'three'

export interface CameraState {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  focalMm: number
  sensorWidthMm: number
  focusDistance: number
  fNumber: number
  near: number
  far: number
}

export interface LensSample {
  pixel: [number, number]
  aperture: [number, number]
}

const right = new THREE.Vector3()
const up = new THREE.Vector3()

export function apertureRadius(state: CameraState): number {
  return state.focalMm / state.fNumber / 2000
}

export function applyLens(
  camera: THREE.PerspectiveCamera,
  state: CameraState,
  width: number,
  height: number,
  sample: LensSample,
  ovalSqueeze: number,
): void {
  const halfW = (state.near * state.sensorWidthMm) / 2 / state.focalMm
  const halfH = (halfW * height) / width
  const radius = apertureRadius(state)
  const ox = (sample.aperture[0] * radius) / ovalSqueeze
  const oy = sample.aperture[1] * radius
  right.set(1, 0, 0).applyQuaternion(state.quaternion)
  up.set(0, 1, 0).applyQuaternion(state.quaternion)
  camera.position.copy(state.position).addScaledVector(right, ox).addScaledVector(up, oy)
  camera.quaternion.copy(state.quaternion)
  const shiftX = (-ox * state.near) / state.focusDistance + (sample.pixel[0] * 2 * halfW) / width
  const shiftY = (-oy * state.near) / state.focusDistance + (sample.pixel[1] * 2 * halfH) / height
  camera.near = state.near
  camera.far = state.far
  camera.aspect = width / height
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfH / state.near))
  camera.projectionMatrix.makePerspective(-halfW + shiftX, halfW + shiftX, halfH + shiftY, -halfH + shiftY, state.near, state.far)
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
  camera.updateMatrixWorld(true)
}
