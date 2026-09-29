import { z } from 'zod'
import type { BoundsIR, ElementIR, ShapeElementIR } from '../../../vendor/drag/src/core/model'
import { primitivePath } from '../../design-system/pattern-geometry'
import { contentHash } from '../../design-system/catalog'
import { SemanticValidationError } from '../../design-system/semantic-contract'
import { containsBox, horizontalIntersection, type TemplateRecipe } from './template-contract'

const REFLOW_VERSION = 'template-grid-reflow-2'
export const templateReflowSchema = z.object({
  columns: z.number().int().min(2).max(4), header: z.enum(['inline', 'stacked']),
  rationale: z.string().min(1).max(500),
}).strict()
export type TemplateReflow = z.infer<typeof templateReflowSchema>
export type ReflowMeasurement = { sourceId: string; width: number; height: number }
const fail = (issue: string): never => { throw new SemanticValidationError([issue]) }
const overlap = (a: BoundsIR, b: BoundsIR) => horizontalIntersection(a, b) && a.y < b.y + b.height && b.y < a.y + a.height
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

// Recognize the canonical native rounded rectangle, not an arbitrary vector.
// Regenerating its path preserves the four absolute corner radii when resizing.
function panelCorners(element: ShapeElementIR): [number, number, number, number] {
  const path = element.pathData ?? '', tokens = path.match(/[A-Za-z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []
  if (path.replace(/[MLCZ]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[\s,]/g, '')) return fail('reflow-panel-invalid-path')
  if (tokens.filter(t => /^[A-Za-z]$/.test(t)).join('') !== 'MLCLCLCLCZ') return fail('reflow-panel-not-rounded-rectangle')
  const values = tokens.filter(t => !/^[A-Za-z]$/.test(t)).map(Number), { width, height } = element.bounds
  const radii: [number, number, number, number] = [values[0], width - values[2], height - values[11], values[18]]
  if (radii.some(r => !Number.isFinite(r) || r < 0 || r > Math.min(width, height) / 2)) return fail('reflow-panel-invalid-corners')
  const expected = primitivePath({ kind: 'rounded', corners: radii.map(r => r / Math.min(width, height)) as typeof radii }, width, height)
    .match(/[A-Za-z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)!
  if (tokens.length !== expected.length || tokens.some((t, i) => /^[A-Za-z]$/.test(t) ? t !== expected[i] : Math.abs(Number(t) - Number(expected[i])) > .01)) return fail('reflow-panel-not-rounded-rectangle')
  return radii
}

export function resizeTemplatePanel(element: ElementIR, bounds: BoundsIR): ShapeElementIR {
  if (element.kind !== 'rectangle' && element.kind !== 'path' || element.rotation || element.centeredTransform?.flipH || element.centeredTransform?.flipV || element.clipBounds) return fail('reflow-unsupported-panel')
  const next = { ...structuredClone(element), bounds: { ...bounds } }
  if (element.kind === 'path') {
    const radii = panelCorners(element), size = Math.min(bounds.width, bounds.height)
    if (size <= 0 || radii.some(r => r * 2 > size)) return fail('reflow-panel-too-small')
    next.pathData = primitivePath({ kind: 'rounded', corners: radii.map(r => r / size) as typeof radii }, bounds.width, bounds.height)
  }
  return next
}

function gridGeometry(recipe: TemplateRecipe, proposal: TemplateReflow, measured?: ReflowMeasurement[]) {
  const { itemCount } = recipe.proposal, { columns, header } = proposal
  if (columns >= itemCount || itemCount % columns !== 0) return fail('reflow-requires-complete-multiple-rows')
  const leaves = new Map<string, { element: ElementIR; guarded: boolean }>()
  const visit = (elements: ElementIR[], guarded = false) => {
    for (const e of elements) {
      const guard = guarded || !!(e.rotation || e.centeredTransform?.flipH || e.centeredTransform?.flipV || 'children' in e && (e.clipsContent || e.clipPathData))
      if ('children' in e) visit(e.children, guard)
      else leaves.set(e.id, { element: e, guarded: guard })
    }
  }
  visit(recipe.elements)
  const items = Array.from({ length: itemCount }, (_, i) => {
    const slots = recipe.slots.filter(s => s.item === i + 1)
    const heading = slots.find(s => s.role === 'heading')!, body = slots.find(s => s.role === 'body')!
    const ordinal = slots.find(s => s.role === 'ordinal')
    const panel = recipe.graphicBounds.find(g => g.sourceId === body.ownerId)
    if (!panel || heading.ownerId !== panel.sourceId || ordinal && ordinal.ownerId !== panel.sourceId || slots.filter(s => s.role === 'ordinal').length > 1) return fail('reflow-requires-unambiguous-owned-card-fields')
    const leaf = leaves.get(panel.sourceId)
    if (!leaf || leaf.guarded) return fail('reflow-unsupported-panel-transform')
    resizeTemplatePanel(leaf.element, leaf.element.bounds)
    if (slots.some(s => !['heading', 'body', 'ordinal'].includes(s.role) && !s.optional)) return fail('reflow-extra-required-card-slot')
    const padding = Math.min(...[heading, body, ...(ordinal ? [ordinal] : [])].map(s => s.bounds.x - panel.bounds.x))
    if (padding <= 0 || ![heading, body, ...(ordinal ? [ordinal] : [])].every(s => containsBox(panel.bounds, s.bounds))) return fail('reflow-missing-source-inset')
    return { panel, heading, body, ordinal, padding, slots }
  })
  if (new Set(items.map(i => i.panel.sourceId)).size !== itemCount) return fail('reflow-shared-panel')
  const panels = items.map(i => i.panel.bounds), left = Math.min(...panels.map(b => b.x)), right = Math.max(...panels.map(b => b.x + b.width)), top = Math.min(...panels.map(b => b.y))
  const ordered = [...panels].sort((a, b) => a.x - b.x)
  if (panels.some(b => Math.abs(b.y - top) > 2) || items.some((item, i) => item.panel.bounds.x !== ordered[i].x)) return fail('reflow-requires-observed-reading-order-row')
  const gaps = ordered.slice(1).map((b, i) => b.x - ordered[i].x - ordered[i].width)
  if (gaps.some(g => g < 0)) return fail('reflow-overlapping-source-panels')
  const gap = median(gaps), padding = median(items.map(i => i.padding)), canvas = recipe.passport.canvas
  const reserved = recipe.graphicBounds.filter(g => !items.some(i => i.panel.sourceId === g.sourceId) && g.bounds.width * g.bounds.height < canvas.width * canvas.height * .7)
    .map(g => g.bounds).concat(recipe.slots.filter(s => s.item === 0).map(s => (recipe.stateBounds.rebalanced ?? recipe.stateBounds.observed)[s.sourceId]))
  let bottom = canvas.height - Math.max(0, Math.min(left, canvas.width - right))
  const area = { x: left, y: top, width: right - left, height: bottom - top }
  for (const b of reserved) if (overlap(area, b)) bottom = Math.min(bottom, b.y - padding)
  const rows = itemCount / columns, width = (right - left - gap * (columns - 1)) / columns, height = (bottom - top - gap * (rows - 1)) / rows
  if (width <= 0 || height <= 0) return fail('reflow-no-free-area')
  const bounds = structuredClone(recipe.stateBounds.rebalanced ?? recipe.stateBounds.expanded ?? recipe.stateBounds.observed)
  const graphics: Record<string, BoundsIR> = {}, omissions: string[] = []
  const layouts = items.map(item => {
    const { heading, body, ordinal, padding: inset } = item
    const textGaps = [body.bounds.y - heading.bounds.y - heading.bounds.height, ...(ordinal ? [heading.bounds.y - ordinal.bounds.y - ordinal.bounds.height] : [])].filter(g => g > 0)
    const innerGap = Math.min(inset, ...textGaps), innerWidth = width - 2 * inset
    const headingWidth = innerWidth - (header === 'inline' && ordinal ? ordinal.bounds.width + innerGap : 0)
    const textHeight = (id: string, boxWidth: number, fallback: number) => {
      const m = measured?.find(m => m.sourceId === id)
      if (m && (Math.abs(m.width - boxWidth) > .001 || !Number.isFinite(m.height) || m.height < 0 || m.height > canvas.height * 10)) return fail(`reflow-invalid-measurement:${id}`)
      return m?.height ?? fallback
    }
    const headingHeight = textHeight(heading.sourceId, headingWidth, heading.bounds.height)
    const ordinalHeight = ordinal ? textHeight(ordinal.sourceId, ordinal.bounds.width, ordinal.bounds.height) : 0
    const headerHeight = header === 'inline' ? Math.max(headingHeight, ordinalHeight) : headingHeight + (ordinal ? ordinalHeight + innerGap : 0)
    const bodyHeight = textHeight(body.sourceId, innerWidth, body.bounds.height)
    return { innerGap, innerWidth, headingWidth, headingHeight, ordinalHeight, headerHeight, minimum: 2 * inset + headerHeight + innerGap + bodyHeight }
  })
  // Rows share only the fixed source content region. Measured ink can reclaim
  // empty header frames and rebalance row heights, never shrink text or insets.
  const minima = Array.from({ length: rows }, (_, row) => Math.max(...layouts.slice(row * columns, (row + 1) * columns).map(l => l.minimum)))
  const spare = bottom - top - gap * (rows - 1) - minima.reduce((sum, value) => sum + value, 0)
  const rowHeights = measured && spare >= 0 ? minima.map(h => h + spare / rows) : Array.from({ length: rows }, () => height)
  for (const [index, item] of items.entries()) {
    const { panel, heading, body, ordinal, padding: inset } = item
    const row = Math.floor(index / columns)
    const box = { x: left + index % columns * (width + gap), y: top + rowHeights.slice(0, row).reduce((sum, h) => sum + h + gap, 0), width, height: rowHeights[row] }
    resizeTemplatePanel(leaves.get(panel.sourceId)!.element, box)
    graphics[panel.sourceId] = box
    const { innerGap, innerWidth, headerHeight, ordinalHeight, headingHeight } = layouts[index], x = box.x + inset, y = box.y + inset
    if (ordinal) bounds[ordinal.sourceId] = { x, y, width: ordinal.bounds.width, height: Math.max(1, ordinalHeight) }
    const headingX = header === 'inline' && ordinal ? x + ordinal.bounds.width + innerGap : x
    bounds[heading.sourceId] = { x: headingX, y: header === 'stacked' && ordinal ? y + ordinalHeight + innerGap : y, width: x + innerWidth - headingX, height: header === 'inline' ? headerHeight : headingHeight }
    bounds[body.sourceId] = { x, y: y + headerHeight + innerGap, width: innerWidth, height: box.height - 2 * inset - headerHeight - innerGap }
    for (const field of [heading, body, ...(ordinal ? [ordinal] : [])]) if (bounds[field.sourceId].width <= 0 || bounds[field.sourceId].height <= 0 || !containsBox(box, bounds[field.sourceId], 0)) return fail('reflow-no-text-capacity')
    omissions.push(...item.slots.filter(s => ![heading.sourceId, body.sourceId, ordinal?.sourceId].includes(s.sourceId)).map(s => s.sourceId))
  }
  return { bounds, graphics, omissions }
}

export function resolveTemplateReflow(recipe: TemplateRecipe, measured: ReflowMeasurement[], boundIds: string[]) {
  if (!recipe.reflow) return fail('reflow-not-authorized')
  const fields = recipe.slots.filter(s => s.item > 0 && ['heading', 'body', 'ordinal'].includes(s.role) && boundIds.includes(s.sourceId))
  if (measured.length !== fields.length || new Set(measured.map(m => m.sourceId)).size !== fields.length || fields.some(s => !measured.some(m => m.sourceId === s.sourceId))) return fail('reflow-incomplete-measurements')
  return gridGeometry(recipe, recipe.reflow, measured)
}

export function validateTemplateReflow(raw: unknown, recipe: TemplateRecipe): TemplateReflow {
  const parsed = templateReflowSchema.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`))
  gridGeometry(recipe, parsed.data)
  return parsed.data
}

export async function applyTemplateReflow(base: TemplateRecipe, raw: unknown, modelRunId: string): Promise<TemplateRecipe> {
  const proposal = validateTemplateReflow(raw, base), geometry = gridGeometry(base, proposal), recipe = structuredClone(base)
  const stateId = `grid-${proposal.columns}x${base.proposal.itemCount / proposal.columns}-${proposal.header}`
  recipe.stateBounds[stateId] = geometry.bounds
  recipe.stateGraphics = { ...recipe.stateGraphics, [stateId]: geometry.graphics }
  recipe.stateOmissions = { ...recipe.stateOmissions, [stateId]: geometry.omissions }
  recipe.passport.version = await contentHash({ version: REFLOW_VERSION, base: base.passport.version, proposal, geometry })
  recipe.passport.invariants = base.passport.invariants.filter(i => i !== 'original-outer-grid').concat('original-content-axes-and-insets', 'original-corner-radii', 'row-major-reading-order')
  recipe.passport.states.push({ id: stateId, family: 'repeated-blocks', evidence: 'proposed', geometryRef: `${recipe.passport.id}#${stateId}` })
  recipe.passport.transitions.push({ from: base.passport.states.at(-1)!.id, to: stateId, level: 3, when: 'Previous states overflow. Reflow owned cards into complete rows. Measured ink determines header and row heights inside the fixed source region; retain content axes/insets/paint/fonts and reading order. Extra optional item fields must be unbound.' })
  recipe.reflow = { ...proposal, modelRunId, previousVersion: base.passport.version }
  return recipe
}
