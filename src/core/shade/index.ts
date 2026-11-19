import type { StageDeps, StagePart } from '../parts'

export function createShade(_deps: StageDeps): StagePart {
  return { resize: () => undefined }
}
