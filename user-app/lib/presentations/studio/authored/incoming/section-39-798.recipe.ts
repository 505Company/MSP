/** MSP Section 39:798 — v6.1.0, single-file edition.
 * All 32 authored source frames, five recipe families.
 * Geometry/semantic contracts only: no Figma example text, colors, fonts or assets.
 * Requires real MSP layout, active-DS measurement and rendered validation.
 * Tests, modular sources and integration notes are in the companion ZIP.
 */

// ===== core.ts =====
/**
 * MSP adaptive recipe contract. Derived from the reviewed section-33-223 v5.
 * This module compiles and validates contracts, NOT pixels. No model-written
 * geometry/content, Figma fonts, colors, icons or example strings are executed.
 * Runtime parsing is dependency-free. zod-adapter.ts binds the SAME validation
 * to the host's Zod instance; jsonSchema is the model's constrained grammar.
 */
export type Rect = { x: number; y: number; w: number; h: number }
export type Range = { min: number; preferred: number; max: number }
export type Insets = { top: number; right: number; bottom: number; left: number }
export type Direction = 'row' | 'column'
export type Align = 'start' | 'center' | 'end' | 'stretch'
export type Emphasis = 'primary' | 'secondary'
export type VisualType = 'photo' | 'illustration' | 'diagram' | 'abstract-graphic' | 'logo'
export type FieldBinding = { sourceRefs: readonly string[] }
export type StructuredItemBinding = { sourceRefs: readonly string[]; fields: Readonly<Record<string, FieldBinding>> }
export type NormalizedValue = FieldBinding | readonly StructuredItemBinding[] | VisualType
export type NormalizedBlock = {
  id: string; type: string; allowedRoles: readonly string[]; sequenceIndex: number
  sourceRefs: readonly string[]; fields: Readonly<Record<string, NormalizedValue>>
}
export type FieldContract =
  | { kind: 'single'; required: boolean }
  | { kind: 'visual-type'; required: boolean }
  | { kind: 'list'; required: boolean; minItems: number; maxItems: number; itemFields: Readonly<Record<string, { required: boolean }>> }
export type Flex = { grow?: number; shrink?: number; basis?: number | 'auto'; growPriority?: number; shrinkPriority?: number }
export type EdgeDecoration = {
  id: string; edge: 'top' | 'bottom' | 'left' | 'right'; role: string
  preferredThicknessPx: number; clearancePx: number
  /** Inset is part of the owner's box, not an overlapping absolute layer. */
  placement: 'inside-edge'; when?: 'always' | 'not-first' | 'not-last'
}
export type InternalNode = {
  id: string; kind: 'field' | 'group' | 'repeat' | 'ornament'
  fieldPath?: string; typographyRole?: string; textAlign?: 'left' | 'center' | 'right'
  direction?: Direction; align?: Align; justify?: 'start' | 'center' | 'end' | 'space-between'
  gap?: Range; padding?: Insets; surfaceRole?: string; flex?: Flex; pushToEnd?: boolean
  /** Default is fill only at the block root; descendants hug unless they grow. */
  heightMode?: 'fill' | 'hug'; preferredWidth?: number; maxLines?: number
  children?: readonly InternalNode[]; item?: InternalNode; tail?: InternalNode
  minItems?: number; maxItems?: number; columns?: number
  /** Repeat's flex grow equals the immutable item count, e.g. N equal table rows. */
  growPerItem?: boolean
  readingOrder?: 'row-major' | 'column-major'
  /** Geometry-only shape from the active DS; never a literal glyph/icon. */
  ornamentRole?: string; ornamentSize?: { w: number; h: number }
  decorations?: readonly EdgeDecoration[]
}
export type PrimitiveLayout = { id: string; root: InternalNode; listCounts?: Readonly<Record<string, { min: number; max: number }>> }
export type BlockContract = {
  type: string; fields: Readonly<Record<string, FieldContract>>
  queryRole: string | null; componentLayouts: readonly string[]; primitiveLayouts: readonly PrimitiveLayout[]
}
export type ItemLayout = {
  id: string; columns: number; minItems: number; maxItems: number
  gapX: Range; gapY: Range; align: Align; readingOrder: 'row-major' | 'column-major'
  /** New topology determines track width; it is NOT a 3x stretch of an old cell. */
  trackBasis: 'resolved-topology'; preferredWeights?: readonly number[]
  /** Slot treatment belongs to this topology, never to a particular source ID. */
  itemPadding?: { first: Insets; middle: Insets; last: Insets }
  betweenItemsRole?: string; borderEdges?: readonly ('top' | 'bottom')[]
  cellHeight?: { mode: 'hug' | 'fill' | 'reference'; preferred?: number }
}
export type Region = {
  id: string; sourceNode?: string; preferredRect: Rect
  size: { width: Range; height: Range }; role: string; accepts: readonly string[]
  minItems: number; maxItems: number; priority: 'component-first' | 'primitive-first' | 'asset-only' | 'mixed-partners'
  typographyRole?: string; textAlign?: 'left' | 'center' | 'right'; emphasis: readonly Emphasis[]; maxPrimaryItems: number
  layouts: readonly ItemLayout[]; preferredLayoutId: string
  /** Per-region internal topology variants, picked by executor, not model. */
  primitiveLayoutIds?: readonly string[]; allowedVisualTypes?: readonly VisualType[]
}
export type ChildRef = {
  kind: 'group' | 'region'; id: string; flex?: Flex; pushToEnd?: boolean
  alignSelf?: Align; gapBefore?: Range
  /** Insets are local to this child; a reference y-offset is not global position. */
  marginBeforeCrossPx?: number
}
export type FlowSeparator = { id: string; afterId: string; beforeId: string; role: string; width: number; height: number; gap: number }
export type Group = {
  id: string; sourceNode?: string; preferredRect: Rect; size: { width: Range; height: Range }
  direction: Direction; align: Align; justify: 'start' | 'center' | 'end' | 'space-between'
  gap: Range; padding: Insets; surfaceRole: string; children: readonly ChildRef[]
  decorations: readonly EdgeDecoration[]; collapseEmpty: boolean
  flex?: Flex; trailingSpace?: Range; flowSeparators?: readonly FlowSeparator[]
}
export type State = {
  id: string; familyId: string; modeId: string; sourceFrame: string; aliasOf?: string
  canvas: { width: number; height: number }; rootGroupId: string
  regions: readonly Region[]; groups: readonly Group[]; surfaceRole: string
  /** Inferences/authorised extensions are explicit, not claimed to be Figma data. */
  adaptationNotes: readonly string[]
}
export type RecipeFamily = { id: string; name: string; modes: readonly { id: string; stateIds: readonly string[] }[] }
export type Bundle = {
  id: string; revision: string; sourceSection: string; sourceFrames: readonly string[]
  contracts: Readonly<Record<string, BlockContract>>; families: readonly RecipeFamily[]; states: readonly State[]
}
export const FALLBACK_REASONS = ['no-compatible-component', 'component-does-not-fit', 'component-field-contract-mismatch'] as const
export type FallbackReason = (typeof FALLBACK_REASONS)[number]
export type RenderChoice = { kind: 'component'; variantId: string } | { kind: 'primitive'; reason: FallbackReason | null } | { kind: 'asset' }
export type Assignment = {
  familyId: string; modeId: string
  assignments: { blockId: string; regionId: string; emphasis: Emphasis; render: RenderChoice }[]
}
export type StructuralAssignment = Omit<Assignment, 'assignments'> & {
  assignments: Omit<Assignment['assignments'][number], 'render'>[]
}
/** One exact state/region/slot/layout, NOT the Cartesian product of ID arrays. */
export type MeasurementScope = {
  blockId: string; blockKey: string; stateId: string; regionId: string; slotIndex: number
  contentRevision: string; designSystemId: string; designSystemRevision: string
  recipeRevision: string; structureKey: string; layoutKey: string; emphasis: Emphasis
  measuredBox: Rect
}
export type ComponentFieldBinding = { path: string; sourceRefs: readonly string[] }
export type MeasuredComponentVariant = MeasurementScope & { id: string; componentId: string; fieldBindings: readonly ComponentFieldBinding[] }
export type FallbackEvidence = MeasurementScope & { reason: FallbackReason; searchComplete: true }
export type QwenContext = {
  contentRevision: string; designSystemId: string; designSystemRevision: string
  sourceRefs: readonly string[]; sourceUseCounts?: Readonly<Record<string, number>>
  blocks: readonly NormalizedBlock[]
  /** Trusted active-DS registry snapshot. The model never supplies this. */
  componentIds: readonly string[]
  componentFieldPaths: Readonly<Record<string, readonly string[]>>
  componentVariants: readonly MeasuredComponentVariant[]; fallbackEvidence: readonly FallbackEvidence[]
  visualAssets: readonly { blockId: string; sourceRef: string; assetId: string; visualType: VisualType }[]
}
export type TopologyChoices = {
  regionLayouts?: Readonly<Record<string, string>>
  primitiveLayouts?: Readonly<Record<string, string>>
  /** Measurement epoch changes whenever bounds, DS profiles or fitting change. */
  layoutRevision: string
}
export type ExecutorChoices = TopologyChoices & {
  /** Measured final per-block INNER boxes, after slot padding/decor reservations. */
  blockBoxes: Readonly<Record<string, Rect>>
}
export class RecipeError extends Error {
  constructor(public readonly issues: readonly string[]) { super(issues.join('\n')); this.name = 'RecipeError' }
}
export const ZERO: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
export const fixed = (n: number): Range => ({ min: n, preferred: n, max: n })
export const range = (min: number, preferred: number, max: number): Range => ({ min, preferred, max })
export function scale30(v: number, minCap = 0, maxCap = Infinity): Range {
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(minCap) || minCap < 0 || !(Number.isFinite(maxCap) || maxCap === Infinity)) throw new RecipeError(['invalid-dimension'])
  const min = Math.ceil(Math.max(.7 * v, minCap) / 4) * 4, max = Math.floor(Math.min(1.3 * v, maxCap) / 4) * 4
  if (min > max || v < min || v > max) throw new RecipeError(['infeasible-dimension-range'])
  return { min, preferred: v, max }
}
export function fitDimension(requested: number, bounds: Range): number {
  if (![requested, bounds.min, bounds.max].every(Number.isFinite)) throw new RecipeError(['nonfinite-dimension'])
  const min = Math.ceil(bounds.min / 4) * 4, max = Math.floor(bounds.max / 4) * 4
  if (min > max) throw new RecipeError(['empty-4px-range'])
  return Math.max(min, Math.min(max, Math.round(requested / 4) * 4))
}
/** Includes the exact authored value even when off-grid; samples are not exhaustive. */
export function dimensionCandidates(bounds: Range): number[] {
  const values = [bounds.preferred]
  for (let n = Math.ceil(bounds.min / 4) * 4; n <= bounds.max; n += 4) if (n !== bounds.preferred) values.push(n)
  return values.sort((a, b) => Math.abs(a - bounds.preferred) - Math.abs(b - bounds.preferred) || a - b)
}
export function canonicalKey(value: unknown): string {
  const walk = (v: unknown): unknown => Array.isArray(v) ? v.map(walk)
    : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, walk(x)])) : v
  return JSON.stringify(walk(value))
}
export const normalizedBlockKey = (b: NormalizedBlock) => canonicalKey(b)
const visualTypes: readonly string[] = ['photo', 'illustration', 'diagram', 'abstract-graphic', 'logo']
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const strs = (v: unknown, nonempty = false): v is string[] => Array.isArray(v) && (!nonempty || v.length > 0) && v.every(str)
const unique = (v: readonly unknown[]) => new Set(v).size === v.length
const validRect = (v: unknown): v is Rect => record(v) && ['x', 'y', 'w', 'h'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k])) && (v.w as number) > 0 && (v.h as number) > 0
const sameRefs = (a: readonly string[], b: readonly string[]) => canonicalKey([...a].sort()) === canonicalKey([...b].sort())
const refsOf = (v: NormalizedValue): string[] => typeof v === 'string' ? [] : Array.isArray(v) ? v.flatMap(i => [...i.sourceRefs]) : [...(v as FieldBinding).sourceRefs]
function ownKeys(v: Record<string, unknown>, allowed: readonly string[], path: string, issues: string[]): void {
  for (const k of Object.keys(v)) if (!allowed.includes(k)) issues.push(`${path}:unknown-property:${k}`)
}
function parseBinding(v: unknown, path: string, issues: string[]): v is FieldBinding {
  if (!record(v) || !strs(v.sourceRefs, true)) { issues.push(`${path}:invalid-field-binding`); return false }
  ownKeys(v, ['sourceRefs'], path, issues)
  if (!unique(v.sourceRefs)) issues.push(`${path}:duplicate-field-ref`)
  return true
}
/** Validate the trusted normalizer too: TypeScript readonly is not runtime safety. */
export function validateContext(bundle: Bundle, value: unknown): asserts value is QwenContext {
  const issues: string[] = []
  if (!record(value)) throw new RecipeError(['context:not-object'])
  ownKeys(value, ['contentRevision', 'designSystemId', 'designSystemRevision', 'sourceRefs', 'sourceUseCounts', 'blocks', 'componentIds', 'componentFieldPaths', 'componentVariants', 'fallbackEvidence', 'visualAssets'], 'context', issues)
  for (const k of ['contentRevision', 'designSystemId', 'designSystemRevision']) if (!str(value[k])) issues.push(`context:missing-${k}`)
  if (!strs(value.sourceRefs, true) || !unique(value.sourceRefs)) issues.push('context:invalid-source-refs')
  if (!strs(value.componentIds) || !unique(value.componentIds)) issues.push('context:invalid-component-registry')
  if (!record(value.componentFieldPaths)) issues.push('context:missing-component-field-registry')
  else if (strs(value.componentIds)) {
    for (const id of value.componentIds) if (!strs(value.componentFieldPaths[id],true) || !unique(value.componentFieldPaths[id] as string[])) issues.push(`context:invalid-component-field-paths:${id}`)
    for (const id of Object.keys(value.componentFieldPaths)) if (!value.componentIds.includes(id)) issues.push(`context:fields-for-unregistered-component:${id}`)
  }
  for (const k of ['blocks', 'componentVariants', 'fallbackEvidence', 'visualAssets']) if (!Array.isArray(value[k])) issues.push(`context:${k}:not-array`)
  if (issues.length) throw new RecipeError(issues)
  const ctx = value as unknown as QwenContext
  if (!ctx.blocks.length) issues.push('empty-normalized-blocks')
  if (!unique(ctx.blocks.map(b => b?.id))) issues.push('duplicate-block-id')
  if (!unique(ctx.blocks.map(b => b?.sequenceIndex))) issues.push('duplicate-sequence-index')
  const uses = new Map<string, number>()
  for (const unknownBlock of ctx.blocks) {
    if (!record(unknownBlock)) { issues.push('block:not-object'); continue }
    const b = unknownBlock as unknown as NormalizedBlock
    ownKeys(unknownBlock, ['id', 'type', 'allowedRoles', 'sequenceIndex', 'sourceRefs', 'fields'], `block:${b.id}`, issues)
    if (!str(b.id) || !str(b.type) || !strs(b.allowedRoles, true) || !unique(b.allowedRoles) || !Number.isInteger(b.sequenceIndex) || b.sequenceIndex < 0 || !strs(b.sourceRefs, true) || !unique(b.sourceRefs) || !record(b.fields)) { issues.push(`block:${b.id}:invalid-shape`); continue }
    const contract = Object.hasOwn(bundle.contracts,b.type)?bundle.contracts[b.type]:undefined
    if (!contract) { issues.push(`block:${b.id}:unknown-type`); continue }
    const allRoles = new Set(bundle.states.flatMap(s => s.regions.map(r => r.role)))
    if (b.allowedRoles.some(r => !allRoles.has(r))) issues.push(`block:${b.id}:unknown-role`)
    if (!b.allowedRoles.some(role => bundle.states.some(s => s.regions.some(r => r.role === role && r.accepts.includes(b.type))))) issues.push(`block:${b.id}:no-compatible-role`)
    for (const name of Object.keys(b.fields)) if (!Object.hasOwn(contract.fields,name)) issues.push(`block:${b.id}:unknown-field:${name}`)
    const allRefs: string[] = []
    for (const [name, spec] of Object.entries(contract.fields)) {
      const v = b.fields[name], p = `block:${b.id}:${name}`
      if (v === undefined) { if (spec.required) issues.push(`${p}:missing`); continue }
      if (spec.kind === 'visual-type') { if (!visualTypes.includes(String(v)) || typeof v !== 'string') issues.push(`${p}:invalid-visual-type`); continue }
      if (spec.kind === 'single') { if (parseBinding(v, p, issues)) allRefs.push(...v.sourceRefs); continue }
      if (!Array.isArray(v) || v.length < spec.minItems || v.length > spec.maxItems) { issues.push(`${p}:invalid-list-count`); continue }
      for (const [i, item] of v.entries()) {
        if (!record(item) || !strs(item.sourceRefs, true) || !unique(item.sourceRefs) || !record(item.fields)) { issues.push(`${p}:${i}:invalid-item`); continue }
        ownKeys(item, ['sourceRefs', 'fields'], `${p}:${i}`, issues)
        const ir: string[] = []
        for (const f of Object.keys(item.fields)) if (!Object.hasOwn(spec.itemFields,f)) issues.push(`${p}:${i}:unknown-item-field:${f}`)
        for (const [f, rule] of Object.entries(spec.itemFields)) {
          const iv = item.fields[f]
          if (iv === undefined) { if (rule.required) issues.push(`${p}:${i}:${f}:missing`); continue }
          if (parseBinding(iv, `${p}:${i}:${f}`, issues)) ir.push(...iv.sourceRefs)
        }
        if (!sameRefs(ir, item.sourceRefs)) issues.push(`${p}:${i}:item-coverage`)
        allRefs.push(...item.sourceRefs)
      }
    }
    if (!sameRefs(allRefs, b.sourceRefs)) issues.push(`block:${b.id}:field-coverage`)
    for (const id of b.sourceRefs) { if (!ctx.sourceRefs.includes(id)) issues.push(`unknown-source-ref:${id}`); uses.set(id, (uses.get(id) ?? 0) + 1) }
    if (b.type === 'visual' && (!record(b.fields.assetRef) || !strs(b.fields.assetRef.sourceRefs) || b.fields.assetRef.sourceRefs.length !== 1)) issues.push(`visual:${b.id}:requires-one-asset`)
  }
  if (ctx.sourceUseCounts !== undefined) {
    if (!record(ctx.sourceUseCounts)) issues.push('invalid-source-use-counts')
    else for (const [ref, count] of Object.entries(ctx.sourceUseCounts)) if (!ctx.sourceRefs.includes(ref) || !Number.isInteger(count) || count < 1) issues.push(`invalid-source-use-count:${ref}`)
  }
  for (const id of ctx.sourceRefs) if ((uses.get(id) ?? 0) !== (ctx.sourceUseCounts?.[id] ?? 1)) issues.push(`source-coverage:${id}`)
  if (issues.length) throw new RecipeError(issues)
  const assetRefs = new Set(ctx.blocks.filter(b => b.type === 'visual').flatMap(b => refsOf(b.fields.assetRef)))
  for (const b of ctx.blocks) if (b.type !== 'visual' && b.sourceRefs.some(id => assetRefs.has(id))) issues.push(`asset-used-as-text:${b.id}`)
  if (!unique(ctx.visualAssets.map(a => a?.blockId))) issues.push('duplicate-visual-block')
  for (const a of ctx.visualAssets) {
    if (!record(a)) { issues.push('invalid-visual-asset'); continue }
    ownKeys(a, ['blockId', 'sourceRef', 'assetId', 'visualType'], 'visual-asset', issues)
    const b = ctx.blocks.find(b => b.id === a.blockId)
    if (!b || b.type !== 'visual' || !str(a.assetId) || b.fields.visualType !== a.visualType || refsOf(b.fields.assetRef)[0] !== a.sourceRef) issues.push(`invalid-visual-asset:${a.blockId}`)
  }
  for (const b of ctx.blocks.filter(b => b.type === 'visual')) if (!ctx.visualAssets.some(a => a.blockId === b.id)) issues.push(`missing-visual-asset:${b.id}`)
  if (!unique(ctx.componentVariants.map(v => v?.id))) issues.push('duplicate-variant-id')
  const scopes: { scope: MeasurementScope; component: boolean }[] = [
    ...ctx.componentVariants.map(scope => ({ scope, component: true })), ...ctx.fallbackEvidence.map(scope => ({ scope, component: false })),
  ]
  for (const { scope: q, component } of scopes) {
    if (!record(q)) { issues.push('invalid-measurement'); continue }
    const p = `measurement:${q.blockId}`
    const keys = ['blockId', 'blockKey', 'stateId', 'regionId', 'slotIndex', 'contentRevision', 'designSystemId', 'designSystemRevision', 'recipeRevision', 'structureKey', 'layoutKey', 'emphasis', 'measuredBox']
    ownKeys(q, [...keys, ...(component ? ['id', 'componentId', 'fieldBindings'] : ['reason', 'searchComplete'])], p, issues)
    for (const k of keys.filter(k => !['slotIndex', 'measuredBox'].includes(k))) if (!str((q as unknown as Record<string, unknown>)[k])) issues.push(`${p}:invalid-${k}`)
    const b = ctx.blocks.find(b => b.id === q.blockId), s = bundle.states.find(s => s.id === q.stateId), r = s?.regions.find(r => r.id === q.regionId)
    if (!b || !r) { issues.push(`${p}:unknown-scope`); continue }
    if (!r.accepts.includes(b.type) || !b.allowedRoles.includes(r.role) || !r.emphasis.includes(q.emphasis)) issues.push(`${p}:incompatible-region`)
    if (!Number.isInteger(q.slotIndex) || q.slotIndex < 0 || q.slotIndex >= r.maxItems || !validRect(q.measuredBox)) issues.push(`${p}:invalid-slot-or-bounds`)
    if (q.recipeRevision !== bundle.revision || q.contentRevision !== ctx.contentRevision || q.designSystemId !== ctx.designSystemId || q.designSystemRevision !== ctx.designSystemRevision || q.blockKey !== normalizedBlockKey(b)) issues.push(`${p}:stale-snapshot`)
    if (component) {
      const v = q as unknown as MeasuredComponentVariant
      if (!str(v.id) || !str(v.componentId) || !ctx.componentIds.includes(v.componentId)) issues.push(`${p}:unregistered-component`)
      if (!bundle.contracts[b.type].queryRole || r.priority === 'asset-only') issues.push(`${p}:component-not-supported`)
      if (!Array.isArray(v.fieldBindings) || !v.fieldBindings.length || v.fieldBindings.some(f => !record(f) || !str(f.path) || !strs(f.sourceRefs,true)) || !unique(v.fieldBindings.map(f=>f.path))) issues.push(`${p}:invalid-component-field-bindings`)
      else {
        if (!sameRefs(v.fieldBindings.flatMap(f=>[...f.sourceRefs]),b.sourceRefs)) issues.push(`${p}:component-field-coverage`)
        for (const f of v.fieldBindings) if (!ctx.componentFieldPaths[v.componentId]?.includes(f.path)) issues.push(`${p}:unknown-component-field-path:${f.path}`)
      }
    } else {
      const e = q as unknown as FallbackEvidence
      if (!FALLBACK_REASONS.includes(e.reason) || e.searchComplete !== true) issues.push(`${p}:incomplete-fallback-evidence`)
    }
  }
  if (issues.length) throw new RecipeError(issues)
}

