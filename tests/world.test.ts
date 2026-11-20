import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { config, frameCount } from '../src/config'
import { apertureRadius, applyLens } from '../src/core/lens'
import { sampleSet } from '../src/core/sampler'
import { cameraAt } from '../src/director/shots'
import { createVehicle } from '../src/vehicle'
import { createWorld } from '../src/world'

const world = await createWorld({ detail: 'blockout' })
const { anchors } = await createVehicle({ paint: config.paint.candidates[0], detail: 'blockout' })
const formats = [config.formats.master, config.formats.vertical]
const camera = new THREE.PerspectiveCamera()

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = []
  root.traverse((node) => { if (node instanceof THREE.Mesh) result.push(node) })
  return result
}

function bounds(root: THREE.Object3D): THREE.Box3[] {
  root.updateMatrixWorld(true)
  const boxes: THREE.Box3[] = []
  const matrix = new THREE.Matrix4()
  for (const mesh of meshes(root)) {
    mesh.geometry.computeBoundingBox()
    const local = mesh.geometry.boundingBox
    if (local === null) throw new Error('mesh has no bounds')
    if (mesh instanceof THREE.InstancedMesh) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix)
        boxes.push(local.clone().applyMatrix4(matrix.premultiply(mesh.matrixWorld)))
      }
    } else {
      boxes.push(local.clone().applyMatrix4(mesh.matrixWorld))
    }
  }
  return boxes
}

function signature(root: THREE.Object3D): unknown[] {
  root.updateMatrixWorld(true)
  return meshes(root).map((mesh) => [
    mesh.name, mesh.matrixWorld.toArray(), mesh instanceof THREE.InstancedMesh ? Array.from(mesh.instanceMatrix.array) : [],
    mesh.geometry.attributes.position.count, mesh.geometry.index?.count, mesh.castShadow, mesh.receiveShadow,
  ])
}

function required(name: string): THREE.Object3D {
  const object = world.root.getObjectByName(name)
  if (!object) throw new Error('missing ' + name)
  return object
}

describe('world blockout', () => {
  it('builds a static, deterministic, unlettered gray-box with no world lights or wet surfaces', async () => {
    const start = signature(world.root)
    const format = config.formats.master
    const timeSeconds = config.beats[2].start
    const sampleIndex = 0
    const frameIndex = timeSeconds * config.film.fps
    const frame = { frameIndex, frameKey: frameIndex, timeSeconds, tier: 'draft' as const, format, samples: config.tiers.draft.samplesPerFrame }
    const state = cameraAt(timeSeconds, format, anchors)
    world.beginFrame({ frame, format, camera: state })
    world.beginSample({ timeSeconds, sample: { ...sampleSet(frameIndex, sampleIndex), frame, sampleIndex, timeSeconds }, camera, state })
    expect(signature(world.root)).toEqual(start)
    expect(world.signs).toEqual([])
    expect(world.lights).toEqual([])
    expect(world.surfaces).toEqual([])
    const second = await createWorld({ detail: 'blockout' })
    expect(signature(second.root)).toEqual(start)
  })

  it('has four matte gray tones, shadow flags on all meshes and low triangle count', () => {
    const palette = new Set<THREE.Material>()
    let triangles = 0
    for (const mesh of meshes(world.root)) {
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 *
        (mesh instanceof THREE.InstancedMesh ? mesh.count : 1)
      expect(mesh.castShadow && mesh.receiveShadow).toBe(true)
      if (!(mesh.material instanceof THREE.MeshStandardMaterial)) throw new Error('expected matte standard material')
      palette.add(mesh.material)
    }
    expect(palette.size).toBe(4)
    for (const material of palette as Set<THREE.MeshStandardMaterial>) {
      const { r, g, b } = material.color
      expect(r === g && g === b).toBe(true)
      expect(material.map).toBeNull()
      expect(material.emissive.getHex()).toBe(0)
    }
    expect(triangles).toBeLessThan(150_000)
  })

  it('keeps the central parking surface at deck height and all tall props outside the clear circle', () => {
    const solid = bounds(world.root)
    const origin = new THREE.Vector3(0, 1, 0)
    const down = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, 2)
    expect(world.deck.heightMap).toBeNull()
    expect(world.deck.meshes.every((mesh) => mesh.material === world.deck.material)).toBe(true)
    expect(down.intersectObjects(world.deck.meshes)[0]?.point.y).toBeCloseTo(0, 8)
    expect(world.deck.bounds.containsPoint(new THREE.Vector2())).toBe(true)
    for (const box of solid) {
      if (box.max.y <= 0.15) continue
      const x = Math.max(0, box.min.x, -box.max.x)
      const z = Math.max(0, box.min.z, -box.max.z)
      expect(Math.hypot(x, z)).toBeGreaterThan(9)
    }
  })

  it('clears the camera through every shutter interval in both framings', () => {
    const solid = bounds(world.root).filter((box) => box.max.y > -0.2 && box.min.x < 11 && box.max.x > -11 &&
      box.min.z < 11 && box.max.z > -11)
    const halfShutter = config.film.shutterDegrees / (720 * config.film.fps)
    let closest = Infinity
    for (const format of formats) {
      for (let frame = 0; frame <= frameCount; frame++) {
        const seconds = frame / config.film.fps
        for (const offset of [-halfShutter, 0, halfShutter]) {
          const state = cameraAt(seconds + offset, format, anchors, seconds)
          for (const box of solid) closest = Math.min(closest, box.distanceToPoint(state.position) - apertureRadius(state))
        }
      }
    }
    expect(closest).toBeGreaterThan(0.1)
  })

  it('keeps the blank south billboard and closes the street below both wide framings', () => {
    world.root.updateMatrixWorld(true)
    const billboard = required('billboard')
    const street = new THREE.Box3().setFromObject(required('continuous ground'))
    const north = new THREE.Vector3(0, 0, 1)
    expect(north.transformDirection(billboard.matrixWorld).z).toBeGreaterThan(0)
    expect(billboard.getWorldPosition(north).z).toBeLessThan(0)
    for (const format of formats) {
      for (const seconds of [0, config.film.heroFrameSeconds]) {
        const state = cameraAt(seconds, format, anchors)
        applyLens(camera, state, format.width, format.height, { pixel: [0, 0], aperture: [0, 0] }, 1)
        expect(street.min.x).toBeLessThan(state.position.x - state.far)
        expect(street.max.x).toBeGreaterThan(state.position.x + state.far)
        expect(street.min.z).toBeLessThan(state.position.z - state.far)
        expect(street.max.z).toBeGreaterThan(state.position.z + state.far)
      }
    }
  })
})
