import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultPaint, formatById, paintById } from '../src/config.ts'
import { launchBrowser } from './lib/browser.ts'
import { args, ensureDir, readJson, workDir, writeJson } from './lib/env.ts'
import { benchPrograms, installProfiler, sceneFacts, type CompileTime, type ProfileDump, type ProfileProgram } from './lib/profile-page.ts'
import { markdownTable, tabulate } from './lib/profile-report.ts'
import { shrinkPage } from './lib/scan.ts'
import { RenderSession, runTool } from './lib/render.ts'

type Step = { step: string; frame: number; wallMs: number; dump: ProfileDump | null; facts?: Record<string, unknown> }

type Profile = { buildHash: string; format: string; tier: string; frames: number[]; steps: Step[] }

function report(profile: Profile, compile: { programs: ProfileProgram[]; compile: CompileTime[] } | null): string {
  const out: string[] = [`# Render profile ${profile.format} ${profile.tier}, frames ${profile.frames.join(', ')}, build ${profile.buildHash}`]
  out.push('', '| step | frame | wall s |', '| --- | --- | --- |', ...profile.steps.map((s) => `| ${s.step} | ${s.frame < 0 ? '' : s.frame} | ${(s.wallMs / 1000).toFixed(1)} |`))
  for (const s of profile.steps) {
    if (!s.dump || s.dump.draws.length === 0) continue
    out.push('', `## ${s.step}, frame ${s.frame}`, '', markdownTable(tabulate(s.dump), s.wallMs))
    const objects = new Map<string, { ms: number; draws: number }>()
    for (const d of s.dump.draws) {
      const key = `${d.path.replace(/^(add|frame)\//, '')} | ${d.system} | ${d.object} | ${d.material} | ${d.target}`
      const o = objects.get(key) ?? { ms: 0, draws: 0 }
      o.ms += d.ms
      o.draws++
      objects.set(key, o)
    }
    out.push('', '| s | draws | path | system | object | material | target |', '| --- | --- | --- | --- | --- | --- | --- |')
    for (const [key, o] of [...objects].sort((x, y) => y[1].ms - x[1].ms).slice(0, 14)) out.push(`| ${(o.ms / 1000).toFixed(2)} | ${o.draws} | ${key} |`)
  }
  if (compile) {
    const byName = new Map<string, { n: number; chars: number; link: number; draw: number; again: number }>()
    for (const c of compile.compile) {
      const p = compile.programs.find((q) => q.id === c.id)
      const e = byName.get(c.name) ?? { n: 0, chars: 0, link: 0, draw: 0, again: 0 }
      e.n++
      e.chars += (p?.vertexChars ?? 0) + (p?.fragmentChars ?? 0)
      e.link += c.linkMs
      e.draw += c.drawMs
      e.again += c.againLinkMs + c.againDrawMs
      byName.set(c.name, e)
    }
    out.push('', '## Programs, compiled alone in a fresh browser', '', '| kind | programs | source KB | link s | first draw s | second time s |', '| --- | --- | --- | --- | --- | --- |')
    for (const [name, e] of [...byName].sort((x, y) => y[1].draw - x[1].draw)) out.push(`| ${name} | ${e.n} | ${(e.chars / 1024).toFixed(0)} | ${(e.link / 1000).toFixed(2)} | ${(e.draw / 1000).toFixed(2)} | ${(e.again / 1000).toFixed(2)} |`)
    const sum = (f: (c: CompileTime) => number): string => (compile.compile.reduce((x, c) => x + f(c), 0) / 1000).toFixed(1)
    out.push(`| all | ${compile.compile.length} | | ${sum((c) => c.linkMs)} | ${sum((c) => c.drawMs)} | ${sum((c) => c.againLinkMs + c.againDrawMs)} |`)
  }
  return out.join('\n') + '\n'
}

function writeReport(file: string): void {
  const profile = readJson<Profile>(file)
  if (!profile) throw new Error(`cannot read ${file}`)
  const compile = readJson<{ programs: ProfileProgram[]; compile: CompileTime[] }>(join(file, '..', `compile-${profile.format}-${profile.tier}.json`))
  const md = file.replace(/\.json$/, '.md')
  writeFileSync(md, report(profile, compile))
  console.log(md)
}