function parseStructure(bundle: Bundle, raw: unknown, ctx: QwenContext, rendered: boolean): Assignment | StructuralAssignment {
  const issues: string[] = []
  if (!record(raw)) throw new RecipeError(['assignment:not-object'])
  ownKeys(raw, ['familyId', 'modeId', 'assignments'], 'assignment', issues)
  const family = bundle.families.find(f => f.id === raw.familyId)
  if (!family || !family.modes.some(m => m.id === raw.modeId)) issues.push('unknown-family-or-mode')
  if (!Array.isArray(raw.assignments) || !raw.assignments.length) throw new RecipeError([...issues, 'empty-assignments'])
  const counts = new Map<string, number>()
  for (const a of raw.assignments) {
    if (!record(a)) { issues.push('invalid-assignment'); continue }
    ownKeys(a, ['blockId', 'regionId', 'emphasis', ...(rendered ? ['render'] : [])], 'assignment-item', issues)
    if (!str(a.blockId) || !ctx.blocks.some(b => b.id === a.blockId) || !str(a.regionId) || !['primary', 'secondary'].includes(String(a.emphasis))) issues.push('invalid-assignment-identity')
    counts.set(String(a.blockId), (counts.get(String(a.blockId)) ?? 0) + 1)
    if (rendered) {
      const r = a.render
      if (!record(r)) { issues.push(`missing-render-choice:${a.blockId}`); continue }
      if (r.kind === 'component') {
        ownKeys(r, ['kind', 'variantId'], 'render', issues)
        if (!str(r.variantId) || !ctx.componentVariants.some(v => v.id === r.variantId)) issues.push('unknown-component-variant')
      } else if (r.kind === 'primitive') {
        ownKeys(r, ['kind', 'reason'], 'render', issues)
        if (r.reason !== null && !FALLBACK_REASONS.includes(r.reason as FallbackReason)) issues.push('invalid-fallback-reason')
      } else if (r.kind === 'asset') ownKeys(r, ['kind'], 'render', issues)
      else issues.push('unknown-render-kind')
    }
  }
  for (const b of ctx.blocks) if (counts.get(b.id) !== 1) issues.push(`block-assignment-count:${b.id}:${counts.get(b.id) ?? 0}`)
  if (raw.assignments.length !== ctx.blocks.length) issues.push('all-blocks-must-be-assigned-once')
  if (issues.length) throw new RecipeError(issues)
  return structuredClone(raw) as unknown as Assignment | StructuralAssignment
}
export function validateStructuralAssignment(bundle: Bundle, raw: unknown, ctx: QwenContext, rendered = false): {
  assignment: StructuralAssignment | Assignment; compatibleStateIds: string[]
} {
  validateContext(bundle, ctx)
  const assignment = parseStructure(bundle, raw, ctx, rendered)
  const rejected: string[] = [], compatibleStateIds: string[] = []
  for (const s of bundle.states.filter(s => s.familyId === assignment.familyId && s.modeId === assignment.modeId)) {
    const problems: string[] = []
    for (const r of s.regions) {
      const items = assignment.assignments.filter(a => a.regionId === r.id)
      if (items.length < r.minItems || items.length > r.maxItems) problems.push(`count:${r.id}:${items.length}`)
      if (items.filter(a => a.emphasis === 'primary').length > r.maxPrimaryItems) problems.push(`primary-count:${r.id}`)
      if (items.length && !r.layouts.some(l => items.length >= l.minItems && items.length <= l.maxItems)) problems.push(`no-layout-for-count:${r.id}`)
    }
    for (const a of assignment.assignments) {
      const r = s.regions.find(r => r.id === a.regionId), b = ctx.blocks.find(b => b.id === a.blockId)!
      if (!r) { problems.push(`unknown-region:${a.regionId}`); continue }
      if (!r.accepts.includes(b.type) || !b.allowedRoles.includes(r.role)) problems.push(`semantic-role-or-type:${b.id}:${r.id}`)
      if (!r.emphasis.includes(a.emphasis)) problems.push(`emphasis:${b.id}:${r.id}`)
      if (b.type==='visual' && r.allowedVisualTypes && !r.allowedVisualTypes.includes(b.fields.visualType as VisualType)) problems.push(`visual-type-not-allowed:${b.id}:${r.id}`)
    }
    if (!problems.length) compatibleStateIds.push(s.id)
    else rejected.push(...problems.map(p => `${s.id}:${p}`))
  }
  if (!compatibleStateIds.length) throw new RecipeError(['no-compatible-state', ...rejected])
  return { assignment, compatibleStateIds }
}
export function structureKey(assignment: StructuralAssignment | Assignment): string {
  return canonicalKey({ familyId: assignment.familyId, modeId: assignment.modeId,
    assignments: assignment.assignments.map(a => ({ blockId: a.blockId, regionId: a.regionId, emphasis: a.emphasis })).sort((a, b) => a.blockId < b.blockId ? -1 : a.blockId > b.blockId ? 1 : 0) })
}
export function eligiblePrimitiveLayouts(bundle: Bundle, block: NormalizedBlock, region?: Region): readonly PrimitiveLayout[] {
  return bundle.contracts[block.type].primitiveLayouts.filter(l =>
    (!region?.primitiveLayoutIds || region.primitiveLayoutIds.includes(l.id)) &&
    Object.entries(l.listCounts ?? {}).every(([f, c]) => Array.isArray(block.fields[f]) && (block.fields[f] as readonly unknown[]).length >= c.min && (block.fields[f] as readonly unknown[]).length <= c.max))
}
export type ResolvedChoices = {
  regionLayouts: Record<string, string>; primitiveLayouts: Record<string, string>
  layoutRevision: string; blockBoxes: Readonly<Record<string, Rect>>
}
function resolveTopologyChoices(bundle: Bundle, state: State, assignment: StructuralAssignment | Assignment, ctx: QwenContext, choices: TopologyChoices): Omit<ResolvedChoices, 'blockBoxes'> {
  const issues: string[] = []
  if (!str(choices.layoutRevision)) throw new RecipeError(['missing-layout-revision'])
  const regionLayouts: Record<string, string> = {}, primitiveLayouts: Record<string, string> = {}
  for (const key of Object.keys(choices.regionLayouts ?? {})) if (!assignment.assignments.some(a => a.regionId === key)) issues.push(`orphan-layout-choice:${key}`)
  for (const r of state.regions) {
    const items = assignment.assignments.filter(a => a.regionId === r.id)
    if (!items.length) continue
    const valid = r.layouts.filter(l => items.length >= l.minItems && items.length <= l.maxItems)
    const requested = choices.regionLayouts?.[r.id]
    const l = requested ? valid.find(l => l.id === requested) : valid.find(l => l.id === r.preferredLayoutId) ?? valid[0]
    if (!l) issues.push(`invalid-region-layout:${r.id}`); else regionLayouts[r.id] = l.id
  }
  for (const key of Object.keys(choices.primitiveLayouts ?? {})) if (!ctx.blocks.some(b => b.id === key)) issues.push(`unknown-primitive-choice:${key}`)
  for (const a of assignment.assignments) {
    const b = ctx.blocks.find(b => b.id === a.blockId)!, r = state.regions.find(r => r.id === a.regionId)!
    const valid = eligiblePrimitiveLayouts(bundle, b, r), requested = choices.primitiveLayouts?.[b.id]
    if (requested && !valid.some(l => l.id === requested)) issues.push(`invalid-primitive-layout:${b.id}:${requested}`)
    if (valid.length) primitiveLayouts[b.id] = requested ?? valid[0].id
  }
  if (issues.length) throw new RecipeError(issues)
  return { regionLayouts, primitiveLayouts, layoutRevision: choices.layoutRevision }
}
function resolveChoices(bundle: Bundle, state: State, assignment: StructuralAssignment | Assignment, ctx: QwenContext, choices: ExecutorChoices): ResolvedChoices {
  const topology = resolveTopologyChoices(bundle, state, assignment, ctx, choices), issues: string[] = []
  if (!record(choices.blockBoxes)) throw new RecipeError(['missing-measured-layout-context'])
  for (const key of Object.keys(choices.blockBoxes)) if (!ctx.blocks.some(b => b.id === key)) issues.push(`unknown-box:${key}`)
  for (const b of ctx.blocks) if (!validRect(choices.blockBoxes[b.id])) issues.push(`missing-or-invalid-box:${b.id}`)
  if (issues.length) throw new RecipeError(issues)
  return { ...topology, blockBoxes: structuredClone(choices.blockBoxes) }
}
export function layoutKey(bundle: Bundle, stateId: string, choices: ResolvedChoices): string {
  return canonicalKey({ recipeRevision: bundle.revision, stateId, ...choices })
}
export function makeMeasurementScope(bundle: Bundle, stateId: string, rawStructure: unknown, ctx: QwenContext, choices: ExecutorChoices, blockId: string): MeasurementScope {
  const v = validateStructuralAssignment(bundle, rawStructure, ctx)
  if (!v.compatibleStateIds.includes(stateId)) throw new RecipeError(['incompatible-state'])
  const s = bundle.states.find(s => s.id === stateId)!, c = resolveChoices(bundle, s, v.assignment, ctx, choices)
  return measurementScope(bundle, s, v.assignment, ctx, c, blockId)
}
function measurementScope(bundle: Bundle, state: State, assignment: StructuralAssignment | Assignment, ctx: QwenContext, choices: ResolvedChoices, blockId: string): MeasurementScope {
  const a = assignment.assignments.find(a => a.blockId === blockId), b = ctx.blocks.find(b => b.id === blockId)
  if (!a || !b) throw new RecipeError(['unknown-measured-block'])
  const ordered = assignment.assignments.filter(i => i.regionId === a.regionId).sort((x, y) => ctx.blocks.find(b => b.id === x.blockId)!.sequenceIndex - ctx.blocks.find(b => b.id === y.blockId)!.sequenceIndex)
  return { blockId, blockKey: normalizedBlockKey(b), stateId: state.id, regionId: a.regionId, slotIndex: ordered.findIndex(i => i.blockId === blockId),
    contentRevision: ctx.contentRevision, designSystemId: ctx.designSystemId, designSystemRevision: ctx.designSystemRevision,
    recipeRevision: bundle.revision, structureKey: structureKey(assignment), layoutKey: layoutKey(bundle, state.id, choices), emphasis: a.emphasis,
    measuredBox: { ...choices.blockBoxes[blockId] } }
}
const scopeOnly = (v: MeasurementScope): MeasurementScope => ({ blockId: v.blockId, blockKey: v.blockKey, stateId: v.stateId, regionId: v.regionId, slotIndex: v.slotIndex,
  contentRevision: v.contentRevision, designSystemId: v.designSystemId, designSystemRevision: v.designSystemRevision, recipeRevision: v.recipeRevision,
  structureKey: v.structureKey, layoutKey: v.layoutKey, emphasis: v.emphasis, measuredBox: v.measuredBox })
export function validateQwenAssignment(bundle: Bundle, stateId: string, raw: unknown, ctx: QwenContext, choices: ExecutorChoices): {
  assignment: Assignment; state: State; choices: ResolvedChoices; requiresRenderedValidation: true
} {
  const v = validateStructuralAssignment(bundle, raw, ctx, true)
  if (!v.compatibleStateIds.includes(stateId)) throw new RecipeError(['state-not-compatible-with-assignment'])
  const state = bundle.states.find(s => s.id === stateId)!, assignment = v.assignment as Assignment
  const c = resolveChoices(bundle, state, assignment, ctx, choices), issues: string[] = []
  for (const a of assignment.assignments) {
    const b = ctx.blocks.find(b => b.id === a.blockId)!, r = state.regions.find(r => r.id === a.regionId)!
    const scope = canonicalKey(measurementScope(bundle, state, assignment, ctx, c, b.id))
    const variants = ctx.componentVariants.filter(v => canonicalKey(scopeOnly(v)) === scope)
    const evidence = ctx.fallbackEvidence.filter(v => canonicalKey(scopeOnly(v)) === scope)
    if (a.render.kind === 'component') {
      const selected = a.render.variantId
      if (!variants.some(v => v.id === selected) || r.priority === 'asset-only' || b.type === 'visual') issues.push(`component-not-measured-for-exact-layout:${b.id}`)
    } else if (a.render.kind === 'asset') {
      if (b.type !== 'visual' || !['asset-only', 'mixed-partners'].includes(r.priority) || !ctx.visualAssets.some(v => v.blockId === b.id)) issues.push(`asset-not-allowed:${b.id}`)
    } else {
      if (b.type === 'visual' || r.priority === 'asset-only') issues.push(`visual-must-use-asset:${b.id}`)
      const componentFirst = r.priority === 'component-first' || r.priority === 'mixed-partners'
      if (componentFirst) {
        if (a.render.reason === null) issues.push(`fallback-reason-required:${b.id}`)
        if (variants.length) issues.push(`compatible-component-must-be-used:${b.id}`)
        const reason = a.render.reason
        if (!evidence.some(e => e.reason === reason && e.searchComplete)) issues.push(`fallback-not-supported-by-executor:${b.id}`)
      } else if (a.render.reason !== null) issues.push(`direct-primitive-must-have-null-reason:${b.id}`)
      if (!c.primitiveLayouts[b.id]) issues.push(`no-eligible-primitive:${b.id}`)
    }
  }
  if (issues.length) throw new RecipeError(issues)
  return { assignment, state, choices: c, requiresRenderedValidation: true }
}

