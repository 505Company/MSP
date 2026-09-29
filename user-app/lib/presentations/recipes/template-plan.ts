import { z } from 'zod'
import type { ElementIR } from '../../../vendor/drag/src/core/model'
import { nativeBoundText } from '../../design-system/editable-native-layout'
import { SemanticValidationError } from '../../design-system/semantic-contract'
import type { TemplateRecipe } from './template-contract'
import type { RecipeMaterial } from './pilot-cases'
import { resizeTemplatePanel, resolveTemplateReflow, type ReflowMeasurement } from './template-reflow'
import { comparisonValues, resolveTemplateComparison } from './template-comparison'

export const templatePlanSchema = z.object({
  bindings: z.array(z.object({ sourceId: z.string().min(1), fragments: z.array(z.string().min(1)).min(1).max(50) }).strict()).min(1).max(60),
  rationale: z.string().min(1).max(500),
}).strict()
export type TemplatePlan = z.infer<typeof templatePlanSchema>
export function validateTemplatePlan(raw: unknown, recipe: TemplateRecipe, material: RecipeMaterial): TemplatePlan {
  const parsed = templatePlanSchema.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 15))
  const plan = parsed.data, used = new Set<string>(), slots = new Set<string>(), issues: string[] = []
  if (material.itemCount !== recipe.passport.capacity.itemCount) issues.push('incompatible-item-count')
  if (!material.fragments.length || new Set(material.fragments.map(f => f.id)).size !== material.fragments.length || material.fragments.some(f => !f.id || !f.text.trim())) issues.push('invalid-material-fragments')
  for (const binding of plan.bindings) {
    if (slots.has(binding.sourceId) || !recipe.slots.some(s => s.sourceId === binding.sourceId)) issues.push(`unknown-or-duplicate-slot:${binding.sourceId}`)
    slots.add(binding.sourceId)
    for (const id of binding.fragments) {
      if (used.has(id) || !material.fragments.some(f => f.id === id)) issues.push(`unknown-or-duplicate-fragment:${id}`)
      used.add(id)
    }
  }
  for (const fragment of material.fragments) if (!used.has(fragment.id)) issues.push(`missing-fragment:${fragment.id}`)
  for (const slot of recipe.slots) if (!slot.optional && !slots.has(slot.sourceId)) issues.push(`missing-required-slot:${slot.sourceId}`)
  if (issues.length) throw new SemanticValidationError(issues)
  comparisonValues(recipe, material, plan)
  return plan
}

export function templateCandidateStates(recipe: TemplateRecipe, plan: TemplatePlan) {
  return recipe.passport.states.filter(s => !recipe.stateOmissions?.[s.id]?.some(id => plan.bindings.some(b => b.sourceId === id))).map(s => s.id)
}

export function instantiateTemplate(recipe: TemplateRecipe, material: RecipeMaterial, raw: TemplatePlan, stateId: string, measured?: ReflowMeasurement[]): ElementIR[] {
  const plan = validateTemplatePlan(raw, recipe, material)
  const grid = measured && !recipe.comparison ? resolveTemplateReflow(recipe, measured, plan.bindings.map(b => b.sourceId)) : null
  if (grid && !recipe.stateGraphics?.[stateId]) throw new SemanticValidationError(['reflow-measurements-on-fixed-state'])
  const comparison = recipe.comparison ? resolveTemplateComparison(recipe, material, plan, measured) : null
  const bounds = comparison?.bounds ?? grid?.bounds ?? recipe.stateBounds[stateId]
  if (!bounds || !recipe.stateBounds[stateId]) throw new SemanticValidationError(['unknown-recipe-state'])
  if (recipe.stateOmissions?.[stateId]?.some(id => plan.bindings.some(b => b.sourceId === id))) throw new SemanticValidationError(['incompatible-bound-optional-slot'])
  const replacements = new Map(plan.bindings.map(b => [b.sourceId, b.fragments.map(id => material.fragments.find(f => f.id === id)!.text).join('\n')]))
  const visit = (element: ElementIR, inherited = { x: 0, y: 0 }): ElementIR[] => {
    if (comparison?.omitted.has(element.id)) return []
    if ('children' in element) {
      let offset = inherited, box = element.bounds
      // Translate a clipped source wrapper with its contents, rather than
      // moving a raster out of its unchanged clipping rectangle.
      if (comparison && (element.clipsContent || element.clipPathData)) {
        const deltas: { x: number; y: number }[] = []
        const inspect = (e: ElementIR) => {
          if (comparison.omitted.has(e.id)) return
          if ('children' in e) { e.children.forEach(inspect); return }
          const original = recipe.graphicBounds.find(g => g.sourceId === e.id)?.bounds
          const target = comparison.graphics[e.id] ?? original
          if (!original || !target || original.width !== target.width || original.height !== target.height) throw new SemanticValidationError(['comparison-unsupported-clipped-resize'])
          deltas.push({ x: target.x - original.x, y: target.y - original.y })
        }
        element.children.forEach(inspect)
        if (deltas.length) {
          offset = deltas[0]
          if (deltas.some(d => Math.abs(d.x - offset.x) > .001 || Math.abs(d.y - offset.y) > .001)) throw new SemanticValidationError(['comparison-partial-clipped-translation'])
          box = { ...box, x: box.x + offset.x - inherited.x, y: box.y + offset.y - inherited.y }
        }
      }
      const children = element.children.flatMap(e => visit(e, offset))
      return children.length ? [{ ...structuredClone(element), bounds: { ...box }, children }] : []
    }
    if (element.kind !== 'text') {
      const b = (comparison?.graphics ?? grid?.graphics ?? recipe.stateGraphics?.[stateId])?.[element.id], original = recipe.graphicBounds.find(g => g.sourceId === element.id)?.bounds
      if (b && b.width <= 0) return []
      if (!b || !original) return [structuredClone(element)]
      const box = { x: element.bounds.x + b.x - original.x - inherited.x, y: element.bounds.y + b.y - original.y - inherited.y, width: b.width, height: b.height }
      return [b.width === original.width && b.height === original.height ? { ...structuredClone(element), bounds: box } : resizeTemplatePanel(element, box)]
    }
    const text = replacements.get(element.id)
    if (text === undefined) return []
    const b = bounds[element.id], original = recipe.slots.find(s => s.sourceId === element.id)!.bounds
    const next = nativeBoundText({ element, binding: { field: 'text' } }, { text }, false)
    // Only the recipe's compiled box delta is applied in the original parent.
    next.bounds = { x: element.bounds.x + b.x - original.x - inherited.x, y: element.bounds.y + b.y - original.y - inherited.y, width: b.width, height: b.height }
    if (next.flow) next.flow.autoFit = 'NONE'
    if (comparison && recipe.slots.some(s => s.sourceId === element.id && ['heading', 'body'].includes(s.role))) next.textBox = { align: next.textBox?.align ?? 'LEFT', wrap: true, vertical: 'TOP' }
    return [next]
  }
  return recipe.elements.flatMap(e => visit(e))
}
