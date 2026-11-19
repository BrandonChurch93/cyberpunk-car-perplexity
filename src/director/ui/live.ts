import * as THREE from 'three'
import { config, frameCount, isTier, type FormatSpec, type TierId } from '../../config'
import type { AppContext } from '../run'
import type { Mode } from '../modes'
import { loadPanelFont, nextPaint } from './fonts'
import { interactiveSize, playbackFrame, withParams, type ParamChanges } from './logic'
import { el, Menu, type View } from './menu'
import { Orbit } from './orbit'
import css from './ui.module.css'

const interactiveBudget = (config.formats.preview.width * config.formats.preview.height) / 4
const settleMs = 220
const dragRadiansPerPixel = 0.006
const keyStep = THREE.MathUtils.degToRad(5)

export function navigate(mode: Mode, current: { format: string; tier: string; diagnostic: string; paint: string; frame: number }): void {
  const changes: Record<Mode, ParamChanges> = {
    live: { mode: 'live', format: current.format, tier: current.tier, diag: current.diagnostic, paint: current.paint, frame: String(current.frame) },
    autopilot: { mode: 'autopilot', format: current.format, tier: current.tier, diag: current.diagnostic, paint: current.paint, frame: String(current.frame) },
    capture: { mode: 'capture', format: current.format, tier: null, diag: current.diagnostic, paint: current.paint, frame: null },
    export: { mode: 'export', format: null, tier: null, diag: null, paint: current.paint, frame: null, first: null, last: null },
  }
  location.assign(withParams(location.href, changes[mode]))
}

