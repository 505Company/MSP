import { flowIssues } from '../design-system/component-flow-layout'
import { z } from 'zod'
import type { EditableTemplate } from '../design-system/editable-contract'
import { nativeBoundText } from '../design-system/editable-native-layout'
import { scaleText } from '../../vendor/drag/src/core/text-flow'
import { componentData, type LayoutInput } from './layout-contract'
import { preparedSlots, preparedContent } from './prepared-components'
import { LAB_VERSION, constraintsSchema, measurementIssues, MINIMUM_TEXT_CONTRAST } from '../component-lab/contract'
import { proofCaseSchema } from '../component-lab/proof'

export const ADAPTIVE_FLOW_VERSION = 'adaptive-blocks-5'
export const ADAPTIVE_FLOW_RENDER = 'adaptive-render-9'
export const ADAPTIVE_COMPONENTS_VERSION = 'adaptive-blocks-2'
export const ADAPTIVE_COMPONENT_RENDER = 'adaptive-render-6'
export const ADAPTIVE_GRID_VERSION = 'adaptive-blocks-3'
export const ADAPTIVE_GRID_RENDER = 'adaptive-render-7'
export const adaptiveComponentSchema = z.object({ id: z.string().min(1).max(120), fields: z.array(z.object({
  path: z.string().regex(/^(title|text|value|unit|items\.\d+\.(title|text|value)|slots\.[0-2])$/),
  fragments: z.array(z.string().min(1).max(80)).min(1).max(100),
}).strict()).min(1).max(20) }).strict()
export type AdaptiveComponent = z.infer<typeof adaptiveComponentSchema>

export function componentSlots(t: EditableTemplate, input?: LayoutInput) {
  if (input?.preparedComponents?.[t.id]) return preparedSlots(input.preparedComponents[t.id].profile)
  return t.sourceLayout?.text.map(s => ({ sourceId: s.element.id,
    paths: s.binding.field === 'metric' ? ['value', 'unit'] : s.binding.field === 'item'
      ? [`items.${s.binding.index ?? t.data.items?.findIndex(i => i.id === s.binding.id) ?? 0}.${s.binding.part ?? 'text'}`] : [s.binding.field],
    metric: ['value', 'metric'].includes(s.binding.field),
  })) ?? []
}

/** Initial adapter: qualified native cards, not quantitative bars or complex
 * diagrams. Original artwork and field geometry remain intact. */
