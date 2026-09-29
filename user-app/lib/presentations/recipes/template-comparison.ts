import { z } from 'zod'
import type { BoundsIR, ElementIR } from '../../../vendor/drag/src/core/model'
import { SemanticValidationError } from '../../design-system/semantic-contract'
import { contentHash } from '../../design-system/catalog'
import { containsBox, horizontalIntersection, type TemplateRecipe } from './template-contract'
import { resizeTemplatePanel, type ReflowMeasurement } from './template-reflow'
import type { TemplatePlan } from './template-plan'
import type { RecipeMaterial } from './pilot-cases'

export const COMPARISON_VERSION = 'paired-percent-comparison-3'
export const COMPARISON_STATE = 'paired-percent-flow'
const id = z.string().min(1).max(180)
const mark = z.object({ sourceId: id, graphicId: id }).strict()
export const templateComparisonSchema = z.object({
  encoding: z.enum(['equal-badges', 'proportional-bars']),
  layout: z.enum(['source-rows', 'balanced-rows']).optional(),
  pairs: z.array(z.object({ item: z.number().int().min(1).max(8), first: mark, second: mark }).strict()).min(2).max(8),
  excludeGraphics: z.array(z.object({ sourceId: id, reason: z.string().min(1).max(500) }).strict()).max(40),
  rationale: z.string().min(1).max(1200),
}).strict()
export type TemplateComparison = z.infer<typeof templateComparisonSchema>
export type CompiledComparison = TemplateComparison & { baseVersion: string; modelRunId: string }
const fail = (issue: string): never => { throw new SemanticValidationError([issue]) }
const overlaps = (a: BoundsIR, b: BoundsIR) => horizontalIntersection(a, b) && a.y < b.y + b.height && b.y < a.y + a.height

export function comparisonGraphicGroups(recipe: TemplateRecipe, proposal?: TemplateComparison) {
  const groups: string[][] = []
  const owners = proposal ? proposal.pairs.flatMap(p => [p.first.graphicId, p.second.graphicId]) : [...new Set(recipe.slots.flatMap(s => s.ownerId ? [s.ownerId] : []))]
  for (const owner of owners) {
    const box = recipe.graphicBounds.find(g => g.sourceId === owner)?.bounds
    if (!box) continue
    const pending = recipe.graphicBounds.filter(g => g.sourceId !== owner && containsBox(box, g.bounds))
    while (pending.length) {
      const group = [pending.pop()!]
      for (let i = 0; i < group.length; i++) for (let j = pending.length - 1; j >= 0; j--) if (overlaps(group[i].bounds, pending[j].bounds)) group.push(pending.splice(j, 1)[0])
      if (group.length > 1) groups.push(group.map(g => g.sourceId).sort())
    }
  }
  return groups
}
const partialGraphicIssues = (recipe: TemplateRecipe, proposal: TemplateComparison) => comparisonGraphicGroups(recipe, proposal)
  .filter(group => group.some(id => proposal.excludeGraphics.some(g => g.sourceId === id)) && !group.every(id => proposal.excludeGraphics.some(g => g.sourceId === id)))
  .map(group => `comparison-partial-icon:${group.join(',')}`)

/** A deliberately narrow grammar: a percentage and its series label. Years or
 * other numbers in that label can never become the plotted value. */
