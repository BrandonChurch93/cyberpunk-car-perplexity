import styles from './styles.module.css'
import { createShowcase } from './capture/frame-interface'
import { FrameEngine } from './core/engine'
import { createRenderer } from './core/renderer'
import { parseLaunch } from './director/modes'
import { BasicResolver } from './post/resolve'
import { SpikeStage } from './world/spike'

function notice(message: string): void {
  const box = document.createElement('div')
  box.className = styles.notice
  box.textContent = message
  document.body.append(box)
}

function start(): void {
  document.body.className = styles.page
  const launch = parseLaunch(location.search)
  const canvas = document.getElementById('stage') as HTMLCanvasElement
  canvas.className = launch.mode === 'live' ? styles.fit : styles.native
  const renderer = createRenderer(canvas)
  const stage = new SpikeStage(renderer)
  const resolver = new BasicResolver(renderer)
  const engine = new FrameEngine(renderer, stage, resolver, launch.format)
  stage.setDiagnostic(launch.diagnostic)
  resolver.setDiagnostic(launch.diagnostic)
  stage.setPaint(launch.paint)
  const showcase = createShowcase(engine, Promise.resolve(), { tier: launch.tier, paint: launch.paint })
  window.showcase = showcase
  if (launch.mode !== 'capture') void showcase.renderFrame(launch.frame, launch.tier)
}

try {
  start()
} catch (error) {
  notice(error instanceof Error ? error.message : String(error))
  throw error
}