export function adaptiveComponents(input: LayoutInput) {
  return input.components.filter(t => {
    if (input.preparedComponents?.[t.id]) return true
    const slots = componentSlots(t), fields = slots.flatMap(s => s.paths)
    return t.sourceLayout && !t.sourceLayout.bar && (t.sourceLayout.structure?.panels ?? 0) <= 1 && !t.children && !t.sourceChart && !t.sourceInline && !t.diagramGraph && !t.sourceRegion &&
      t.width > 0 && t.height > 0 && slots.length >= 2 && slots.length <= 12 && new Set(fields).size === fields.length &&
      t.sourceLayout.text.every(s => !s.element.rotation && !s.element.centeredTransform?.flipH && !s.element.centeredTransform?.flipV && s.element.bounds.width > 0 && s.element.bounds.height > 0)
  })
}
export function componentBindingIssues(binding: AdaptiveComponent, ids: string[], input: LayoutInput) {
  const t = adaptiveComponents(input).find(t => t.id === binding.id)
  if (!t) return ['unknown-or-unsupported-adaptive-component']
  const slots = componentSlots(t, input), paths = binding.fields.map(f => f.path), bound = binding.fields.flatMap(f => f.fragments)
  const issues: string[] = []
  if(!input.preparedComponents?.[t.id]&&input.componentFlows?.[t.id]&&!paths.includes('value'))issues.push('component-number-field-required')
  if (input.preparedComponents?.[t.id]) try { preparedContent(binding, input.preparedComponents[t.id], input.content) } catch { issues.push('prepared-component-fields') }
  if (new Set(paths).size !== paths.length) issues.push(`component-duplicate-fields:${t.id}`)
  for (const path of paths.filter(p => !slots.some(s => s.paths.includes(p)))) issues.push(`component-unknown-field:${t.id}:${path}`)
  for (const slot of slots.filter(s => !binding.fields.some(f => s.paths.includes(f.path)))) issues.push(`component-required-field:${t.id}:${slot.paths.join('|')}; choose a simpler card if this content is absent`)
  if (ids.length !== bound.length || new Set(bound).size !== bound.length || bound.some(id => !ids.includes(id))) issues.push('component-must-bind-all-part-fragments-once')
  for (const field of binding.fields) if (!input.preparedComponents?.[t.id] && slots.some(s => s.metric && s.paths.includes(field.path))) {
    const value = field.fragments.map(id => input.content.find(f => f.id === id)?.text ?? '').join('\n')
    if (value.length > 32 || field.path === 'value' && !/\d/.test(value)) issues.push('component-value-must-be-short-source-number')
  }
  return issues
}
export function adaptiveComponentData(binding: AdaptiveComponent, template: EditableTemplate, input: LayoutInput) {
  // Reuse the existing cleared-data binder; newline joins match whole-fragment
  // semantics without asking the model for fragile character offsets.
  const fields = binding.fields.map(f => ({ path: f.path, parts: [{ fragmentId: f.path, start: 0,
    end: f.fragments.map(id => input.content.find(f => f.id === id)!.text).join('\n').length }] }))
  return componentData({ id: binding.id, fields }, template, { ...input, content: binding.fields.map(f => ({ id: f.path, text: f.fragments.map(id => input.content.find(f => f.id === id)!.text).join('\n') })) })
}
export function componentScale(t: EditableTemplate, availableWidth: number) {
  const body = t.sourceLayout!.text.filter((_, i) => !componentSlots(t)[i].metric)
  const preferred = Math.max(1, 40 / Math.min(...body.map(s => s.element.fontSize)))
  return Math.min(availableWidth / t.width, preferred, 2)
}
export function componentElements(binding: AdaptiveComponent, t: EditableTemplate, input: LayoutInput, family: string, fontStep: number, legacyTypography = false) {
  const data = adaptiveComponentData(binding, t, input)
  return t.sourceLayout!.text.map(slot => {
    const e = scaleText(nativeBoundText(slot, data), legacyTypography ? [1, .95, .9, .85, .8][fontStep] : 1 - fontStep / 16)
    // scaleText materializes an absent paragraph list as []; the native painter
    // treats [] as an explicitly empty flow. Recovered glyph fields use no list.
    if (!e.paragraphs?.length) delete e.paragraphs
    e.fontFamily = family
    e.styleRuns = e.styleRuns?.map(r => ({ ...r, fontFamily: family }))
    e.flow = { ...e.flow, columns: e.flow?.columns ?? 1, gap: e.flow?.gap ?? 0, autoFit: 'NONE' }
    return e
  })
}
export function componentColumns(parts: { component?: AdaptiveComponent | null }[], input: LayoutInput, width: number, step: number, mixed = true, legacyTypography = false, localSteps?: number[]) {
  const cards = parts.filter(p => p.component)
  if (cards.length < 2 || !mixed && cards.length !== parts.length) return 1
  const minimum = Math.max(320, ...cards.map(p => {
    const t = input.components.find(t => t.id === p.component!.id)!, slots = componentSlots(t)
    if (input.preparedComponents?.[t.id]) return input.preparedComponents[t.id].profile.minWidth
    if (input.componentFlows?.[t.id]) return input.componentFlows[t.id].minWidth
    return t.width * Math.max(...componentElements(p.component!, t, input, '', localSteps?.[parts.indexOf(p)] ?? step, legacyTypography).map((e, i) =>
      (slots[i].metric ? 48 : 24) / Math.min(e.fontSize, ...e.styleRuns?.map(r => r.fontSize) ?? [])))
  }))
  const consecutive = localSteps ? Math.max(...componentRows(parts, 3).filter(r => parts[r.indices[0]].component).map(r => r.indices.length)) : cards.length
  return Math.min(3, consecutive, Math.max(1, Math.floor((width + 16) / (minimum + 16))))
}
export function componentRows(parts: { component?: AdaptiveComponent | null }[], columns: number) {
  const rows: { indices: number[]; columns: number }[] = []
  for (const [i, part] of parts.entries()) {
    const last = rows.at(-1)
    if (part.component && last?.columns === columns && last.indices.length < columns && parts[last.indices[0]].component) last.indices.push(i)
    else rows.push({ indices: [i], columns: part.component ? columns : 1 })
  }
  return rows
}
const number = z.number().finite().min(-100000).max(1000000)
const rect = z.object({ x: number, y: number, width: number, height: number }).strict()
export const componentMeasurementSchema = rect.extend({
  id: z.string(), templateId: z.string(), scale: number, fontFamily: z.string(), assetsLoaded: z.boolean(),
  layoutVersion: z.literal('metric-caption-flow-1').optional(), flowDirection: z.enum(['row','stack']).optional(),
  fontStep: z.number().int().min(0).max(4).optional(),
  prepared: proofCaseSchema.extend({ version: z.literal(LAB_VERSION), fingerprint: z.string().length(64), constraints: constraintsSchema,
    feasibleSizes: z.array(z.object({ width: number.positive(), height: number.positive(), state: z.enum(['vertical', 'horizontal', 'compact']), step: z.number().int().min(0).max(4) }).strict()).max(4),
  }).optional(),
  fields: z.array(z.object({ sourceId: z.string(), text: z.string().max(40000), fontSize: number, box: rect, ink: rect }).strict()).max(20),
}).strict()
export type ComponentMeasurement = z.infer<typeof componentMeasurementSchema>

