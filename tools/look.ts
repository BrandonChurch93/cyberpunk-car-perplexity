import { join } from 'node:path'
import sharp, { type OverlayOptions } from 'sharp'
import { defaultPaint, formatById, isTier, paintById } from '../src/config.ts'
import { args, config, ensureDir, workDir } from './lib/env.ts'
import { RenderSession, runTool } from './lib/render.ts'

/** A quick look at chosen frames: one montage, plus the camera and the anchors as numbers. */
void runTool(async () => {
  const a = args()
  const tier = a.tier ?? 'draft'
  if (!isTier(tier)) throw new Error(`unknown tier ${tier}`)
  const format = a.format ? formatById(a.format) : config.formats.preview
  const frames = (a.frames ?? '0,195,360,520,690,800,950,1200').split(',').map(Number)
  const columns = Number(a.columns ?? (format.width >= format.height ? 3 : 6))
  const cellWidth = Math.floor(1400 / columns)
  const cellHeight = Math.round((cellWidth * format.height) / format.width)
  const session = await RenderSession.open({ budgetMinutes: 0 })
  try {
    const cells: OverlayOptions[] = []
    for (const [i, frame] of frames.entries()) {
      const spec = { frame, tier, format, paint: paintById(a.paint ?? defaultPaint).id, diag: a.diag ?? 'beauty' }
      const { file } = await session.still(spec, { force: true })
      const input = await sharp(file).resize(cellWidth, cellHeight).toBuffer()
      const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cellWidth}" height="18"><rect width="110" height="18" fill="#15161a"/><text x="4" y="13" font-family="monospace" font-size="12" fill="#d8d8d8">${frame} ${(frame / config.film.fps).toFixed(2)} s</text></svg>`)
      const left = (i % columns) * cellWidth
      const top = Math.floor(i / columns) * cellHeight
      cells.push({ input, left, top }, { input: label, left, top })
      if (a.numbers === 'true') {
        const page = await session.pageFor(spec)
        const numbers = await page.evaluate(`(() => {
          const stage = window.filmStage
          const camera = stage.cameraState(${frame / config.film.fps})
          const round = (v) => v.map((x) => x.toFixed(3)).join(', ')
          return { camera: round(camera.position.toArray()), focus: camera.focusDistance.toFixed(3), anchors: Object.fromEntries(Object.entries(stage.vehicle.anchors).map(([k, v]) => [k, round(v.position.toArray()) + ' | ' + round(v.normal.toArray())])) }
        })()`)
        console.log(frame, JSON.stringify(numbers))
      }
    }
    const rows = Math.ceil(frames.length / columns)
    const out = join(ensureDir(join(workDir, 'look')), `look-${a.name ?? format.id}.jpg`)
    await sharp({ create: { width: cellWidth * columns, height: cellHeight * rows, channels: 3, background: '#101114' } }).composite(cells).jpeg({ quality: 88 }).toFile(out)
    console.log(out)
    return 0
  } finally {
    await session.close()
  }
})
