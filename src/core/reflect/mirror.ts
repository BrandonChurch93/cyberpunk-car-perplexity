import * as THREE from 'three'

const mirrorY = new THREE.Matrix4().makeScale(1, -1, 1)
const flipX = new THREE.Matrix4().makeScale(-1, 1, 1)
const deckPlane = new THREE.Plane()
const clip = new THREE.Vector4()
const q = new THREE.Vector4()

/**
 * Sets `out` to the camera that sees the scene mirrored in the plane y = 0. It is a proper rigid camera under the deck
 * whose image is the true mirror image flipped left to right, so a deck point lands on the mirrored pixel of the source.
 * The near plane is made oblique so nothing below y = 0 is drawn.
 */
export function mirrorCamera(source: THREE.PerspectiveCamera, out: THREE.PerspectiveCamera): void {
  out.matrixAutoUpdate = false
  out.matrixWorldAutoUpdate = false
  out.matrixWorld.multiplyMatrices(mirrorY, source.matrixWorld).multiply(flipX)
  out.matrixWorld.decompose(out.position, out.quaternion, out.scale)
  out.matrix.copy(out.matrixWorld)
  out.matrixWorldInverse.copy(out.matrixWorld).invert()
  out.near = source.near
  out.far = source.far
  const e = out.projectionMatrix.copy(source.projectionMatrix).elements
  for (const i of [1, 2, 3, 4, 8, 12]) e[i] = -e[i]
  obliqueNear(out.projectionMatrix, out.matrixWorldInverse)
  out.projectionMatrixInverse.copy(out.projectionMatrix).invert()
}

/** Moves the near plane of `projection` onto the deck plane y = 0, after Lengyel. */
export function obliqueNear(projection: THREE.Matrix4, view: THREE.Matrix4): void {
  deckPlane.set(new THREE.Vector3(0, 1, 0), 0).applyMatrix4(view)
  clip.set(deckPlane.normal.x, deckPlane.normal.y, deckPlane.normal.z, deckPlane.constant)
  const e = projection.elements
  q.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14])
  clip.multiplyScalar(2 / clip.dot(q))
  e[2] = clip.x
  e[6] = clip.y
  e[10] = clip.z + 1
  e[14] = clip.w
}

/** The direction from `probe` to where the ray from `p` along `dir` leaves `box`. Same math as the shader. */
export function boxProject(p: THREE.Vector3, dir: THREE.Vector3, box: THREE.Box3, probe: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  if (!box.containsPoint(p)) return out.copy(dir)
  let t = Infinity
  for (const k of ['x', 'y', 'z'] as const) {
    const d = dir[k]
    if (Math.abs(d) < 1e-9) continue
    const hit = ((d > 0 ? box.max[k] : box.min[k]) - p[k]) / d
    t = Math.min(t, hit)
  }
  return out.copy(p).addScaledVector(dir, t).sub(probe).normalize()
}