export function componentMeasurementIssues(m: ComponentMeasurement, binding: AdaptiveComponent, input: LayoutInput, family: string, step: number, availableWidth: number, preserveInsets = true, legacyTypography = false, fillWidth = false, flow = false, prepared = false, background?: string) {
  const t = adaptiveComponents(input).find(t => t.id === binding.id)
  if (!t) return ['component-unavailable']
  const pin = prepared && input.preparedComponents?.[t.id]
  if (pin) {
    const evidence = m.prepared, p = pin.profile, issues: string[] = []
    if (!evidence || evidence.status !== 'fits' || !evidence.chosen || evidence.fingerprint !== p.fingerprint || evidence.version !== LAB_VERSION || m.templateId !== p.id || !m.assetsLoaded || m.scale !== 1) return ['prepared-component-evidence']
    let content: Record<string, string>
    try { content = preparedContent(binding, pin, input.content) } catch { return ['prepared-component-content'] }
    issues.push(...measurementIssues(p, content, evidence.chosen, evidence.constraints))
    if (background && evidence.constraints.background?.toLowerCase() !== background.toLowerCase()) issues.push('prepared-component-background')
    if (Math.abs(evidence.constraints.width - availableWidth) > 1 || Math.abs(m.height - evidence.chosen.height) > 1 || m.fields.length !== evidence.chosen.fields.length || m.fields.some((f, i) => { const expected = evidence.chosen!.fields[i]; return f.sourceId !== expected.id || f.text !== expected.text || Math.abs(f.fontSize - expected.fontSize) > .01 || ['box', 'ink'].some(k => (['x', 'y', 'width', 'height'] as const).some(axis => Math.abs(f[k as 'box'][axis] - expected[k as 'box'][axis] - (axis === 'x' ? m.x : axis === 'y' ? m.y : 0)) > 1)) })) issues.push('prepared-component-geometry')
    if (evidence.pixels?.length !== p.fields.length || p.fields.some(f => !evidence.pixels?.some(v => v.id === f.id && v.count >= 3 && v.contrast >= MINIMUM_TEXT_CONTRAST)) || p.artwork && (evidence.artwork?.hash !== p.artwork.hash || evidence.artwork.count < 3)) issues.push('prepared-component-pixels')
    return issues
  }
  if (m.prepared) return ['unexpected-prepared-component']
  const profile = flow && input.componentFlows?.[t.id]
  if (profile) {
    const local = { width: m.width, height: m.height, direction: m.flowDirection ?? 'stack', fontStep: m.fontStep ?? -1, fields: m.fields.map(f => ({ ...f, box: { ...f.box, x: f.box.x-m.x, y: f.box.y-m.y }, ink: { ...f.ink, x: f.ink.x-m.x, y: f.ink.y-m.y } })) }
    return [...flowIssues(local,t,adaptiveComponentData(binding,t,input),profile), ...(m.layoutVersion!==profile.version || !m.flowDirection || m.templateId!==t.id || !m.assetsLoaded || Math.abs(m.width-availableWidth)>1 || m.scale!==1 ? ['component-flow-evidence'] : [])]
  }
  if(m.layoutVersion||m.flowDirection)return ['unexpected-component-flow']
  const scale = fillWidth ? availableWidth / t.width : componentScale(t, availableWidth), elements = componentElements(binding, t, input, family, step, legacyTypography), issues: string[] = []
  if (fillWidth && (m.fontStep !== step || scale > 2 + .001)) issues.push(`component-size-contract:${m.id}`)
  if (m.templateId !== t.id || m.fontFamily !== family || Math.abs(m.scale - scale) > .001 || Math.abs(m.width - t.width * scale) > 1 || Math.abs(m.height - t.height * scale) > 1 || !m.assetsLoaded) issues.push(`component-evidence:${m.id}`)
  if (m.fields.length !== elements.length || elements.some(e => m.fields.filter(f => f.sourceId === e.id).length !== 1)) return [...issues, `component-fields:${m.id}`]
  const contains = (a: typeof m.fields[number]['box'], b: typeof a) => b.width > 0 && b.height > 0 && b.x >= a.x - 2 && b.y >= a.y - 2 && b.x + b.width <= a.x + a.width + 2 && b.y + b.height <= a.y + a.height + 2
  for (const [i, e] of elements.entries()) {
    const f = m.fields.find(f => f.sourceId === e.id)!, b = e.bounds
    const minSize = Math.min(e.fontSize, ...e.styleRuns?.map(r => r.fontSize) ?? []) * scale
    if (f.text !== e.text || Math.abs(f.fontSize - minSize) > .01 || minSize < (componentSlots(t)[i].metric ? 48 : 24) - .01) issues.push(`component-text:${m.id}:${e.id}`)
    if (Math.abs(f.box.x - (m.x + b.x * scale)) > 1 || Math.abs(f.box.y - (m.y + b.y * scale)) > 1 || Math.abs(f.box.width - b.width * scale) > 1 || Math.abs(f.box.height - b.height * scale) > 1 || !contains(m, f.ink)) issues.push(`component-overflow:${m.id}:${e.id}`)
    // Recovered display numbers can have intentionally tight source frames.
    // Body fields must fit their own frame, preserving the native card insets.
    if (preserveInsets && !componentSlots(t)[i].metric && !contains(f.box, f.ink)) issues.push(`component-field-overflow:${m.id}:${e.id}`)
  }
  for (let i = 0; i < m.fields.length; i++) for (let j = i + 1; j < m.fields.length; j++) {
    const a = m.fields[i].ink, b = m.fields[j].ink
    if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 2 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 2) issues.push(`component-collision:${m.id}`)
  }
  return issues
}
