import { stageDetail, type StageDetail } from '../../src/core/detail.ts'

/** The stage detail asked for by flag, then by SHOWCASE_DETAIL, then the build default. */
export function detailFrom(value?: string): StageDetail {
  const v = value ?? process.env.SHOWCASE_DETAIL ?? stageDetail
  if (v !== 'full' && v !== 'blockout') throw new Error(`unknown detail ${v}, use full or blockout`)
  return v
}
