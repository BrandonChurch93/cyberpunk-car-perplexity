import * as THREE from 'three'
import { config } from '../config'

export type SignStyle = 'channel' | 'neon' | 'module' | 'lightbox'
export type SignLine = {
  text: string; font: string; weight: number; height: number; y: number; x?: number; track?: number
  gain?: number; dead?: readonly number[]; dim?: readonly number[]; vertical?: boolean; wide?: number
}
export type SignMark = { kind: 'sill' | 'moth' | 'orbit' | 'arrow'; x: number; y: number; size: number; gain?: number }
export type SignArt = {
  name: string; width: number; height: number; style: SignStyle; lines: readonly SignLine[]; marks?: readonly SignMark[]
  water?: number; panel?: number; seed: number
  raceways?: readonly (readonly [y: number, x0: number, x1: number, thickness: number])[]
}

const styleCode: Record<SignStyle, number> = { channel: 0, neon: 1, module: 2, lightbox: 3 }

function shade(level: number): string {
  return `rgba(255,255,255,${Math.min(1, Math.max(0, level)).toFixed(3)})`
}

function letterGain(seed: number, i: number): number {
  const h = Math.sin((seed * 12.9898 + i * 78.233) * 1.7) * 43758.5453
  return .84 + .16 * (h - Math.floor(h))
}

export function signText(art: SignArt): string {
  const allowed = [...config.signage.generic, ...config.signage.invented]
  if (!allowed.includes(art.name)) throw new Error(`Unapproved sign name: ${art.name}`)
  const words = art.name.split(' ')
  for (const line of art.lines) {
    const ok = line.text.split(' ').every(word => words.includes(word) || config.signage.generic.includes(line.text))
    if (!ok) throw new Error(`Sign line outside config: ${line.text}`)
  }
  return art.name
}