/** Same full-height chrome occupancy rule as reviewed v5; empty gaps are NOT nodes. */
export function resolvePresentState(state: State, presentRegionIds: readonly string[]): State {
  const present = new Set(presentRegionIds), result = structuredClone(state)
  if ([...present].some(id => !state.regions.some(r => r.id === id))) throw new RecipeError(['unknown-present-region'])
  if (state.regions.some(r => r.minItems > 0 && !present.has(r.id))) throw new RecipeError(['required-region-absent'])
  const keep = new Set<string>(), visiting = new Set<string>(), map = new Map(result.groups.map(g => [g.id, g]))
  const prune = (id: string): boolean => {
    if (visiting.has(id)) throw new RecipeError([`group-cycle:${id}`])
    const g = map.get(id); if (!g) throw new RecipeError([`unknown-group:${id}`])
    if (keep.has(id)) return true
    visiting.add(id)
    g.children = g.children.filter(c => c.kind === 'region' ? present.has(c.id) : prune(c.id))
    g.flowSeparators = g.flowSeparators?.filter(d => g.children.some(c => c.id === d.afterId) && g.children.some(c => c.id === d.beforeId))
    visiting.delete(id)
    if (id === state.rootGroupId || g.children.length || !g.collapseEmpty) { keep.add(id); return true }
    return false
  }
  prune(result.rootGroupId)
  result.groups = result.groups.filter(g => keep.has(g.id))
  result.regions = result.regions.filter(r => present.has(r.id))
  return result
}
export type BoundNode = {
  id: string; templateId: string; kind: 'field' | 'group' | 'ornament'
  sourceRefs?: readonly string[]; typographyRole?: string; textAlign?: 'left' | 'center' | 'right'
  direction?: Direction; align?: Align; justify?: 'start' | 'center' | 'end' | 'space-between'
  gap?: Range; padding?: Insets; surfaceRole?: string; flex?: Flex; pushToEnd?: boolean
  minWidth: 0; heightMode: 'fill' | 'hug'; measureWidth?: 'available' | 'intrinsic'
  preferredWidth?: number; maxLines?: number; children?: BoundNode[]
  decorations?: (EdgeDecoration & { ownerNodeId: string })[]; ornamentRole?: string; ornamentSize?: { w: number; h: number }
}
export const walkBound = (n: BoundNode): BoundNode[] => [n, ...(n.children?.flatMap(walkBound) ?? [])]
function boundDecoration(d: EdgeDecoration, id: string, index: number, count: number): (EdgeDecoration & { ownerNodeId: string }) | null {
  if (d.when === 'not-first' && index === 0 || d.when === 'not-last' && index === count - 1) return null
  return { ...structuredClone(d), id: `${id}/${d.id}`, ownerNodeId: id }
}
function bindPrimitive(b: NormalizedBlock, r: Region, layout: PrimitiveLayout): BoundNode {
  const bind = (spec: InternalNode, fields: NormalizedBlock['fields'], prefix: string, parentDirection: Direction = 'column', index = 0, count = 1): BoundNode | null => {
    const id = `${prefix}/${spec.id}`
    const base: BoundNode = { id, templateId: spec.id, kind: spec.kind === 'repeat' ? 'group' : spec.kind,
      minWidth: 0, heightMode: spec.heightMode ?? (spec.flex?.grow ? 'fill' : 'hug'), typographyRole: spec.typographyRole,
      direction: spec.direction, align: spec.align, justify: spec.justify, gap: spec.gap ? { ...spec.gap } : undefined,
      padding: { ...ZERO, ...spec.padding }, surfaceRole: spec.surfaceRole ?? 'plain', flex: spec.flex ? { ...spec.flex } : undefined,
      pushToEnd: spec.pushToEnd, preferredWidth: spec.preferredWidth, maxLines: spec.maxLines, textAlign: spec.textAlign }
    if (spec.kind === 'field') {
      const value = fields[spec.fieldPath ?? '']
      if (value === undefined) return null
      if (!record(value) || !strs(value.sourceRefs, true)) throw new RecipeError([`field-binding-expected:${id}`])
      base.sourceRefs = [...value.sourceRefs]
      base.measureWidth = parentDirection === 'row' && !spec.flex?.grow && spec.preferredWidth === undefined ? 'intrinsic' : 'available'
      if (b.type === 'text' || b.type === 'label') {
        if (r.typographyRole) base.typographyRole = r.typographyRole
        if (r.textAlign) base.textAlign = r.textAlign
      }
    } else if (spec.kind === 'ornament') {
      base.ornamentRole = spec.ornamentRole; base.ornamentSize = spec.ornamentSize ? { ...spec.ornamentSize } : undefined
    } else if (spec.kind === 'repeat') {
      const value = fields[spec.fieldPath ?? '']
      if (value === undefined) return null
      if (!Array.isArray(value) || !spec.item || value.length < (spec.minItems ?? 0) || value.length > (spec.maxItems ?? Infinity)) throw new RecipeError([`invalid-repeat:${id}`])
      if (spec.growPerItem) base.flex = { ...base.flex, grow: value.length, shrink: base.flex?.shrink ?? 1, basis: 0 }
      const items = value.map((it, i) => bind(spec.item!, it.fields, `${id}/${i}`, spec.direction ?? 'column', i, value.length)!)
      const tail = spec.tail ? bind(spec.tail, fields, `${id}/tail`, 'column') : null
      const columns = Math.min(spec.columns ?? 1, Math.max(1, items.length))
      if (columns > 1) {
        base.direction = 'row'; base.align = 'start'
        base.children = Array.from({ length: columns }, (_, c) => {
          const q=Math.floor(items.length/columns), remainder=items.length%columns
          const from=q*c+Math.min(c,remainder), to=from+q+(c<remainder?1:0)
          const children = spec.readingOrder === 'column-major' ? items.slice(from, to) : items.filter((_, i) => i % columns === c)
          if (c === columns - 1 && tail) children.push(tail)
          return { id: `${id}/lane-${c}`, templateId: `${spec.id}-lane`, kind: 'group' as const, direction: 'column' as const,
            minWidth: 0 as const, heightMode: 'hug' as const, align: 'stretch' as const, gap: spec.gap ? { ...spec.gap } : fixed(0),
            flex: { grow: 1, shrink: 1, basis: 0 }, children }
        }).filter(lane => lane.children.length)
      } else { base.direction = spec.direction ?? 'column'; base.children = tail ? [...items, tail] : items }
      if (!base.children.length) return null
      if (base.direction === 'row') for (const child of base.children) if (!child.flex) child.flex = { grow: 1, shrink: 1, basis: 0 }
    } else {
      base.children = (spec.children ?? []).map(c => bind(c, fields, id, spec.direction ?? 'column', index, count)).filter((x): x is BoundNode => x !== null)
      if (!base.children.length) return null
      // A single child must not inherit an accidental equal-space-between policy.
      if (base.children.length === 1 && base.justify === 'space-between') base.justify = 'start'
    }
    base.decorations = (spec.decorations ?? []).map(d => boundDecoration(d, id, index, count)).filter((d): d is EdgeDecoration & { ownerNodeId: string } => d !== null)
    for (const d of base.decorations) base.padding![d.edge] = Math.max(base.padding![d.edge], d.preferredThicknessPx + d.clearancePx)
    return base
  }
  const root = bind(layout.root, b.fields, `${b.id}/${layout.id}`)
  if (!root) throw new RecipeError([`empty-primitive:${b.id}`])
  root.heightMode = layout.root.heightMode ?? 'fill'
  const refs = walkBound(root).flatMap(n => n.sourceRefs ?? [])
  if (!sameRefs(refs, b.sourceRefs)) throw new RecipeError([`primitive-loses-or-repeats-content:${b.id}`])
  return root
}
/** An unmeasured draft is NOT a permission to use a primitive fallback.
 * It breaks the bootstrap dependency: bind internal candidates before actual
 * slot dimensions, library choices or completed fallback evidence exist. */
export type DraftBlock = {
  blockId: string; regionId: string; slotIndex: number; sequenceIndex: number; emphasis: Emphasis
  block: NormalizedBlock
  componentQueryRole: string | null; componentLayouts: readonly string[]
  primitiveCandidates: { layoutId: string; root: BoundNode }[]
  asset?: { assetId: string; visualType: VisualType; fit: 'contain' | 'cover' }
}
export type MeasurementDraft = {
  kind: 'measurement-draft'; state: State; structureKey: string
  topology: Omit<ResolvedChoices, 'blockBoxes'>
  regions: { regionId: string; layout: ItemLayout; blocks: DraftBlock[] }[]
  requiresMeasurement: true; authorizesPrimitiveFallback: false
}
export function createMeasurementDraft(bundle: Bundle, stateId: string, rawStructure: unknown, input: QwenContext, choices: TopologyChoices): MeasurementDraft {
  const ctx = structuredClone(input), v = validateStructuralAssignment(bundle, rawStructure, ctx)
  if (!v.compatibleStateIds.includes(stateId)) throw new RecipeError(['state-not-compatible-with-assignment'])
  const original = bundle.states.find(s => s.id === stateId)!
  const topology = resolveTopologyChoices(bundle, original, v.assignment, ctx, choices)
  const state = resolvePresentState(original, v.assignment.assignments.map(a => a.regionId))
  const regions = state.regions.map(r => ({ regionId: r.id, layout: structuredClone(r.layouts.find(l => l.id === topology.regionLayouts[r.id])!),
    blocks: v.assignment.assignments.filter(a => a.regionId === r.id)
      .sort((a,b) => ctx.blocks.find(n => n.id === a.blockId)!.sequenceIndex - ctx.blocks.find(n => n.id === b.blockId)!.sequenceIndex)
      .map((a,slotIndex): DraftBlock => {
        const b = ctx.blocks.find(b => b.id === a.blockId)!, c = bundle.contracts[b.type]
        const requested = choices.primitiveLayouts?.[b.id]
        const candidates = eligiblePrimitiveLayouts(bundle,b,r).filter(l => requested === undefined || l.id === requested)
        const asset = ctx.visualAssets.find(x => x.blockId === b.id)
        return {blockId:b.id,regionId:r.id,slotIndex,sequenceIndex:b.sequenceIndex,emphasis:a.emphasis,block:structuredClone(b),
          componentQueryRole:c.queryRole,componentLayouts:[...c.componentLayouts],
          primitiveCandidates:candidates.map(l => ({layoutId:l.id,root:bindPrimitive(b,r,l)})),
          ...(asset?{asset:{assetId:asset.assetId,visualType:asset.visualType,fit:asset.visualType==='photo'?'cover' as const:'contain' as const}}:{})}
      }) }))
  return {kind:'measurement-draft',state,structureKey:structureKey(v.assignment),topology,regions,requiresMeasurement:true,authorizesPrimitiveFallback:false}
}

export type BoundBlockPlan = {
  blockId: string; blockKey: string; regionId: string; slotIndex: number; sequenceIndex: number; emphasis: Emphasis
  sourceRefs: readonly string[]; scope: MeasurementScope
  content:
    | { kind: 'primitive'; layoutId: string; reason: FallbackReason | null; root: BoundNode }
    | { kind: 'component'; variantId: string; componentId: string; fields: NormalizedBlock['fields']; fieldBindings: readonly ComponentFieldBinding[] }
    | { kind: 'asset'; assetId: string; visualType: VisualType; fit: 'contain' | 'cover' }
}
export type RenderPlan = {
  bundleId: string; recipeRevision: string; state: State; choices: ResolvedChoices
  regions: { regionId: string; layout: ItemLayout; blocks: BoundBlockPlan[] }[]
  structureKey: string; layoutKey: string; requiresRenderedValidation: true
}
export function createStateRenderPlan(bundle: Bundle, stateId: string, raw: unknown, input: QwenContext, choices: ExecutorChoices): RenderPlan {
  // Work on one snapshot to prevent later caller mutations from changing a plan.
  const ctx = structuredClone(input), v = validateQwenAssignment(bundle, stateId, raw, ctx, choices)
  const state = resolvePresentState(v.state, v.assignment.assignments.map(a => a.regionId))
  const regions = state.regions.map(r => {
    const layout = r.layouts.find(l => l.id === v.choices.regionLayouts[r.id])!
    const assignments = v.assignment.assignments.filter(a => a.regionId === r.id).sort((a, b) => ctx.blocks.find(x => x.id === a.blockId)!.sequenceIndex - ctx.blocks.find(x => x.id === b.blockId)!.sequenceIndex)
    const blocks = assignments.map((a, slotIndex): BoundBlockPlan => {
      const b = ctx.blocks.find(b => b.id === a.blockId)!
      let content: BoundBlockPlan['content']
      if (a.render.kind === 'component') {
        const choice = a.render.variantId, component = ctx.componentVariants.find(v => v.id === choice)!
        content = { kind: 'component', variantId: choice, componentId: component.componentId, fields: structuredClone(b.fields), fieldBindings: structuredClone(component.fieldBindings) }
      } else if (a.render.kind === 'asset') {
        const asset = ctx.visualAssets.find(v => v.blockId === b.id)!
        content = { kind: 'asset', assetId: asset.assetId, visualType: asset.visualType, fit: asset.visualType === 'photo' ? 'cover' : 'contain' }
      } else {
        const l = eligiblePrimitiveLayouts(bundle, b, r).find(l => l.id === v.choices.primitiveLayouts[b.id])!
        content = { kind: 'primitive', layoutId: l.id, reason: a.render.reason, root: bindPrimitive(b, r, l) }
      }
      return { blockId: b.id, blockKey: normalizedBlockKey(b), regionId: r.id, slotIndex, sequenceIndex: b.sequenceIndex, emphasis: a.emphasis,
        sourceRefs: [...b.sourceRefs], scope: measurementScope(bundle, v.state, v.assignment, ctx, v.choices, b.id), content }
    })
    return { regionId: r.id, layout: structuredClone(layout), blocks }
  })
  return { bundleId: bundle.id, recipeRevision: bundle.revision, state, choices: v.choices, regions,
    structureKey: structureKey(v.assignment), layoutKey: layoutKey(bundle, stateId, v.choices), requiresRenderedValidation: true }
}

/** The parser is strict at runtime; the JSON Schema is the provider grammar.
 * Semantic validation remains mandatory after shape parsing. */
export function createQwenAssignmentSchema(bundle: Bundle, ctx: QwenContext) {
  validateContext(bundle, ctx)
  const renders: unknown[] = [
    { type: 'object', additionalProperties: false, required: ['kind', 'reason'], properties: { kind: { const: 'primitive' }, reason: { enum: [null, ...FALLBACK_REASONS] } } },
    { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'asset' } } },
  ]
  if (ctx.componentVariants.length) renders.unshift({ type: 'object', additionalProperties: false, required: ['kind', 'variantId'], properties: { kind: { const: 'component' }, variantId: { enum: ctx.componentVariants.map(v => v.id) } } })
  const jsonSchema = { type: 'object', additionalProperties: false, required: ['familyId', 'modeId', 'assignments'], properties: {
    familyId: { enum: bundle.families.map(f => f.id) }, modeId: { enum: [...new Set(bundle.states.map(s => s.modeId))] },
    assignments: { type: 'array', minItems: ctx.blocks.length, maxItems: ctx.blocks.length, items: {
      type: 'object', additionalProperties: false, required: ['blockId', 'regionId', 'emphasis', 'render'], properties: {
        blockId: { enum: ctx.blocks.map(b => b.id) }, regionId: { enum: [...new Set(bundle.states.flatMap(s => s.regions.map(r => r.id)))] },
        emphasis: { enum: ['primary', 'secondary'] }, render: { oneOf: renders },
      },
    } },
  } }
  const parse = (raw: unknown): Assignment => parseStructure(bundle, raw, ctx, true) as Assignment
  const safeParse = (raw: unknown): { success: true; data: Assignment } | { success: false; error: RecipeError } => {
    try { return { success: true, data: parse(raw) } } catch (e) { return { success: false, error: e instanceof RecipeError ? e : new RecipeError([String(e)]) } }
  }
  return { jsonSchema, parse, safeParse }
}

