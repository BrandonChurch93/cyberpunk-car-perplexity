import { config, frameCount, type FormatKey, type TierId } from '../../config'
import { diagnosticViews } from '../../diagnostics/views'
import type { Mode } from '../modes'
import { beatMarks, beatOfFrame } from './logic'
import css from './ui.module.css'

export type View = 'orbit' | 'film'

export interface MenuState {
  mode: Mode
  format: string
  tier: TierId
  diagnostic: string
  paint: string
  frame: number
  playing: boolean
  view: View
}

export interface MenuHandlers {
  mode(mode: Mode): void
  format(id: string): void
  tier(id: TierId): void
  diagnostic(view: string): void
  paint(id: string): void
  frame(frame: number, final: boolean): void
  play(playing: boolean): void
  view(view: View): void
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

const modeLabels: Record<Mode, string> = {
  live: 'Live orbit',
  autopilot: 'Autopilot, clean playback',
  capture: 'Capture, waits for the harness',
  export: 'Export to a video file',
}

const formatNames: Record<FormatKey, string> = { master: 'Master', vertical: 'Vertical', preview: 'Preview' }

let uid = 0

function field(labelText: string, control: HTMLElement): HTMLElement {
  const wrap = el('div', css.section)
  const id = `menu-${++uid}`
  control.id = id
  const label = el('label', css.label, labelText)
  label.htmlFor = id
  wrap.append(label, control)
  return wrap
}

function select(options: Array<[string, string]>, value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = el('select', css.select)
  for (const [v, text] of options) {
    const o = el('option', '', text)
    o.value = v
    s.append(o)
  }
  s.value = value
  s.addEventListener('change', () => onChange(s.value))
  return s
}

export class Menu {
  readonly root: HTMLElement
  private readonly range: HTMLInputElement
  private readonly readout: HTMLElement
  private readonly playButton: HTMLButtonElement
  private readonly viewButtons: Record<View, HTMLButtonElement>
  private readonly beatButtons: HTMLButtonElement[] = []
  private lastFocus: Element | null = null

  constructor(state: MenuState, handlers: MenuHandlers) {
    const root = el('aside', css.panel)
    root.setAttribute('aria-label', 'Menu')
    root.hidden = true
    this.root = root

    const head = el('div', css.head)
    head.append(el('h2', css.title, config.name), el('span', css.key, 'M or Escape closes'))
    root.append(head)

    root.append(field('Mode', select((Object.keys(modeLabels) as Mode[]).map((m) => [m, modeLabels[m]]), state.mode, (v) => handlers.mode(v as Mode))))

    const formats = (Object.keys(config.formats) as FormatKey[]).map((k): [string, string] => {
      const f = config.formats[k]
      return [f.id, `${formatNames[k]}, ${f.width} x ${f.height}`]
    })
    const tiers = (Object.keys(config.tiers) as TierId[]).map((t): [string, string] => {
      const n = config.tiers[t].samplesPerFrame
      return [t, `${t}, ${n} ${n === 1 ? 'sample' : 'samples'}`]
    })
    const grid = el('div', css.grid)
    grid.append(
      field('Format', select(formats, state.format, handlers.format)),
      field('Tier when still', select(tiers, state.tier, (v) => handlers.tier(v as TierId))),
      field('View', select(diagnosticViews.map((v) => [v, v]), state.diagnostic, handlers.diagnostic)),
      field('Paint', select(config.paint.candidates.map((p) => [p.id, p.id.replaceAll('-', ' ')]), state.paint, handlers.paint)),
    )
    root.append(grid)

    const camera = el('div', css.section)
    camera.append(el('span', css.label, 'Camera'))
    const camRow = el('div', css.row)
    camRow.setAttribute('role', 'group')
    camRow.setAttribute('aria-label', 'Camera')
    const orbit = el('button', css.button, 'Free orbit')
    const film = el('button', css.button, 'Film camera')
    orbit.type = 'button'
    film.type = 'button'
    orbit.addEventListener('click', () => handlers.view('orbit'))
    film.addEventListener('click', () => handlers.view('film'))
    camRow.append(orbit, film)
    camera.append(camRow)
    root.append(camera)
    this.viewButtons = { orbit, film }

    const timeline = el('div', css.section)
    const rangeId = `menu-${++uid}`
    const tl = el('label', css.label, 'Timeline')
    tl.htmlFor = rangeId
    this.readout = el('p', css.readout)
    this.readout.setAttribute('aria-live', 'polite')
    this.range = el('input', css.range)
    this.range.id = rangeId
    this.range.type = 'range'
    this.range.min = '0'
    this.range.max = String(frameCount - 1)
    this.range.step = '1'
    this.range.addEventListener('input', () => handlers.frame(Number(this.range.value), false))
    this.range.addEventListener('change', () => handlers.frame(Number(this.range.value), true))
    const beats = el('div', css.beats)
    for (const [i, mark] of beatMarks().entries()) {
      const b = el('button', i % 2 === 0 ? css.beat : `${css.beat} ${css.beatLow}`, mark.id)
      b.type = 'button'
      b.style.left = `${mark.left}%`
      b.style.width = `${mark.width}%`
      b.title = `Go to the ${mark.id} beat, frame ${mark.startFrame}`
      b.setAttribute('aria-label', b.title)
      b.dataset.beat = mark.id
      b.addEventListener('click', () => handlers.frame(mark.startFrame, true))
      beats.append(b)
      this.beatButtons.push(b)
    }
    const playRow = el('div', css.row)
    playRow.style.marginTop = '8px'
    this.playButton = el('button', css.button)
    this.playButton.type = 'button'
    this.playButton.addEventListener('click', () => handlers.play(this.playButton.getAttribute('aria-pressed') !== 'true'))
    playRow.append(this.playButton)
    timeline.append(tl, this.readout, this.range, beats, playRow)
    root.append(timeline)

    root.append(el('p', css.help, 'Drag to orbit. Wheel or pinch to zoom. Arrow keys orbit, plus and minus zoom, Space plays or pauses.'))

    this.setFrame(state.frame)
    this.setPlaying(state.playing)
    this.setView(state.view)
  }

  get isOpen(): boolean {
    return !this.root.hidden
  }

  open(): void {
    this.lastFocus = document.activeElement
    this.root.hidden = false
    this.root.querySelector<HTMLElement>('select, button, input')?.focus()
  }

  close(): void {
    this.root.hidden = true
    if (this.lastFocus instanceof HTMLElement && !this.root.contains(this.lastFocus)) this.lastFocus.focus()
    else (document.activeElement as HTMLElement | null)?.blur()
  }

  toggle(): void {
    if (this.isOpen) this.close()
    else this.open()
  }

  setFrame(frame: number): void {
    this.range.value = String(frame)
    const beat = beatOfFrame(frame)
    this.readout.textContent = `Frame ${frame} of ${frameCount - 1}, ${(frame / config.film.fps).toFixed(2)} s, beat ${beat}`
    for (const b of this.beatButtons) b.classList.toggle(css.beatActive, b.dataset.beat === beat)
  }

  setPlaying(playing: boolean): void {
    this.playButton.textContent = playing ? 'Pause' : 'Play'
    this.playButton.setAttribute('aria-pressed', String(playing))
  }

  setView(view: View): void {
    for (const [k, b] of Object.entries(this.viewButtons)) b.setAttribute('aria-pressed', String(k === view))
  }
}
