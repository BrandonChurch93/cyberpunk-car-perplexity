/** Record many one-image answers at once. Reads lines "serial<TAB>likelihood<TAB>why" from stdin. */
import { readFileSync } from 'node:fs'
import { record } from './jury.ts'

for (const line of readFileSync(0, 'utf8').split('\n')) {
  if (!line.trim()) continue
  const [serial, likelihood, ...why] = line.split('\t')
  const t = record(Number(serial), Number(likelihood), why.join(' '))
  console.log(`${t.agent} ${t.run} ${t.subject} ${t.likelihood}`)
}