export function paintSign(art: SignArt): { glyphs: THREE.Texture; detail: THREE.Texture } | null {
  if (typeof document === 'undefined') return null
  const ratio = art.width / art.height
  const W = ratio >= 1 ? 1024 : Math.max(96, Math.round(1024 * ratio))
  const H = ratio >= 1 ? Math.max(96, Math.round(1024 / ratio)) : 1024
  const glyph = document.createElement('canvas'), aux = document.createElement('canvas')
  glyph.width = aux.width = W
  glyph.height = aux.height = H
  const g = glyph.getContext('2d'), a = aux.getContext('2d')
  if (!g || !a) return null
  a.fillStyle = '#000'
  a.fillRect(0, 0, W, H)
  a.fillStyle = 'rgb(0,0,255)'
  for (const [y, x0, x1, t] of art.raceways ?? []) a.fillRect(x0 * W, (y - t * .5) * H, (x1 - x0) * W, t * H)
  const tube = art.style === 'neon'
  type Pen = (cx: CanvasRenderingContext2D, x: number, y: number) => void
  const both = (draw: (cx: CanvasRenderingContext2D, layer: 'face' | 'return' | 'core' | 'cap', level: number) => void, level: number) => {
    a.save(); a.globalCompositeOperation = 'lighter'
    if (art.style === 'channel') { a.fillStyle = a.strokeStyle = 'rgb(255,0,0)'; draw(a, 'return', 1) }
    if (tube) { a.fillStyle = a.strokeStyle = 'rgb(0,255,0)'; draw(a, 'core', level) }
    a.restore()
    if (art.style === 'channel') {
      a.save(); a.globalCompositeOperation = 'source-over'; a.fillStyle = a.strokeStyle = '#000'; draw(a, 'face', 1)
      a.globalCompositeOperation = 'lighter'; a.fillStyle = a.strokeStyle = 'rgb(0,255,0)'; draw(a, 'cap', 1); a.restore()
    }
    g.fillStyle = g.strokeStyle = shade(level)
    draw(g, 'face', level)
  }
  for (const [n, line] of art.lines.entries()) {
    const px = line.height * H
    const font = `${line.weight} ${px}px "${line.font}"`
    g.font = a.font = font
    g.textBaseline = a.textBaseline = 'middle'
    g.textAlign = a.textAlign = 'center'
    const chars = [...line.text]
    const track = (line.track ?? 0) * px
    const wide = line.wide ?? 1
    const widths = chars.map(ch => g.measureText(ch).width * wide)
    const total = line.vertical ? chars.length * px * 1.04 : widths.reduce((s, w) => s + w, 0) + track * (chars.length - 1)
    const fit = line.vertical ? Math.min(1, H * .96 / total) : Math.min(1, W * 1.88 * Math.min(line.x ?? .5, 1 - (line.x ?? .5)) / total)
    let cursor = line.vertical ? (line.y * H - total * fit * .5) : ((line.x ?? .5) * W - total * fit * .5)
    let index = 0
    for (const [i, ch] of chars.entries()) {
      const w = line.vertical ? px * 1.04 : widths[i]! + track
      const cx = line.vertical ? (line.x ?? .5) * W : cursor + widths[i]! * fit * .5
      const cy = line.vertical ? cursor + w * fit * .5 : line.y * H
      cursor += w * fit
      if (ch === ' ') continue
      const k = index++
      const base = (line.gain ?? 1) * letterGain(art.seed + n * 31, k)
      const level = line.dead?.includes(k) ? .035 : line.dim?.includes(k) ? base * .42 : base
      const pen: Pen = (cx2, x, y) => {
        cx2.save(); cx2.translate(x, y); cx2.scale(fit * wide, fit)
        if (tube) { cx2.lineWidth = px * .085; cx2.lineJoin = cx2.lineCap = 'round'; cx2.strokeText(ch, 0, 0) }
        else cx2.fillText(ch, 0, 0)
        cx2.restore()
      }
      both((cx2, layer, lv) => {
        if (layer === 'return') { pen(cx2, cx + px * .035, cy + px * .07); return }
        if (layer === 'core') {
          cx2.save(); cx2.translate(cx, cy); cx2.scale(fit * wide, fit); cx2.lineWidth = px * .028; cx2.lineJoin = cx2.lineCap = 'round'
          cx2.globalAlpha = lv; cx2.strokeText(ch, 0, 0); cx2.restore(); return
        }
        if (layer === 'cap') {
          cx2.save(); cx2.translate(cx, cy); cx2.scale(fit * wide, fit); cx2.lineWidth = px * .03; cx2.strokeText(ch, 0, 0); cx2.restore(); return
        }
        pen(cx2, cx, cy)
      }, level)
    }
  }
  for (const mark of art.marks ?? []) {
    const s = mark.size * H, x = mark.x * W, y = mark.y * H
    const level = mark.gain ?? 1
    both((cx2, layer, lv) => {
      cx2.save()
      cx2.translate(x + (layer === 'return' ? s * .03 : 0), y + (layer === 'return' ? s * .06 : 0))
      cx2.lineJoin = cx2.lineCap = 'round'
      cx2.globalAlpha = layer === 'core' ? lv : 1
      const stroked = tube || layer === 'core' || layer === 'cap'
      cx2.lineWidth = layer === 'core' ? s * .03 : layer === 'cap' ? s * .02 : s * .085
      if (mark.kind === 'sill') {
        for (const [i, wide] of [.94, .70, .46].entries()) {
          const yy = (i - 1) * s * .30
          if (stroked) cx2.strokeRect(-s * wide * .5, yy - s * .06, s * wide, s * .12)
          else cx2.fillRect(-s * wide * .5, yy - s * .06, s * wide, s * .12)
        }
      } else if (mark.kind === 'moth') {
        cx2.beginPath()
        cx2.moveTo(0, -s * .32); cx2.lineTo(-s * .5, -s * .1); cx2.lineTo(-s * .18, s * .12); cx2.closePath()
        cx2.moveTo(0, -s * .32); cx2.lineTo(s * .5, -s * .1); cx2.lineTo(s * .18, s * .12); cx2.closePath()
        cx2.moveTo(-s * .05, -s * .3); cx2.lineTo(-s * .05, s * .38); cx2.lineTo(s * .05, s * .38); cx2.lineTo(s * .05, -s * .3); cx2.closePath()
        if (stroked) cx2.stroke(); else cx2.fill()
      } else if (mark.kind === 'orbit') {
        cx2.beginPath(); cx2.ellipse(0, 0, s * .48, s * .17, -.32, 0, Math.PI * 2)
        cx2.lineWidth = Math.max(cx2.lineWidth, s * .07); cx2.stroke()
        cx2.beginPath(); cx2.arc(0, 0, s * .2, 0, Math.PI * 2)
        if (stroked) cx2.stroke(); else cx2.fill()
      } else {
        cx2.beginPath()
        cx2.moveTo(-s * .5, -s * .09); cx2.lineTo(s * .12, -s * .09); cx2.lineTo(s * .12, -s * .3); cx2.lineTo(s * .5, 0)
        cx2.lineTo(s * .12, s * .3); cx2.lineTo(s * .12, s * .09); cx2.lineTo(-s * .5, s * .09); cx2.closePath()
        if (stroked) cx2.stroke(); else cx2.fill()
      }
      cx2.restore()
    }, level)
  }
  const glyphs = new THREE.CanvasTexture(glyph)
  const detail = new THREE.CanvasTexture(aux)
  for (const t of [glyphs, detail]) { t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8 }
  return { glyphs, detail }
}

