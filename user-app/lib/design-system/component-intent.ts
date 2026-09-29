import { z } from 'zod'
import type { SourceScene } from './source-scene'
import type { EditableProposal, EditableReply } from './editable-contract'
import { titleBodyParagraphs } from '../component-lab/source-paragraphs'

export const COMPONENT_INTENT_VERSION = 'component-intent-1'
const ids = z.array(z.string().min(1).max(120)).max(500)
export const componentIntentSchema = z.object({
  version: z.literal(COMPONENT_INTENT_VERSION),
  family: z.enum(['number-caption', 'title-body', 'number-title-body', 'ordinal-caption', 'media-text', 'quote-author', 'fixed']),
  fields: z.array(z.object({ sourceId: z.string().min(1).max(120), part: z.enum(['whole', 'heading', 'body']), role: z.enum(['number', 'caption', 'ordinal', 'title', 'body', 'quote', 'author']) }).strict()).max(12),
  layouts: z.array(z.object({ state: z.enum(['vertical', 'horizontal', 'compact']), textAlign: z.enum(['source', 'left', 'center', 'right']), position: z.enum(['top', 'center', 'bottom']) }).strict()).max(3),
  rationale: z.string().min(1).max(900),
}).strict()
export const sourceDispositionSchema = z.object({ background: ids, decoration: ids, context: ids, unresolved: ids }).strict()
const familyRoles = {
  'number-caption': [['number', 'caption']], 'title-body': [['title', 'body']],
  'number-title-body': [['ordinal', 'title', 'body']], 'ordinal-caption': [['ordinal', 'body']],
  'media-text': [['body'], ['title', 'body']], 'quote-author': [['quote', 'author'], ['quote', 'body', 'author']],
} as const
// The fresh model grammar must enforce the same field cardinality and roles
// as the validator. Historical saved data retains its optional intent schema.
const field = componentIntentSchema.shape.fields.element
const adaptiveResponses = Object.entries(familyRoles).flatMap(([family, alternatives]) => alternatives.map(roles => componentIntentSchema.extend({
  family: z.literal(family),
  fields: z.array(field.extend({ role: z.enum([...roles] as [typeof roles[number], ...typeof roles[number][]]) })).length(roles.length),
  layouts: z.array(componentIntentSchema.shape.layouts.element.extend({
    state: ['title-body', 'quote-author'].includes(family) ? z.literal('vertical') : componentIntentSchema.shape.layouts.element.shape.state,
  })).min(1).max(3),
})))
export const componentIntentResponseSchema = z.union([
  componentIntentSchema.extend({ family: z.literal('fixed'), fields: z.array(field).max(0), layouts: z.array(componentIntentSchema.shape.layouts.element).max(0) }),
  adaptiveResponses[0], ...adaptiveResponses.slice(1),
])
export function intentIssues(b: EditableProposal, scene: SourceScene) {
  const intent = b.adaptation, issues: string[] = []
  if (!intent) return issues
  if (new Set(intent.layouts.map(l => l.state)).size !== intent.layouts.length) issues.push('duplicate-adaptive-state')
  if (intent.family !== 'fixed' && (!intent.fields.length || !intent.layouts.length)) issues.push('incomplete-adaptive-intent')
  const roles = intent.fields.map(f => f.role).sort().join(',')
  if (intent.family !== 'fixed' && !familyRoles[intent.family].some(fields => [...fields].sort().join(',') === roles)) issues.push(`adaptive-family-fields: family=${intent.family}; expected=${familyRoles[intent.family].map(fields => fields.join('+')).join(' or ')}; got=${roles || 'none'}; keep every source text; use fixed with empty fields/layouts if no supported family fits`)
  if (['title-body', 'quote-author'].includes(intent.family) && intent.layouts.some(l => l.state !== 'vertical')) issues.push('adaptive-family-layouts')
  const keys = new Set<string>()
  for (const f of intent.fields) {
    const r = scene.records.get(f.sourceId), key = `${f.sourceId}:${f.part}`
    if (keys.has(key)) issues.push('duplicate-adaptive-field'); keys.add(key)
    if (!r || r.element.kind !== 'text' || r.disposition !== 'visible' || !b.sourceIds.some(id => id === f.sourceId || r.ancestors.includes(id))) { issues.push(`unowned-adaptive-field:${f.sourceId}`); continue }
    if (f.part !== 'whole' && !titleBodyParagraphs(r.element)) issues.push(`unproven-field-split:${f.sourceId}`)
  }
  if (intent.fields.some(f => f.part === 'whole' && intent.fields.some(other => other.sourceId === f.sourceId && other.part !== 'whole'))) issues.push('overlapping-adaptive-fields')
  if (intent.family !== 'fixed') for (const r of scene.records.values()) {
    if (r.element.kind !== 'text' || !r.element.text.trim() || r.disposition !== 'visible' || !b.sourceIds.some(id => id === r.element.id || r.ancestors.includes(id))) continue
    const parts = intent.fields.filter(f => f.sourceId === r.element.id).map(f => f.part)
    if (!(parts.length === 1 && parts[0] === 'whole') && !(parts.length === 2 && parts.includes('heading') && parts.includes('body'))) issues.push(`adaptive-text-coverage:${r.element.id}`)
  }
  return issues
}
/** Use exactly the object inventory shown to the model. Coverage is a ledger,
 * not a claim that every decoration should become a reusable component. */
