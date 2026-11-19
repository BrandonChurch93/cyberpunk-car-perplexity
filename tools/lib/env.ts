import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildHash, repoRoot } from './hash.ts'
import { config } from '../../src/config.ts'

export { config, repoRoot, buildHash }
export const workDir = join(repoRoot, 'out', 'work')
export const distDir = join(repoRoot, 'dist')

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

export function args(argv = process.argv.slice(2)): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = 'true'
    else {
      out[a.slice(2)] = next
      i++
    }
  }
  if (out.detail !== undefined) {
    if (out.detail !== 'full' && out.detail !== 'blockout') throw new Error(`unknown detail ${out.detail}, use full or blockout`)
    process.env.SHOWCASE_DETAIL = out.detail
  }
  return out
}

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

export function writeJson(path: string, value: unknown): void {
  ensureDir(dirname(path))
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

export function ensureBuild(): string {
  const hash = buildHash()
  const recordPath = join(distDir, 'build-record.json')
  const record = readJson<{ buildHash: string }>(recordPath)
  if (record?.buildHash === hash && existsSync(join(distDir, 'index.html'))) return hash
  execFileSync('npx', ['vite', 'build'], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] })
  writeJson(recordPath, { buildHash: hash })
  return hash
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function renderLock(): Promise<() => void> {
  const path = join(ensureDir(workDir), 'render.lock')
  let warned = false
  for (;;) {
    const holder = readJson<{ pid: number }>(path)
    if (!holder || !alive(holder.pid) || holder.pid === process.pid) break
    if (!warned) console.error(`waiting for render process ${holder.pid} to finish`)
    warned = true
    await new Promise((r) => setTimeout(r, 2000))
  }
  writeJson(path, { pid: process.pid })
  const release = (): void => {
    const holder = readJson<{ pid: number }>(path)
    if (holder?.pid === process.pid) rmSync(path, { force: true })
  }
  process.on('exit', release)
  return release
}
