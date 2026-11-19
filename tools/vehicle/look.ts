import { mkdirSync, writeFileSync } from 'node:fs'
import { openViewer, outDir, type Shot } from './viewer.ts'

const args = process.argv.slice(2)
const opt = (k: string, d: string): string => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? args[i + 1] : d
}
const detail = opt('detail', 'blockout') as 'blockout' | 'full'
const shots = JSON.parse(opt('shots', '[]')) as Array<Shot & { name: string }>
mkdirSync(outDir, { recursive: true })
const viewer = await openViewer(detail, opt('paint', '') || undefined)
console.log(JSON.stringify(viewer.info))
for (const s of shots) {
  const png = await viewer.shoot(s)
  writeFileSync(`${outDir}/${s.name}.png`, png)
  console.log(`${outDir}/${s.name}.png`)
}
await viewer.close()
