import type { Showcase } from '../capture/frame-interface'
import type { FrameEngine } from '../core/engine'
import type { FilmStage } from '../core/film-stage'
import type { Launch } from './modes'

export interface AppContext {
  launch: Launch
  canvas: HTMLCanvasElement
  engine: FrameEngine
  stage: FilmStage
  showcase: Showcase
}

export function runMode(context: AppContext): void {
  if (context.launch.mode === 'capture') return
  void context.showcase.renderFrame(context.launch.frame, context.launch.tier)
}
