import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const repo = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  root,
  base: './',
  publicDir: `${repo}public`,
  define: { __BUILD_HASH__: JSON.stringify('vehicle-view'), __VERSIONS__: JSON.stringify({}) },
  build: { target: 'es2022', outDir: `${repo}out/work/vehicle-view`, emptyOutDir: true, chunkSizeWarningLimit: 8000, rollupOptions: { input: `${root}view.html` } },
  logLevel: 'warn',
})
