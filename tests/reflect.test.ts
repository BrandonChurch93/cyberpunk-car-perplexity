import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { quality } from '../src/core/reflect'
import { boxProject, mirrorCamera } from '../src/core/reflect/mirror'

function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 500)
  c.position.set(1.5, 1.2, 9)
  c.lookAt(0, 0.4, 0)
  c.updateMatrixWorld(true)
  return c
}

function clipOf(c: THREE.Camera, p: THREE.Vector3): THREE.Vector4 {
  return new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(c.matrixWorldInverse).applyMatrix4(c.projectionMatrix)
}

describe('mirror camera', () => {
  const source = camera()
  const mirror = new THREE.PerspectiveCamera()
  mirrorCamera(source, mirror)

  it('sees a point above the deck where the source sees its mirror image, flipped left to right', () => {
    const p = new THREE.Vector3(-0.8, 2.3, -4)
    const seen = clipOf(mirror, p)
    const image = clipOf(source, new THREE.Vector3(p.x, -p.y, p.z))
    expect(seen.x / seen.w).toBeCloseTo(-image.x / image.w, 5)
    expect(seen.y / seen.w).toBeCloseTo(image.y / image.w, 5)
  })

  it('lands a deck point on the mirrored pixel of the source', () => {
    const p = new THREE.Vector3(0.6, 0, 2)
    const a = clipOf(mirror, p)
    const b = clipOf(source, p)
    expect(a.x / a.w).toBeCloseTo(-b.x / b.w, 5)
    expect(a.y / a.w).toBeCloseTo(b.y / b.w, 5)
  })

  it('clips everything below the deck and keeps what is above it', () => {
    const below = clipOf(mirror, new THREE.Vector3(0, -0.2, 0))
    const above = clipOf(mirror, new THREE.Vector3(0, 0.2, 0))
    expect(below.z).toBeLessThan(-below.w)
    expect(above.z).toBeGreaterThan(-above.w)
    expect(above.z).toBeLessThan(above.w)
  })

  it('is a proper rigid camera', () => {
    expect(mirror.matrixWorld.determinant()).toBeCloseTo(1, 5)
  })
})

describe('box projection', () => {
  const box = new THREE.Box3(new THREE.Vector3(-10, 0, -5), new THREE.Vector3(10, 20, 5))
  const probe = new THREE.Vector3(0, 0.6, 0)

  it('points from the probe to where the ray leaves the box', () => {
    const p = new THREE.Vector3(4, 0.6, 0)
    const out = boxProject(p, new THREE.Vector3(0, 0, 1), box, probe)
    expect(out.toArray().map((v) => +v.toFixed(5))).toEqual(new THREE.Vector3(4, 0, 5).normalize().toArray().map((v) => +v.toFixed(5)))
  })

  it('leaves the direction alone outside the box', () => {
    const dir = new THREE.Vector3(0.3, 0.4, 0.5).normalize()
    expect(boxProject(new THREE.Vector3(30, 1, 0), dir, box, probe).equals(dir)).toBe(true)
  })
})

describe('quality', () => {
  it('keeps the full setting for the final tier and cheaper ones below it', () => {
    expect(quality.final.planarEverySample).toBe(true)
    expect(quality.final.bounce).toBe(true)
    expect(quality.draft.captureSize).toBeLessThan(quality.review.captureSize)
    expect(quality.review.captureSize).toBeLessThan(quality.final.captureSize)
    for (const q of Object.values(quality)) expect(Math.log2(q.captureSize) % 1).toBe(0)
  })
})
