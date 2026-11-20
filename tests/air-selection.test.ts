import * as THREE from 'three'
import { expect, it } from 'vitest'
import { WorldRibbonSelection } from '../src/weather/air/selection'

it('keeps shutter-edge and uncertain wrap candidates in their original blend order', () => {
  const drops = new Float32Array([
    0, 0.5, -0.2, 0.002,
    0, 0.5, 0.2, 0.002,
    0.45, 0.5, -0.2, 0.002,
    0.2825, 0.5, -0.2, 0.002,
    0, 0, 0.2, 0.002,
  ])
  const motion = new Float32Array(drops.length)
  for (let i = 0; i < motion.length; i += 4) motion.set([45, 9, 6, 0.5], i)
  const selection = new WorldRibbonSelection(drops, motion, new THREE.Vector3(40, 9, 40), new THREE.Vector3(0, 1, 0), [1.9, 25])
  const camera = new THREE.PerspectiveCamera(90, 1, 0.02, 100)
  const world = new THREE.Matrix4()
  const shift = new THREE.Vector2()
  const select = () => {
    camera.updateMatrixWorld()
    selection.select(camera, world, undefined, shift, 8, 0)
    const { drawRange } = selection.geometry
    return Array.from(selection.geometry.index!.array.slice(0, drawRange.count))
  }
  const original = [0, 1, 2, 0, 2, 3, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19]
  expect(select()).toEqual(original)
  camera.rotation.y = Math.PI
  expect(select()).toEqual([4, 5, 6, 4, 6, 7, 16, 17, 18, 16, 18, 19])
  camera.rotation.y = 0
  expect(select()).toEqual(original)
})