const validRange = (r: Range) => [r.min, r.preferred, r.max].every(Number.isFinite) && r.min >= 0 && r.min <= r.preferred && r.preferred <= r.max
function checkDeco(d: EdgeDecoration, at: string, issues: string[]): void {
  if (!str(d.id) || !str(d.role) || !['top', 'bottom', 'left', 'right'].includes(d.edge) || d.placement !== 'inside-edge' || !Number.isFinite(d.preferredThicknessPx) || d.preferredThicknessPx <= 0 || !Number.isFinite(d.clearancePx) || d.clearancePx < 0) issues.push(`${at}:invalid-decoration:${d.id}`)
}
/** Fail at import time for invalid recipes, not several generations later. */
export function validateRecipeDefinition(bundle: Bundle): string[] {
  const issues: string[] = []
  if (!unique(bundle.sourceFrames) || bundle.states.length !== bundle.sourceFrames.length || !unique(bundle.states.map(s => s.sourceFrame))) issues.push('source-frame-coverage')
  if (!unique(bundle.states.map(s => s.id))) issues.push('duplicate-state-id')
  if (!unique(bundle.families.map(f => f.id))) issues.push('duplicate-family-id')
  for (const s of bundle.states) {
    if (!bundle.sourceFrames.includes(s.sourceFrame)) issues.push(`${s.id}:unknown-source-frame`)
    const f = bundle.families.find(f => f.id === s.familyId), m = f?.modes.find(m => m.id === s.modeId)
    if (!m?.stateIds.includes(s.id)) issues.push(`${s.id}:family-mode-mismatch`)
    if (s.aliasOf) {
      const a = bundle.states.find(a => a.id === s.aliasOf)
      if (!a || a.aliasOf || a.id === s.id || a.familyId !== s.familyId || a.modeId !== s.modeId) issues.push(`${s.id}:invalid-alias`)
      const shape=(v:State)=>canonicalKey({canvas:v.canvas,root:v.rootGroupId,surface:v.surfaceRole,regions:v.regions.map(({sourceNode,...rest})=>rest),groups:v.groups.map(({sourceNode,...rest})=>rest)})
      if(a&&shape(a)!==shape(s))issues.push(`${s.id}:alias-has-different-runtime-layout`)
    }
    const rids = new Set(s.regions.map(r => r.id)), gids = new Set(s.groups.map(g => g.id))
    if (rids.size !== s.regions.length || gids.size !== s.groups.length) issues.push(`${s.id}:duplicate-node-id`)
    if ([...rids].some(id => gids.has(id))) issues.push(`${s.id}:cross-kind-id-collision`)
    if (!gids.has(s.rootGroupId)) issues.push(`${s.id}:root-missing`)
    const parent = new Map<string, number>()
    for (const r of s.regions) {
      if (!validRect(r.preferredRect) || !validRange(r.size.width) || !validRange(r.size.height)) issues.push(`${s.id}:${r.id}:invalid-region-geometry`)
      if (!Number.isInteger(r.minItems) || !Number.isInteger(r.maxItems) || r.minItems < 0 || r.minItems > r.maxItems) issues.push(`${s.id}:${r.id}:invalid-counts`)
      if (r.textAlign !== undefined && !['left','center','right'].includes(r.textAlign)) issues.push(`${s.id}:${r.id}:invalid-text-alignment`)
      if (r.accepts.some(t => !bundle.contracts[t])) issues.push(`${s.id}:${r.id}:unknown-block-type`)
      if (r.priority === 'component-first' && r.accepts.includes('text')) issues.push(`${s.id}:${r.id}:component-first-allows-generic-text`)
      if (r.priority === 'asset-only' && r.accepts.some(t => t !== 'visual')) issues.push(`${s.id}:${r.id}:asset-region-type`)
      if (r.accepts.some(t => bundle.contracts[t]?.type === 'text') && !r.typographyRole) issues.push(`${s.id}:${r.id}:missing-primitive-typography`)
      if (!unique(r.layouts.map(l => l.id)) || !r.layouts.some(l => l.id === r.preferredLayoutId)) issues.push(`${s.id}:${r.id}:invalid-layout-ids`)
      for (const l of r.layouts) if (!Number.isInteger(l.columns) || l.columns < 1 || !validRange(l.gapX) || !validRange(l.gapY) || l.minItems < 1 || l.maxItems < l.minItems) issues.push(`${s.id}:${r.id}:invalid-layout:${l.id}`)
      for (let n = Math.max(1, r.minItems); n <= r.maxItems; n++) if (!r.layouts.some(l => n >= l.minItems && n <= l.maxItems)) issues.push(`${s.id}:${r.id}:unhandled-item-count:${n}`)
      for (const id of r.primitiveLayoutIds ?? []) if (!r.accepts.some(t => bundle.contracts[t]?.primitiveLayouts.some(l => l.id === id))) issues.push(`${s.id}:${r.id}:unknown-primitive-layout:${id}`)
    }
    for (const g of s.groups) {
      if (!validRect(g.preferredRect) || ![g.size.width, g.size.height, g.gap].every(validRange) || g.trailingSpace && !validRange(g.trailingSpace)) issues.push(`${s.id}:${g.id}:invalid-group-geometry`)
      if (Object.values(g.padding).some(v => !Number.isFinite(v) || v < 0)) issues.push(`${s.id}:${g.id}:invalid-padding`)
      for (const d of g.flowSeparators ?? []) {
        const i = g.children.findIndex(c => c.id === d.afterId)
        if (i < 0 || g.children[i+1]?.id !== d.beforeId || !str(d.role) || ![d.width, d.height, d.gap].every(Number.isFinite) || d.width <= 0 || d.height <= 0 || d.gap < 0) issues.push(`${s.id}:${g.id}:invalid-flow-separator`)
      }
      for (const d of g.decorations) checkDeco(d, `${s.id}:${g.id}`, issues)
      if (!unique(g.decorations.map(d => d.id))) issues.push(`${s.id}:${g.id}:duplicate-decoration`)
      for (const c of g.children) {
        const key = `${c.kind}:${c.id}`; parent.set(key, (parent.get(key) ?? 0) + 1)
        if (!(c.kind === 'region' ? rids : gids).has(c.id)) issues.push(`${s.id}:${g.id}:unknown-child:${key}`)
        if (c.gapBefore && !validRange(c.gapBefore) || c.marginBeforeCrossPx !== undefined && (!Number.isFinite(c.marginBeforeCrossPx) || c.marginBeforeCrossPx < 0)) issues.push(`${s.id}:${g.id}:invalid-child-gap`)
      }
    }
    for (const [kind, ids] of [['region', rids], ['group', gids]] as const) for (const id of ids) if ((parent.get(`${kind}:${id}`) ?? 0) !== (id === s.rootGroupId && kind === 'group' ? 0 : 1)) issues.push(`${s.id}:${kind}:${id}:parent-count`)
    const seen = new Set<string>(), active = new Set<string>()
    const visit = (id: string) => {
      if (active.has(id)) { issues.push(`${s.id}:cycle:${id}`); return }
      if (seen.has(id)) return
      seen.add(id); active.add(id)
      for (const c of s.groups.find(g => g.id === id)?.children ?? []) if (c.kind === 'group') visit(c.id)
      active.delete(id)
    }
    visit(s.rootGroupId)
    for (const id of gids) if (!seen.has(id)) issues.push(`${s.id}:unreachable:${id}`)
  }
  for (const f of bundle.families) for (const m of f.modes) for (const id of m.stateIds) if (!bundle.states.some(s => s.id === id && s.familyId === f.id && s.modeId === m.id)) issues.push(`orphan-mode-state:${id}`)
  for (const contract of Object.values(bundle.contracts)) {
    if (contract.type !== 'visual' && !contract.primitiveLayouts.length) issues.push(`${contract.type}:missing-primitive`)
    if (!unique(contract.primitiveLayouts.map(l => l.id))) issues.push(`${contract.type}:duplicate-layout-id`)
    for (const l of contract.primitiveLayouts) {
      const ids = new Set<string>(), coverage = new Map<string, number>()
      const scan = (n: InternalNode, fields: Readonly<Record<string, FieldContract>>, prefix: string) => {
        if (!str(n.id) || ids.has(n.id)) issues.push(`${contract.type}:${l.id}:duplicate-node:${n.id}`)
        ids.add(n.id)
        if (n.growPerItem !== undefined && (typeof n.growPerItem !== 'boolean' || n.kind !== 'repeat')) issues.push(`${contract.type}:${l.id}:invalid-grow-per-item`)
        if (n.gap && !validRange(n.gap)) issues.push(`${contract.type}:${l.id}:invalid-gap`)
        if (n.padding && Object.values(n.padding).some(v => !Number.isFinite(v) || v < 0)) issues.push(`${contract.type}:${l.id}:invalid-padding`)
        if (n.preferredWidth !== undefined && (!Number.isFinite(n.preferredWidth) || n.preferredWidth <= 0)) issues.push(`${contract.type}:${l.id}:invalid-width`)
        for (const d of n.decorations ?? []) checkDeco(d, `${contract.type}:${l.id}:${n.id}`, issues)
        if (!unique((n.decorations ?? []).map(d => d.id))) issues.push(`${contract.type}:${l.id}:${n.id}:duplicate-decoration`)
        if (n.kind === 'field') {
          const spec = fields[n.fieldPath ?? ''], p = `${prefix}${n.fieldPath}`
          if (!spec || spec.kind !== 'single') issues.push(`${contract.type}:${l.id}:invalid-field:${p}`)
          if (!n.typographyRole) issues.push(`${contract.type}:${l.id}:missing-typography:${p}`)
          coverage.set(p, (coverage.get(p) ?? 0) + 1)
        } else if (n.kind === 'repeat') {
          const spec = fields[n.fieldPath ?? '']
          if (!spec || spec.kind !== 'list' || !n.item) { issues.push(`${contract.type}:${l.id}:invalid-repeat`); return }
          if (n.minItems === undefined || n.maxItems === undefined || n.minItems < spec.minItems || n.maxItems > spec.maxItems || n.minItems > n.maxItems) issues.push(`${contract.type}:${l.id}:repeat-counts`)
          const inner = Object.fromEntries(Object.entries(spec.itemFields).map(([k, v]) => [k, { kind: 'single' as const, required: v.required }]))
          scan(n.item, inner, `${prefix}${n.fieldPath}[].`)
          if (n.tail) scan(n.tail, fields, prefix)
        } else if (n.kind === 'group') {
          if (!n.direction || !n.children?.length) issues.push(`${contract.type}:${l.id}:empty-group`)
          for (const c of n.children ?? []) scan(c, fields, prefix)
        } else if (n.kind === 'ornament' && (!str(n.ornamentRole) || !n.ornamentSize || !Number.isFinite(n.ornamentSize.w) || n.ornamentSize.w <= 0 || !Number.isFinite(n.ornamentSize.h) || n.ornamentSize.h <= 0)) issues.push(`${contract.type}:${l.id}:invalid-ornament`)
      }
      scan(l.root, contract.fields, '')
      for (const [f, spec] of Object.entries(contract.fields)) {
        const paths = spec.kind === 'list' ? Object.keys(spec.itemFields).map(k => `${f}[].${k}`) : spec.kind === 'single' ? [f] : []
        for (const p of paths) if (coverage.get(p) !== 1) issues.push(`${contract.type}:${l.id}:field-coverage:${p}`)
      }
    }
  }
  return issues
}

/** Translate presence-resolved relationships into spacer/child flex instructions.
 * Original x/y are references only. Every spacer belongs to its two live neighbours.
 * Resizing a title consumes these gaps and sibling flex ranges; no absolute shift. */
export type Flow = { id: string; kind: 'group' | 'region' | 'gap' | 'ornament'; ornament?: FlowSeparator; group?: Group; region?: Region; childPolicy?: ChildRef; range?: Range; children?: Flow[] }
export function compileFlowTree(state: State): Flow {
  const build = (id: string): Flow => {
    const g = state.groups.find(g => g.id === id); if (!g) throw new RecipeError([`flow:unknown-group:${id}`])
    const children: Flow[] = []
    g.children.forEach((c, i) => {
      if (i > 0) {
        const separator = g.flowSeparators?.find(d => d.afterId === g.children[i - 1].id && d.beforeId === c.id)
        if (separator) {
          children.push({ id: `${id}:${separator.id}:before`, kind: 'gap', range: fixed(separator.gap) },
            { id: `${id}:${separator.id}`, kind: 'ornament', ornament: structuredClone(separator) },
            { id: `${id}:${separator.id}:after`, kind: 'gap', range: fixed(separator.gap) })
        } else children.push({ id: `${id}:gap:${g.children[i - 1].id}:${c.id}`, kind: 'gap', range: { ...(c.gapBefore ?? g.gap) } })
      }
      if (c.kind === 'group') children.push({ ...build(c.id), childPolicy: structuredClone(c) })
      else children.push({ id: c.id, kind: 'region', region: structuredClone(state.regions.find(r => r.id === c.id)!), childPolicy: structuredClone(c) })
    })
    if (g.trailingSpace && g.children.length) children.push({ id: `${id}:trailing-space`, kind: 'gap', range: { ...g.trailingSpace } })
    return { id, kind: 'group', group: structuredClone(g), children }
  }
  return build(state.rootGroupId)
}

/** Deterministic bounded allocator for one already-measured flex axis.
 * Sizes may stay at their authored off-grid preferred values; adapted dimensions
 * are grid values. Space not allocated to boxes is returned for elastic gaps.
 * Does not guess text measurements or claim a two-dimensional rendered fit. */
export function allocateAxis(available: number, items: readonly { id: string; bounds: Range; requested: number; shrinkPriority: number; growPriority: number }[]): { sizes: Record<string, number>; slack: number } {
  if (!Number.isFinite(available) || available < 0 || !unique(items.map(i => i.id))) throw new RecipeError(['invalid-axis-input'])
  for (const i of items) if (!validRange(i.bounds) || !Number.isFinite(i.requested) || !Number.isFinite(i.shrinkPriority) || !Number.isFinite(i.growPriority)) throw new RecipeError(['invalid-axis-item'])
  const sizes = Object.fromEntries(items.map(i => [i.id, i.requested === i.bounds.preferred ? i.requested : fitDimension(i.requested, i.bounds)]))
  const sum = () => Object.values(sizes).reduce((a, b) => a + b, 0)
  let excess = sum() - available
  if (excess > 1e-6) for (const i of [...items].sort((a, b) => a.shrinkPriority - b.shrinkPriority)) {
    const target = sizes[i.id] - excess
    const n = Math.max(Math.ceil(i.bounds.min / 4) * 4, Math.floor(target / 4) * 4)
    if (n <= sizes[i.id] && n <= i.bounds.max) sizes[i.id] = n
    excess = sum() - available
    if (excess <= 1e-6) break
  }
  if (excess > 1e-6) throw new RecipeError(['axis-does-not-fit'])
  return { sizes, slack: available - sum() }
}


// ===== builders.ts =====
export const B = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })
export const P = (top = 0, right = 0, bottom = 0, left = 0): Insets => ({ top, right, bottom, left })
export const edge = (id: string, e: EdgeDecoration['edge'], clearancePx = 0, preferredThicknessPx = 2, when: EdgeDecoration['when'] = 'always'): EdgeDecoration => ({
  id, edge: e, role: 'editorial-divider', preferredThicknessPx, clearancePx, placement: 'inside-edge', when,
})
export const one: ItemLayout = { id: 'single', columns: 1, minItems: 1, maxItems: 1, gapX: fixed(0), gapY: fixed(0), align: 'start', readingOrder: 'row-major', trackBasis: 'resolved-topology' }
export function columns(max: number, preferred: number, gap = 24, align: ItemLayout['align'] = 'start', extra: Partial<ItemLayout> = {}): ItemLayout[] {
  const list = [preferred, ...Array.from({ length: max }, (_, i) => i + 1).filter(n => n !== preferred)]
  return list.map(n => ({ ...one, id: `columns-${n}`, columns: n, minItems: n, maxItems: max,
    gapX: fixed(n > 1 ? gap : 0), gapY: fixed(gap), align, readingOrder: 'row-major', ...extra,
    // Positional gutters/weights belong only to the authored horizontal topology.
    ...(n === preferred ? {} : { itemPadding: undefined, preferredWeights: undefined }),
  }))
}
export function R(id: string, role: string, node: string | undefined, rect: Rect, type = 'text', min = 1, max = 1, opts: Partial<Region> = {}): Region {
  return { id, role, sourceNode: node, preferredRect: rect, size: { width: scale30(rect.w), height: scale30(rect.h) }, accepts: [type],
    minItems: min, maxItems: max, priority: type === 'text' ? 'primitive-first' : type === 'visual' ? 'asset-only' : 'component-first',
    typographyRole: type === 'text' ? role : undefined, textAlign: ['header-right','footer-right','format','page','version'].includes(role)?'right':undefined, emphasis: role === 'title' ? ['primary'] : ['secondary'], maxPrimaryItems: role === 'title' ? 1 : 0,
    layouts: [one], preferredLayoutId: 'single', ...opts }
}
export const C = (id: string, opts: Omit<ChildRef, 'kind' | 'id'> = {}): ChildRef => ({ kind: 'region', id, ...opts })
export const CG = (id: string, opts: Omit<ChildRef, 'kind' | 'id'> = {}): ChildRef => ({ kind: 'group', id, ...opts })
export function G(id: string, rect: Rect, direction: Group['direction'], children: readonly ChildRef[], opts: Partial<Group> = {}): Group {
  return { id, preferredRect: rect, size: { width: scale30(rect.w), height: scale30(rect.h) }, direction, align: 'start', justify: 'start',
    gap: fixed(0), padding: { ...ZERO }, surfaceRole: 'plain', children, decorations: [], collapseEmpty: true, ...opts }
}
export function root(rect: Rect, children: readonly ChildRef[], opts: Partial<Group> = {}): Group {
  return G('slide-root', rect, 'column', children, { size: { width: fixed(rect.w), height: fixed(rect.h) }, align: 'stretch', collapseEmpty: false, ...opts })
}
export function S(id: string, familyId: string, modeId: string, sourceFrame: string, regions: Region[], groups: Group[], adaptationNotes: string[] = [], surfaceRole = 'slide'): State {
  return { id, familyId, modeId, sourceFrame, canvas: { width: 1920, height: 1080 }, rootGroupId: 'slide-root', regions, groups, surfaceRole, adaptationNotes }
}
export const F = (id: string, fieldPath: string, typographyRole: string, extra: Partial<InternalNode> = {}): InternalNode => ({ id, kind: 'field', fieldPath, typographyRole, ...extra })
export const IG = (id: string, children: InternalNode[], extra: Partial<InternalNode> = {}): InternalNode => ({ id, kind: 'group', direction: 'column', align: 'stretch', justify: 'start', gap: fixed(0), padding: P(), surfaceRole: 'plain', children, ...extra })
export const RP = (id: string, path: string, min: number, max: number, item: InternalNode, extra: Partial<InternalNode> = {}): InternalNode => ({ id, kind: 'repeat', fieldPath: path, minItems: min, maxItems: max, direction: 'column', item, gap: fixed(0), ...extra })
export const single = (required = true) => ({ kind: 'single' as const, required })
export const list = (min: number, max: number, itemFields: Record<string, { required: boolean }>, required = true) => ({ kind: 'list' as const, required, minItems: min, maxItems: max, itemFields })
export const req = { required: true }, opt = { required: false }
export const PL = (id: string, n: InternalNode, extra: Partial<PrimitiveLayout> = {}): PrimitiveLayout => ({ id, root: n, ...extra })
export const BC = (type: string, fields: BlockContract['fields'], layouts: PrimitiveLayout[], queryRole: string | null = type, componentLayouts: string[] = layouts.map(l => l.id)): BlockContract => ({ type, fields, queryRole, componentLayouts, primitiveLayouts: layouts })

