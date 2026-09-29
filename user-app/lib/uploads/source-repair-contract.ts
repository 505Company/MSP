import type { SourceSnapshot } from '../digital-designer/source-types'
export const SOURCE_REPAIR_VERSION = 'source-reader-15'
export type SourceRepairStatus = { version: string; revision: string; name: string; slides: number[]; knownAssetIds: string[]; needed: boolean }
export type SourceRepairPatch = { version: string; revision: string; snapshot: SourceSnapshot; refresh?:boolean;
  assets: { id: string; base64: string }[]; previews: { id: string; dataUrl: string }[] }
