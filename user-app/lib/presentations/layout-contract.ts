import { z } from 'zod'
import type { EditableData, EditableTemplate } from '../design-system/editable-contract'
import type { ComponentDefinition } from '../design-system/types'
import { SemanticValidationError } from '../design-system/semantic-contract'
import { adaptationLevel, layoutStates, stateById, type SlideState } from './recipes/layout-engine-v1/states'

export const LAYOUT_EXECUTION_VERSION = 'layout-execution-2'
export const LAYOUT_RENDER_VERSION = 'layout-dom-3'
export type LayoutFragment = { id: string; text: string }
export type LayoutInput = {
  slideId: string; title: string; uploadId: string; content: LayoutFragment[]; directions: string[]
  fonts: { id: string; family: string }[]; colors: { id: string; hex: string }[]
  componentFlows?: Record<string, import('../design-system/component-adaptation').ComponentFlow>;
  preparedComponents?: import('./prepared-components').PreparedBoxes;
  components: EditableTemplate[]; graphics: ComponentDefinition[]; rules: string[]
}
export const spanSchema = z.object({ fragmentId: z.string().min(1), start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict()
const spans = z.array(spanSchema).min(1).max(200)
const block = z.object({ parts: spans, component: z.object({ id: z.string().min(1), fields: z.array(z.object({ path: z.string().regex(/^(title|text|value|unit|items\.\d+\.(title|text|value))$/), parts: spans }).strict()).min(1).max(80) }).strict().optional() }).strict()
export const colorRoles = ['background', 'primary', 'secondary', 'surface', 'onSurface', 'accent', 'onAccent', 'stroke', 'graphic'] as const
export const layoutPlanSchema = z.object({
  preferredState: z.string().min(1), fontToken: z.string().min(1), colors: z.object(Object.fromEntries(colorRoles.map(r => [r, z.string().min(1)])) as Record<typeof colorRoles[number], z.ZodString>).strict(),
  primary: spans, support: z.array(block).max(2), context: z.array(spans).max(2), facts: z.array(spans).max(3), footer: z.array(spanSchema).max(40),
  visuals: z.array(z.object({ id: z.string().min(1), reason: z.string().min(1).max(500), fit: z.enum(['cover', 'contain']) }).strict()).max(3),
  connectorId: z.string().nullable(), rationale: z.string().min(1).max(1000),
}).strict()
export type LayoutPlan = z.infer<typeof layoutPlanSchema>
export type LayoutResolution = { plan: LayoutPlan; componentFallbacks: { block: string; componentId: string; issues: string[] }[] }
export function resolveLayoutPlan(raw: unknown, input: LayoutInput, evidence: LayoutEvidence): LayoutResolution {
  const parsed = layoutPlanSchema.safeParse(raw)
  if (!parsed.success) return { plan: validateLayoutPlan(raw, input, evidence), componentFallbacks: [] }
  const plain = { ...parsed.data, support: parsed.data.support.map(b => ({ parts: b.parts })) }
  // Only optional presentation bindings may fall back; source coverage and roles
  // must already form a complete valid slide before any component is removed.
  validateLayoutPlan(plain, input, evidence)
  const componentFallbacks: LayoutResolution['componentFallbacks'] = []
  const support = parsed.data.support.map((block, index) => {
    if (!block.component) return block
    try {
      validateLayoutPlan({ ...plain, support: plain.support.map((b, i) => i === index ? block : b) }, input, evidence)
      return block
    } catch (error) {
      if (!(error instanceof SemanticValidationError)) throw error
      componentFallbacks.push({ block: `support-${index}`, componentId: block.component.id, issues: error.issues })
      return { parts: block.parts }
    }
  })
  return { plan: validateLayoutPlan({ ...parsed.data, support }, input, evidence), componentFallbacks }
}
export type LayoutSpan = z.infer<typeof spanSchema>
export type LayoutIssue = { code: string; block?: string; message: string }
export type LayoutMeasurement = { block: string; width: number; height: number; scrollWidth: number; scrollHeight: number; lines: number; fontSize: number }
export type LayoutTrial = { stateId: string; level: 0 | 1 | 2 | 3; plainComponents: boolean; wideContext?: boolean; issues: LayoutIssue[]; measurements: LayoutMeasurement[] }
export type LayoutPreviewCheck = { width: number; height: number; textBlocks: { block: string; pixels: number }[] }
export type LayoutFit = { version: typeof LAYOUT_RENDER_VERSION; planHash: string; passed: boolean; stateId: string | null; plainComponents: boolean; trials: LayoutTrial[]; previewCheck?: LayoutPreviewCheck }
export type LayoutEvidence = { fontTokens: string[] }
export const spanText = (parts: LayoutSpan[], input: LayoutInput) => parts.map(p => input.content.find(f => f.id === p.fragmentId)!.text.slice(p.start, p.end)).join(' ')
export const planSpans = (p: LayoutPlan) => [p.primary, ...p.support.map(b => b.parts), ...p.context, ...p.facts, p.footer].flat()

function coverage(parts: LayoutSpan[], content: LayoutFragment[], issues: string[], prefix = 'content') {
  const intervals = new Map(content.map(f => [f.id, [] as LayoutSpan[]]))
  for (const p of parts) {
    const source = content.find(f => f.id === p.fragmentId)
    if (!source || p.start >= p.end || p.end > source.text.length) { issues.push(`${prefix}:invalid-source-range`); continue }
    for (const at of [p.start, p.end]) if (at > 0 && at < source.text.length &&
      (/[\p{L}\p{N}]/u.test(source.text[at - 1]) && /[\p{L}\p{N}]/u.test(source.text[at]) || /[\uD800-\uDBFF]/.test(source.text[at - 1]) && /[\uDC00-\uDFFF]/.test(source.text[at]) || /[\p{M}\u200D\uFE0F]/u.test(source.text[at]) || source.text[at - 1] === '\u200D')) issues.push(`${prefix}:word-or-glyph-split`)
    intervals.get(p.fragmentId)!.push(p)
  }
  for (const f of content) {
    let cursor = 0
    for (const p of intervals.get(f.id)!.sort((a, b) => a.start - b.start)) { if (p.start !== cursor) issues.push(`${prefix}:gap-or-duplicate:${f.id}:${cursor}`); cursor = p.end }
    if (cursor !== f.text.length) issues.push(`${prefix}:missing:${f.id}:${cursor}/${f.text.length}`)
  }
}
export function componentFields(t: EditableTemplate): string[] {
  if (t.sourceLayout) return [...new Set(t.sourceLayout.text.flatMap(({ binding: b }) => b.field === 'metric' ? ['value', 'unit'] : b.field === 'item' ? [`items.${b.index ?? Math.max(0, t.data.items?.findIndex(i => i.id === b.id) ?? 0)}.${b.part ?? 'text'}`] : [b.field]))]
  return [...['title', 'text', 'value', 'unit'].filter(k => k in t.data), ...(t.data.items ?? []).flatMap((v, i) => ['title', 'text', 'value'].filter(k => k in v).map(k => `items.${i}.${k}`))]
}
export function componentData(binding: NonNullable<LayoutPlan['support'][number]['component']>, template: EditableTemplate, input: LayoutInput): EditableData {
  const data: EditableData = { items: template.data.items?.map(i => ({ id: i.id })) }
  for (const field of binding.fields) {
    const value = spanText(field.parts, input), match = /^items\.(\d+)\.(title|text|value)$/.exec(field.path)
    if (match) { data.items ??= []; data.items[Number(match[1])] ??= {}; Object.assign(data.items[Number(match[1])], { [match[2]]: value }) }
    else Object.assign(data, { [field.path]: value })
  }
  return data
}
export function compatibleState(p: LayoutPlan, s: SlideState) {
  if (p.context.length && !s.context || p.footer.length && !s.footer || p.support.length > (s.support?.length ?? 0)) return false
  if (p.facts.length && s.factsY === undefined && (!s.wideInfo || p.facts.length > 1)) return false
  if (p.visuals.length !== (s.visuals?.length ?? 0)) return false
  return true
}
export function candidateStates(p: LayoutPlan): SlideState[] {
  const preferred = stateById(p.preferredState)!
  const eligible = layoutStates.filter(s => compatibleState(p, s))
  return eligible.sort((a, b) => adaptationLevel(preferred, a) - adaptationLevel(preferred, b) || a.localOrder - b.localOrder)
}
export function layoutCandidates(plan: LayoutPlan) {
  return candidateStates(plan).flatMap(state => (plan.support.some(b => b.component) ? [false, true] : [false]).flatMap(plainComponents =>
    (state.context && plan.context.length === 1 ? [false, true] : [false]).map(wideContext => ({ state, plainComponents, wideContext,
      level: Math.max(adaptationLevel(stateById(plan.preferredState)!, state), wideContext ? 2 : 0) as 0 | 1 | 2 | 3 }))))
}
export function validateLayoutPlan(raw: unknown, input: LayoutInput, evidence: LayoutEvidence): LayoutPlan {
  const parsed = layoutPlanSchema.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.slice(0, 12).map(i => `${i.path.join('.')}: ${i.message}`))
  const p = parsed.data, issues: string[] = []
  if (!stateById(p.preferredState)) issues.push('unknown-slide-state')
  if (!input.fonts.some(f => f.id === p.fontToken) || !evidence.fontTokens.includes(p.fontToken)) issues.push('FONT_TOKEN_UNAVAILABLE')
  if (Object.values(p.colors).some(id => !input.colors.some(c => c.id === id))) issues.push('INVALID_COLOR_COMBINATION:unknown-token')
  coverage(planSpans(p), input.content, issues)
  if (!spanText(p.primary.filter(s => input.content.some(f => f.id === s.fragmentId)), input).trim()) issues.push('primary-thesis-required')
  const graphicIds = new Set(input.graphics.map(g => g.id))
  if (p.visuals.some(v => !graphicIds.has(v.id)) || p.connectorId && !graphicIds.has(p.connectorId)) issues.push('unknown-graphic')
  if (new Set(p.visuals.map(v => v.id)).size !== p.visuals.length) issues.push('mosaic-must-not-repeat-visual')
  for (const b of p.support) if (b.component) {
    const t = input.components.find(t => t.id === b.component!.id)
    if (!t) { issues.push('unknown-or-unqualified-component'); continue }
    const allowed = componentFields(t), paths = b.component.fields.map(f => f.path)
    if (new Set(paths).size !== paths.length || paths.some(path => !allowed.includes(path))) issues.push('invalid-component-fields')
    const fields = b.component.fields.flatMap(f => f.parts)
    coverage([...planSpans(p).filter(s => !b.parts.includes(s)), ...fields], input.content, issues, 'component')
    const signature = (parts: LayoutSpan[]) => {
      const ranges: LayoutSpan[] = []
      for (const s of [...parts].sort((a, b) => a.fragmentId.localeCompare(b.fragmentId) || a.start - b.start)) {
        const previous = ranges.at(-1)
        if (previous && previous.fragmentId === s.fragmentId && previous.end === s.start) previous.end = s.end
        else ranges.push({ ...s })
      }
      return JSON.stringify(ranges)
    }
    if (signature(fields) !== signature(b.parts)) issues.push('component-must-bind-every-source-character-once')
  }
  if (issues.length) throw new SemanticValidationError([...new Set(issues)])
  if (!candidateStates(p).length) throw new SemanticValidationError(['No verified state supports these semantic blocks. Regroup the same source ranges without omission; do not invent geometry.'])
  return p
}
