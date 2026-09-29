import type { ElementIR } from '../../vendor/drag/src/core/model'
import type { SourceSnapshot } from '../digital-designer/source-types'

export type ComponentIssue = { code: string; message: string; elementId?: string; severity?: 'warning' | 'blocking' }
export type TextSlot = { id: string; elementId: string; label: string; defaultText: string; policy: 'fixed-box'; maxLength: number; range?: { start: number; end: number } }
export type ComponentDefinition = {
  pattern?: import('./pattern-contract').PatternDefinition
  id: string
  name: string
  kind: 'atom' | 'compound'
  source: { slide: number; rootId: string; elementIds: string[]; ancestorIds: string[]; assetIds: string[] }
  scene: { width: number; height: number; elements: ElementIR[] }
  slots: TextSlot[]
  fixedTextIds: string[]
  fixedTextReasons?: Record<string, string>
  issues: ComponentIssue[]
  semantics: { findingId: string; name: string; role: string; basis: string }[]
}
export type ComponentLibrary = {
  schemaVersion: 1
  compilerVersion: string
  sourceId: string
  name: string
  tokens: Pick<SourceSnapshot, 'colors' | 'fonts'>
  components: ComponentDefinition[]
  excluded: { elementId: string; reason: string }[]
  assemblyIssues?: { findingId: string; elementIds: string[]; reason: string }[]
  notes: string[]
}
export type RenderReport = { dataUrl: string; issues: ComponentIssue[]; fits: boolean }
/** Archival format only; active catalogs do not read or write manual decisions. */
export type ComponentDecision = { status: 'candidate' | 'accepted' | 'rejected'; values: Record<string, string> }
export type LibraryRevision = {
  schemaVersion: 1
  id: string
  parentId: string | null
  definitionId: string
  createdAt: string
  decisions: Record<string, ComponentDecision>
}
export type SavedLibrary = { definitionId: string; library: ComponentLibrary; revision: LibraryRevision }
