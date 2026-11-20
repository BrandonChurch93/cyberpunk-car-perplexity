import { config, formatById, frameCount, paintById } from '../config'
import type { FrameEngine } from '../core/engine'
import { requireTier, samplesFor } from '../core/tiers'
import { diagnosticViews } from '../diagnostics/views'

export interface Showcase {
  ready: Promise<void>
  info(): { frameCount: number; fps: number; format: string; tier: string; paint: string; detail: string; buildHash: string; versions: Record<string, string> }
  setFormat(id: string): Promise<void>
  setDiagnostic(view: string): void
  setPaint(id: string): void
  renderFrame(frameIndex: number, tier: string): Promise<void>
  beginFrame(frameIndex: number, tier: string): Promise<void>
  addSamples(count: number): Promise<number>
  saveSum(): Promise<void>
  loadSum(): Promise<void>
  finishFrame(): Promise<void>
  /** Count of non-finite RGB pixels in the HDR sum at the last finishFrame. */
  nonFinitePixels(): number
  /** Every string on every sign in the scene, for the gate. */
  signs(): string[]
  /** The vehicle's anchors as plain numbers, for the tools that place crops. */
  anchors(): Record<string, { position: number[]; normal: number[]; radius: number }>
}

declare global {
  interface Window {
    showcase?: Showcase
  }
}

const sumEndpoint = '__harness/sum'

export function createShowcase(engine: FrameEngine, ready: Promise<void>, initial: { tier: string; paint: string; detail: string }): Showcase {
  let tier = initial.tier
  let paint = initial.paint
  const showcase: Showcase = {
    ready,
    info: () => ({
      frameCount,
      fps: config.film.fps,
      format: engine.format.id,
      tier,
      paint,
      detail: initial.detail,
      buildHash: __BUILD_HASH__,
      versions: __VERSIONS__,
    }),
    async setFormat(id) {
      engine.setFormat(formatById(id))
    },
    setDiagnostic(view) {
      if (!diagnosticViews.includes(view)) throw new Error(`unknown diagnostic view ${view}`)
      engine.stage.setDiagnostic(view)
      engine.resolver.setDiagnostic(view)
    },
    setPaint(id) {
      paint = paintById(id).id
      engine.stage.setPaint(paint)
    },
    async renderFrame(frameIndex, tierId) {
      await showcase.beginFrame(frameIndex, tierId)
      const total = samplesFor(requireTier(tierId))
      while ((await showcase.addSamples(1)) < total) continue
      await showcase.finishFrame()
    },
    async beginFrame(frameIndex, tierId) {
      tier = requireTier(tierId)
      engine.beginFrame(frameIndex, requireTier(tierId))
    },
    async addSamples(count) {
      const held = engine.addSamples(count)
      engine.accumulator.settle()
      return held
    },
    async saveSum() {
      const data = engine.accumulator.read()
      const response = await fetch(sumEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-sample-count': String(engine.accumulator.count) },
        body: data.buffer as ArrayBuffer,
      })
      if (!response.ok) throw new Error(`The harness refused the running sum: ${response.status}`)
    },
    async loadSum() {
      const response = await fetch(sumEndpoint)
      if (!response.ok) throw new Error(`The harness has no running sum: ${response.status}`)
      const count = Number(response.headers.get('x-sample-count'))
      const data = new Float32Array(await response.arrayBuffer())
      engine.accumulator.write(data, count)
    },
    async finishFrame() {
      engine.finishFrame()
    },
    nonFinitePixels: () => engine.resolver.nonFinitePixels ?? 0,
    signs: () => engine.stage.signs(),
    anchors: () => engine.stage.anchors(),
  }
  return showcase
}