/** Full row occupancy + stable right anchoring, including a right-only row. */
export function plainHeader(leftNode: string, rightNode: string, leftWidth = 380, rightWidth = 364, x = 46, w = 1828) {
  return {
    regions: [R('header-left', 'header-left', leftNode, B(x, 44, leftWidth, 27), 'text', 0),
      R('header-right', 'header-right', rightNode, B(x + w - rightWidth, 44, rightWidth, 27), 'text', 0)],
    group: G('header-row', B(x, 44, w, 62), 'row', [C('header-left'), C('header-right', { pushToEnd: true })], {
      size: { width: fixed(w), height: range(44, 62, 80) }, gap: fixed(24), padding: P(0, 0, 35), decorations: [edge('header-line', 'bottom')],
    }),
  }
}
export function footer(leftNode?: string, rightNode?: string, y = 994, leftW = 680, rightW = 364, h = 27, rightH = 27, lineGap = 24, x = 46, w = 1828) {
  const regions = [
    ...(leftNode ? [R('footer', 'footer', leftNode, B(x, y, leftW, h), 'text', 0)] : []),
    ...(rightNode ? [R('footer-right', 'footer-right', rightNode, B(x + w - rightW, y, rightW, rightH), 'text', 0)] : []),
  ]
  return { regions, group: G('footer-row', B(x, y - lineGap - 2, w, Math.max(h, rightH) + lineGap + 2), 'row', [
    ...(leftNode ? [C('footer')] : []), ...(rightNode ? [C('footer-right', { pushToEnd: true })] : []),
  ], { align: 'start', gap: fixed(24), padding: P(lineGap + 2), decorations: [edge('footer-line', 'top')] }) }
}
/** Compact chrome used by the last authored content frames. */
export function editorialChrome(ids: { context: string; year: string; format: string; footer: string; page: string }, formatW: number, pageW = 69) {
  return {
    regions: [R('context', 'context', ids.context, B(46, 56.5, 197, 29), 'text', 0),
      R('year', 'year', ids.year, B(393, 56.5, 59, 29), 'text', 0),
      R('format', 'format', ids.format, B(1874 - formatW, 56.5, formatW, 29), 'text', 0),
      R('footer', 'footer', ids.footer, B(46, 1019, 530, 27), 'text', 0),
      R('page', 'page', ids.page, B(1874 - pageW, 1019, pageW, 27), 'text', 0)],
    groups: [G('header-row', B(46, 44, 1828, 54), 'row', [CG('context-year'), C('format', { pushToEnd: true })], { align: 'center', gap: fixed(16), size: { width: fixed(1828), height: fixed(54) } }),
      G('context-year', B(46, 56.5, 406, 29), 'row', [C('context'), C('year')], { align: 'center', gap: fixed(16), flowSeparators: [{ id: 'context-rule', afterId: 'context', beforeId: 'year', role: 'context-separator', width: 118, height: 2, gap: 16 }] }),
      G('footer-row', B(46, 1012, 1828, 34), 'row', [C('footer'), C('page', { pushToEnd: true })], { align: 'end', gap: fixed(24), size: { width: fixed(1828), height: fixed(34) } })],
  }
}
/** Inferred vertical flow from authored bands. Positive distances become elastic
 * neighbour gaps; no absolute child coordinate is emitted at runtime. */
export function stack(rect: Rect, children: ChildRef[], bands: Record<string, Rect>, extra: Partial<Group> = {}): Group {
  const refs = children.map((item,i) => {
    const dx=Math.max(0,(bands[item.id]?.x??rect.x)-rect.x)
    const c={...item,...(dx?{marginBeforeCrossPx:dx}:{})}
    if (!i) return c
    const prev = bands[children[i-1].id], next = bands[c.id]
    if (!prev || !next) throw Error('Missing authored band')
    const gap = Math.max(0, next.y - prev.y - prev.h)
    return { ...c, gapBefore: c.gapBefore ?? range(Math.min(gap,24),gap,Math.max(gap, gap*1.3)) }
  })
  const last = bands[children.at(-1)?.id ?? '']
  const tail = last ? Math.max(0,rect.y+rect.h-last.y-last.h) : 0
  const first=bands[children[0]?.id??'']
  return root(rect, refs, { padding:P(Math.max(0,(first?.y??rect.y)-rect.y)),trailingSpace:range(0,tail,Math.max(tail,32)), ...extra })
}


// ===== contracts.ts =====
/** Content-agnostic internal mini-recipes. No example strings/assets are stored. */

const flexEqual={grow:1,shrink:1,basis:0} as const
const fld=(name:string,role=name):InternalNode=>F(name,name,role)
const ornament=(id:string,role:string,w:number,h:number):InternalNode=>({id,kind:'ornament',ornamentRole:role,ornamentSize:{w,h}})
const moduleFields={label:single(false),heading:single(),body:single(),extra:single(false),source:single(false)}
const moduleVariants=[10,14,16,18,20].map(gap=>PL(`module-${gap}`,IG('module',[fld('label','eyebrow'),fld('heading','section-title'),fld('body','body'),fld('extra','body'),fld('source','source')],{gap:fixed(gap),heightMode:'hug'})))
const numberedFields={marker:single(false),heading:single(),body:single()}
const numberedTop=PL('numbered-top',IG('item',[fld('marker','list-marker'),fld('heading','item-title'),fld('body','body-small')],{padding:P(12),gap:fixed(8),decorations:[edge('rule','top',0,1)]}))
const numberedRow=(id:string,markerWidth:number,gap:number,pad:number,bodyGap:number)=>PL(id,IG('item',[
 F('marker','marker','list-marker',{preferredWidth:markerWidth}),IG('description',[fld('heading','item-title'),fld('body','body-small')],{gap:fixed(bodyGap),flex:flexEqual}),
],{direction:'row',gap:fixed(gap),align:'start',padding:P(pad,0,pad),decorations:[edge('rule','top',0,1)]}))
const metricFields={value:single(),caption:single(),note:single(false)}
const metricNodes=()=>[fld('value','metric-value'),fld('caption','metric-caption'),fld('note','note')]
const quoteFields={label:single(false),quote:single(),author:single(false)}
const plainQuote=()=>[fld('quote','quote'),fld('author','quote-author')]
const tableCell=(id:string,path:string,role:string,weight:number,padding:number)=>IG(id,[F(id+'-value',path,role)],{flex:{grow:weight,shrink:1,basis:0},padding:P(padding,padding,padding,padding),justify:'center'})
/** Both header and body use the SAME four weights. No arbitrary column reflow. */
function tableContract(type:string,weights:number[],compact:boolean):BlockContract {
 const fields={h1:single(),h2:single(),h3:single(),h4:single(),rows:list(1,4,{c1:req,c2:req,c3:req,c4:req})}
 const cells=(header:boolean)=>weights.map((w,i)=>{
  const cell=tableCell(`${header?'h':'c'}-${i}`,`${header?'h':'c'}${i+1}`,header?'table-header':i===0?'table-key':'table-body',w,compact?0:16)
  if(!compact&&i>0)cell.decorations=[edge('column-rule','left',0,1)]
  return cell
 })
 const row=IG('data-row',cells(false),{direction:'row',align:'stretch',padding:compact?P(16,16,16,16):P(),flex:flexEqual,decorations:[edge('row-rule','top',0,1)]})
 const header=IG('header-row',cells(true),{direction:'row',align:'stretch',surfaceRole:'table-header',padding:compact?P(12,16,12,16):P(),...(compact?{}:{flex:flexEqual})})
 const rows=RP('rows','rows',1,4,row,{flex:{grow:1,shrink:1,basis:0},growPerItem:!compact,heightMode:'fill'})
 return BC(type,fields,[PL(type,IG('table',[header,rows],{align:'stretch',surfaceRole:'table',decorations:(['top','right','bottom','left'] as const).map(e=>edge('outline-'+e,e,0,1))}))], 'table', ['table-four-columns'])
}
const sourceList=(id:string,max:number,gap:number)=>RP(id,'items',1,max,IG('source-item',[fld('text','source')]),{gap:fixed(gap)})
const bullet=(id='bullet')=>IG(id,[F('marker','marker','list-marker',{preferredWidth:56}),F('text','text','body',{flex:flexEqual})],{direction:'row',gap:fixed(18)})

export const contracts:Readonly<Record<string,BlockContract>>={
 text:BC('text',{text:single()},[PL('text',IG('root',[fld('text','body')]))],null),
 label:BC('label',{text:single()},[PL('label',IG('root',[fld('text','tag')],{padding:P(12,24,12,24),surfaceRole:'tag'}))]),
 module:BC('module',moduleFields,moduleVariants),
 'editorial-column':BC('editorial-column',{index:single(false),heading:single(),body:single(),note:single(false)},[PL('editorial-column',IG('column',[fld('index','index'),fld('heading','section-title'),fld('body','body'),fld('note','note')],{gap:fixed(14)}))]),
 'margin-note':BC('margin-note',{label:single(false),body:single(),source:single(false)},[PL('margin-note',IG('margin',[fld('label','eyebrow'),fld('body','note'),fld('source','source')],{justify:'space-between',gap:fixed(16)}))]),
 'quote-strip':BC('quote-strip',{quote:single()},[PL('quote-strip',IG('quote-strip',[ornament('quotation-sign','quotation-mark',19,58),F('quote','quote','quote',{flex:flexEqual})],{direction:'row',gap:fixed(24),padding:P(16,20,16,20),surfaceRole:'quote-panel'}))]),
 'quote-banner':BC('quote-banner',{quote:single(),author:single(false)},[PL('quote-banner',IG('quote-banner',[F('quote','quote','quote',{flex:{grow:1280,shrink:1,basis:0}}),F('author','author','quote-author',{flex:{grow:442,shrink:1,basis:0}})],{direction:'row',gap:fixed(50),align:'center',padding:P(22,28,22,28),surfaceRole:'quote-panel'}))]),
 'quote-panel':BC('quote-panel',quoteFields,[PL('quote-panel',IG('quote-panel',[fld('label','eyebrow'),...plainQuote()],{justify:'space-between',gap:fixed(24),padding:P(32,32,32,32),surfaceRole:'quote-panel'}))]),
 'feature-module':BC('feature-module',{label:single(false),lead:single(),body:single(),source:single(false)},[PL('feature-module',IG('feature',[fld('label','eyebrow'),fld('lead','lead'),fld('body','body'),fld('source','source')],{gap:fixed(16),padding:P(24,24,24,24),surfaceRole:'feature-panel'}))]),
 'tier':BC('tier',{label:single(),body:single()},[PL('tier',IG('tier',[F('label','label','eyebrow',{flex:flexEqual}),F('body','body','body',{flex:flexEqual})],{direction:'row',gap:fixed(34),padding:P(20,0,20),decorations:[edge('tier-rule','top',0,1)]}))]),
 metric:BC('metric',metricFields,[PL('metric-dense',IG('metric',metricNodes(),{gap:fixed(7)})),PL('metric-normal',IG('metric',metricNodes(),{gap:fixed(18)}))]),
 'callout-fact':BC('callout-fact',{label:single(false),value:single(),caption:single()},[PL('callout-fact',IG('fact',[fld('label','eyebrow'),fld('value','fact-value'),fld('caption','note')],{gap:fixed(8),padding:P(22,22,22,22),surfaceRole:'fact-panel'}))]),
 'hero-fact':BC('hero-fact',{label:single(false),value:single(),caption:single(),source:single(false)},[PL('hero-fact',IG('fact',[fld('label','eyebrow'),fld('value','hero-value'),fld('caption','fact-caption'),fld('source','source')],{gap:fixed(16)}))]),
 'numbered-item':BC('numbered-item',numberedFields,[numberedTop,numberedRow('numbered-row-54',54,18,12,5),numberedRow('numbered-row-48',48,18,14,7)]),
 'matrix-cell':BC('matrix-cell',{index:single(false),heading:single(),signal:single(),action:single()},[PL('matrix-cell',IG('cell',[fld('index','index'),fld('heading','section-title'),fld('signal','body-small'),fld('action','body-small')],{padding:P(20,20,20,20),gap:fixed(10),surfaceRole:'matrix-cell',decorations:(['top','right','bottom','left'] as const).map(e=>edge(e,e,0,1))}))]),
 'source-list':BC('source-list',{label:single(false),heading:single(),items:list(1,5,{text:req})},[PL('source-list',IG('sources',[fld('label','eyebrow'),fld('heading','title-small'),sourceList('items',5,16)],{gap:fixed(16)}))]),
 'conclusion-panel':BC('conclusion-panel',{label:single(false),title:single(),body:single(),source:single(false)},[PL('conclusion-panel',IG('panel',[fld('label','eyebrow'),fld('title','title'),fld('body','body'),fld('source','source')],{gap:fixed(20),justify:'space-between',padding:P(28,28,28,28),surfaceRole:'conclusion-panel'}))]),
 'step-card':BC('step-card',{marker:single(),heading:single(),body:single()},[PL('step-card',IG('step',[fld('marker','step-marker'),fld('heading','item-title'),fld('body','note')],{gap:fixed(12),padding:P(18,18,18,18),surfaceRole:'step-card',decorations:(['top','right','bottom','left'] as const).map(e=>edge(e,e,0,1))}))]),
 'timeline-event':BC('timeline-event',{time:single(),heading:single(),body:single()},[PL('timeline-event',IG('event',[fld('time','time'),fld('heading','section-title'),fld('body','body-small'),ornament('timeline-tick','timeline-tick',60,87)],{gap:fixed(18)}))]),
 'argument-pillar':BC('argument-pillar',{label:single(),items:list(3,3,{marker:opt,text:req})},[PL('argument-pillar',IG('pillar',[fld('label','eyebrow'),RP('items','items',3,3,IG('item',[fld('marker','list-marker'),F('text','text','item-title',{flex:flexEqual})],{direction:'row',gap:fixed(16),padding:P(14),flex:flexEqual,decorations:[edge('rule','top',0,1)]}),{gap:fixed(18),flex:flexEqual,heightMode:'fill'})],{padding:P(24,24,24,24),gap:fixed(18),surfaceRole:'argument-panel'}))]),
 'exceptions':BC('exceptions',{label:single(false),heading:single(),items:list(1,6,{text:req}),source:single(false)},[PL('exceptions',IG('exceptions',[fld('label','eyebrow'),fld('heading','section-title'),RP('items','items',1,6,IG('item',[fld('text','body-small')]),{gap:fixed(18)}),fld('source','source')],{gap:fixed(18),padding:P(26,26,26,26),surfaceRole:'exceptions-panel'}))]),
 'faq':BC('faq',{marker:single(false),question:single(),answer:single()},[PL('faq',IG('faq',[IG('question-row',[F('marker','marker','index',{preferredWidth:36}),F('question','question','question',{flex:flexEqual})],{direction:'row',gap:fixed(16)}),fld('answer','answer')],{gap:fixed(8),padding:P(16,16,16,16),surfaceRole:'faq-panel',decorations:(['top','right','bottom','left'] as const).map(e=>edge(e,e,0,1))}))]),
 'next-step':BC('next-step',{label:single(false),body:single()},[PL('next-step',IG('next-step',[F('label','label','eyebrow',{flex:flexEqual}),F('body','body','lead',{flex:flexEqual})],{direction:'row',gap:fixed(30),align:'center',padding:P(20,20,20,20),surfaceRole:'next-step'}))]),
 'evidence-table':tableContract('evidence-table',[1,1,1,1],true),
 'comparison-table':tableContract('comparison-table',[280,516,516,516],false),
 'wide-fact':BC('wide-fact',{value:single(),caption:single(),body:single()},[PL('wide-fact',IG('fact',[F('value','value','hero-value',{flex:{grow:1056,shrink:1,basis:0}}),IG('explanation',[fld('caption','fact-caption'),fld('body','body')],{gap:fixed(24),padding:P(0,0,10),flex:{grow:748,shrink:1,basis:0}})],{direction:'row',align:'end',gap:fixed(24)}))]),
 'metric-orientation':BC('metric-orientation',{index:single(false),heading:single(),value:single(),unit:single(),body:single()},[PL('metric-orientation',IG('orientation',[fld('index','index'),fld('heading','section-title'),IG('value-unit',[fld('value','metric-value'),fld('unit','metric-unit')]),IG('bottom',[fld('body','body')],{flex:flexEqual,justify:'end'})],{gap:fixed(22),padding:P(28,28,28,28)}))]),
 'approach':BC('approach',{index:single(false),heading:single(),body:single(),items:list(1,3,{marker:opt,text:req})},[PL('approach',IG('approach',[IG('heading-group',[fld('index','index'),fld('heading','section-title')],{gap:fixed(12)}),IG('body-group',[fld('body','body')],{padding:P(28),decorations:[edge('rule','top',0,2)]}),RP('items','items',1,3,bullet(),{gap:fixed(20)})],{gap:fixed(26),padding:P(34,34,34,34),surfaceRole:'comparison-panel'}))]),
 'thesis-list':BC('thesis-list',{items:list(1,7,{marker:opt,text:req}),conclusion:single(false)},[2,1].map(n=>PL(`theses-${n}-columns`,RP('items','items',1,7,bullet(),{columns:n,readingOrder:'column-major',gap:fixed(30),tail:IG('conclusion-panel',[fld('conclusion','callout')],{surfaceRole:'callout',padding:P(24,24,24,24)})})))),
 'passport':BC('passport',{kind:single(false),title:single(),update:single(false)},[PL('passport',IG('passport',[fld('kind','eyebrow'),fld('title','title'),fld('update','support')],{gap:fixed(28)}))]),
 'toc-item':BC('toc-item',{marker:single(false),title:single(),note:single(false)},[PL('toc-item',IG('toc-item',[F('marker','marker','index',{preferredWidth:60}),F('title','title','toc-title',{flex:flexEqual}),F('note','note','note',{preferredWidth:210,textAlign:'right'})],{direction:'row',gap:fixed(24),align:'center',padding:P(18,0,18),decorations:[edge('rule','top',0,1)]}))]),
 'cover-quote':BC('cover-quote',{quote:single(),author:single(false),context:single(false)},[PL('cover-quote',IG('quote-envelope',[ornament('quotation-sign','quotation-mark',250,200),IG('quote-column',[fld('quote','quote-display'),IG('credits',[F('author','author','quote-author',{flex:{grow:650,shrink:1,basis:0}}),F('context','context','note',{flex:{grow:670,shrink:1,basis:0},textAlign:'right'})],{direction:'row',gap:fixed(190),align:'center',pushToEnd:true,padding:P(30),decorations:[edge('rule','top',0,2)]})],{gap:fixed(32),padding:P(50),flex:flexEqual,heightMode:'fill'})],{direction:'row',gap:fixed(14),align:'stretch'}))]),
 visual:BC('visual',{assetRef:single(),visualType:{kind:'visual-type',required:true}},[],null),
}


// ===== dense.ts =====
export const DENSE_FRAMES=['44:2259','44:2293','44:2326','44:2365','44:2396','44:2425','44:2467','44:2520','44:2566','44:2607','44:2655','44:2720','44:2762','44:2820','44:2864','44:2913','44:2976','44:3037','44:3118','44:3153','44:3197','44:3245','44:3306','44:3350'] as const
const footerIds=[2290,2323,2362,2393,2422,2464,2517,2563,2604,2652,2717,2759,2817,2861,2910,2973,3034,3115,3150,3194,3242,3303,3347,3388]
const pageWidths=[54,56,56,57,56,56,55,56,56,54,50,53,53,53,53,53,52,53,53,56,53,55,55,55]
export const A=(x:number,y:number,w:number,h:number):Rect=>B(46+x,111+y,w,h)
export const grow={grow:1,shrink:1,growPriority:2,shrinkPriority:1} as const
export const rowC=(id:string):ChildRef=>C(id,{flex:grow})
export const rowG=(id:string):ChildRef=>CG(id,{flex:grow})
/** Topological column variants are executor-owned. Reference cell widths are not
 * stretched to fit fewer columns; the new tracks are solved before measurement. */