void runTool(async () => {
  const a = args()
  if (a.from) return writeReport(a.from)
  const format = formatById(a.format ?? '16x9')
  const tier = a.tier ?? 'final'
  const frames = (a.frames ?? '195,360').split(',').map(Number)
  const warm = Number(a.warm ?? 1)
  const plain = Number(a.plain ?? 1)
  const diag = a.diag ?? 'beauty'
  const session = await RenderSession.open({ budgetMinutes: 0 })
  const steps: Step[] = []
  let open = true
  try {
    const t0 = Date.now()
    const page = await session.freshPage(format, diag, paintById(a.paint ?? defaultPaint).id, 'full')
    if (a.width) await shrinkPage(page, format, Number(a.width))
    steps.push({ step: 'page load', frame: -1, wallMs: Date.now() - t0, dump: null })
    await page.evaluate('globalThis.__name = (f) => f')
    await page.evaluate(installProfiler)
    const run = async (step: string, frame: number, on: boolean, root: string, call: () => Promise<unknown>): Promise<void> => {
      await page.evaluate(([o, r]) => {
        const p = (window as unknown as { __profile: { on: boolean; stack: string[] } }).__profile
        p.on = o as boolean
        p.stack = r ? [r as string] : []
      }, [on, root] as const)
      const t = Date.now()
      await call()
      await page.evaluate(() => (window as unknown as { __profile: { settle(): Promise<void> } }).__profile.settle())
      const wallMs = Date.now() - t
      const dump = on ? await page.evaluate(() => (window as unknown as { __profile: { dump(sources: boolean): Promise<ProfileDump> } }).__profile.dump(false)) : null
      await page.evaluate(() => ((window as unknown as { __profile: { on: boolean; stack: string[] } }).__profile.on = false))
      const facts = step.startsWith('frame begin') ? await page.evaluate(sceneFacts) : undefined
      steps.push({ step, frame, wallMs, dump, facts })
      console.log(`${step} frame ${frame}: ${(wallMs / 1000).toFixed(1)} s${on ? ' (profiled)' : ''}`)
    }
    for (const [k, frame] of frames.entries()) {
      const cold = k === 0
      await run(cold ? 'frame begin cold' : 'frame begin', frame, true, '', () => page.evaluate(([f, t]) => window.showcase!.beginFrame(f as number, t as string), [frame, tier] as const))
      await run(cold ? 'sample cold' : 'sample', frame, true, 'add', () => page.evaluate(() => window.showcase!.addSamples(1)))
      for (let i = 0; i < warm; i++) await run('sample warm', frame, true, 'add', () => page.evaluate(() => window.showcase!.addSamples(1)))
      for (let i = 0; i < plain; i++) await run('sample plain', frame, false, '', () => page.evaluate(() => window.showcase!.addSamples(1)))
      await run(cold ? 'finish cold' : 'finish', frame, true, 'post', () => page.evaluate(() => window.showcase!.finishFrame()))
    }
    const info = await page.evaluate(() => window.showcase!.info())
    const programs = (await page.evaluate(() => (window as unknown as { __profile: { dump(sources: boolean): Promise<ProfileDump> } }).__profile.dump(true))).programs
    const dir = ensureDir(join(workDir, 'profile'))
    const out = join(dir, `profile-${format.id}${a.width ? `-w${a.width}` : ''}${diag === 'beauty' ? '' : `-${diag}`}-${tier}-${frames.join('-')}.json`)
    writeJson(out, { buildHash: session.buildHash, format: format.id, tier, frames, info, steps })
    console.log(out)
    open = false
    await session.close()
    const browser = await launchBrowser()
    const blank = await browser.newPage()
    await blank.goto('about:blank')
    await blank.evaluate('globalThis.__name = (f) => f')
    const t = Date.now()
    const compile = await blank.evaluate(benchPrograms, programs.filter((p) => p.vertex && p.fragment).map((p) => ({ id: p.id, name: p.name, vertex: p.vertex!, fragment: p.fragment! })))
    console.log(`compile bench: ${compile.length} programs, ${((Date.now() - t) / 1000).toFixed(1)} s`)
    await browser.close()
    const compileOut = join(dir, `compile-${format.id}-${tier}.json`)
    writeJson(compileOut, { buildHash: session.buildHash, programs: programs.map((p) => ({ ...p, vertex: undefined, fragment: undefined })), compile })
    console.log(compileOut)
    writeReport(out)
    return 0
  } finally {
    if (open) await session.close()
  }
})
