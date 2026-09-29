import type { ComponentBinding, ContentSlide, RenderReceipt, StudioLibrary } from '../presentations/studio/contract'
import type { SlidePacket } from '../presentations/studio/compact-content'

// These are data/import contracts, not calls into the former slide engine.
export type DesignLibrary = StudioLibrary
export type { ContentSlide, ComponentBinding, SlidePacket }
export const MSP2_VERSION = 'msp2-grid-1'
export type Arrangement = 'balanced' | 'horizontal' | 'vertical' | 'focus-left' | 'focus-right'
export type GridCell = { i: string; x: number; y: number; w: number; h: number }
export type SlidePlan = {
  content: ContentSlide
  components: Record<string, ComponentBinding>
  arrangement: Arrangement
  rationale: string
  background?: { id: string; area: Omit<GridCell, 'i'>; color: string; ink: string }
}
export type SlideResult = Omit<RenderReceipt, 'candidateId'> & {
  version: typeof MSP2_VERSION; planHash: string; grid: GridCell[]; spec: object
  search: { measuredWidths: number; candidates: number; checked: number; score: number; typographyScale: number }
}
export type Project = {
  id: string; revision: string; name: string; text: string; uploadId: string; styleName: string
  mode: 'local' | 'ai'; createdAt: string; updatedAt: string
}
export type Run = {
  version: typeof MSP2_VERSION; projectId: string; revision: string; createdAt: string
  mode: Project['mode']; library: DesignLibrary; packets: SlidePacket[]
  plans: Record<string, SlidePlan>; results: Record<string, SlideResult>
  errors: Record<string, string>; modelRuns: Record<string, number>
}