export function itemLayouts(max:number,preferred:number,gapX:number,gapY:number,opts:Partial<ItemLayout>={}):ItemLayout[]{
 return columns(max,preferred,gapX,opts.align??'start',opts).filter(l=>l.columns<=preferred).map(l=>({...l,gapY:fixed(gapY)}))
}
export function denseColumnSlots(n:number,pad=24):Partial<ItemLayout>{
 return {itemPadding:{first:P(0,pad),middle:P(0,pad,0,pad),last:P(0,pad,0,pad)},betweenItemsRole:'column-divider',preferredWeights:Array.from({length:n},(_,i)=>i?1:1)}
}
/** Shared chrome is a hierarchy, never optional absolute fragments.
 * An empty source caption cannot free the footer while page is still present. */
export class DenseBuilder{
 readonly regions:Region[]=[]
 readonly groups:Group[]=[]
 readonly sourceFrame:string
 readonly ordinal:number
 constructor(ordinal:number,readonly id:string,readonly familyId:string){
  this.ordinal=ordinal;this.sourceFrame=DENSE_FRAMES[ordinal-1]
  if(!this.sourceFrame)throw Error('Unknown dense frame')
 }
 text(id:string,node:number,rect:Rect,role=id,optional=false){
  this.regions.push(R(id,id,`44:${node}`,rect,'text',optional?0:1,1,{typographyRole:role}));return id
 }
 block(id:string,node:number,rect:Rect,type:string,opts:Partial<Region>={}){
  this.regions.push(R(id,id,`44:${node}`,rect,type,1,1,opts));return id
 }
 items(id:string,node:number,rect:Rect,type:string,count:number,prefColumns:number,gapX:number,gapY:number,opts:Partial<Region>={},layoutOpts:Partial<ItemLayout>={}){
  const layouts=itemLayouts(count,prefColumns,gapX,gapY,layoutOpts)
  this.regions.push(R(id,id,`44:${node}`,rect,type,1,count,{layouts,preferredLayoutId:`columns-${prefColumns}`,...opts}));return id
 }
 g(id:string,rect:Rect,direction:Group['direction'],children:ChildRef[],opts:Partial<Group>={}){
  this.groups.push(G(id,rect,direction,children,opts));return id
 }
 /** A rule belongs to the following owner, and its clearance is reserved there.
  * The parent's ordinary gap precedes the rule; padding follows it. */
 ruleGroup(id:string,rect:Rect,children:ChildRef[],clearance=18,opts:Partial<Group>={}){
  return this.g(id,rect,'column',children,{padding:P(clearance+1),decorations:[edge(id+'-rule','top',0,1)],align:'stretch',...opts})
 }
 end(contentId:string,notes:string[]=[]):State{
  const n=Number(this.sourceFrame.split(':')[1]),cat=Math.floor((this.ordinal-1)/6)
  const cw=[176,323,288,226][cat],yw=47,contextWidth=cw+16+92+16+yw,fx=46+contextWidth+16
  const footer=footerIds[this.ordinal-1],pw=pageWidths[this.ordinal-1]
  this.regions.push(
   R('context','context',`44:${n+2}`,B(46,46,cw,22),'text',0,1,{typographyRole:'header'}),
   R('year','year',`44:${n+4}`,B(46+cw+124,46,yw,22),'text',0,1,{typographyRole:'header'}),
   R('format','format',`44:${n+5}`,B(fx,46,1874-fx,22),'text',0,1,{typographyRole:'header-right'}),
   R('footer','footer',`44:${footer}`,B(46,1030,610,18),'text',0,1,{typographyRole:'footer'}),
   R('page','page',`44:${footer+1}`,B(1874-pw,1029.5,pw,19),'text',0,1,{typographyRole:'page'}),
  )
  this.groups.push(
   G('context-year',B(46,40,contextWidth,34),'row',[C('context'),C('year')],{align:'center',gap:fixed(16),flowSeparators:[{id:'context-rule',afterId:'context',beforeId:'year',role:'context-separator',width:92,height:2,gap:16}]}),
   G('header-row',B(46,40,1828,34),'row',[CG('context-year'),C('format',{pushToEnd:true,flex:{grow:1,shrink:1}})],{align:'center',gap:fixed(16)}),
   G('header-band',B(46,40,1828,53),'column',[CG('header-row')],{padding:P(0,0,19),align:'stretch',decorations:[edge('header-bottom-rule','bottom',0,1)]}),
   G('footer-row',B(46,1026,1828,26),'row',[C('footer'),C('page',{pushToEnd:true})],{align:'center',gap:fixed(24)}),
   G('footer-band',B(46,1007,1828,45),'column',[CG('footer-row')],{padding:P(19),align:'stretch',decorations:[edge('footer-top-rule','top',0,1)]}),
   root(B(46,40,1828,1012),[CG('header-band'),CG(contentId,{flex:grow}),CG('footer-band')],{gap:fixed(18)}),
  )
  return {id:this.id,familyId:this.familyId,modeId:this.id,sourceFrame:this.sourceFrame,canvas:{width:1920,height:1080},rootGroupId:'slide-root',regions:this.regions,groups:this.groups,surfaceRole:'slide',adaptationNotes:[
   'Dense source chrome: top 40, bottom 28, header 34, footer 26; not the older 54/34 profile.',
   'Dimensions use all feasible 4px values inside +/-30%; positions derive from this tree.',
   'Source/inset preferred values may be fractional. Font family, colors, surfaces and emphasis come from the active DS.',
   'All content, including optional supplied notes, is conserved. No blind clipping or ellipsis.',
   ...notes,
  ]}
 }
}
export const SINGLE_LAYOUT=[one]
export const rule=(id:string,e:'top'|'right'|'bottom'|'left',thickness=1)=>edge(id,e,0,thickness)
export const softGap=(n:number)=>range(Math.min(n,8),n,Math.max(n,32))


// ===== recipes/reading.ts =====
export const readingStates:State[]=(()=>{
const family='editorial-reading'
const readingStates:State[]=[]
// 01 — title/lead, three independent editorial modules, three supplied notes.
{
 const s=new DenseBuilder(1,'reading-three-columns',family)
 s.text('title',2268,A(0,0,1210,177),'title');s.text('lead',2269,A(1250,84,578,93),'lead',true)
 s.g('intro',A(0,0,1828,177),'row',[C('title'),C('lead',{pushToEnd:true})],{gap:fixed(40),align:'end'})
 s.items('modules',2271,A(0,214,1828,588),'module',3,3,32,32,{primitiveLayoutIds:['module-10']})
 s.items('notes',2284,A(0,820,1828,58),'text',3,3,32,18,{minItems:0,typographyRole:'source'})
 s.ruleGroup('notes-owner',A(0,820,1828,58),[C('notes')],9)
 s.ruleGroup('reading-body',A(0,195,1828,607),[rowC('modules')])
 s.g('content',A(0,0,1828,878),'column',[CG('intro'),rowG('reading-body'),CG('notes-owner')],{gap:fixed(18),align:'stretch'})
 readingStates.push(s.end('content',['Editorial modules allow 1/2/3 columns; notes have independent supplied content, not generated citations.']))
}
// 02 — a margin column remains attached to the complete article row.
{
 const s=new DenseBuilder(2,'reading-margin-quote',family)
 s.block('margin',2302,A(0,0,250,878),'margin-note')
 s.g('margin-owner',A(0,0,250,878),'column',[rowC('margin')],{padding:P(0,24),decorations:[rule('margin-rule','right')]})
 s.text('eyebrow',2307,A(284,0,281,17),'eyebrow',true);s.text('title',2308,A(284,37,1544,130),'title')
 s.block('article-left',2310,A(284,187,756,244),'module',{primitiveLayoutIds:['module-16']})
 s.block('article-right',2314,A(1072,187,756,161),'module',{primitiveLayoutIds:['module-16']})
 s.g('article-columns',A(284,187,1544,581),'row',[rowC('article-left'),rowC('article-right')],{gap:fixed(32),align:'start'})
 s.block('quote',2318,A(284,788,1544,90),'quote-strip')
 s.g('article',A(284,0,1544,878),'column',[C('eyebrow'),C('title'),rowG('article-columns'),C('quote')],{gap:fixed(20),align:'stretch'})
 s.g('content',A(0,0,1828,878),'row',[CG('margin-owner'),rowG('article')],{gap:fixed(34),align:'stretch'})
 readingStates.push(s.end('content'))
}
// 03 — unlike independent cards, these gutters belong to column positions.
{
 const s=new DenseBuilder(3,'reading-four-editorial-columns',family)
 s.text('title',2335,A(0,0,1280,114),'title');s.text('title-note',2336,A(1280,82,548,32),'source',true)
 s.g('intro',A(0,0,1828,114),'row',[C('title'),C('title-note',{pushToEnd:true,flex:grow})],{align:'end'})
 s.items('columns',2338,A(0,151,1828,693),'editorial-column',4,4,0,20,{}, {...denseColumnSlots(4),preferredWeights:[438.25,463.25,463.25,463.25],cellHeight:{mode:'fill'}})
 s.ruleGroup('columns-owner',A(0,132,1828,712),[rowC('columns')])
 s.text('source',2359,A(0,862,1828,16),'source',true)
 s.g('content',A(0,0,1828,878),'column',[CG('intro'),rowG('columns-owner'),C('source')],{gap:fixed(18),align:'stretch'})
 readingStates.push(s.end('content',['Column-specific gutters and dividers disappear/rebind when column topology changes.']))
}
// 04 — quote and attribution share a horizontal banner; no quote-sign literals.
{
 const s=new DenseBuilder(4,'reading-quote-banner',family)
 s.block('quote',2373,A(0,0,1828,138),'quote-banner')
 s.items('articles',2376,A(0,156,1828,656),'module',2,2,44,24,{primitiveLayoutIds:['module-14']})
 s.items('notes',2387,A(0,830,1828,48),'text',3,3,36,18,{minItems:0,typographyRole:'source'})
 s.g('content',A(0,0,1828,878),'column',[C('quote'),rowC('articles'),C('notes')],{gap:fixed(18),align:'stretch'})
 readingStates.push(s.end('content'))
}
// 05 — all three tiers share the right column; their two internal tracks are equal.
{
 const s=new DenseBuilder(5,'reading-title-rail-tiers',family)
 s.text('eyebrow',2406,A(0,0,528,17),'eyebrow',true);s.text('title',2407,A(0,41,528,639),'title');s.text('lead',2408,A(0,704,528,62),'lead',true)
 s.g('title-rail',A(0,0,560,878),'column',[C('eyebrow'),C('title'),C('lead')],{gap:fixed(24),padding:P(0,32),decorations:[rule('rail-rule','right',2)],align:'stretch'})
 s.items('tiers',2410,A(596,0,1232,862),'tier',3,1,0,0,{}, {cellHeight:{mode:'fill'}})
 s.text('source',2419,A(596,862,1232,16),'source',true)
 s.g('right-rail',A(596,0,1232,878),'column',[rowC('tiers'),C('source')],{align:'stretch'})
 s.g('content',A(0,0,1828,878),'row',[CG('title-rail'),rowG('right-rail')],{gap:fixed(36),align:'stretch'})
 readingStates.push(s.end('content'))
}
// 06 — one larger module plus two distinct stacks; trailing source belongs right.
{
 const s=new DenseBuilder(6,'reading-modular-essay',family)
 s.text('title',2434,A(0,0,1270,183),'title');s.text('title-note',2435,A(1318,120,510,63),'note',true)
 s.g('intro',A(0,0,1828,183),'row',[C('title'),C('title-note',{pushToEnd:true,flex:grow})],{gap:fixed(48),align:'end'})
 s.block('feature',2438,A(0,220,680,658),'feature-module')
 s.items('middle-modules',2443,A(704,220,550,658),'module',2,1,0,22,{primitiveLayoutIds:['module-10']})
 s.items('right-modules',2452,A(1278,220,550,290),'module',2,1,0,22,{primitiveLayoutIds:['module-10']})
 s.text('source',2461,A(1278,532,550,48),'source',true)
 s.g('right-stack',A(1278,220,550,658),'column',[C('right-modules'),C('source')],{gap:fixed(22),align:'stretch'})
 s.g('module-row',A(0,220,1828,658),'row',[C('feature'),rowC('middle-modules'),rowG('right-stack')],{gap:fixed(24),align:'stretch'})
 s.ruleGroup('module-owner',A(0,201,1828,677),[rowG('module-row')])
 s.g('content',A(0,0,1828,878),'column',[CG('intro'),rowG('module-owner')],{gap:fixed(18),align:'stretch'})
 readingStates.push(s.end('content'))
}
// 12 — sources, method, conclusion are semantically distinct columns.
{
 const s=new DenseBuilder(12,'reading-source-dossier',family)
 s.block('sources',2729,A(0,0,500,878),'source-list')
 s.g('sources-owner',A(0,0,500,878),'column',[rowC('sources')],{padding:P(0,24),decorations:[rule('sources-rule','right')]})
 s.text('method-label',2738,A(526,0,756,17),'eyebrow',true);s.text('method-heading',2739,A(526,35,756,28),'section-title')
 s.items('methods',2740,A(526,81,756,330),'numbered-item',3,1,0,18,{primitiveLayoutIds:['numbered-top']})
 s.g('method-column',A(526,0,756,878),'column',[C('method-label'),C('method-heading'),C('methods')],{gap:fixed(18),align:'stretch'})
 s.block('conclusion',2752,A(1308,0,520,878),'conclusion-panel')
 s.g('content',A(0,0,1828,878),'row',[CG('sources-owner'),rowG('method-column'),C('conclusion')],{gap:fixed(26),align:'stretch'})
 readingStates.push(s.end('content'))
}

return readingStates;
})();

