import { z } from 'zod'
import type { SourceSnapshot } from '../../digital-designer/source-types'
import type { BoundsIR, ElementIR } from '../../../vendor/drag/src/core/model'
import { readSourceScene, type SourceScene } from '../../design-system/source-scene'
import { SemanticValidationError } from '../../design-system/semantic-contract'
import { contentHash } from '../../design-system/catalog'
import { RECIPE_PASSPORT_VERSION, RECIPE_RULES_VERSION, type RecipePassport } from './passport'
import type { CompiledComparison } from './template-comparison'

export const TEMPLATE_RECIPE_VERSION = 'native-template-1'
const id = z.string().min(1).max(180)
const explanation = z.string().min(1).max(500)
export const templateProposalSchema = z.object({
  name: z.string().min(1).max(100), purpose: explanation, slideId: id,
  itemCount: z.number().int().min(2).max(8),
  slots: z.array(z.object({ sourceId: id, role: z.enum(['primary', 'context', 'heading', 'body', 'ordinal', 'note', 'footer']),
    item: z.number().int().min(0).max(8), optional: z.boolean(), ownerId: id.nullable(),
  }).strict()).min(3).max(60),
  graphics: z.array(z.object({ sourceId: id, usage: z.enum(['decoration', 'source-only']), reason: explanation }).strict()).max(120),
  sourceOnlyText: z.array(z.object({ sourceId: id, reason: z.enum(['page-number', 'event-metadata']) }).strict()).max(10),
  expandSlots: z.array(id).max(24), rationale: explanation,
}).strict()
export type TemplateProposal = z.infer<typeof templateProposalSchema>
export type TemplateRecipe = {
  passport: RecipePassport; proposal: TemplateProposal; sourceSnapshotHash: string
  elements: ElementIR[]; originalElements: ElementIR[]
  slots: (Omit<TemplateProposal['slots'][number], 'role'> & { role: TemplateProposal['slots'][number]['role'] | 'metric'; bounds: BoundsIR })[]
  stateBounds: Record<string, Record<string, BoundsIR>>
  stateGraphics?: Record<string, Record<string, BoundsIR>>
  stateOmissions?: Record<string, string[]>
  graphicBounds: { sourceId: string; bounds: BoundsIR }[]
  ledger: { sourceId: string; disposition: 'slot' | 'decoration' | 'source-only'; reason?: string }[]
  adaptation?: { modelRunId: string; baseVersion: string; widenSlots: string[]; rationale: string }
  reflow?: { modelRunId: string; previousVersion: string; columns: number; header: 'inline' | 'stacked'; rationale: string }
  comparison?: CompiledComparison
}
export const horizontalIntersection = (a: BoundsIR, b: BoundsIR) => a.x < b.x + b.width && b.x < a.x + a.width
export const containsBox = (a: BoundsIR, b: BoundsIR, tolerance = 2) => b.x >= a.x - tolerance && b.y >= a.y - tolerance && b.x + b.width <= a.x + a.width + tolerance && b.y + b.height <= a.y + a.height + tolerance
const leafRecords = (scene: SourceScene, number: number) => [...scene.records.values()].filter(r => r.source.slide === number && r.disposition === 'visible' && !('children' in r.element))

/** Choose manageable source evidence by structure, never by a particular upload
 * or slide ID. The model still chooses the family and assigns all semantic roles. */
export function templateCandidates(snapshot: SourceSnapshot, options: { excludeSlideIds?: string[]; limit?: number } = {}) {
  const scene = readSourceScene(snapshot)
  return snapshot.slides.filter(s => s.warnings.every(w => w.startsWith('font-substitution:'))).map(s => ({ slide: s, nodes: leafRecords(scene, s.number) }))
    .filter(s => !options.excludeSlideIds?.includes(s.slide.id) && s.nodes.filter(n => n.element.kind === 'text').length >= 10 && s.nodes.length <= 80)
    .sort((a, b) => a.nodes.length - b.nodes.length || a.slide.number - b.slide.number).slice(0, options.limit ?? 3)
}

