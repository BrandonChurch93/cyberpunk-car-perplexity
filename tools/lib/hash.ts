import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
}

export function buildHash(): string {
  const files: string[] = []
  for (const d of ['src', 'public', 'config']) walk(join(repoRoot, d), files)
  files.push(join(repoRoot, 'package-lock.json'))
  const h = createHash('sha256')
  for (const f of files) {
    h.update(relative(repoRoot, f).replaceAll('\\', '/'))
    h.update('\0')
    h.update(readFileSync(f))
    h.update('\0')
  }
  return h.digest('hex').slice(0, 16)
}
