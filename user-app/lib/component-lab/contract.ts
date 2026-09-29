import { z } from 'zod'
import { metricParts } from './metric-unit'

// Keep source/rule identity stable when only the renderer changes. Existing
// rules remain editable, while proofs and committed measurements must be redone.
export const PROFILE_VERSION = 'component-box-2' as const
export const LAB_VERSION = 'component-box-7' as const
// Product quality setting, shared by measurement, reports and the lab UI.
export const MINIMUM_TEXT_CONTRAST = 4
export const stateSchema = z.enum(['vertical', 'horizontal', 'compact'])
export type ComponentState = z.infer<typeof stateSchema>
export const behaviorSchema = z.object({
  textAlign: z.enum(['source', 'left', 'center', 'right']).default('source'),
  position: z.enum(['top', 'center', 'bottom']).default('top'),
  gap: z.number().finite().min(8).max(40).optional(),
  padding: z.number().finite().min(12).max(48).optional(),
  contentWidth: z.number().finite().min(50).max(100).default(100),
}).strict()
export const fontReplacementSchema = z.object({ source: z.string().min(1).max(160), family: z.enum(['Noto Sans', 'Noto Serif', 'Roboto Mono']) }).strict()
export const rulesSchema = z.object({
  states: z.object({ vertical: behaviorSchema.optional(), horizontal: behaviorSchema.optional(), compact: behaviorSchema.optional() }).strict(),
  fontReplacements: z.array(fontReplacementSchema).max(3).optional(),
}).strict()
export type ComponentRules = z.infer<typeof rulesSchema>
export const roleSchema = z.enum(['number', 'caption', 'ordinal', 'title', 'body', 'quote', 'author'])
// A template may display a placeholder. Permit only its exact observed value;
// this does not turn numeric fields into arbitrary text inputs.
export const metricPlaceholder = (value: string) => /^(?:[xх?]{1,8}|[—–-]{1,3}|…|\.{3})\s*[%‰]?$/iu.test(value.trim())
const finite = z.number().finite()
export const artworkSchema = z.object({ kind: z.enum(['badge', 'media']), svg: z.string().min(1).max(800000), hash: z.string().length(64), width: finite.positive(), height: finite.positive(), size: finite.min(40).max(400), ids: z.array(z.string()).min(1), field: z.string().optional() }).strict()
export const fieldSchema = z.object({
  id: z.string().min(1).max(160), role: roleSchema, required: z.boolean(), order: z.number().int().nonnegative(),
  font: z.string().min(1).max(160), weight: z.union([z.literal(400), z.literal(700)]), italic: z.boolean(),
  size: finite.min(12).max(240), minimum: finite.min(12).max(96), leading: finite.min(1).max(2),
  letterSpacing: finite.min(-12).max(20), color: z.string().regex(/^#[\da-f]{6}$/i),
  align: z.enum(['left', 'center', 'right']),
  unitScale: finite.min(.35).max(1.5).optional(),
  sourcePlaceholder: z.string().min(1).max(160).optional(),
}).strict().refine(f => f.minimum <= f.size && (f.unitScale === undefined || f.role === 'number' && f.minimum * f.unitScale >= 24) && (f.sourcePlaceholder === undefined || f.role === 'number' && f.unitScale === undefined && metricPlaceholder(f.sourcePlaceholder)), 'Invalid type size, metric unit or source placeholder')
export const profileSchema = z.object({
  version: z.literal(PROFILE_VERSION), id: z.string().min(1), name: z.string(), catalogId: z.string(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), family: z.enum(['number-caption', 'title-body', 'number-title-body', 'ordinal-caption', 'media-text', 'quote-author']),
  source: z.object({ templateId: z.string(), ids: z.array(z.string()), width: finite.positive(), height: finite.positive(), graphic: z.string(), background: z.string().regex(/^#[\da-f]{6}$/i).optional() }).strict(),
  artwork: artworkSchema.optional(),
  fields: z.array(fieldSchema).min(1).max(3), states: z.array(stateSchema).min(1).max(3), preferred: stateSchema,
  behavior: rulesSchema.shape.states.optional(),
  fontReplacements: rulesSchema.shape.fontReplacements,
  padding: finite.min(12).max(48), gap: finite.min(8).max(40), minWidth: finite.min(100), maxWidth: finite.max(2000), maxHeight: finite.min(60).max(1500),
}).strict().superRefine((p, ctx) => {
  if (new Set(p.fields.map(f => f.id)).size !== p.fields.length || new Set(p.fields.map(f => f.role)).size !== p.fields.length || new Set(p.states).size !== p.states.length || !p.states.includes(p.preferred) || p.minWidth > p.maxWidth) ctx.addIssue({ code: 'custom', message: 'Invalid component identity or states' })
  const required = { 'number-caption': ['number', 'caption'], 'title-body': ['title', 'body'], 'number-title-body': ['ordinal', 'title', 'body'], 'ordinal-caption': ['ordinal', 'body'], 'media-text': ['body'], 'quote-author': ['quote', 'author'] }[p.family]
  if (required.some(role => !p.fields.some(f => f.role === role))) ctx.addIssue({ code: 'custom', message: 'Invalid family fields' })
  if (p.artwork?.kind === 'badge' && !p.fields.some(f => f.id === p.artwork!.field && f.role === 'ordinal') || p.family === 'media-text' && p.artwork?.kind !== 'media') ctx.addIssue({ code: 'custom', message: 'Invalid artwork binding' })
})
export type ComponentProfile = z.infer<typeof profileSchema>
export type ComponentField = z.infer<typeof fieldSchema>
export type ComponentContent = Record<string, string>
export function behaviorFor(p: ComponentProfile, state: ComponentState) {
  const b = behaviorSchema.parse(p.behavior?.[state] ?? {})
  return { ...b, gap: b.gap ?? p.gap, padding: b.padding ?? p.padding }
}
export const constraintsSchema = z.object({
  width: finite.min(120).max(1600), maxHeight: finite.min(60).max(1200),
  widthMode: z.enum(['fixed', 'fill']).default('fill'), heightMode: z.enum(['hug', 'fill']).default('hug'),
  allowedStates: z.array(stateSchema).min(1).max(3).optional(),
  background: z.string().regex(/^#[\da-f]{6}$/i).optional(),
}).strict()
export type BoxConstraints = z.infer<typeof constraintsSchema>
export type Box = { x: number; y: number; width: number; height: number }
export type FieldMeasurement = { id: string; role: ComponentField['role']; text: string; font: string; fontSize: number; lineCount: number; align?: ComponentField['align']; box: Box; ink: Box; parts?: { text: string; fontSize: number; box: Box }[] }
export type ArtworkMeasurement = { kind: 'badge' | 'media'; box: Box; hash: string }
export type LayoutTrial = { state: ComponentState; step: number; width: number; height: number; requiredHeight: number; fits: boolean; fields: FieldMeasurement[]; artwork?: ArtworkMeasurement; issues: string[] }
export type ComponentMeasurement = {
  version: typeof LAB_VERSION; fingerprint: string; inputHash: string; status: 'fits' | 'needs-space' | 'incompatible' | 'unavailable';
  constraints: BoxConstraints; chosen?: LayoutTrial; trials: LayoutTrial[];
  feasibleSizes: { width: number; height: number; state: ComponentState; step: number }[];
  issues: string[]; artistic: 'not-reviewed';
}
export function contentIssues(p: ComponentProfile, content: ComponentContent) {
  const issues: string[] = []
  for (const key of Object.keys(content)) if (!p.fields.some(f => f.id === key)) issues.push(`unknown-field:${key}`)
  for (const f of p.fields) {
    const value = content[f.id]
    if (value !== undefined && typeof value !== 'string') { issues.push(`field-type:${f.id}`); continue }
    if (f.required && !value?.trim()) issues.push(`required-field:${f.id}`)
    if (value?.length > 12000) issues.push(`content-limit:${f.id}`)
    if (value?.trim() && f.role === 'number' && value !== f.sourcePlaceholder && !/^[+−–-]?\s*\d/.test(value.trim())) issues.push(`number-expected:${f.id}`)
    if (value?.trim() && f.unitScale !== undefined && !metricParts(value)) issues.push(`number-unit-expected:${f.id}`)
    if (value?.trim() && f.role === 'ordinal' && !/^\d{1,3}[.)]?$/.test(value.trim())) issues.push(`ordinal-expected:${f.id}`)
  }
  return issues
}
export const contains = (a: Box, b: Box, tolerance = 1) => b.x >= a.x - tolerance && b.y >= a.y - tolerance && b.x + b.width <= a.x + a.width + tolerance && b.y + b.height <= a.y + a.height + tolerance
export function measurementIssues(profile: ComponentProfile, content: ComponentContent, trial: LayoutTrial, constraints: BoxConstraints) {
  const issues = contentIssues(profile, content)
  if (![trial.width, trial.height, trial.requiredHeight, trial.step, ...trial.fields.flatMap(f => [f.fontSize, f.lineCount, ...Object.values(f.box), ...Object.values(f.ink)])].every(Number.isFinite)) return [...issues, 'non-finite-measurement']
  if (!profile.states.includes(trial.state) || constraints.allowedStates && !constraints.allowedStates.includes(trial.state)) issues.push('state-not-allowed')
  if (!Number.isInteger(trial.step) || trial.step < 0 || trial.step > 4) issues.push('type-step')
  if (trial.width !== constraints.width || trial.height > constraints.maxHeight + 1 || trial.height > profile.maxHeight || trial.requiredHeight > trial.height + 1 || constraints.heightMode === 'fill' && Math.abs(trial.height - constraints.maxHeight) > 1) issues.push('container-height')
  if (trial.width < profile.minWidth || trial.width > profile.maxWidth) issues.push('container-width')
  const visible = profile.fields.filter(f => content[f.id]?.trim())
  if (visible.length !== trial.fields.length || new Set(trial.fields.map(f => f.id)).size !== trial.fields.length) issues.push('field-count')
  const behavior = behaviorFor(profile, trial.state), { padding } = behavior
  const inner = { x: padding, y: padding, width: trial.width - 2 * padding, height: trial.height - 2 * padding }
  const expectedTop = padding + Math.max(0, trial.height - trial.requiredHeight) * ({ top: 0, center: .5, bottom: 1 }[behavior.position])
  if (trial.fields.length && Math.abs(Math.min(...trial.fields.map(f => f.box.y), trial.artwork?.box.y ?? Infinity) - expectedTop) > 1) issues.push('content-position')
  if (!!profile.artwork !== !!trial.artwork) issues.push('artwork-missing')
  if (profile.artwork && trial.artwork) {
    const a = trial.artwork, source = profile.artwork
    if (a.hash !== source.hash || a.kind !== source.kind || !Object.values(a.box).every(Number.isFinite) || a.box.width <= 0 || a.box.height <= 0 || !contains(inner, a.box) || Math.abs(a.box.width / a.box.height - source.width / source.height) > .01) issues.push('artwork-geometry')
    for (const field of trial.fields) {
      if (source.kind === 'badge' && field.id === source.field) { if (!contains(a.box, field.ink)) issues.push('badge-overflow'); continue }
      const b = field.ink
      if (Math.min(a.box.x + a.box.width, b.x + b.width) - Math.max(a.box.x, b.x) > 1 && Math.min(a.box.y + a.box.height, b.y + b.height) - Math.max(a.box.y, b.y) > 1) issues.push('artwork-text-overlap')
    }
  }
  for (const f of visible) {
    const m = trial.fields.find(m => m.id === f.id)
    if (!m || m.text !== content[f.id] || m.role !== f.role) { issues.push(`field-content:${f.id}`); continue }
    const expected = Math.max(f.minimum, f.size * (1 - trial.step * .05))
    if (m.font !== f.font || Math.abs(m.fontSize - expected) > .05 || m.fontSize < f.minimum) issues.push(`field-font:${f.id}`)
    if (f.unitScale !== undefined) {
      const parts = metricParts(content[f.id])
      if (!parts || !m.parts || m.parts.length !== parts.length || m.parts.some((part, i) => part.text !== parts[i] || !Object.values(part.box).every(Number.isFinite) || !Number.isFinite(part.fontSize) || Math.abs(part.fontSize - expected * (i ? f.unitScale! : 1)) > .05 || !contains(m.box, part.box))) issues.push(`field-unit:${f.id}`)
    } else if (m.parts?.length) issues.push(`unexpected-unit:${f.id}`)
    if (!contains(inner, m.box) || !contains(m.box, m.ink) || m.ink.height <= 0 || m.ink.width <= 0) issues.push(`field-overflow:${f.id}`)
    // A DOM Range includes trailing wrap whitespace, so its union is not the
    // painted text's alignment axis. Check the computed alignment separately.
    if (m.align !== undefined && m.align !== (profile.artwork?.field === f.id ? 'center' : behavior.textAlign === 'source' ? f.align : behavior.textAlign)) issues.push(`field-alignment:${f.id}`)
  }
  for (let i = 0; i < trial.fields.length; i++) for (let j = i + 1; j < trial.fields.length; j++) {
    const a = trial.fields[i].ink, b = trial.fields[j].ink
    if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1) issues.push('field-overlap')
  }
  return [...new Set(issues)]
}
