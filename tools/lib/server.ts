import { createServer, type IncomingMessage, type Server } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import type { AddressInfo } from 'node:net'
import { ensureDir } from './env.ts'
import { dirname } from 'node:path'

const types: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.hdr': 'application/octet-stream',
  '.exr': 'application/octet-stream', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
}

function body(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export interface Harness {
  url: string
  sumPath: string | null
  nextUpload(): Promise<Buffer>
  close(): Promise<void>
}

export async function startHarness(root: string, prefix = '/'): Promise<Harness> {
  const waiting: Array<(b: Buffer) => void> = []
  const state = { sumPath: null as string | null }
  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0])
      if (path.endsWith('/__harness/sum')) {
        if (!state.sumPath) {
          res.writeHead(409).end()
          return
        }
        if (req.method === 'POST') {
          const data = await body(req)
          ensureDir(dirname(state.sumPath))
          writeFileSync(state.sumPath, data)
          writeFileSync(state.sumPath + '.count', String(req.headers['x-sample-count'] ?? '0'))
          res.writeHead(204).end()
          return
        }
        if (!existsSync(state.sumPath)) {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'x-sample-count': readFileSync(state.sumPath + '.count', 'utf8'),
        })
        createReadStream(state.sumPath).pipe(res)
        return
      }
      if (path.endsWith('/__harness/upload') && req.method === 'POST') {
        const data = await body(req)
        const next = waiting.shift()
        if (next) next(data)
        res.writeHead(204).end()
        return
      }
      if (!path.startsWith(prefix)) {
        res.writeHead(404).end()
        return
      }
      let rel = normalize(path.slice(prefix.length)).replace(/^(\.\.[/\\])+/, '')
      if (rel === '' || rel === '.' || rel.endsWith('/')) rel = join(rel, 'index.html')
      const file = join(root, rel)
      if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
        console.error(`harness: 404 for ${path}`)
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      createReadStream(file).pipe(res)
    })().catch((error) => {
      console.error(error)
      res.writeHead(500).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}${prefix}`,
    get sumPath() {
      return state.sumPath
    },
    set sumPath(value: string | null) {
      state.sumPath = value
    },
    nextUpload: () => new Promise<Buffer>((resolve) => waiting.push(resolve)),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
