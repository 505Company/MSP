import type { ComponentDefinition } from './types'
import type { ComponentFamily } from './calibration-contract'
import type { ComponentUsage } from './component-curation'

export type CatalogItem = {
  id: string; name: string; kind: 'atom'|'compound'; slide: number
  elementCount: number; slotCount: number; text: string; repeatCount: number
  available: boolean; reason?: string
  /** Display-only source artwork, never admission to editable data generation. */
  sourceOnly?: boolean
  family?: ComponentFamily; usage?: ComponentUsage; occurrenceIds?: string[]; slides?: number[]
}
export type CatalogPage = {
  catalogId: string; name: string; total: number; filtered: number; page: number; pages: number
  counts: { atoms: number; molecules: number }
  items: CatalogItem[]; slides: number[]; notes: string[]
  focusedId?: string
  calibration?: { id: string; checked: number; excluded: number; variants: number }
}
export type CatalogComponent = {
  catalogId: string; definitionId: string; component: ComponentDefinition
}
