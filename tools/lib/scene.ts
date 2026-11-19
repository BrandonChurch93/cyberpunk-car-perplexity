import * as THREE from 'three'
import type { Page } from 'playwright'
import { config, paintById, defaultPaint, type FormatSpec } from '../../src/config.ts'
import type { CameraState } from '../../src/core/lens.ts'
import { cameraAt } from '../../src/director/shots.ts'
import { beatAt } from '../../src/director/timeline.ts'
import { createVehicle, type Anchor, type AnchorId } from '../../src/vehicle/index.ts'
import { createWorld } from '../../src/world/index.ts'
import type { StageDetail } from '../../src/core/detail.ts'
import { detailFrom } from './detail.ts'

export const anchorIds: AnchorId[] = ['paint', 'wheel', 'lamp', 'detail', 'exhaust']
export type Anchors = Record<AnchorId, Anchor>

interface PlainAnchor {
  position: [number, number, number]
  normal: [number, number, number]
  radius: number
}

/** Prefer the page's own anchors when it exposes them, so the tools follow the vehicle the page builds. */
export async function sceneAnchors(page?: Page, paint = defaultPaint): Promise<{ anchors: Anchors; source: string }> {
  if (page) {
    const plain = await page.evaluate(() => {
      const s = window.showcase as unknown as { anchors?: () => Record<string, PlainAnchor> } | undefined
      return typeof s?.anchors === 'function' ? s.anchors() : null
    })
    if (plain) {
      const out = {} as Anchors
      for (const id of anchorIds) {
        const a = plain[id]
        out[id] = { position: new THREE.Vector3(...a.position), normal: new THREE.Vector3(...a.normal), radius: a.radius }
      }
      return { anchors: out, source: 'page' }
    }
  }
  const detail = detailFrom()
  const vehicle = await createVehicle({ paint: paintById(paint), detail })
  return { anchors: vehicle.anchors, source: `${detail} vehicle module in node` }
}

export function frameSeconds(frame: number): number {
  return frame / config.film.fps
}

export function cameraForFrame(frame: number, format: FormatSpec, anchors: Anchors): CameraState {
  const t = frameSeconds(frame)
  return cameraAt(t, format, anchors, t)
}

export function beatOfFrame(frame: number): string {
  return beatAt(frameSeconds(frame)).beat.id
}

export interface Projected {
  x: number
  y: number
  depth: number
  pixelsPerMeter: number
}

const inverse = new THREE.Quaternion()
const local = new THREE.Vector3()

/** Pinhole projection matching applyLens with the aperture and pixel jitter at zero. */
export function project(state: CameraState, format: FormatSpec, point: THREE.Vector3): Projected | null {
  inverse.copy(state.quaternion).invert()
  local.copy(point).sub(state.position).applyQuaternion(inverse)
  const depth = -local.z
  if (depth <= state.near) return null
  const scale = state.focalMm / (state.sensorWidthMm / 2)
  const ndcX = (local.x / depth) * scale
  const ndcY = ((local.y / depth) * scale * format.width) / format.height
  return {
    x: ((ndcX + 1) / 2) * format.width,
    y: ((1 - ndcY) / 2) * format.height,
    depth,
    pixelsPerMeter: (scale * format.width) / 2 / depth,
  }
}

/** The world ray through a pixel, for naming what a region of the frame looks at. */
export function rayThrough(state: CameraState, format: FormatSpec, x: number, y: number): { origin: THREE.Vector3; direction: THREE.Vector3 } {
  const scale = state.focalMm / (state.sensorWidthMm / 2)
  const ndcX = (x / format.width) * 2 - 1
  const ndcY = 1 - (y / format.height) * 2
  const direction = new THREE.Vector3(ndcX / scale, (ndcY * format.height) / format.width / scale, -1).normalize().applyQuaternion(state.quaternion)
  return { origin: state.position.clone(), direction }
}

const cachedScenes = new Map<StageDetail, Promise<THREE.Object3D | null>>()

async function buildNodeScene(paint: string, detail: StageDetail): Promise<THREE.Object3D | null> {
  try {
    const [world, vehicle] = await Promise.all([createWorld({ detail }), createVehicle({ paint: paintById(paint), detail })])
    const root = new THREE.Group()
    root.add(world.root, vehicle.root)
    root.updateMatrixWorld(true)
    return root
  } catch {
    return detail === 'full' ? buildNodeScene(paint, 'blockout') : null
  }
}

/** The scene built in Node at the asked detail, used only to name what each region of a frame shows. Falls back to the blockout. */
export function nodeScene(paint = defaultPaint, detail: StageDetail = detailFrom()): Promise<THREE.Object3D | null> {
  let scene = cachedScenes.get(detail)
  if (!scene) {
    scene = buildNodeScene(paint, detail)
    cachedScenes.set(detail, scene)
  }
  return scene
}

function labelOf(object: THREE.Object3D, point: THREE.Vector3, distance: number): string {
  const names: string[] = []
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (o.name) names.push(o.name)
  const top = names[names.length - 1] ?? 'scene'
  const part = names.length > 1 ? names[0] : ''
  if (top === 'world' && !part) return point.y < 0.05 && point.y > -0.6 ? 'deck' : distance > 45 ? 'towers and city' : 'deck structures'
  return part ? `${top} ${part}` : top
}

const caster = new THREE.Raycaster()

/** What a region of the frame shows, by casting a grid of rays into the scene. */
export async function describeRegion(state: CameraState, format: FormatSpec, rect: { left: number; top: number; width: number; height: number }, steps = 5): Promise<string> {
  const scene = await nodeScene()
  const counts = new Map<string, { n: number; near: number; far: number }>()
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      const x = rect.left + ((i + 0.5) / steps) * rect.width
      const y = rect.top + ((j + 0.5) / steps) * rect.height
      const { origin, direction } = rayThrough(state, format, x, y)
      let label = direction.y >= 0 ? 'sky' : 'below the horizon'
      let distance = Infinity
      if (scene) {
        caster.set(origin, direction)
        caster.near = state.near
        caster.far = state.far
        const hit = caster.intersectObject(scene, true)[0]
        if (hit) {
          label = labelOf(hit.object, hit.point, hit.distance)
          distance = hit.distance
        }
      } else if (direction.y < 0) {
        distance = -origin.y / direction.y
        label = distance < 60 ? 'deck' : 'city below'
      }
      const c = counts.get(label) ?? { n: 0, near: Infinity, far: 0 }
      c.n++
      c.near = Math.min(c.near, distance)
      c.far = Math.max(c.far, distance)
      counts.set(label, c)
    }
  }
  const total = steps * steps
  return [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([label, c]) => `${label} ${Math.round((100 * c.n) / total)}%${Number.isFinite(c.near) ? ` at ${c.near.toFixed(1)}${c.far.toFixed(1) !== c.near.toFixed(1) ? ` to ${c.far.toFixed(1)}` : ''} m` : ''}`)
    .join(', ')
}
