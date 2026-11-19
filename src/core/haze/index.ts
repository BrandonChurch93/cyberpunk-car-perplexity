import type { StageDeps, StagePart } from '../parts'

export function createHaze(_deps: StageDeps): StagePart {
  return { resize: () => undefined }
}
