import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { buildHash } from './tools/lib/hash.ts'

const lock = JSON.parse(readFileSync(new URL('./package-lock.json', import.meta.url), 'utf8'))
const version = (name: string): string => lock.packages[`node_modules/${name}`].version

export default defineConfig({
  base: './',
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash()),
    __VERSIONS__: JSON.stringify({ three: version('three'), gsap: version('gsap'), mediabunny: version('mediabunny') }),
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/**/*.test.ts'] },
})
