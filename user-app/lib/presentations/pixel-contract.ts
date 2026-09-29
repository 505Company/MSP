import { z } from 'zod'
import { SemanticValidationError } from '../design-system/semantic-contract'
import { adaptiveComponents, componentBindingIssues, componentSlots } from './adaptive-components'
import type { LayoutInput } from './layout-contract'
import type { EditableTemplate } from '../design-system/editable-contract'
import { flowGeometry } from '../design-system/component-flow-layout'
import { contrastRatio } from './layout-html'

const id = z.string().min(1).max(120), ids = z.array(id).min(1).max(120)
export const pixelBriefSchema = z.object({
  version: z.literal('qwen-design-brief-1'), intent: z.string().min(1).max(1500),
  authorState: id, authorAdaptation: z.string().min(1).max(2000),
  compositionId: id.nullable(), compositionUse: z.enum(['exact', 'adapted', 'none']), compositionReason: z.string().min(1).max(1500),
  title: ids, directions: z.array(z.object({ sourceId: id, reason: z.string().min(1).max(500) }).strict()).max(20),
  groups: z.array(z.object({ id, role: z.enum(['argument', 'metric', 'support']), fragments: ids,
    placement: z.enum(['left', 'right', 'bottom']), component: z.object({ id, fields: z.array(z.object({ path: id, fragments: ids }).strict()).min(1).max(20) }).strict().nullable(),
    appearance: z.string().min(1).max(1000),
  }).strict()).min(1).max(8),
  fontToken: id, background: id, priorities: z.array(z.string().min(1).max(600)).min(1).max(8),
  typesettingBrief: z.string().min(1).max(6000),
}).strict()
export type PixelBrief = z.infer<typeof pixelBriefSchema>
export type PixelEnvironment = { input: LayoutInput; compositions: EditableTemplate[]; fontTokens: string[] }
export const pixelBoxSchema = z.object({ x: z.number().finite().min(0).max(1920), y: z.number().finite().min(0).max(1080), width: z.number().finite().positive().max(1920), height: z.number().finite().positive().max(1080) }).strict()
export type PixelBox = z.infer<typeof pixelBoxSchema>
export const pixelPlanSchema = z.object({
  version: z.literal('qwen-pixel-plan-1'), briefHash: z.string().length(64),
  canvas: z.object({ width: z.literal(1920), height: z.literal(1080), background: id }).strict(),
  regions: z.array(z.object({ id, box: pixelBoxSchema, background: id.nullable(), radius: z.number().min(0).max(8),
    mode: z.enum(['plain', 'native', 'flow']), fontStep: z.number().int().min(0).max(4).nullable(), flowDirection: z.enum(['row', 'stack']).nullable(),
  }).strict()).min(2).max(9),
  texts: z.array(z.object({ id, regionId: id, fragments: ids, field: id.nullable(), box: pixelBoxSchema,
    fontToken: id, fontSize: z.number().min(24).max(220), lineHeight: z.number().min(24).max(264),
    weight: z.number().int().min(400).max(800), color: id, opacity: z.number().min(.5).max(1),
    align: z.enum(['left', 'center', 'right']), wrap: z.boolean(),
  }).strict()).min(1).max(60),
  calculationSummary: z.string().min(1).max(3000),
}).strict()
export type PixelPlan = z.infer<typeof pixelPlanSchema>
export const containsPixelBox = (a: PixelBox, b: PixelBox, tolerance = 1) => b.x >= a.x - tolerance && b.y >= a.y - tolerance && b.x + b.width <= a.x + a.width + tolerance && b.y + b.height <= a.y + a.height + tolerance
export const overlapPixelBoxes = (a: PixelBox, b: PixelBox) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1
const sameIds = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && a.every(x => b.includes(x))
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw)
  if (!r.success) throw new SemanticValidationError(r.error.issues.slice(0, 15).map(i => `${i.path.join('.')}: ${i.message}`))
  return r.data
}
export function validatePixelBrief(raw: unknown, env: PixelEnvironment, authorStates: string[]) {
  const b = parse(pixelBriefSchema, raw), issues: string[] = [], { input } = env
  if (!authorStates.includes(b.authorState)) issues.push('unknown-author-state')
  const all = [...b.title, ...b.groups.flatMap(g => g.fragments), ...b.directions.map(d => d.sourceId)]
  if (!sameIds(all, input.content.map(f => f.id))) issues.push('every-source-fragment-exactly-once')
  // Only clearly spatial, colon-terminated directions may leave visible content.
  for (const d of b.directions) if (!/^(?=.{1,200}:$)(?=.*(?:справа|слева|сверху|снизу|размести|расположи|оформление|композиция)).*$/iu.test(input.content.find(f => f.id === d.sourceId)?.text ?? '')) issues.push(`not-an-explicit-layout-direction:${d.sourceId}`)
  if (!env.fontTokens.includes(b.fontToken) || !input.colors.some(c => c.id === b.background)) issues.push('unavailable-style-token')
  if (new Set(b.groups.map(g => g.id)).size !== b.groups.length || b.groups.some(g => g.id === 'title')) issues.push('duplicate-or-reserved-group-id')
  if (b.compositionId ? !env.compositions.some(c => c.id === b.compositionId) || b.compositionUse === 'none' : b.compositionUse !== 'none') issues.push('unknown-composition-or-use')
  if (b.compositionUse === 'exact') issues.push('exact-composition-geometry-not-verifiable-in-this-pilot-use-adapted')
  for (const g of b.groups) {
    if (g.component) issues.push(...componentBindingIssues(g.component, g.fragments, input).map(i => `${g.id}:${i}`))
    if (g.role === 'metric' && !g.component) issues.push(`${g.id}:use-a-compatible-library-metric-card-or-report-incompatibility`)
  }
  const percentages = input.content.filter(f => /^[+\-−]?\s*\d+(?:[.,]\d+)?\s*%$/u.test(f.text.trim()))
  const metricsOnRight = b.directions.some(d => /^справа\s.*карточ/iu.test(input.content.find(f => f.id === d.sourceId)?.text ?? ''))
  for (const f of percentages) {
    const group = b.groups.find(g => g.fragments.includes(f.id))
    if (!group?.component || group.role !== 'metric') issues.push(`standalone-percentage-requires-separate-library-metric-card:${f.id}; support/plain is not an alternative`)
    else {
      if (percentages.filter(f => group.fragments.includes(f.id)).length !== 1) issues.push(`one-percentage-per-card:${group.id}`)
      const t = adaptiveComponents(input).find(t => t.id === group.component!.id)
      if (t && !group.component.fields.some(field => field.fragments.includes(f.id) && componentSlots(t).some(s => s.metric && s.paths.includes(field.path)))) issues.push(`percentage-must-bind-number-field:${f.id}`)
    }
    if (metricsOnRight && group?.placement !== 'right') issues.push(`explicit-right-card-direction-not-preserved:${f.id}`)
  }
  if (issues.length) throw new SemanticValidationError(issues)
  return b
}
export function sourceInk(t: EditableTemplate, index: number, input: LayoutInput) {
  const fill = t.sourceLayout!.text[index].element.colorRuns?.[0]?.fill
  if (!fill || fill.type !== 'solid') throw Error(`Unsupported source ink: ${t.id}`)
  const { r, g, b, a } = fill.color
  const hex = '#' + [r, g, b].map(n => Math.round(n * 255).toString(16).padStart(2, '0')).join('')
  const token = input.colors.find(c => c.hex.toLowerCase() === hex)
  if (!token) throw Error(`Source ink missing from palette: ${hex}`)
  return { color: token.id, opacity: a ?? 1 }
}
export function pixelComponentCatalog(env: PixelEnvironment) {
  return adaptiveComponents(env.input).map(t => ({ id: t.id, name: t.name, kind: t.kind, width: t.width, height: t.height, slide: t.slide,
    style: t.style, flow: env.input.componentFlows?.[t.id] ?? null,
    fields: componentSlots(t).map((s, i) => {
      const e = t.sourceLayout!.text[i].element
      return { ...s, box: e.bounds, fontSize: e.fontSize, fontFamily: e.fontFamily, align: e.textBox?.align ?? 'LEFT',
        ...sourceInk(t, i, env.input), example: e.text }
    }),
  }))
}
export function validatePixelPlan(raw: unknown, brief: PixelBrief, briefHash: string, env: PixelEnvironment) {
  const p = parse(pixelPlanSchema, raw), issues: string[] = [], { input } = env
  if (p.briefHash !== briefHash || p.canvas.background !== brief.background) issues.push('brief-or-background-changed')
  if (!sameIds(p.regions.map(r => r.id), ['title', ...brief.groups.map(g => g.id)])) issues.push('regions-must-match-designer-groups')
  if (new Set(p.texts.map(t => t.id)).size !== p.texts.length) issues.push('duplicate-text-id')
  if (!sameIds(p.texts.flatMap(t => t.fragments), [...brief.title, ...brief.groups.flatMap(g => g.fragments)])) issues.push('visible-fragments-must-be-preserved-exactly-once')
  for (const region of p.regions) {
    const group = brief.groups.find(g => g.id === region.id), component = group?.component
    const texts = p.texts.filter(t => t.regionId === region.id)
    if (!containsPixelBox({ x: 16, y: 16, width: 1888, height: 1048 }, region.box)) issues.push(`canvas-overflow:${region.id}`)
    if (!sameIds(texts.flatMap(t => t.fragments), region.id === 'title' ? brief.title : group?.fragments ?? [])) issues.push(`group-content-changed:${region.id}`)
    if (!component) {
      if (region.mode !== 'plain' || region.fontStep !== null || region.flowDirection !== null || texts.some(t => t.field !== null)) issues.push(`plain-region-contract:${region.id}`)
      if (region.background && !input.colors.some(c => c.id === region.background)) issues.push(`unknown-background:${region.id}`)
      continue
    }
    const template = adaptiveComponents(input).find(t => t.id === component.id)!, slots = componentSlots(template), scale = region.box.width / template.width
    if (region.background !== null || region.radius !== 0 || region.fontStep === null || region.mode === 'plain') issues.push(`native-artwork-must-not-be-repainted:${region.id}`)
    if (texts.length !== slots.length || slots.some(s => texts.filter(t => s.paths.includes(t.field ?? '')).length !== 1)) { issues.push(`component-fields:${region.id}`); continue }
    const ordered = slots.map(s => texts.find(t => s.paths.includes(t.field ?? ''))!)
    for (const [i, t] of ordered.entries()) {
      const binding = component.fields.find(f => f.path === t.field)
      if (!binding || !sameIds(t.fragments, binding.fragments)) issues.push(`component-binding-changed:${t.id}`)
      const ink = sourceInk(template, i, input)
      if (t.color !== ink.color || Math.abs(t.opacity - ink.opacity) > .001) issues.push(`source-ink-changed:${t.id}`)
      if (t.fontSize < (slots[i].metric ? 48 : 24)) issues.push(`component-font-floor:${t.id}`)
    }
    if (region.mode === 'native') {
      if (scale > 2 || Math.abs(region.box.height - template.height * scale) > 1 || region.flowDirection !== null) issues.push(`native-aspect-ratio:${region.id}`)
      for (const [i, t] of ordered.entries()) {
        const e = template.sourceLayout!.text[i].element, expectedSize = e.fontSize * scale * (1 - (region.fontStep ?? 0) / 16)
        if (['x','y','width','height'].some(k => Math.abs(t.box[k as 'x'] - e.bounds[k as 'x'] * scale) > 1)) issues.push(`native-field-geometry:${t.id}`)
        if (Math.abs(t.fontSize - expectedSize) > 1) issues.push(`native-font-size:${t.id}:expected=${expectedSize}`)
      }
    } else if (region.mode === 'flow') {
      const profile = input.componentFlows?.[template.id]
      if (!profile) { issues.push(`unqualified-flow:${region.id}`); continue }
      const geometry = flowGeometry(profile, region.box.width, ordered.map(t => t.box.height), region.flowDirection ?? undefined)
      if (region.flowDirection !== geometry.direction || Math.abs(region.box.height - geometry.height) > 1 || region.box.width < profile.minWidth || region.box.width > profile.maxWidth || region.box.height > profile.maxHeight) issues.push(`flow-geometry:${region.id}:expectedHeight=${geometry.height}`)
      ordered.forEach((t, i) => {
        if (['x','y','width','height'].some(k => Math.abs(t.box[k as 'x'] - geometry.boxes[i][k as 'x']) > 1)) issues.push(`flow-field-geometry:${t.id}:expected=${JSON.stringify(geometry.boxes[i])}`)
        const size = Math.max(slots[i].metric ? 48 : 24, template.sourceLayout!.text[i].element.fontSize * profile.fontScale * (1 - (region.fontStep ?? 0) / 16))
        if (Math.abs(t.fontSize - size) > 1) issues.push(`flow-font-size:${t.id}:expected=${size}`)
      })
    }
  }
  for (const t of p.texts) {
    const region = p.regions.find(r => r.id === t.regionId)
    if (!region) { issues.push(`unknown-region:${t.id}`); continue }
    if (!env.fontTokens.includes(t.fontToken) || !input.colors.some(c => c.id === t.color)) issues.push(`unavailable-text-style:${t.id}`)
    if (!containsPixelBox({ x: 0, y: 0, width: region.box.width, height: region.box.height }, t.box)) issues.push(`text-box-outside-region:${t.id}`)
    if (t.lineHeight < t.fontSize || t.lineHeight > t.fontSize * 1.6) issues.push(`line-height:${t.id}`)
    if (region.id === 'title' && t.fontSize < 60) issues.push('title-floor-60')
    if (region.mode === 'plain') {
      const foreground = input.colors.find(c => c.id === t.color)?.hex, background = input.colors.find(c => c.id === (region.background ?? p.canvas.background))?.hex
      if (foreground && background && (t.opacity !== 1 || contrastRatio(foreground, background) < 4.5)) issues.push(`text-contrast:${t.id}`)
    }
  }
  for (let i = 0; i < p.regions.length; i++) for (let j = i + 1; j < p.regions.length; j++) if (overlapPixelBoxes(p.regions[i].box, p.regions[j].box)) issues.push(`region-collision:${p.regions[i].id}/${p.regions[j].id}`)
  const left = brief.groups.filter(g => g.placement === 'left').map(g => p.regions.find(r => r.id === g.id)).filter(Boolean)
  const right = brief.groups.filter(g => g.placement === 'right').map(g => p.regions.find(r => r.id === g.id)).filter(Boolean)
  if (left.length && right.some(r => r!.box.x < Math.max(...left.map(l => l!.box.x + l!.box.width)) + 16 - 1)) issues.push('right-groups-must-be-to-the-right-of-left-groups-with-gap')
  if (brief.compositionUse === 'exact') {
    // The pilot catalog has composition membership/config, not qualified source
    // placement frames. It cannot prove exact reproduction from an ID alone.
    issues.push('exact-composition-geometry-not-verifiable-in-this-pilot-use-adapted')
  }
  if (issues.length) throw new SemanticValidationError([...new Set(issues)])
  return p
}
export function pixelJsonSchema(schema: z.ZodTypeAny): object {
  if (schema instanceof z.ZodNullable) return { anyOf: [pixelJsonSchema(schema.unwrap()), { type: 'null' }] }
  if (schema instanceof z.ZodLiteral) return { type: typeof schema.value, const: schema.value }
  if (schema instanceof z.ZodString) return { type: 'string', ...(schema.minLength !== null ? { minLength: schema.minLength } : {}), ...(schema.maxLength !== null ? { maxLength: schema.maxLength } : {}) }
  if (schema instanceof z.ZodNumber) return { type: schema.isInt ? 'integer' : 'number', ...(schema.minValue !== null ? { minimum: schema.minValue } : {}), ...(schema.maxValue !== null ? { maximum: schema.maxValue } : {}) }
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' }
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options }
  if (schema instanceof z.ZodArray) return { type: 'array', items: pixelJsonSchema(schema.element), ...(schema._def.minLength ? { minItems: schema._def.minLength.value } : {}), ...(schema._def.maxLength ? { maxItems: schema._def.maxLength.value } : {}) }
  if (schema instanceof z.ZodObject) return { type: 'object', additionalProperties: false, required: Object.keys(schema.shape), properties: Object.fromEntries(Object.entries(schema.shape).map(([k, v]) => [k, pixelJsonSchema(v as z.ZodTypeAny)])) }
  throw Error('Unsupported pixel schema')
}