// ===== recipes/data.ts =====
export const dataStates:State[]=(()=>{
const family='data-comparison'
const dataStates:State[]=[]
// 07 — four top-aligned metrics, not top/bottom-separated display cards.
{
 const s=new DenseBuilder(7,'data-metrics-methods',family)
 s.text('title',2476,A(0,0,1200,122),'title');s.text('lead',2477,A(1358,60,470,62),'lead',true)
 s.g('intro',A(0,0,1828,122),'row',[C('title'),C('lead',{pushToEnd:true})],{align:'end',gap:fixed(32)})
 s.items('metrics',2479,A(0,159,1828,132),'metric',4,4,0,20,{primitiveLayoutIds:['metric-dense']}, {...denseColumnSlots(4),preferredWeights:[438.25,463.25,463.25,463.25]})
 s.ruleGroup('metrics-owner',A(0,140,1828,151),[C('metrics')])
 s.items('methods',2501,A(0,328,1828,516),'module',3,3,34,24,{primitiveLayoutIds:['module-10']})
 s.ruleGroup('methods-owner',A(0,309,1828,535),[rowC('methods')])
 s.text('source',2514,A(0,862,1828,16),'source',true)
 s.g('content',A(0,0,1828,878),'column',[CG('intro'),CG('metrics-owner'),rowG('methods-owner'),C('source')],{gap:fixed(18),align:'stretch'})
 dataStates.push(s.end('content'))
}
// 08 — coherent four-column table. Headers/cells remain bound in one block.
{
 const s=new DenseBuilder(8,'data-evidence-table',family)
 s.text('title',2529,A(0,0,1368,114),'title');s.block('fact',2530,A(1408,0,420,184),'callout-fact')
 s.g('intro',A(0,0,1828,184),'row',[rowC('title'),C('fact')],{gap:fixed(40),align:'start'})
 s.block('table',2534,A(0,202,1828,626),'evidence-table')
 s.text('source',2560,A(0,846,1828,32),'source',true)
 s.g('content',A(0,0,1828,878),'column',[CG('intro'),rowC('table'),C('source')],{gap:fixed(18),align:'stretch'})
 dataStates.push(s.end('content',['Table has four fixed semantic tracks. Row count can be 1–4; column deletion, transposition and cell reassignment are forbidden.']))
}
// 09 — hero fact with four scoped clarifications; order down each column.
{
 const s=new DenseBuilder(9,'data-hero-fact-clarifications',family)
 s.block('fact',2575,A(0,0,700,878),'hero-fact')
 s.g('fact-owner',A(0,0,700,878),'column',[rowC('fact')],{padding:P(0,38),decorations:[rule('fact-rule','right',2)]})
 s.text('title',2581,A(748,0,1080,110),'title')
 s.items('clarifications',2582,A(748,130,1080,696),'numbered-item',4,2,28,18,{primitiveLayoutIds:['numbered-top']},{readingOrder:'column-major'})
 s.text('source',2601,A(748,846,1080,32),'source',true)
 s.g('right-column',A(748,0,1080,878),'column',[C('title'),rowC('clarifications'),C('source')],{gap:fixed(20),align:'stretch'})
 s.g('content',A(0,0,1828,878),'row',[CG('fact-owner'),rowG('right-column')],{gap:fixed(48),align:'stretch'})
 dataStates.push(s.end('content'))
}
// 10 — independent labelled matrix cells may reflow; their field pairing cannot.
{
 const s=new DenseBuilder(10,'data-evidence-matrix',family)
 s.text('title',2616,A(0,0,1200,118),'title');s.text('title-note',2617,A(1200,86,628,32),'source',true)
 s.g('intro',A(0,0,1828,118),'row',[C('title'),C('title-note',{pushToEnd:true,flex:grow})],{align:'end'})
 s.items('matrix',2618,A(0,136,1828,708),'matrix-cell',6,3,0,0,{}, {cellHeight:{mode:'reference',preferred:250}})
 s.text('source',2649,A(0,862,1828,16),'source',true)
 s.g('content',A(0,0,1828,878),'column',[CG('intro'),rowC('matrix'),C('source')],{gap:fixed(18),align:'stretch'})
 dataStates.push(s.end('content',['This matrix contains independent labelled records, unlike the four-column evidence table. Each record remains atomic through 1/2/3-column reflow.']))
}
// 11 — three checkpoint OWNERS, each with separately queryable metric components.
{
 const s=new DenseBuilder(11,'data-checkpoint-trajectory',family)
 s.text('title',2663,A(0,0,1828,126),'title');s.text('lead',2664,A(0,144,1828,62),'lead',true)
 const parents=[]
 for(let i=0;i<3;i++){
  const x=i*(1828+22)/3,w=(1828-44)/3,base=[2666,2682,2698][i],p=`checkpoint-${i+1}`
  s.text(p+'-label',base+1,A(x+24,248,w-48,17),'eyebrow')
  s.block(p+'-main',base+2,A(x+24,283,w-48,113),'metric',{primitiveLayoutIds:['metric-dense']})
  s.block(p+'-secondary-a',base+8,A(x+24,433,(w-72)/2,113),'metric',{primitiveLayoutIds:['metric-dense']})
  s.block(p+'-secondary-b',base+12,A(x+24+(w-72)/2+24,433,(w-72)/2,113),'metric',{primitiveLayoutIds:['metric-dense']})
  s.g(p+'-secondary',A(x+24,433,w-48,113),'row',[rowC(p+'-secondary-a'),rowC(p+'-secondary-b')],{gap:fixed(24),align:'start'})
  s.ruleGroup(p+'-secondary-owner',A(x+24,414,w-48,132),[CG(p+'-secondary')])
  s.g(p,A(x,224,w,620),'column',[C(p+'-label'),C(p+'-main'),CG(p+'-secondary-owner')],{gap:fixed(18),padding:P(24,24,24,24),surfaceRole:i===2?'checkpoint-emphasis':'checkpoint-neutral',align:'stretch'})
  parents.push(rowG(p))
 }
 s.g('trajectory',A(0,224,1828,620),'row',parents,{gap:fixed(22),align:'stretch'})
 s.text('source',2714,A(0,862,1828,16),'source',true)
 s.g('content',A(0,0,1828,878),'column',[C('title'),C('lead'),rowG('trajectory'),C('source')],{gap:fixed(18),align:'stretch'})
 dataStates.push(s.end('content',['The three checkpoint positions are locked roles. Each of nine metrics independently resolves through the active component registry. No fake enclosing-checkpoint fallback bypasses metric matching.']))
}
// 16 — same four shared tracks in every row, with a narrower row-heading track.
{
 const s=new DenseBuilder(16,'data-approach-table',family)
 s.text('title',2922,A(0,0,1170,177),'title');s.text('lead',2923,A(1214,115,614,62),'lead',true)
 s.g('intro',A(0,0,1828,177),'row',[C('title'),C('lead',{pushToEnd:true,flex:grow})],{gap:fixed(44),align:'end'})
 s.block('table',2924,A(0,195,1828,649),'comparison-table')
 s.text('source',2970,A(0,862,1828,16),'source',true)
 s.g('content',A(0,0,1828,878),'column',[CG('intro'),rowC('table'),C('source')],{gap:fixed(18),align:'stretch'})
 dataStates.push(s.end('content',['Shared table track weights 280:516:516:516 apply to both header and every data row. Columns cannot be independently resized by individual rows.']))
}
// 27 — supplementary large fact, exact different hierarchy from a dense metric.
{
 const ch=editorialChrome({context:'8:1277',year:'8:1279',format:'8:1281',footer:'8:1297',page:'8:1298'},198,67)
 const regs=[...ch.regions,R('tag','tag','8:1285',B(46,122,400,53),'label',0),R('topic','topic','8:1287',B(1169,131.5,705,34),'text',0),R('fact','fact','8:1288',B(46,398,1828,295),'wide-fact'),R('source','source','8:1295',B(46,932,1828,56),'text',0)]
 const groups=[...ch.groups,G('intro',B(46,122,1828,53),'row',[C('tag'),C('topic',{pushToEnd:true})],{align:'center',gap:fixed(24)}),
 G('source-owner',B(46,916,1828,72),'column',[C('source')],{padding:P(16),decorations:[edge('source-rule','top')],align:'stretch'}),
 G('fact-main',B(46,122,1828,866),'column',[CG('intro'),C('fact'),CG('source-owner')],{justify:'space-between',gap:fixed(24),align:'stretch'}),
 root(B(46,44,1828,1002),[CG('header-row'),CG('fact-main',{flex:grow}),CG('footer-row')],{gap:fixed(24)})]
 dataStates.push(S('display-wide-fact',family,'display-wide-fact','8:1275',regs,groups))
}
// 28 — value/unit at top; prose explicitly pinned to bottom of every cell.
{
 const ch=editorialChrome({context:'8:1162',year:'8:1164',format:'8:1166',footer:'8:1207',page:'8:1208'},303,69)
 const ls=columns(4,4,0,'stretch',{betweenItemsRole:'column-divider',borderEdges:['top','bottom'],cellHeight:{mode:'fill'}})
 const regs=[...ch.regions,R('title','title','8:1170',B(46,135,1056,71)),R('context-note','context-note','8:1172',B(1281,122,593,84),'text',0,1,{typographyRole:'note'}),R('metrics','metrics','8:1173',B(46,238,1828,750),'metric-orientation',1,4,{layouts:ls,preferredLayoutId:'columns-4'})]
 const groups=[...ch.groups,G('intro',B(46,122,1828,84),'row',[C('title'),C('context-note',{pushToEnd:true})],{gap:fixed(24),align:'end'}),G('metrics-main',B(46,122,1828,866),'column',[CG('intro'),rowC('metrics')],{gap:fixed(32),align:'stretch'}),root(B(46,44,1828,1002),[CG('header-row'),rowG('metrics-main'),CG('footer-row')],{gap:fixed(24)})]
 dataStates.push(S('display-four-orientations',family,'display-four-orientations','8:1160',regs,groups))
}
// 30 — the two approaches are named roles and do not swap by visual preference.
{
 const ch=editorialChrome({context:'8:1418',year:'8:1420',format:'8:1422',footer:'8:1460',page:'8:1461'},296,61)
 const regs=[...ch.regions,R('title','title','8:1425',B(46,122,1365,74)),R('left-approach','left-approach','8:1427',B(46,226,904,762),'approach'),R('right-approach','right-approach','8:1443',B(974,226,900,762),'approach',1,1,{emphasis:['primary'],maxPrimaryItems:1})]
 const groups=[...ch.groups,G('comparison',B(46,226,1828,762),'row',[rowC('left-approach'),rowC('right-approach')],{gap:fixed(24),align:'stretch'}),G('comparison-main',B(46,122,1828,866),'column',[C('title'),rowG('comparison')],{gap:fixed(30),align:'stretch'}),root(B(46,44,1828,1002),[CG('header-row'),rowG('comparison-main'),CG('footer-row')],{gap:fixed(24)})]
 dataStates.push(S('display-two-approaches',family,'display-two-approaches','8:1416',regs,groups,['Left and right emphasis profiles must be provided by the active DS; no source colors are copied.']))
}

return dataStates;
})();

// ===== recipes/instructions.ts =====
export const instructionStates:State[]=(()=>{
const family='instructions-reference'
const instructionStates:State[]=[]
// 13 — numbered cards preserve row-major order when the column count changes.
{
 const s=new DenseBuilder(13,'instructions-ten-step-grid',family)
 s.text('title',2771,A(0,0,1250,118),'title');s.text('lead',2772,A(1398,25,430,93),'lead',true)
 s.g('intro',A(0,0,1828,118),'row',[C('title'),C('lead',{pushToEnd:true})],{gap:fixed(24),align:'end'})
 s.items('steps',2773,A(0,136,1828,708),'step-card',10,5,0,0,{}, {cellHeight:{mode:'reference',preferred:335}})
 s.text('source',2814,A(0,862,1828,16),'source',true)
 s.g('content',A(0,0,1828,878),'column',[CG('intro'),rowC('steps'),C('source')],{gap:fixed(18),align:'stretch'})
 instructionStates.push(s.end('content',['Number of supplied step blocks is 1–10. Their sequenceIndex, never Qwen array order, determines reading order.']))
}
// 14 — time/heading/prose with an active-DS timeline tick, not embedded glyph.
{
 const s=new DenseBuilder(14,'instructions-horizontal-timeline',family)
 s.text('title',2828,A(0,0,1828,122),'title')
 s.items('events',2829,A(0,140,1828,688),'timeline-event',5,5,0,20,{}, {...denseColumnSlots(5),itemPadding:{first:P(22,24),middle:P(22,24,0,24),last:P(22,24,0,24)},preferredWeights:[345.6,370.6,370.6,370.6,370.6],borderEdges:['top','bottom'],cellHeight:{mode:'fill'}})
 s.items('notes',2855,A(0,846,1828,32),'text',3,3,34,18,{minItems:0,typographyRole:'source'})
 s.g('content',A(0,0,1828,878),'column',[C('title'),rowC('events'),C('notes')],{gap:fixed(18),align:'stretch'})
 instructionStates.push(s.end('content'))
}
// 15 — role-locked argument columns. Sequence keys preserve row correspondence.
{
 const s=new DenseBuilder(15,'instructions-argument-chain',family)
 s.text('title',2872,A(0,0,1828,130),'title')
 const refs=[]
 for(let i=0;i<3;i++){
  const id=`argument-${i+1}`
  s.block(id,[2874,2885,2896][i],A(i*616,148,596,696),'argument-pillar',i===2?{emphasis:['primary'],maxPrimaryItems:1}:{})
  refs.push(rowC(id))
 }
 s.g('chain',A(0,148,1828,696),'row',refs,{gap:fixed(20),align:'stretch'})
 s.text('source',2907,A(0,862,1828,16),'source',true)
 s.g('content',A(0,0,1828,878),'column',[C('title'),rowG('chain'),C('source')],{gap:fixed(18),align:'stretch'})
 instructionStates.push(s.end('content',['Argument column roles are locked; corresponding list rows must be normalized in matching order. No text-based inference of row relations is attempted by the layout stage.']))
}
// 17 — exceptions panel is NOT interchangeable with a generic body column.
{
 const s=new DenseBuilder(17,'instructions-recommendations-exceptions',family)
 s.text('title',2986,A(0,0,1324,114),'title')
 s.items('recommendations',2987,A(0,124,1324,754),'numbered-item',8,2,24,8,{primitiveLayoutIds:['numbered-top']},{readingOrder:'column-major'})
 s.g('left',A(0,0,1324,878),'column',[C('title'),rowC('recommendations')],{gap:fixed(10),align:'stretch'})
 s.block('exceptions',3022,A(1358,0,470,878),'exceptions')
 s.g('content',A(0,0,1828,878),'row',[rowG('left'),C('exceptions')],{gap:fixed(34),align:'stretch'})
 instructionStates.push(s.end('content'))
}
// 18 — ordinal plus title, twelve independently component-addressable items.
{
 const s=new DenseBuilder(18,'instructions-twelve-point-plan',family)
 s.text('index',3046,A(0,9,149,113),'hero-index',true);s.text('title',3047,A(199,0,1629,122),'title')
 s.g('intro',A(0,0,1828,122),'row',[C('index'),rowC('title')],{gap:fixed(50),align:'end'})
 s.items('items',3049,A(0,159,1828,719),'numbered-item',12,3,28,0,{primitiveLayoutIds:['numbered-row-54']},{readingOrder:'column-major',cellHeight:{mode:'fill'}})
 s.ruleGroup('items-owner',A(0,140,1828,738),[rowC('items')])
 s.g('content',A(0,0,1828,878),'column',[CG('intro'),rowG('items-owner')],{gap:fixed(18),align:'stretch'})
 instructionStates.push(s.end('content'))
}
// 21 — FAQ remains question+answer, not a freely reclassified text block.
{
 const s=new DenseBuilder(21,'instructions-six-faq',family)
 s.text('title',3206,A(0,0,900,268),'title');s.text('lead',3207,A(1268,206,560,62),'lead',true)
 s.g('intro',A(0,0,1828,268),'row',[C('title'),C('lead',{pushToEnd:true})],{gap:fixed(24),align:'end'})
 s.items('faq',3208,A(0,286,1828,558),'faq',6,2,0,0,{}, {cellHeight:{mode:'reference',preferred:178}})
 s.text('source',3239,A(0,862,1828,16),'source',true)
 s.g('content',A(0,0,1828,878),'column',[CG('intro'),rowC('faq'),C('source')],{gap:fixed(18),align:'stretch'})
 instructionStates.push(s.end('content'))
}
// 22 — two column-major lanes, explicit marker/heading/body internals.
{
 const s=new DenseBuilder(22,'instructions-eight-theses',family)
 s.text('title',3254,A(0,0,900,134),'title');s.text('title-note',3255,A(900,90,928,44),'note',true)
 s.g('intro',A(0,0,1828,134),'row',[C('title'),C('title-note',{pushToEnd:true,flex:grow})],{align:'end'})
 s.items('items',3257,A(0,171,1828,673),'numbered-item',8,2,34,0,{primitiveLayoutIds:['numbered-row-48']},{readingOrder:'column-major',cellHeight:{mode:'fill'}})
 s.ruleGroup('items-owner',A(0,152,1828,692),[rowC('items')])
 s.text('source',3300,A(0,862,1828,16),'source',true)
 s.g('content',A(0,0,1828,878),'column',[CG('intro'),rowG('items-owner'),C('source')],{gap:fixed(18),align:'stretch'})
 instructionStates.push(s.end('content'))
}
// 29 — source equivalent to the earlier seven-thesis layout, retained here.
{
 const ch=editorialChrome({context:'8:1342',year:'8:1344',format:'8:1346',footer:'8:1382',page:'8:1383'},418,69)
 const regs=[...ch.regions,R('tag','tag','8:1351',B(46,122,217,53),'label',0),R('title','title','8:1353',B(46,201,696,332)),R('note','note','8:1354',B(46,932,696,56),'text',0),R('theses','theses','8:1355',B(818,122,1056,866),'thesis-list')]
 const groups=[...ch.groups,G('heading-top',B(46,122,696,411),'column',[C('tag'),C('title')],{gap:fixed(26),align:'stretch'}),G('heading-rail',B(46,122,748,866),'column',[CG('heading-top'),C('note',{pushToEnd:true})],{padding:P(0,52),gap:fixed(24),align:'stretch'}),G('theses-owner',B(818,122,1056,866),'column',[rowC('theses')],{padding:P(0,0,0,40),decorations:[edge('theses-rule','left')],align:'stretch'}),G('main',B(46,122,1828,866),'row',[CG('heading-rail'),rowG('theses-owner')],{gap:fixed(24),align:'stretch'}),root(B(46,44,1828,1002),[CG('header-row'),rowG('main'),CG('footer-row')],{gap:fixed(24)})]
 instructionStates.push(S('display-seven-theses',family,'display-seven-theses','8:1340',regs,groups,['Same composition as source 39:677 in section 39:514, but this source frame is retained independently. Global deduplication is a catalog concern, not a missing-frame alias.']))
}

return instructionStates;
})();

// ===== recipes/media.ts =====
export const mediaStates:State[]=(()=>{
const family='cases-media'
const mediaStates:State[]=[]
// 19 — image is part of the top row, not an independently fixed y-coordinate.
{
 const s=new DenseBuilder(19,'media-title-map-modules',family)
 s.text('eyebrow',3128,A(0,0,1214,17),'eyebrow',true);s.text('title',3129,A(0,35,1214,244),'title')
 s.g('heading',A(0,0,1214,279),'column',[C('eyebrow'),C('title')],{gap:fixed(18),align:'stretch'})
 s.block('visual',3130,A(1248,0,580,430),'visual')
 s.g('top-row',A(0,0,1828,430),'row',[rowG('heading'),C('visual')],{gap:fixed(34),align:'start'})
 s.items('modules',3134,A(0,448,1828,396),'module',3,3,24,24,{primitiveLayoutIds:['module-10']})
 s.text('source',3147,A(0,862,1828,16),'source',true)
 s.g('content',A(0,0,1828,878),'column',[CG('top-row'),rowC('modules'),C('source')],{gap:fixed(18),align:'stretch'})
 mediaStates.push(s.end('content',['Image placeholder labels and axes are excluded. A real supplied diagram is contained, never cropped to the frame.']))
}
// 20 — quote and three real metric candidates, not one indiscriminate text panel.
{
 const s=new DenseBuilder(20,'media-quote-statistics',family)
 s.block('quote',3162,A(0,0,820,878),'quote-panel')
 s.text('title',3167,A(848,0,980,51),'title')
 s.items('metrics',3168,A(848,73,980,113),'metric',3,3,20,20,{primitiveLayoutIds:['metric-dense']})
 s.items('modules',3182,A(848,231,980,139),'module',2,2,28,22,{primitiveLayoutIds:['module-10']})
 s.ruleGroup('modules-owner',A(848,208,980,162),[C('modules')],22)
 s.text('source',3191,A(848,392,980,16),'source',true)
 s.g('right',A(848,0,980,878),'column',[C('title'),C('metrics'),CG('modules-owner'),C('source')],{gap:fixed(22),align:'stretch'})
 s.g('content',A(0,0,1828,878),'row',[C('quote'),rowG('right')],{gap:fixed(28),align:'stretch'})
 mediaStates.push(s.end('content'))
}
// 23 — image and bottom result panel form a single resizable right column.
{
 const s=new DenseBuilder(23,'media-case-result',family)
 s.text('eyebrow',3316,A(0,0,1204,17),'eyebrow',true);s.text('title',3317,A(0,35,1204,177),'title');s.text('lead',3318,A(0,230,1204,62),'lead')
 s.items('modules',3320,A(0,329,1204,134),'module',3,3,24,20,{primitiveLayoutIds:['module-10']})
 s.ruleGroup('modules-owner',A(0,310,1204,153),[C('modules')])
 s.g('story',A(0,0,1204,878),'column',[C('eyebrow'),C('title'),C('lead'),CG('modules-owner')],{gap:fixed(18),align:'stretch'})
 s.block('visual',3334,A(1238,0,590,480),'visual')
 s.text('result-label',3339,A(1260,520,546,17),'eyebrow',true)
 s.block('metric',3340,A(1260,549,546,113),'metric',{primitiveLayoutIds:['metric-dense']})
 s.text('result-note',3344,A(1260,674,546,38),'note',true)
 s.g('result',A(1238,498,590,380),'column',[C('result-label'),C('metric'),C('result-note')],{gap:fixed(12),padding:P(22,22,22,22),surfaceRole:'result-panel',align:'stretch'})
 s.g('right',A(1238,0,590,878),'column',[C('visual'),rowG('result')],{gap:fixed(18),align:'stretch'})
 s.g('content',A(0,0,1828,878),'row',[rowG('story'),CG('right')],{gap:fixed(34),align:'stretch'})
 mediaStates.push(s.end('content',['A result-panel contains a separate metric region; lack of an enclosing panel component cannot suppress metric component-first matching.']))
}
// 24 — diagram, conclusions, next step and sources each retain their meaning.
{
 const s=new DenseBuilder(24,'media-closing-system',family)
 s.text('eyebrow',3361,A(0,0,592,17),'eyebrow',true);s.text('title',3362,A(0,35,592,345),'title');s.text('left-source',3363,A(0,862,592,16),'source',true)
 s.g('heading',A(0,0,592,380),'column',[C('eyebrow'),C('title')],{gap:fixed(18),align:'stretch'})
 s.g('left',A(0,0,620,878),'column',[CG('heading'),C('left-source',{pushToEnd:true})],{gap:fixed(18),padding:P(0,28),decorations:[rule('left-rule','right',2)],align:'stretch'})
 s.block('visual',3365,A(648,0,1180,300),'visual')
 s.items('modules',3369,A(648,320,1180,369),'module',3,3,20,20,{primitiveLayoutIds:['module-10']})
 s.block('next-step',3382,A(648,709,1180,133),'next-step')
 s.text('source',3385,A(648,862,1180,16),'source',true)
 s.g('right',A(648,0,1180,878),'column',[C('visual'),rowC('modules'),C('next-step'),C('source')],{gap:fixed(20),align:'stretch'})
 s.g('content',A(0,0,1828,878),'row',[CG('left'),rowG('right')],{gap:fixed(28),align:'stretch'})
 mediaStates.push(s.end('content'))
}

return mediaStates;
})();