export function parsePercentMetric(text: string) {
  if (/[\r\n]/.test(text)) return fail('comparison-requires-single-line-value')
  const match = /^\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s+(?:в\s+)?([^\n%]+?)\s*$/u.exec(text)
  if (!match) return fail('comparison-requires-percent-and-series-label')
  const value = Number(match[1].replace(',', '.')), label = match[2].trim()
  if (!Number.isFinite(value) || value < 0 || value > 100 || !label) return fail('comparison-percent-out-of-range')
  return { value, label }
}
function leaves(recipe: TemplateRecipe) {
  const result = new Map<string, { element: ElementIR; guarded: boolean }>()
  const walk = (elements: ElementIR[], guarded = false) => {
    for (const e of elements) {
      const guard = guarded || !!(e.rotation || e.centeredTransform?.flipH || e.centeredTransform?.flipV || 'children' in e && (e.clipsContent || e.clipPathData))
      if ('children' in e) walk(e.children, guard)
      else result.set(e.id, { element: e, guarded: guard })
    }
  }
  walk(recipe.elements)
  return result
}
function pairGeometry(recipe: TemplateRecipe, proposal: TemplateComparison) {
  const source = leaves(recipe), used = new Set<string>()
  if (proposal.pairs.length !== recipe.proposal.itemCount || new Set(proposal.pairs.map(p => p.item)).size !== recipe.proposal.itemCount) return fail('comparison-requires-every-item-once')
  const items = proposal.pairs.map(pair => {
    if (pair.item > recipe.proposal.itemCount) return fail('comparison-unknown-item')
    const heading = recipe.slots.find(s => s.item === pair.item && s.role === 'heading')!
    const body = recipe.slots.find(s => s.item === pair.item && s.role === 'body')!
    if (!heading || !body || heading.ownerId || body.ownerId) return fail('comparison-requires-standalone-text-column')
    const marks = [pair.first, pair.second].map(mark => {
      const slot = recipe.slots.find(s => s.sourceId === mark.sourceId), graphic = recipe.graphicBounds.find(g => g.sourceId === mark.graphicId)
      const leaf = source.get(mark.graphicId), text = source.get(mark.sourceId)?.element
      if (!slot || slot.item !== pair.item || !['note', 'metric'].includes(slot.role) || slot.ownerId !== mark.graphicId || !graphic || !leaf || leaf.guarded || text?.kind !== 'text') return fail(`comparison-invalid-mark:${mark.sourceId}`)
      if (!containsBox(graphic.bounds, slot.bounds) || !containsBox({ x: 0, y: 0, ...recipe.passport.canvas }, graphic.bounds, 0)) return fail(`comparison-invalid-containment:${mark.sourceId}`)
      resizeTemplatePanel(leaf.element, leaf.element.bounds)
      if (used.has(mark.sourceId) || used.has(mark.graphicId)) return fail('comparison-duplicate-mark')
      used.add(mark.sourceId); used.add(mark.graphicId)
      return { ...mark, slot, graphic, originalValue: parsePercentMetric(text.text) }
    })
    if (marks[0].graphic.bounds.y + marks[0].graphic.bounds.height > marks[1].graphic.bounds.y + 2 || Math.abs(marks[0].graphic.bounds.x - marks[1].graphic.bounds.x) > 2) return fail('comparison-requires-stacked-pair')
    if (Math.abs(heading.bounds.x - body.bounds.x) > 2 || marks.some(m => m.graphic.bounds.x <= heading.bounds.x)) return fail('comparison-requires-metrics-right-of-text')
    const left = heading.bounds.x, right = Math.min(...marks.map(m => m.graphic.bounds.x))
    const gaps = [right - heading.bounds.x - heading.bounds.width, right - body.bounds.x - body.bounds.width].filter(g => g > 2)
    if (!gaps.length) return fail('comparison-missing-source-text-gap')
    const gap = Math.min(...gaps), width = right - left - gap
    const innerGap = body.bounds.y - heading.bounds.y - heading.bounds.height
    if (width <= 0 || innerGap < 0) return fail('comparison-invalid-source-text-column')
    return { item: pair.item, heading, body, marks, gap, innerGap, width, top: Math.min(heading.bounds.y, ...marks.map(m => m.graphic.bounds.y)) }
  }).sort((a, b) => a.item - b.item)
  for (const series of [0, 1]) if (new Set(items.map(i => i.marks[series].originalValue.label)).size !== 1) return fail('comparison-inconsistent-source-series')
  if (items[0].marks[0].originalValue.label === items[0].marks[1].originalValue.label) return fail('comparison-indistinguishable-series')
  if (new Set(proposal.excludeGraphics.map(g => g.sourceId)).size !== proposal.excludeGraphics.length) return fail('comparison-duplicate-exclusion')
  for (const exclusion of proposal.excludeGraphics) {
    const graphic = recipe.graphicBounds.find(g => g.sourceId === exclusion.sourceId)
    if (!graphic || used.has(exclusion.sourceId) || !items.some(i => i.marks.some(m => containsBox(m.graphic.bounds, graphic.bounds)))) return fail(`comparison-exclusion-outside-metric:${exclusion.sourceId}`)
  }
  if (recipe.slots.some(s => s.item > 0 && !['heading', 'body'].includes(s.role) && !used.has(s.sourceId))) return fail('comparison-unclassified-item-slot')
  // A common maximum width, derived from the narrowest source column. It is
  // either a uniform badge width or the exact 100% endpoint of a zero-based bar.
  const columns = [...new Set(items.map(i => i.heading.bounds.x))]
  const width = Math.min(...columns.map(x => Math.max(...items.filter(i => i.heading.bounds.x === x).flatMap(i => i.marks.map(m => m.graphic.bounds.width)))))
  for (const item of items) for (const mark of item.marks) {
    const b = { ...mark.graphic.bounds, width }
    for (const other of items) if (other.item !== item.item && [other.heading.bounds, other.body.bounds, ...other.marks.map(m => m.graphic.bounds)].some(o => overlaps(b, o))) return fail('comparison-no-room-for-common-width')
    for (const g of recipe.graphicBounds) if (!used.has(g.sourceId) && !proposal.excludeGraphics.some(e => e.sourceId === g.sourceId) &&
      !containsBox(mark.graphic.bounds, g.bounds) && g.bounds.width * g.bounds.height < recipe.passport.canvas.width * recipe.passport.canvas.height * .7 && overlaps(b, g.bounds)) return fail('comparison-graphic-obstacle')
    if (b.x + b.width > recipe.passport.canvas.width) return fail('comparison-common-width-outside-canvas')
  }
  return { items, width }
}
export function validateTemplateComparison(raw: unknown, recipe: TemplateRecipe, newProposal = false): TemplateComparison {
  const parsed = templateComparisonSchema.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`))
  if (recipe.reflow || recipe.adaptation) return fail('comparison-requires-unadapted-source')
  pairGeometry(recipe, parsed.data)
  // Older replies remain readable evidence of failure; new proposals must
  // repair complete icon groups. Rendering gates the older partial proposals.
  if (newProposal) {
    const issues = partialGraphicIssues(recipe, parsed.data)
    if (issues.length) throw new SemanticValidationError(issues)
  }
  return parsed.data
}
export async function applyTemplateComparison(base: TemplateRecipe, raw: unknown, modelRunId: string): Promise<TemplateRecipe> {
  const proposal = validateTemplateComparison(raw, base), recipe = structuredClone(base)
  recipe.comparison = { ...proposal, baseVersion: base.passport.version, modelRunId }
  const metricIds = new Set(proposal.pairs.flatMap(p => [p.first.sourceId, p.second.sourceId]))
  recipe.slots = recipe.slots.map(s => metricIds.has(s.sourceId) ? { ...s, role: 'metric', optional: false } : s)
  recipe.passport.version = await contentHash({ version: COMPARISON_VERSION, base: base.passport.version, proposal })
  recipe.passport.states = [{ id: COMPARISON_STATE, family: 'paired-metrics', evidence: 'proposed', geometryRef: `${recipe.passport.id}#${COMPARISON_STATE}` }]
  recipe.passport.transitions = []
  recipe.passport.invariants = base.passport.invariants.filter(i => i !== 'original-outer-grid').concat('original-horizontal-text-and-metric-axes', 'original-corner-radii', 'row-major-reading-order', 'complete-paired-percent-values', 'consistent-series-order', proposal.encoding === 'equal-badges' ? 'equal-width-not-quantitative' : 'zero-based-common-percent-scale')
  recipe.passport.capacity.description = `${base.proposal.itemCount} пунктов с заголовком, пояснением и двумя процентами с подписями серий. Все значения обязательны. Объём определяется измерением; текстовый список без показателей несовместим.`
  recipe.stateBounds = { [COMPARISON_STATE]: structuredClone(base.stateBounds.observed) }
  recipe.passport.qualification = { technical: 'unverified', artistic: 'pending' }
  return recipe
}
export function comparisonValues(recipe: TemplateRecipe, material: RecipeMaterial, plan: TemplatePlan) {
  if (!recipe.comparison) return new Map<string, { value: number; label: string }>()
  const values = new Map<string, { value: number; label: string }>()
  for (const pair of recipe.comparison.pairs) for (const mark of [pair.first, pair.second]) {
    const binding = plan.bindings.find(b => b.sourceId === mark.sourceId)
    if (!binding || binding.fragments.length !== 1) return fail(`comparison-requires-single-value-fragment:${mark.sourceId}`)
    const fragment = material.fragments.find(f => f.id === binding.fragments[0])
    if (!fragment) return fail(`comparison-missing-value:${mark.sourceId}`)
    values.set(mark.sourceId, parsePercentMetric(fragment.text))
  }
  for (const key of ['first', 'second'] as const) if (new Set(recipe.comparison.pairs.map(p => values.get(p[key].sourceId)!.label)).size !== 1) return fail('comparison-inconsistent-new-series')
  const first = recipe.comparison.pairs[0]
  if (values.get(first.first.sourceId)!.label === values.get(first.second.sourceId)!.label) return fail('comparison-indistinguishable-new-series')
  return values
}
export function resolveTemplateComparison(recipe: TemplateRecipe, material: RecipeMaterial, plan: TemplatePlan, measured?: ReflowMeasurement[]) {
  if (!recipe.comparison) return fail('comparison-not-authorized')
  const { items, width } = pairGeometry(recipe, recipe.comparison), values = comparisonValues(recipe, material, plan)
  const bounds = structuredClone(recipe.stateBounds[COMPARISON_STATE]), graphics: Record<string, BoundsIR> = {}, omitted = new Set(recipe.comparison.excludeGraphics.map(g => g.sourceId))
  const textFields = items.flatMap(i => [i.heading, i.body])
  if (measured && (measured.length !== textFields.length || new Set(measured.map(m => m.sourceId)).size !== textFields.length || textFields.some(s => !measured.some(m => m.sourceId === s.sourceId)))) return fail('comparison-incomplete-measurements')
  const contentBottom = Math.max(...recipe.slots.filter(s => s.item > 0).map(s => s.bounds.y + s.bounds.height))
  const heights = new Map<string, number>()
  for (const item of items) for (const field of [item.heading, item.body]) {
    const m = measured?.find(m => m.sourceId === field.sourceId)
    if (m && (!Number.isFinite(m.height) || m.height <= 0 || m.height > recipe.passport.canvas.height * 10 || Math.abs(m.width - item.width) > .001)) return fail(`comparison-invalid-measurement:${field.sourceId}`)
    heights.set(field.sourceId, m?.height ?? field.bounds.height)
  }
  const rows = new Map<number, { top: number; bottom: number }>()
  if (recipe.comparison.layout === 'balanced-rows') {
    const columns = [...new Set(items.map(i => i.heading.bounds.x))].sort((a, b) => a - b)
      .map(x => items.filter(i => i.heading.bounds.x === x).sort((a, b) => a.top - b.top))
    const count = columns[0].length
    if (columns.some(c => c.length !== count)) return fail('comparison-requires-complete-rows')
    const sourceRows = Array.from({ length: count }, (_, row) => columns.map(c => c[row]))
    if (sourceRows.flat().some((item, index) => item.item !== index + 1)) return fail('comparison-requires-row-major-order')
    const end = (item: typeof items[number]) => Math.max(item.heading.bounds.y + item.heading.bounds.height, item.body.bounds.y + item.body.bounds.height, ...item.marks.map(m => m.graphic.bounds.y + m.graphic.bounds.height))
    const gaps = sourceRows.slice(1).map((row, i) => Math.min(...row.map(item => item.top)) - Math.max(...sourceRows[i].map(end))).filter(g => g > 2)
    const gap = gaps.length ? Math.min(...gaps) : Math.max(...items.map(i => i.innerGap))
    if (gap <= 0) return fail('comparison-missing-row-gap')
    const top = Math.min(...items.map(i => i.top)), left = Math.min(...items.map(i => i.heading.bounds.x))
    const right = Math.max(...items.flatMap(i => i.marks.map(m => m.graphic.bounds.x + width)))
    let bottom = recipe.passport.canvas.height - Math.max(0, Math.min(left, recipe.passport.canvas.width - right))
    const marks = items.flatMap(i => i.marks)
    const reserved = recipe.graphicBounds.filter(g => !marks.some(m => m.graphicId === g.sourceId || containsBox(m.graphic.bounds, g.bounds)) && g.bounds.width * g.bounds.height < recipe.passport.canvas.width * recipe.passport.canvas.height * .7)
      .map(g => g.bounds).concat(recipe.slots.filter(s => s.item === 0).map(s => s.bounds))
    for (const b of reserved) if (b.y >= top && horizontalIntersection({ x: left, y: top, width: right - left, height: bottom - top }, b)) bottom = Math.min(bottom, b.y - gap)
    const minima = sourceRows.map(row => Math.max(...row.map(item => Math.max(item.heading.bounds.y - item.top + heights.get(item.heading.sourceId)! + item.innerGap + heights.get(item.body.sourceId)!, ...item.marks.map(m => m.graphic.bounds.y + m.graphic.bounds.height - item.top)))))
    const available = bottom - top - gap * (count - 1), spare = available - minima.reduce((sum, h) => sum + h, 0)
    if (available <= 0) return fail('comparison-no-free-region')
    const rowHeights = spare >= 0 ? minima.map(h => h + spare / count) : minima.map(() => available / count)
    let y = top
    for (const [index, row] of sourceRows.entries()) {
      for (const item of row) rows.set(item.item, { top: y, bottom: y + rowHeights[index] })
      y += rowHeights[index] + gap
    }
  }
  for (const item of items) {
    const next = items.filter(i => i.heading.bounds.x === item.heading.bounds.x && i.top > item.top).sort((a, b) => a.top - b.top)[0]
    const bottom = rows.get(item.item)?.bottom ?? (next ? next.top - item.innerGap : contentBottom)
    const dy = (rows.get(item.item)?.top ?? item.top) - item.top
    const headingHeight = heights.get(item.heading.sourceId)!
    bounds[item.heading.sourceId] = { ...item.heading.bounds, y: item.heading.bounds.y + dy, width: item.width, height: headingHeight }
    const bodyY = item.heading.bounds.y + dy + headingHeight + item.innerGap
    bounds[item.body.sourceId] = { x: item.body.bounds.x, y: bodyY, width: item.width, height: Math.max(1, bottom - bodyY) }
    for (const mark of item.marks) {
      const b = mark.graphic.bounds, slot = mark.slot.bounds
      const w = recipe.comparison.encoding === 'equal-badges' ? width : width * values.get(mark.sourceId)!.value / 100
      graphics[mark.graphicId] = { ...b, y: b.y + dy, width: w }
      const leftInset = slot.x - b.x
      const rightInset = Math.min(leftInset, ...recipe.graphicBounds.filter(g => g.sourceId !== mark.graphicId && containsBox(b, g.bounds)).map(g => g.bounds.x - b.x).filter(v => v > 0))
      bounds[mark.sourceId] = { ...slot, y: slot.y + dy, width: Math.max(1, w - leftInset - rightInset) }
      for (const graphic of recipe.graphicBounds) if (graphic.sourceId !== mark.graphicId && !omitted.has(graphic.sourceId) && containsBox(b, graphic.bounds)) graphics[graphic.sourceId] = { ...graphic.bounds, y: graphic.bounds.y + dy }
    }
  }
  return { bounds, graphics, omitted }
}