export function runLive(context: AppContext): void {
  const { launch, canvas, engine, stage, showcase } = context
  loadPanelFont()
  canvas.className = css.orbitCanvas
  canvas.tabIndex = -1

  const orbit = new Orbit(new THREE.Box3().setFromObject(stage.vehicle.root))
  let full: FormatSpec = launch.format
  let tier: TierId = launch.tier
  let diagnostic = launch.diagnostic
  let paint = launch.paint
  let frame = Math.min(launch.frame, frameCount - 1)
  let view: View = 'orbit'
  let playing = false
  let playStart = 0
  let playFrom = 0
  let dirty = true
  let refined = false
  let lastInput = -Infinity
  const pointers = new Map<number, { x: number; y: number }>()

  const current = () => ({ format: full.id, tier, diagnostic, paint, frame })
  const remember = (): void => {
    history.replaceState(null, '', withParams(location.href, { mode: 'live', format: full.id, tier, diag: diagnostic, paint, frame: String(frame) }))
  }
  const touch = (): void => {
    dirty = true
    lastInput = performance.now()
  }

  const hint = el('div', css.hint)
  hint.append(el('span', css.kbd, 'M'), document.createTextNode('Menu'))

  const menu = new Menu(
    { mode: 'live', format: full.id, tier, diagnostic, paint, frame, playing, view },
    {
      mode: (m) => {
        if (m !== 'live') navigate(m, current())
      },
      format: (id) => {
        void showcase.setFormat(id).then(() => {
          full = engine.format
          remember()
          touch()
        })
      },
      tier: (id) => {
        if (!isTier(id)) return
        tier = id
        remember()
        refined = false
      },
      diagnostic: (v) => {
        showcase.setDiagnostic(v)
        diagnostic = v
        remember()
        touch()
      },
      paint: (id) => {
        showcase.setPaint(id)
        paint = id
        remember()
        touch()
      },
      frame: (f, final) => {
        setPlaying(false)
        frame = f
        menu.setFrame(f)
        if (final) remember()
        touch()
      },
      play: (p) => setPlaying(p),
      view: (v) => setView(v),
    },
  )
  document.body.append(canvas, hint, menu.root)

  function setPlaying(p: boolean): void {
    if (p === playing) return
    playing = p
    playStart = performance.now()
    playFrom = frame
    menu.setPlaying(p)
    if (!p) remember()
    touch()
  }

  function setView(v: View): void {
    view = v
    menu.setView(v)
    touch()
  }

  function toggleMenu(): void {
    menu.toggle()
    hint.hidden = menu.isOpen
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (view !== 'orbit') setView('orbit')
    touch()
  })
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId)
    if (!p) return
    if (pointers.size === 1) {
      orbit.rotate(-(e.clientX - p.x) * dragRadiansPerPixel, (e.clientY - p.y) * dragRadiansPerPixel)
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.entries()]
      const other = a[0] === e.pointerId ? b[1] : a[1]
      const before = Math.hypot(p.x - other.x, p.y - other.y)
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y)
      if (before > 0 && after > 0) orbit.zoom(before / after)
    }
    p.x = e.clientX
    p.y = e.clientY
    touch()
  })
  const release = (e: PointerEvent): void => {
    pointers.delete(e.pointerId)
    touch()
  }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      if (view !== 'orbit') setView('orbit')
      orbit.zoom(Math.exp(e.deltaY * 0.0015))
      touch()
    },
    { passive: false },
  )

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault()
      toggleMenu()
      return
    }
    if (e.key === 'Escape' && menu.isOpen) {
      e.preventDefault()
      toggleMenu()
      return
    }
    if (menu.isOpen && menu.root.contains(document.activeElement)) return
    const turns: Record<string, [number, number]> = {
      ArrowLeft: [keyStep, 0],
      ArrowRight: [-keyStep, 0],
      ArrowUp: [0, keyStep],
      ArrowDown: [0, -keyStep],
    }
    if (e.key in turns) {
      e.preventDefault()
      if (view !== 'orbit') setView('orbit')
      orbit.rotate(...turns[e.key])
      touch()
    } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      e.preventDefault()
      if (view !== 'orbit') setView('orbit')
      orbit.zoom(e.key === '-' || e.key === '_' ? 1.12 : 1 / 1.12)
      touch()
    } else if (e.key === ' ') {
      e.preventDefault()
      setPlaying(!playing)
    }
  })

  const sized = (size: { width: number; height: number }): FormatSpec => ({ id: full.id, width: size.width, height: size.height })
  const useSize = (format: FormatSpec): void => {
    if (engine.format.width !== format.width || engine.format.height !== format.height) engine.setFormat(format)
  }
  const aim = (): void => {
    stage.cameraOverride = view === 'orbit' ? orbit.cameraState(engine.format) : null
  }

  async function quick(): Promise<void> {
    const small = sized(interactiveSize(full.width, full.height, interactiveBudget))
    useSize(small)
    aim()
    await showcase.beginFrame(frame, 'draft')
    await showcase.addSamples(1)
    await showcase.finishFrame()
    refined = small.width === full.width && small.height === full.height && tier === 'draft'
  }

  async function refine(): Promise<void> {
    useSize(full)
    aim()
    await showcase.beginFrame(frame, tier)
    const total = config.tiers[tier].samplesPerFrame
    for (;;) {
      const held = await showcase.addSamples(1)
      await showcase.finishFrame()
      if (held >= total) break
      await nextPaint()
      if (dirty) return
    }
    refined = true
  }

  async function loop(): Promise<void> {
    for (;;) {
      await nextPaint()
      const now = performance.now()
      if (playing) {
        const next = playbackFrame(playFrom, now - playStart)
        if (next !== frame) {
          frame = next
          menu.setFrame(frame)
          dirty = true
        }
      }
      if (dirty) {
        dirty = false
        await quick()
        continue
      }
      if (!refined && !playing && pointers.size === 0 && now - lastInput > settleMs) await refine()
    }
  }

  loop().catch((error: unknown) => {
    hint.hidden = false
    hint.textContent = `The live view stopped: ${error instanceof Error ? error.message : String(error)}`
    throw error
  })
}
