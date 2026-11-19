import styles from '../../styles.module.css'
import type { AppContext } from '../run'
import { nextPaint } from './fonts'
import { playbackFrame, withParams } from './logic'
import css from './ui.module.css'

export function runAutopilot(context: AppContext): void {
  const { launch, canvas, showcase } = context
  canvas.className = styles.fit
  document.body.classList.add(css.clean)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') location.assign(withParams(location.href, { mode: 'live' }))
  })

  async function loop(): Promise<void> {
    const start = performance.now()
    let shown = -1
    for (;;) {
      await nextPaint()
      const frame = playbackFrame(launch.frame, performance.now() - start)
      if (frame === shown) continue
      await showcase.renderFrame(frame, launch.tier)
      shown = frame
    }
  }
  void loop()
}