export function validateTemplateProposal(raw: unknown, snapshot: SourceSnapshot, allowedSlides: string[]): TemplateProposal {
  const parsed = templateProposalSchema.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 20))
  const p = parsed.data, slide = snapshot.slides.find(s => s.id === p.slideId), issues: string[] = []
  if (!slide || !allowedSlides.includes(p.slideId)) throw new SemanticValidationError(['source-slide-not-supplied'])
  const scene = readSourceScene(snapshot), leaves = leafRecords(scene, slide.number), assigned = new Map<string, number>()
  const assign = (sourceId: string, text: boolean) => {
    assigned.set(sourceId, (assigned.get(sourceId) ?? 0) + 1)
    const r = leaves.find(r => r.element.id === sourceId)
    if (!r || (r.element.kind === 'text') !== text) issues.push(`invalid-source:${sourceId}`)
    return r
  }
  for (const slot of p.slots) {
    const r = assign(slot.sourceId, true)
    if (slot.item > p.itemCount || ['primary', 'context', 'footer'].includes(slot.role) && slot.item !== 0) issues.push(`invalid-item:${slot.sourceId}`)
    if (r && [r.element.id, ...r.ancestors].some(key => { const e = scene.records.get(key)!.element; return e.rotation || e.centeredTransform?.flipH || e.centeredTransform?.flipV || 'clipsContent' in e && e.clipsContent })) issues.push(`unsupported-text-transform:${slot.sourceId}`)
    if (slot.ownerId) {
      const owner = leaves.find(r => r.element.id === slot.ownerId)
      if (!owner || owner.element.kind === 'text' || !r || !containsBox(owner.bounds, r.bounds) || owner.bounds.width * owner.bounds.height > slide.width * slide.height * .7) issues.push(`invalid-owner:${slot.sourceId}`)
      if (!p.graphics.some(g => g.sourceId === slot.ownerId && g.usage === 'decoration')) issues.push(`owner-must-be-decoration:${slot.sourceId}`)
    }
  }
  for (const g of p.graphics) assign(g.sourceId, false)
  for (const t of p.sourceOnlyText) {
    const r = assign(t.sourceId, true)
    if (t.reason === 'page-number' && r?.element.kind === 'text' && !/^\s*\d{1,4}\s*$/.test(r.element.text)) issues.push(`not-page-number:${t.sourceId}`)
  }
  for (const r of leaves) if (assigned.get(r.element.id) !== 1) issues.push(`source-coverage:${r.element.id}`)
  if (p.slots.filter(s => s.role === 'primary' && !s.optional).length !== 1) issues.push('one-required-primary: общий заголовок слайда должен иметь role=primary, item=0, optional=false. heading означает только заголовок карточки, не слайда.')
  for (let item = 1; item <= p.itemCount; item++) {
    for (const role of ['heading', 'body']) if (p.slots.filter(s => s.item === item && s.role === role && !s.optional).length !== 1) issues.push(`required-${role}:item-${item}`)
  }
  if (new Set(p.expandSlots).size !== p.expandSlots.length) issues.push('duplicate-expansion')
  for (const sourceId of p.expandSlots) if (!p.slots.some(s => s.sourceId === sourceId && s.ownerId && s.role === 'body')) issues.push(`only-owned-body-can-expand:${sourceId}`)
  if (issues.length) throw new SemanticValidationError(issues.slice(0, 30))
  return p
}

export async function compileTemplateRecipe(proposal: TemplateProposal, snapshot: SourceSnapshot, uploadId: string, modelRunId: string): Promise<TemplateRecipe> {
  const p = validateTemplateProposal(proposal, snapshot, [proposal.slideId]), scene = readSourceScene(snapshot)
  const slide = snapshot.slides.find(s => s.id === p.slideId)!, sourceSnapshotHash = await contentHash(snapshot)
  const slots = p.slots.map(s => ({ ...s, bounds: { ...scene.records.get(s.sourceId)!.bounds } }))
  const observed = Object.fromEntries(slots.map(s => [s.sourceId, { ...s.bounds }])), expanded = structuredClone(observed)
  for (const sourceId of p.expandSlots) {
    const slot = slots.find(s => s.sourceId === sourceId)!, owner = scene.records.get(slot.ownerId!)!.bounds, b = slot.bounds
    // Preserve x/width/font and the panel's observed left inset as its bottom
    // inset. Stop at any lower text frame; never consume another semantic slot.
    const padding = Math.max(0, b.x - owner.x)
    let bottom = owner.y + owner.height - padding
    for (const neighbour of slots) if (neighbour.sourceId !== sourceId && neighbour.bounds.y >= b.y + b.height - 2 && horizontalIntersection(b, neighbour.bounds)) bottom = Math.min(bottom, neighbour.bounds.y - padding)
    expanded[sourceId].height = Math.max(b.height, bottom - b.y)
  }
  const hasExpansion = slots.some(s => expanded[s.sourceId].height > s.bounds.height + 1)
  const originalElements = scene.roots.filter(e => scene.sources.get(e.id)?.slide === slide.number).map(e => structuredClone(e))
  const retained = new Set([...p.slots.map(s => s.sourceId), ...p.graphics.filter(g => g.usage === 'decoration').map(g => g.sourceId)])
  const prune = (e: ElementIR): ElementIR[] => {
    if ('children' in e) { const children = e.children.flatMap(prune); return children.length ? [{ ...e, children }] : [] }
    return retained.has(e.id) ? [structuredClone(e)] : []
  }
  const revision = await contentHash({ version: TEMPLATE_RECIPE_VERSION, sourceSnapshotHash, proposal: p, observed, expanded })
  const recipeId = `template-${revision.slice(0, 20)}`
  return {
    passport: {
      schemaVersion: RECIPE_PASSPORT_VERSION, id: recipeId, version: revision, name: p.name, purpose: p.purpose,
      rulesVersion: RECIPE_RULES_VERSION, origin: { kind: 'template', sourceHash: sourceSnapshotHash, uploadId, slideIds: [slide.id], modelRunId },
      scope: { kind: 'design-system', uploadId }, executor: 'native-template-v1', canvas: { width: slide.width, height: slide.height },
      invariants: ['original-outer-grid', 'original-font-size-and-paint', 'no-source-data-in-decoration', 'exact-source-coverage'],
      capacity: { itemCount: p.itemCount, description: `${p.itemCount} смысловых блоков; иное число требует другого рецепта. Вместимость текста определяется измерением.` },
      states: [{ id: 'observed', family: 'repeated-blocks', evidence: 'observed', geometryRef: `${recipeId}#observed` }, ...(hasExpansion ? [{ id: 'expanded', family: 'repeated-blocks', evidence: 'proposed' as const, geometryRef: `${recipeId}#expanded` }] : [])],
      transitions: hasExpansion ? [{ from: 'observed', to: 'expanded', level: 1, when: 'Measured text overflow; expand only the model-selected body slots within their source panels.' }] : [],
      qualification: { technical: 'unverified', artistic: 'pending' },
    }, proposal: p, sourceSnapshotHash, elements: originalElements.flatMap(prune), originalElements, slots,
    stateBounds: { observed, ...(hasExpansion ? { expanded } : {}) },
    graphicBounds: p.graphics.filter(g => g.usage === 'decoration').map(g => ({ sourceId: g.sourceId, bounds: scene.records.get(g.sourceId)!.bounds })),
    ledger: [...slots.map(s => ({ sourceId: s.sourceId, disposition: 'slot' as const })), ...p.graphics.map(g => ({ sourceId: g.sourceId, disposition: g.usage, reason: g.reason })), ...p.sourceOnlyText.map(t => ({ sourceId: t.sourceId, disposition: 'source-only' as const, reason: t.reason }))],
  }
}