// ===== recipes/openers.ts =====
export const openerStates:State[]=(()=>{
const family='openers-navigation'
const grow={grow:1,shrink:1} as const
const openerStates:State[]=[]
// 25 — bottom-aligned introduction; a disappearing tag releases its gap.
{
 const ch=editorialChrome({context:'8:1062',year:'8:1064',format:'8:1066',footer:'8:1079',page:'8:1080'},335,65)
 const regs=[...ch.regions,R('tag','tag','8:1070',B(46,122,516,53),'label',0),R('title','title','8:1072',B(46,207,1519,232)),
  R('lead','lead','8:1074',B(46,820,1056,168),'text'),R('comment','comment','8:1077',B(1126,852,593,136),'text')]
 const groups=[...ch.groups,G('heading',B(46,122,1519,317),'column',[C('tag'),C('title')],{gap:fixed(32),align:'stretch'}),
  G('comment-owner',B(1126,834,593,154),'column',[C('comment')],{padding:P(18),decorations:[edge('comment-line','top')],align:'stretch'}),
  G('explanations',B(46,820,1828,168),'row',[C('lead'),CG('comment-owner')],{gap:fixed(24),align:'end'}),
  G('intro-main',B(46,122,1828,866),'column',[CG('heading'),CG('explanations',{pushToEnd:true})],{gap:range(24,32,48),align:'stretch'}),
  root(B(46,44,1828,1002),[CG('header-row'),CG('intro-main',{flex:grow}),CG('footer-row')],{gap:fixed(24)})]
 openerStates.push(S('opener-bottom-introduction',family,'opener-bottom-introduction','8:1060',regs,groups,
  ['The large title remains at the top and the lead/comment row at the bottom. Their shared reserve shrinks first. The comment divider belongs to the comment wrapper.']))
}
// 26 — the quotation mark is an active-DS ornament, never source content.
{
 const h=plainHeader('41:423','41:424')
 const regs=[...h.regions,R('quotation','quotation','41:427',B(36,140,1774,772),'cover-quote',1,1,{emphasis:['primary'],maxPrimaryItems:1}),
  R('footer','footer','41:431',B(46,994,620,27),'text',0)]
 const bands={'header-row':h.group.preferredRect,quotation:B(36,140,1774,772),footer:B(46,994,1828,27)}
 const groups=[h.group,stack(B(36,44,1838,1002),[CG('header-row'),C('quotation',{flex:grow}),C('footer')],bands)]
 openerStates.push(S('opener-large-quotation',family,'opener-large-quotation','41:422',regs,groups,
  ['The 36px optical inset belongs to the ornament envelope, not to the text safe area. The quote starts after an internal ornament track. Credits and their divider are one attached bottom group.'],'slide-inverse'))
}
// 31 — full-bleed status row, date/year group and a material passport.
{
 const f=footer('41:421',undefined,982,620,364,54,54,28)
 const regs=[...f.regions,R('status','status','41:412',B(46,48,600,58),'text',0),R('version','version','41:413',B(1510,58,364,34),'text',0),
  R('date','date','41:414',B(46,242,820,148),'text'),R('year-large','year-large','41:415',B(46,408,820,148),'text',0),
  R('passport','passport','41:416',B(1000,242,874,620),'passport',1,1,{emphasis:['primary'],maxPrimaryItems:1})]
 const groups=[f.group,
  G('status-row',B(0,0,1920,174),'row',[C('status'),C('version',{pushToEnd:true,marginBeforeCrossPx:10})],{padding:P(48,46,68,46),surfaceRole:'status-band',gap:fixed(24)}),
  G('date-stack',B(46,242,820,314),'column',[C('date'),C('year-large')],{gap:fixed(18),align:'stretch'}),
  G('passport-shell',B(1000,242,874,620),'column',[C('passport',{flex:grow})],{padding:P(0,0,0,40),decorations:[edge('passport-line','left')],align:'stretch'}),
  G('dated-main',B(46,242,1828,620),'row',[CG('date-stack'),CG('passport-shell',{flex:grow})],{gap:range(24,134,172),align:'start'}),
  G('dated-body',B(46,242,1828,794),'column',[CG('dated-main',{flex:grow}),CG('footer-row')],{gap:range(24,90,116),align:'stretch'}),
  root(B(0,0,1920,1080),[CG('status-row'),CG('dated-body',{flex:grow})],{gap:range(24,68,88),align:'center',trailingSpace:range(0,44,56)})]
 openerStates.push(S('opener-dated-passport',family,'opener-dated-passport','41:410',regs,groups,
  ['Equivalent authored composition to 39:539 in the previous section. Date, year and status are input references; no current date or publication status is generated. The whole status band collapses only when both status and version are absent.']))
}
// 32 — left cover rail plus a sequence-preserving, vertically repeated TOC.
{
 const ls=columns(1,1,0,'stretch',{cellHeight:{mode:'reference',preferred:116}})
 const regs=[R('rail-label','rail-label','41:454',B(46,44,500,27),'text',0),R('title','title','41:455',B(46,220,590,318)),
  R('introduction','introduction','41:456',B(46,792,560,70),'text',0),R('rail-footer','rail-footer','41:457',B(46,994,500,27),'text',0),
  R('toc-label','toc-label','41:459',B(786,154,1088,27),'text',0),
  R('entries','entries','41:458',B(786,215,1088,580),'toc-item',1,5,{layouts:ls.map(l=>({...l,minItems:1,maxItems:5})),preferredLayoutId:'columns-1'}),
  R('footer-right','footer-right','41:481',B(1510,994,364,27),'text',0)]
 const groups=[G('left-rail',B(0,0,700,1080),'column',[
   C('rail-label'),C('title',{gapBefore:range(24,149,194)}),C('introduction',{pushToEnd:true,gapBefore:range(24,254,330)}),C('rail-footer',{gapBefore:range(24,132,172)}),
  ],{padding:P(44,64,59,46),surfaceRole:'cover-rail',align:'start'}),
  G('toc',B(786,154,1088,760),'column',[C('toc-label'),C('entries')],{gap:fixed(34),align:'stretch',trailingSpace:range(0,119,155)}),
  G('right-footer',B(786,994,1088,27),'row',[C('footer-right',{pushToEnd:true})]),
  G('right-column',B(786,154,1088,867),'column',[CG('toc',{flex:grow}),CG('right-footer')],{gap:range(24,80,104),align:'stretch'}),
  root(B(0,0,1920,1080),[CG('left-rail'),CG('right-column',{flex:grow,marginBeforeCrossPx:154})],{direction:'row',gap:range(24,86,112),padding:P(0,46),align:'start'})]
 openerStates.push(S('opener-mini-contents',family,'opener-mini-contents','41:452',regs,groups,
  ['TOC rows contain marker / title / trailing note. All supplied entries remain in sequence order. A missing right footer removes only its row; it does not move the left-rail footer.']))
}

return openerStates;
})();

// ===== runtime.ts =====
export type SlotPlan<T extends {blockId:string}=BoundBlockPlan>={id:string;block:T;row:number;column:number;padding:Insets;decorations:(EdgeDecoration&{ownerNodeId:string})[];trackWeight:number;height:'hug'|'fill'|'reference';referenceHeight?:number}
export type RegionSlots<T extends {blockId:string}=BoundBlockPlan>={id:string;columns:number;rows:number;readingOrder:'row-major'|'column-major';padding:Insets;gapX:Range;gapY:Range;align:string;decorations:(EdgeDecoration&{ownerNodeId:string})[];slots:SlotPlan<T>[]}
/** Slot shells work identically for library components, primitives and logo assets.
 * A component is measured AFTER these insets are subtracted, not in the raw cell.
 * Track sizes are derived by the adapter's flex layout, not chosen by Qwen. */
export function compileRegionSlots<T extends {blockId:string}>(plan:{regions:{regionId:string;layout:ItemLayout;blocks:T[]}[]}):RegionSlots<T>[] {
  return plan.regions.map(r=>{
    const l=r.layout,n=r.blocks.length,c=Math.min(l.columns,n),rows=Math.ceil(n/c)
    const slots=r.blocks.map((block,i):SlotPlan<T>=>{
      let row=Math.floor(i/c),column=i%c
      if(l.readingOrder==='column-major'){
        const q=Math.floor(n/c),rem=n%c;let start=0
        for(let lane=0;lane<c;lane++){const size=q+(lane<rem?1:0);if(i<start+size){column=lane;row=i-start;break}start+=size}
      }
      const id=`${r.regionId}/slot/${block.blockId}`
      const padding={...ZERO,...(l.itemPadding?(column===0?l.itemPadding.first:column===c-1?l.itemPadding.last:l.itemPadding.middle):{})}
      const decorations:SlotPlan<T>['decorations']=[]
      if(l.betweenItemsRole&&(c===1?row>0:column>0)){
        const edge=c===1?'top':'left'
        const d:EdgeDecoration&{ownerNodeId:string}={id:`${id}/separator`,ownerNodeId:id,edge,placement:'inside-edge',preferredThicknessPx:1,clearancePx:0,role:l.betweenItemsRole}
        decorations.push(d);padding[edge]=Math.max(padding[edge],d.preferredThicknessPx)
      }
      return {id,block,row,column,padding,decorations,trackWeight:l.preferredWeights?.length===c?l.preferredWeights[column]:1,height:l.cellHeight?.mode??'hug',referenceHeight:l.cellHeight?.preferred}
    })
    const padding={...ZERO};for(const e of l.borderEdges??[])padding[e]=2
    return {id:r.regionId,columns:c,rows,readingOrder:l.readingOrder,padding,gapX:l.gapX,gapY:l.gapY,align:l.align,slots,decorations:(l.borderEdges??[]).map(edge=>({id:`${r.regionId}/${edge}-border`,ownerNodeId:r.regionId,edge,placement:'inside-edge' as const,role:'editorial-divider',preferredThicknessPx:2,clearancePx:0}))}
  })
}
export type TypographyProfile={role:string;fontFamily:string;fontWeight:string|number;preferredPx:number;minPx:number;maxPx:number;lineHeightRatio:number;letterSpacingEm:number;colorToken:string}
export function typographyCandidates(p:TypographyProfile):number[]{
  if(!p.role||!p.fontFamily||!p.colorToken||![p.minPx,p.preferredPx,p.maxPx,p.lineHeightRatio,p.letterSpacingEm].every(Number.isFinite)||p.minPx<=0||p.minPx>p.preferredPx||p.preferredPx>p.maxPx||p.lineHeightRatio<=0)throw new RecipeError(['invalid-active-ds-typography-profile'])
  const values=[p.preferredPx]
  for(let n=Math.floor(p.preferredPx/4)*4;n>=p.minPx;n-=4)if(n!==p.preferredPx)values.push(n)
  return values
}
export function resolveTypography(p:TypographyProfile,size:number){
  typographyCandidates(p)
  if(size<p.minPx||size>p.maxPx||(size!==p.preferredPx&&size%4!==0))throw new RecipeError(['font-outside-role-limits'])
  return {fontFamily:p.fontFamily,fontWeight:p.fontWeight,fontSize:size,lineHeight:size*p.lineHeightRatio,letterSpacing:size*p.letterSpacingEm,colorToken:p.colorToken}
}
/** Geometry report supplied by the real layout adapter. Parent/child containment
 * is intentional; collision is tested between siblings, not whole ancestor trees. */
export type GeometryBox={id:string;parentId:string|null;rect:Rect;kind:'region'|'group'|'field'|'asset'|'decoration';overflow:boolean;allowedSize?:{width:Range;height:Range};authoredSize?:{w:number;h:number}}
export function validateGeometryReport(boxes:readonly GeometryBox[],canvas={width:1920,height:1080}):string[]{
  const issues:string[]=[],map=new Map(boxes.map(b=>[b.id,b]))
  if(map.size!==boxes.length)issues.push('duplicate-rendered-node-id')
  const epsilon=.05
  for(const b of boxes){const r=b.rect
    if(![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.w<=0||r.h<=0){issues.push(`${b.id}:invalid-bounds`);continue}
    if(b.overflow)issues.push(`${b.id}:overflow`)
    if(r.x<-epsilon||r.y<-epsilon||r.x+r.w>canvas.width+epsilon||r.y+r.h>canvas.height+epsilon)issues.push(`${b.id}:out-of-canvas`)
    if(b.parentId){const p=map.get(b.parentId)?.rect
      if(!p)issues.push(`${b.id}:unknown-parent`)
      else if(r.x<p.x-epsilon||r.y<p.y-epsilon||r.x+r.w>p.x+p.w+epsilon||r.y+r.h>p.y+p.h+epsilon)issues.push(`${b.id}:outside-parent`)
    }
    if(b.allowedSize)for(const [k,key]of[['w','width'],['h','height']]as const){const lim=b.allowedSize[key]
      if(r[k]<lim.min-epsilon||r[k]>lim.max+epsilon)issues.push(`${b.id}:${key}:outside-adaptation-range`)
      if(!(b.authoredSize&&Math.abs(r[k]-b.authoredSize[k])<=epsilon)&&Math.abs(r[k]/4-Math.round(r[k]/4))>epsilon/4)issues.push(`${b.id}:${key}:not-4px`)
    }
  }
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j]
    if(a.parentId!==b.parentId)continue
    if(Math.min(a.rect.x+a.rect.w,b.rect.x+b.rect.w)-Math.max(a.rect.x,b.rect.x)>epsilon&&Math.min(a.rect.y+a.rect.h,b.rect.y+b.rect.h)-Math.max(a.rect.y,b.rect.y)>epsilon)issues.push(`collision:${a.id}:${b.id}`)
  }
  return issues
}
export const runtimePolicy={
  dimensionSearch:'every-feasible-4px-value-inside-bounds',initialSamplesAreExhaustive:false,
  unchangedAuthoredDimensionsMayBeOffGrid:true,geometrySource:'hierarchical-flex-flow',
  typographySource:'active-design-system-role-profile',colorsAndSurfaces:'active-design-system',
  fontReduction:'last-resort-after-native-type-and-geometry-search',contentCoverage:'every-supplied-block-and-field-exactly-once',
  componentMeasurement:'exact-inner-slot-and-current-snapshots',nativeArtwork:'never-stretch-or-recolor-without-component-contract',
  decorations:'attached-owner-with-measured-thickness-and-reserved-inset',
  requiredFinalChecks:['loaded-ds-fonts','internal-text-overflow','node-bounds','sibling-collisions','field-bindings','source-coverage','asset-cropping','active-role-size-limits'],
}as const


// ===== zod-adapter.ts =====
/** Optional adapter for the host's Zod. No package download or second Zod copy.
 * The constrained-decoding grammar is schema.jsonSchema, not z.custom() output.
 * Call validateQwenAssignment/createStateRenderPlan after parsing: a shape parser
 * does not certify component measurements or the rendered geometry. */
export type ZodParser<T>={parse(value:unknown):T;safeParse(value:unknown):{success:true;data:T}|{success:false;error:unknown}}
export type HostZod = {
  custom<T>(check:(value:unknown)=>boolean,params?:{message:string}):ZodParser<T>
}
export function createZodAssignmentSchema(z:HostZod,bundle:Bundle,ctx:QwenContext) {
  const parser=createQwenAssignmentSchema(bundle,ctx)
  const schema=z.custom<Assignment>(value=>parser.safeParse(value).success,{message:'Invalid MSP recipe assignment; inspect strict parser issues for details.'})
  return {schema,jsonSchema:parser.jsonSchema,parse:parser.parse,safeParse:parser.safeParse}
}


// ===== index.ts =====
export const states=[...readingStates,...dataStates,...instructionStates,...mediaStates,...openerStates]
const familyGroups=[
 {id:'editorial-reading',name:'Длинное чтение и редакционные разборы',states:readingStates},
 {id:'data-comparison',name:'Данные, метрики и сравнения',states:dataStates},
 {id:'instructions-reference',name:'Инструкции, списки и справочные структуры',states:instructionStates},
 {id:'cases-media',name:'Кейсы, медиа и смешанные выводы',states:mediaStates},
 {id:'openers-navigation',name:'Вводные слайды, цитаты и навигация',states:openerStates},
]
/** Complete source inventory, independent of runtime family ordering. */
export const SOURCE_FRAMES=[
 '44:2259','44:2293','44:2326','44:2365','44:2396','44:2425','44:2467','44:2520',
 '44:2566','44:2607','44:2655','44:2720','44:2762','44:2820','44:2864','44:2913',
 '44:2976','44:3037','44:3118','44:3153','44:3197','44:3245','44:3306','44:3350',
 '8:1060','41:422','8:1275','8:1160','8:1340','8:1416','41:410','41:452',
] as const
export const bundle:Bundle={
 id:'section-39-798',revision:'6.1.0',sourceSection:'39:798',sourceFrames:SOURCE_FRAMES,
 contracts,states,families:familyGroups.map(f=>({id:f.id,name:f.name,modes:[...new Set(f.states.map(s=>s.modeId))].map(id=>({id,stateIds:f.states.filter(s=>s.modeId===id).map(s=>s.id)}))})),
}
export const RECIPE_DEFINITION_ISSUES=validateRecipeDefinition(bundle)
if(RECIPE_DEFINITION_ISSUES.length)throw Error(RECIPE_DEFINITION_ISSUES.join('\n'))
export const canonicalStates=states.filter(s=>!s.aliasOf)
export const recipes=bundle.families.map(f=>({id:f.id,name:f.name,sourceSection:bundle.sourceSection,revision:bundle.revision,modes:f.modes,states:states.filter(s=>s.familyId===f.id)}))
export const recipe=bundle
export default bundle