export function sourceCoverage(slide: Pick<EditableReply['slides'][number], 'objectRoles'> & { blocks: { sourceIds: string[] }[] }, supplied: string[], scene: SourceScene) {
  const grouped = new Set(slide.blocks.flatMap(b => b.sourceIds)), disposition = slide.objectRoles
  const covered = supplied.filter(id => grouped.has(id) || scene.records.get(id)?.ancestors.some(parent => grouped.has(parent)))
  const inventory = new Set(supplied), parents = new Set(supplied.map(id => scene.records.get(id)?.source.parentId)), issues: string[] = []
  // Non-raster groups are omitted from the compact inventory, but their IDs
  // are disclosed as each object's parent. Project those aliases onto the
  // supplied descendants; never accept an unrelated source group or invent
  // new inventory entries. A parent and child in one role are redundant.
  const expand = (ids: string[]) => [...new Set(ids.flatMap(id => {
    if (inventory.has(id)) return [id]
    const record = scene.records.get(id)
    if (parents.has(id) && record?.element.kind === 'group' && record.disposition === 'visible') return supplied.filter(child => scene.records.get(child)?.ancestors.includes(id))
    issues.push(`unknown-disposition:${id}`)
    return []
  }))]
  const background = expand(disposition?.background ?? []), decoration = expand(disposition?.decoration ?? []), context = expand(disposition?.context ?? []), unresolved = expand(disposition?.unresolved ?? [])
  const declared = [...background, ...decoration, ...context, ...unresolved], raw = Object.values(disposition ?? {}).flat()
  if (new Set(raw).size !== raw.length || new Set(declared).size !== declared.length || declared.some(id => covered.includes(id))) issues.push('overlapping-source-disposition')
  const unassigned = supplied.filter(id => !covered.includes(id) && !declared.includes(id))
  return { covered, background, decoration, context, unresolved, unassigned, issues, complete: !unresolved.length && !unassigned.length && !issues.length }
}

/** A later addition updates the ledger from actual accepted membership. The
 * previous result stays immutable; unrelated unresolved objects remain visible. */
export function updatedSourceCoverage(previous: ReturnType<typeof sourceCoverage>, blocks: { sourceIds: string[] }[], scene: SourceScene) {
  const supplied = [...new Set([...previous.covered, ...previous.background, ...previous.decoration, ...previous.context, ...previous.unresolved, ...previous.unassigned])]
  const covered = new Set(sourceCoverage({ blocks }, supplied, scene).covered)
  const remaining = (ids: string[]) => ids.filter(id => !covered.has(id))
  return sourceCoverage({ blocks, objectRoles: { background: remaining(previous.background), decoration: remaining(previous.decoration), context: remaining(previous.context), unresolved: remaining(previous.unresolved) } }, supplied, scene)
}