export function comparisonGeometryIssues(recipe: TemplateRecipe, geometry: ReturnType<typeof resolveTemplateComparison>, measurements: { sourceId: string; box: BoundsIR; ink: { left: number; right: number; top: number; bottom: number } }[]) {
  const issues: string[] = partialGraphicIssues(recipe, recipe.comparison!)
  for (const pair of recipe.comparison!.pairs) for (const mark of [pair.first, pair.second]) {
    const box = geometry.graphics[mark.graphicId]
    if (box.width <= 0) issues.push(`comparison-zero-bar-with-internal-label:${mark.sourceId}`)
    for (const m of measurements) {
      const ink = { x: m.box.x + m.ink.left, y: m.box.y + m.ink.top, width: m.ink.right - m.ink.left, height: m.ink.bottom - m.ink.top }
      if (m.sourceId === mark.sourceId) { if (!containsBox(box, ink)) issues.push(`metric-outside-graphic:${m.sourceId}`) }
      else if (overlaps(box, ink)) issues.push(`metric-graphic-collision:${m.sourceId}:${mark.graphicId}`)
    }
    for (const g of recipe.graphicBounds) if (g.sourceId !== mark.graphicId && !geometry.omitted.has(g.sourceId) && containsBox(recipe.graphicBounds.find(g => g.sourceId === mark.graphicId)!.bounds, g.bounds) && !containsBox(box, geometry.graphics[g.sourceId] ?? g.bounds)) issues.push(`metric-decoration-outside-graphic:${g.sourceId}`)
  }
  return issues
}
