import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { args } from '../lib/env'

type Pixel = readonly [number, number]
type View = 'top' | 'left'
type Trace = { view: View; name: string; points: readonly Pixel[] }
const traces: Trace[] = [
  { view: 'top', name: 'hood V', points: [[144, 318], [217, 339], [326, 371], [405, 394]] },
  { view: 'top', name: 'hood outer fold', points: [[144, 318], [208, 292], [307, 253], [406, 215], [501, 175], [562, 181]] },
  { view: 'top', name: 'lamp-top fold', points: [[108, 316], [208, 234], [307, 162], [406, 92]] },
  { view: 'left', name: 'door upper fold', points: [[424, 171], [531, 159], [644, 147], [751, 135]] },
  { view: 'left', name: 'door lower fold', points: [[526, 255], [640, 246], [738, 237], [844, 227]] },
  { view: 'left', name: 'upper shoulder below side glass', points: [[510, 117], [585, 111], [654, 104], [725, 94], [791, 80], [862, 64], [906, 54]] },
  { view: 'left', name: 'shoulder fold', points: [[830, 131], [909, 108], [981, 88], [1064, 76], [1135, 68], [1199, 69], [1255, 77]] },
  { view: 'left', name: 'upper haunch to tail lamp', points: [[896, 28], [975, 33], [1050, 42], [1130, 54], [1190, 65], [1290, 77]] },
  { view: 'left', name: 'haunch fold', points: [[904, 53], [955, 76], [983, 93], [1014, 111], [1058, 134]] },
]

const dirArg = args().dir
if (!dirArg) throw new Error('Pass the directory produced by the orthographic line audit with --dir.')
const dir = resolve(dirArg)
const scales = JSON.parse(await readFile(join(dir, 'scale.json'), 'utf8')) as Record<View, { mmPerPx: [number, number] }>
for (const view of ['top', 'left'] as const) {
  const { data, info } = await sharp(join(dir, view + '-lines-model.png')).greyscale().raw().toBuffer({ resolveWithObject: true })
  const stretchX = (info.width - 16) / (view === 'top' ? 2376 : 1400)
  const stretchY = (info.height - 16) / (view === 'top' ? 1092 : 334)
  const [mmX, mmY] = scales[view].mmPerPx
  const nearest = (px: number, py: number) => {
    const x = px * stretchX + 8, y = py * stretchY + 8
    for (let j = Math.max(0, Math.ceil(y - 10 / mmY)); j <= Math.min(info.height - 1, y + 10 / mmY); j++) {
      for (let i = Math.max(0, Math.ceil(x - 10 / mmX)); i <= Math.min(info.width - 1, x + 10 / mmX); i++) {
        if (data[j * info.width + i] > 127 && Math.hypot((i - x) * mmX, (j - y) * mmY) <= 10) return 1
      }
    }
    return 0
  }
  let matched = 0, total = 0
  for (const trace of traces.filter((item) => item.view === view)) {
    let hit = 0, n = 0
    for (const [i, [x, y]] of trace.points.slice(1).entries()) {
      const [a, b] = trace.points[i]
      const steps = Math.ceil(Math.hypot((x - a) * stretchX * mmX, (y - b) * stretchY * mmY) / 2)
      for (let j = 0; j < steps; j++) {
        const u = j / steps, v = b + (y - b) * u
        hit += nearest(a + (x - a) * u, v)
        if (view === 'top') hit += nearest(a + (x - a) * u, 1092 - v)
        n += view === 'top' ? 2 : 1
      }
    }
    console.log(`${view} ${trace.name}: ${(100 * hit / n).toFixed(1)}% within 10 mm (${hit}/${n})`)
    matched += hit
    total += n
  }
  console.log(`${view} character lines: ${(100 * matched / total).toFixed(1)}% within 10 mm`)
}
