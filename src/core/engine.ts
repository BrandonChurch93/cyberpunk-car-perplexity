import * as THREE from 'three'
import { config, frameCount, shutterSeconds, type FormatSpec, type TierId } from '../config'
import { Accumulator } from './accumulator'
import { sizeRenderer } from './renderer'
import { sampleSet, type SampleSet } from './sampler'
import { samplesFor } from './tiers'

export interface FrameInfo {
  frameIndex: number
  frameKey: number
  timeSeconds: number
  tier: TierId
  format: FormatSpec
  samples: number
}

export interface SampleInfo extends SampleSet {
  frame: FrameInfo
  sampleIndex: number
  timeSeconds: number
}

export interface Stage {
  resize(format: FormatSpec): void
  setDiagnostic(view: string): void
  setPaint(id: string): void
  beginFrame(frame: FrameInfo): void
  renderSample(sample: SampleInfo, target: THREE.WebGLRenderTarget): void
  signs(): string[]
  anchors(): Record<string, { position: number[]; normal: number[]; radius: number }>
}

export interface Resolver {
  readonly nonFinitePixels?: number
  resize(format: FormatSpec): void
  setDiagnostic(view: string): void
  resolve(sum: THREE.Texture, count: number, frame: FrameInfo, target: THREE.WebGLRenderTarget | null): void
}

export class FrameEngine {
  readonly accumulator: Accumulator
  frame: FrameInfo | null = null
  format: FormatSpec

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly stage: Stage,
    readonly resolver: Resolver,
    format: FormatSpec,
  ) {
    this.format = format
    sizeRenderer(renderer, format)
    this.accumulator = new Accumulator(renderer, format)
    stage.resize(format)
    resolver.resize(format)
  }

  setFormat(format: FormatSpec): void {
    this.format = format
    sizeRenderer(this.renderer, format)
    this.accumulator.resize(format)
    this.stage.resize(format)
    this.resolver.resize(format)
    this.frame = null
  }

  beginFrame(frameIndex: number, tier: TierId): void {
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex > frameCount) {
      throw new Error(`frame index ${frameIndex} is outside 0 to ${frameCount}`)
    }
    this.frame = {
      frameIndex,
      frameKey: frameIndex % frameCount,
      timeSeconds: frameIndex / config.film.fps,
      tier,
      format: this.format,
      samples: samplesFor(tier),
    }
    this.accumulator.clear()
    this.stage.beginFrame(this.frame)
  }

  addSamples(count: number): number {
    const frame = this.requireFrame()
    const end = Math.min(frame.samples, this.accumulator.count + count)
    while (this.accumulator.count < end) {
      const sampleIndex = this.accumulator.count
      const set = sampleSet(frame.frameIndex, sampleIndex)
      const sample: SampleInfo = {
        ...set,
        frame,
        sampleIndex,
        timeSeconds: frame.timeSeconds + (set.shutter - 0.5) * shutterSeconds,
      }
      this.stage.renderSample(sample, this.accumulator.sample)
      this.accumulator.addSample()
    }
    return this.accumulator.count
  }

  finishFrame(): void {
    const frame = this.requireFrame()
    if (this.accumulator.count === 0) throw new Error('finishFrame was called before any sample was added')
    this.resolver.resolve(this.accumulator.sum.texture, this.accumulator.count, frame, null)
    this.renderer.setRenderTarget(null)
  }

  private requireFrame(): FrameInfo {
    if (!this.frame) throw new Error('beginFrame has not been called')
    return this.frame
  }
}
