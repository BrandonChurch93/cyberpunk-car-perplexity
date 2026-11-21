import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { FormatSpec } from '../../src/config.ts'
import type { CameraState } from '../../src/core/lens.ts'
import { config, ensureDir, readJson, workDir, writeJson } from './env.ts'
import { detailOf, stillName, type RenderSession, type StillSpec } from './render.ts'
import { anchorIds, beatOfFrame, cameraForFrame, describeRegion, extraCropPoints, frameSeconds, project, sceneAnchors, type Anchors, type CropPoint } from './scene.ts'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface CropPlan {
  id: string
  kind: 'anchor' | 'grid'
  on: string[]
  center: [number, number]
  rect: Rect
  note: string
}

export interface CropManifest {
  planVersion: number
  buildHash: string
  format: string
  tier: string
  paint: string
  diagnostic: string
  detail: string
  frame: number
  timeSeconds: number
  beat: string
  still: string
  anchorSource: string
  crops: Array<CropPlan & { file: string }>
}

export const cropPlanVersion = 5
const limit = (): number => config.critics.maxImageLongEdgePx

export function gridShape(format: FormatSpec): { columns: number; rows: number } {
  const landscape = format.width >= format.height
  const columns = Math.max(landscape ? 3 : 2, Math.ceil(format.width / limit()))
  const rows = Math.max(landscape ? 2 : 3, Math.ceil(format.height / limit()))
  return { columns, rows }
}

function regionName(column: number, columns: number, row: number, rows: number): string {
  const v = rows === 1 ? '' : row === 0 ? 'upper' : row === rows - 1 ? 'lower' : 'middle'
  const h = columns === 1 ? '' : column === 0 ? 'left' : column === columns - 1 ? 'right' : 'center'
  return [v, h].filter(Boolean).join(' ') || 'whole frame'
}

export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
  if (w <= 0 || h <= 0) return 0
  return (w * h) / Math.min(a.width * a.height, b.width * b.height)
}

export function clampRect(cx: number, cy: number, width: number, height: number, format: FormatSpec): Rect {
  const w = Math.min(width, format.width)
  const h = Math.min(height, format.height)
  const left = Math.round(Math.min(Math.max(cx - w / 2, 0), format.width - w))
  const top = Math.round(Math.min(Math.max(cy - h / 2, 0), format.height - h))
  return { left, top, width: Math.round(w), height: Math.round(h) }
}

export function planCrops(state: CameraState, format: FormatSpec, anchors: Anchors, extra: CropPoint[] = []): CropPlan[] {
  const plans: CropPlan[] = []
  const minSide = Math.min(limit(), Math.round(Math.min(format.width, format.height) / 2))
  const points: CropPoint[] = [...anchorIds.map((id) => ({ id, position: anchors[id].position, radius: anchors[id].radius })), ...extra]
  for (const a of points) {
    const id = a.id
    const p = project(state, format, a.position)
    if (!p) continue
    const r = a.radius * p.pixelsPerMeter
    const outside = Math.hypot(Math.max(0, -p.x, p.x - format.width), Math.max(0, -p.y, p.y - format.height))
    if (outside > 0.5 * r) continue
    const side = Math.min(limit(), Math.max(minSide, Math.round(3 * r)))
    const rect = clampRect(p.x, p.y, side, side, format)
    const merged = plans.find((q) => overlap(q.rect, rect) > 0.8 && Math.hypot(q.center[0] - p.x, q.center[1] - p.y) < side / 4)
    const note = `${id} ${extra.includes(a) ? 'point' : 'anchor'} at ${p.depth.toFixed(2)} m, projected radius ${Math.round(r)} px${p.x < 0 || p.x > format.width || p.y < 0 || p.y > format.height ? ', center just outside the frame' : ''}`
    if (merged) {
      merged.on.push(id)
      merged.note += `; ${note}`
      continue
    }
    plans.push({ id: `anchor-${id}`, kind: 'anchor', on: [id], center: [Math.round(p.x), Math.round(p.y)], rect, note })
  }
  const { columns, rows } = gridShape(format)
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const left = Math.round((column * format.width) / columns)
      const top = Math.round((row * format.height) / rows)
      const rect = { left, top, width: Math.round(((column + 1) * format.width) / columns) - left, height: Math.round(((row + 1) * format.height) / rows) - top }
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      plans.push({ id: `grid-r${row + 1}c${column + 1}`, kind: 'grid', on: [regionName(column, columns, row, rows)], center: [Math.round(cx), Math.round(cy)], rect, note: '' })
    }
  }
  return plans
}

export function cropsDir(spec: StillSpec): string {
  return join(workDir, 'crops', stillName(spec))
}

export async function buildCrops(session: RenderSession, spec: StillSpec): Promise<{ dir: string; manifest: CropManifest; reused: boolean }> {
  const dir = cropsDir(spec)
  const manifestPath = join(dir, 'manifest.json')
  const old = readJson<CropManifest>(manifestPath)
  if (old && old.planVersion === cropPlanVersion && old.buildHash === session.buildHash && old.format === spec.format.id && old.tier === spec.tier && old.paint === spec.paint && old.diagnostic === spec.diag && old.detail === detailOf(spec) && old.frame === spec.frame && old.crops.every((c) => existsSync(join(dir, c.file)))) {
    return { dir, manifest: old, reused: true }
  }
  const { file: still } = await session.still(spec)
  const page = await session.pageFor(spec)
  const { anchors, source } = await sceneAnchors(page, spec.paint)
  const state = cameraForFrame(spec.frame, spec.format, anchors)
  const plans = planCrops(state, spec.format, anchors, await extraCropPoints())
  rmSync(dir, { recursive: true, force: true })
  ensureDir(dir)
  const crops: CropManifest['crops'] = []
  for (const plan of plans) {
    const shows = await describeRegion(state, spec.format, plan.rect)
    plan.note = plan.note ? `${plan.note}. Shows ${shows}` : `Shows ${shows}`
    const file = `${plan.id}.png`
    await sharp(still).extract(plan.rect).png({ compressionLevel: 6 }).toFile(join(dir, file))
    writeJson(join(dir, `${plan.id}.json`), { buildHash: session.buildHash, format: spec.format.id, tier: spec.tier, paint: spec.paint, diagnostic: spec.diag, detail: detailOf(spec), frame: spec.frame, source: still, ...plan })
    crops.push({ ...plan, file })
  }
  const manifest: CropManifest = {
    planVersion: cropPlanVersion,
    buildHash: session.buildHash,
    format: spec.format.id,
    tier: spec.tier,
    paint: spec.paint,
    diagnostic: spec.diag,
    detail: detailOf(spec),
    frame: spec.frame,
    timeSeconds: frameSeconds(spec.frame),
    beat: beatOfFrame(spec.frame),
    still,
    anchorSource: source,
    crops,
  }
  writeJson(manifestPath, manifest)
  return { dir, manifest, reused: false }
}
