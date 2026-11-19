import styles from './styles.module.css'
import { createShowcase } from './capture/frame-interface'
import { FrameEngine } from './core/engine'
import { createRenderer } from './core/renderer'
import { parseLaunch } from './director/modes'
import { runMode } from './director/run'
import { BasicResolver } from './post/resolve'
import { stageDetail, type StageDetail } from './core/detail'
import { FilmStage } from './core/film-stage'

function notice(message: string): void {
  const box = document.createElement('div')
  box.className = styles.notice
  box.textContent = message
  document.body.append(box)
}

async function start(): Promise<void> {
  document.body.className = styles.page
  const launch = parseLaunch(location.search)
  const canvas = document.getElementById('stage') as HTMLCanvasElement
  canvas.className = launch.mode === 'live' ? styles.fit : styles.native
  const renderer = createRenderer(canvas)
  const asked = new URLSearchParams(location.search).get('detail')
  const detail: StageDetail = asked === 'full' || asked === 'blockout' ? asked : stageDetail
  const stage = await FilmStage.create(renderer, launch.paint, detail)
  const resolver = new BasicResolver(renderer)
  const engine = new FrameEngine(renderer, stage, resolver, launch.format)
  stage.setDiagnostic(launch.diagnostic)
  resolver.setDiagnostic(launch.diagnostic)
  const showcase = createShowcase(engine, Promise.resolve(), { tier: launch.tier, paint: launch.paint })
  window.showcase = showcase
  runMode({ launch, canvas, engine, stage, showcase })
}

start().catch((error: unknown) => {
  notice(error instanceof Error ? error.message : String(error))
  throw error
})
