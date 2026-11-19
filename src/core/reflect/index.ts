import type { StageDeps, StagePart } from '../parts'

export function createReflections(_deps: StageDeps): StagePart {
  return { resize: () => undefined }
}
