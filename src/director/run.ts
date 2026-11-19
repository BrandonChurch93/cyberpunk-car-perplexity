import type { Showcase } from '../capture/frame-interface'
import type { FrameEngine } from '../core/engine'
import type { FilmStage } from '../core/film-stage'
import { runExport } from '../capture/export'
import type { Launch } from './modes'
import { runAutopilot } from './ui/autopilot'
import { runLive } from './ui/live'

export interface AppContext {
  launch: Launch
  canvas: HTMLCanvasElement
  engine: FrameEngine
  stage: FilmStage
  showcase: Showcase
}

export function runMode(context: AppContext): void {
  switch (context.launch.mode) {
    case 'capture':
      return
    case 'autopilot':
      return runAutopilot(context)
    case 'live':
      return runLive(context)
    case 'export':
      return runExport(context)
  }
}