export const templateAdaptationSchema = z.object({ widenSlots: z.array(id).min(1).max(4), rationale: explanation }).strict()
export type TemplateAdaptation = z.infer<typeof templateAdaptationSchema>
export function validateTemplateAdaptation(raw: unknown, recipe: TemplateRecipe): TemplateAdaptation {
  const parsed = templateAdaptationSchema.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`))
  if (new Set(parsed.data.widenSlots).size !== parsed.data.widenSlots.length || parsed.data.widenSlots.some(id => !recipe.slots.some(s => s.sourceId === id && s.role === 'context' && s.item === 0 && !s.ownerId))) throw new SemanticValidationError(['Only a standalone context row may use empty horizontal space.'])
  return parsed.data
}
export async function applyTemplateAdaptation(base: TemplateRecipe, raw: unknown, modelRunId: string): Promise<TemplateRecipe> {
  const adaptation = validateTemplateAdaptation(raw, base), recipe = structuredClone(base)
  const bounds = structuredClone(base.stateBounds.expanded ?? base.stateBounds.observed)
  for (const id of adaptation.widenSlots) {
    const box = bounds[id]
    let right = Math.min(base.passport.canvas.width, Math.max(...base.slots.map(s => s.bounds.x + s.bounds.width)))
    for (const slot of base.slots) if (slot.sourceId !== id && slot.bounds.y < box.y + box.height && box.y < slot.bounds.y + slot.bounds.height && slot.bounds.x >= box.x + box.width) right = Math.min(right, slot.bounds.x)
    for (const { bounds: obstacle } of base.graphicBounds) if (obstacle.width * obstacle.height < base.passport.canvas.width * base.passport.canvas.height * .7 && obstacle.y < box.y + box.height && box.y < obstacle.y + obstacle.height && obstacle.x + obstacle.width > box.x + box.width) right = Math.min(right, obstacle.x)
    if (right <= box.x + box.width) throw new SemanticValidationError([`No free row width:${id}`])
    box.width = right - box.x
  }
  recipe.stateBounds.rebalanced = bounds
  recipe.passport.version = await contentHash({ base: base.passport.version, adaptation, bounds })
  recipe.passport.states.push({ id: 'rebalanced', family: 'repeated-blocks', evidence: 'proposed', geometryRef: `${recipe.passport.id}#rebalanced` })
  recipe.passport.transitions.push({ from: base.passport.states.at(-1)!.id, to: 'rebalanced', level: 2, when: 'The measured context overflows; the model authorizes using the otherwise empty row within the source content axes.' })
  recipe.adaptation = { ...adaptation, modelRunId, baseVersion: base.passport.version }
  return recipe
}