const vertex = /* glsl */ `
  varying vec2 face;
  void main() { face = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

export function signFace(art: SignArt, maps: { glyphs: THREE.Texture; detail: THREE.Texture }, tint: THREE.Color, radiance: number,
  cells: readonly [number, number] = [0, 0]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: {
      glyphs: { value: maps.glyphs }, detail: { value: maps.detail }, tint: { value: tint }, radiance: { value: radiance },
      style: { value: styleCode[art.style] }, water: { value: art.water ?? -1 }, panel: { value: art.panel ?? .05 }, seed: { value: art.seed },
      cells: { value: new THREE.Vector2(...cells) }, scatterStep: { value: new THREE.Vector2(.045 / art.width, .045 / art.height) },
    },
    vertexShader: vertex,
    fragmentShader: /* glsl */ `
      varying vec2 face;
      uniform sampler2D glyphs, detail;
      uniform vec3 tint;
      uniform float radiance, style, water, seed, panel;
      uniform vec2 cells, scatterStep;
      float hash(vec2 p){ vec3 q=fract(p.xyx*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
      float field(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
      void main(){
        float lit=texture2D(glyphs,face).a;
        vec3 aux=texture2D(detail,face).rgb;
        float bleed=0.0;
        for(int x=-2;x<=2;x++) for(int y=-2;y<=2;y++) bleed+=texture2D(glyphs,face+vec2(float(x),float(y))*scatterStep).a;
        bleed/=25.0;
        float uneven=.80+.20*field(face*vec2(4.0,2.2)+seed)+.05*field(face*vec2(23.0,9.0)+seed*1.7);
        vec2 edge=1.0-abs(face-.5)*2.0;
        float rim=smoothstep(.0,.06,min(edge.x,edge.y));
        vec3 back=vec3(.011,.013,.017)*(.75+.5*field(face*vec2(7.0,3.0)+seed*3.1));
        vec3 c=back+tint*radiance*(style>2.5 ? .028 : .075)*bleed*rim;
        if (style<1.5 || style>2.5) c=mix(c,vec3(.022,.023,.026)+tint*radiance*(.012+.09*bleed),aux.b*(1.0-lit));
        if (style<.5) {
          c=mix(c,vec3(.018,.019,.022)+tint*radiance*(.022+.05*bleed),aux.r*(1.0-lit));
          c+=tint*radiance*lit*uneven*(1.22-.22*aux.g);
        } else if (style<1.5) {
          c=mix(c,c*.35,aux.r);
          c+=tint*radiance*(.48*lit*uneven+.9*aux.g)+radiance*aux.g*vec3(.22,.24,.26);
          c+=tint*radiance*.06*bleed;
        } else if (style<2.5) {
          vec2 cell=fract(face*cells)-.5;
          float led=smoothstep(.46,.26,length(cell));
          vec2 tile=floor(face*cells/vec2(8.0,8.0));
          float module=.86+.14*hash(tile+seed)-.55*aux.b;
          c+=tint*radiance*lit*uneven*module*(.34+1.15*led);
        } else {
          float tubes=.82+.18*pow(abs(cos(face.x*3.14159*3.0)),2.0);
          c+=tint*radiance*(panel*tubes*rim*uneven);
          c+=mix(tint,vec3(dot(tint,vec3(.3333))),.55)*radiance*lit*uneven*1.05;
        }
        if (water>0.0) {
          float below=1.0-smoothstep(water-.004,water+.004,face.y);
          float streak=field(vec2(face.x*38.0,face.y*3.0)+seed);
          c*=1.0-below*(.42+.18*streak);
          c+=tint*radiance*.05*exp(-pow((face.y-water)*140.0,2.0));
        }
        gl_FragColor=vec4(c,1.0);
      }`,
  })
}
