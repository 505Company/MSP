import { PREPARED_BOX_VERSION, PREPARED_BOX_RENDER } from './prepared-components'
import { z } from 'zod'
import { SemanticValidationError } from '../design-system/semantic-contract'
import { colorRoles, type LayoutEvidence, type LayoutInput } from './layout-contract'
import { contrastRatio } from './layout-html'
import { ADAPTIVE_FLOW_VERSION, ADAPTIVE_FLOW_RENDER, ADAPTIVE_COMPONENTS_VERSION, ADAPTIVE_COMPONENT_RENDER, ADAPTIVE_GRID_VERSION, ADAPTIVE_GRID_RENDER, adaptiveComponentSchema, componentBindingIssues, componentMeasurementSchema, componentMeasurementIssues, componentSlots, componentColumns, componentRows } from './adaptive-components'

export const ADAPTIVE_RECIPE_ID = 'adaptive-blocks'
export const ADAPTIVE_VERSION = 'adaptive-blocks-1'
export const ADAPTIVE_RENDER_VERSION = 'adaptive-render-1'
export const ADAPTIVE_PALETTE_VERSION = 'adaptive-blocks-4'
export const ADAPTIVE_PALETTE_RENDER = 'adaptive-render-8'
export const adaptiveVersions = [ADAPTIVE_VERSION, ADAPTIVE_COMPONENTS_VERSION, ADAPTIVE_GRID_VERSION, ADAPTIVE_PALETTE_VERSION, ADAPTIVE_FLOW_VERSION, PREPARED_BOX_VERSION] as const
export type AdaptiveVersion = typeof adaptiveVersions[number]
export const adaptiveRenderVersion = (version?: string) => version === PREPARED_BOX_VERSION ? PREPARED_BOX_RENDER : version === ADAPTIVE_FLOW_VERSION ? ADAPTIVE_FLOW_RENDER : version === ADAPTIVE_PALETTE_VERSION ? ADAPTIVE_PALETTE_RENDER : version === ADAPTIVE_GRID_VERSION ? ADAPTIVE_GRID_RENDER : version === ADAPTIVE_COMPONENTS_VERSION ? ADAPTIVE_COMPONENT_RENDER : ADAPTIVE_RENDER_VERSION
export const usesAdaptiveGrid = (renderer: string) => renderer === ADAPTIVE_GRID_RENDER || renderer === ADAPTIVE_PALETTE_RENDER || renderer === ADAPTIVE_FLOW_RENDER || renderer === PREPARED_BOX_RENDER
export const usesPanelColors = (version?: string) => version === ADAPTIVE_PALETTE_VERSION || version === ADAPTIVE_FLOW_VERSION || version === PREPARED_BOX_VERSION
export const adaptiveRenderKey = (prefix: string, version?: string) => `${prefix}/render-${adaptiveRenderVersion(version)}.json`
export const adaptiveReviewPrefix = (prefix: string, version?: string) => `${prefix}/review-${adaptiveRenderVersion(version)}`
export const adaptiveRules = { width: 1920, height: 1080, margin: 56, gap: 32, padding: 28, textGap: 16, minWidth: 320, minHeight: 140 } as const
export const adaptiveInset = (block: AdaptivePlan['blocks'][number], grid: boolean) => grid && block.emphasis === 'plain' ? 0 : adaptiveRules.padding
export const adaptiveSpan = (index: number, count: number, columns: number) => index === count - 1 ? columns - index % columns : 1
export const adaptiveTypography = {
  title: [88, 80, 72, 64, 60], heading: [44, 42, 38, 34, 32], body: [40, 38, 36, 32, 30], metric: [100, 92, 84, 72, 64], caption: [28, 27, 26, 25, 24],
} as const
const fragments = z.array(z.string().min(1).max(80)).min(1).max(100)
const part = z.object({ role: z.enum(['heading', 'body', 'metric', 'caption']), fragments, component: adaptiveComponentSchema.nullable().optional() }).strict()
export const panelColorsSchema = z.object({ background: z.string().min(1), foreground: z.string().min(1) }).strict()
export const adaptivePlanSchema = z.object({
  version: z.enum([ADAPTIVE_COMPONENTS_VERSION, ADAPTIVE_GRID_VERSION, ADAPTIVE_PALETTE_VERSION, ADAPTIVE_FLOW_VERSION, PREPARED_BOX_VERSION]).optional(),
  title: fragments, blocks: z.array(z.object({ emphasis: z.enum(['normal', 'accent', 'plain']), panelColors: panelColorsSchema.nullable().optional(), parts: z.array(part).min(1).max(30) }).strict()).min(1).max(8),
  footer: z.array(z.string().min(1).max(80)).max(20), fontToken: z.string().min(1),
  colors: z.object(Object.fromEntries(colorRoles.map(r => [r, z.string().min(1)])) as Record<typeof colorRoles[number], z.ZodString>).strict(),
  rationale: z.string().min(1).max(600),
}).strict()
export type AdaptivePlan = z.infer<typeof adaptivePlanSchema>
export type AdaptiveRole = keyof typeof adaptiveTypography
export function adaptivePanelColors(block: AdaptivePlan['blocks'][number], plan: AdaptivePlan) {
  if (block.emphasis === 'plain') return { background: null, foreground: plan.colors.primary }
  if (usesPanelColors(plan.version) && block.panelColors) return block.panelColors
  return { background: block.emphasis === 'accent' ? plan.colors.accent : plan.colors.surface, foreground: block.emphasis === 'accent' ? plan.colors.onAccent : plan.colors.onSurface }
}
export function adaptiveTexts(plan: AdaptivePlan, input: LayoutInput) {
  const text = (ids: string[]) => ids.map(id => input.content.find(f => f.id === id)?.text ?? '').join('\n')
  return [{ id: 'title', box: 'title', role: 'title' as AdaptiveRole, text: text(plan.title) },
    ...plan.blocks.flatMap((b, i) => b.parts.flatMap((p, j) => p.component ? [] : [{ id: `block-${i}-part-${j}`, box: `block-${i}`, role: p.role as AdaptiveRole, text: text(p.fragments) }])),
    ...(plan.footer.length ? [{ id: 'footer', box: 'footer', role: 'caption' as AdaptiveRole, text: text(plan.footer) }] : [])]
}
export function validateAdaptivePlan(raw: unknown, input: LayoutInput, evidence: LayoutEvidence): AdaptivePlan {
  const parsed = adaptivePlanSchema.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.slice(0, 12).map(i => `${i.path.join('.')}: ${i.message}`))
  const p = parsed.data, issues: string[] = []
  if (!p.version && p.blocks.some(b => b.emphasis === 'plain' || b.parts.some(p => p.component))) issues.push('components-require-adaptive-blocks-2')
  for (const b of p.blocks) {
    if (b.parts.some(p => p.component) && b.emphasis !== 'plain') issues.push('library-components-require-unframed-block')
    if (b.panelColors !== undefined && !usesPanelColors(p.version)) issues.push('panel-colors-require-adaptive-blocks-4')
    if (b.panelColors) {
      if (b.emphasis === 'plain' || b.parts.some(p => p.component)) issues.push('panel-colors-require-text-panel')
      const background = input.colors.find(c => c.id === b.panelColors!.background), foreground = input.colors.find(c => c.id === b.panelColors!.foreground)
      if (!background || !foreground) issues.push('unknown-panel-color-token')
      else if (contrastRatio(foreground.hex, background.hex) < 4.5) issues.push('insufficient-panel-contrast')
    }
    for (const part of b.parts) if (part.component) {
      if (p.version !== PREPARED_BOX_VERSION && part.component.fields.some(f => f.path.startsWith('slots.'))) issues.push('prepared-components-require-adaptive-blocks-6')
      issues.push(...componentBindingIssues(part.component, part.fragments, p.version === PREPARED_BOX_VERSION ? input : { ...input, preparedComponents: undefined }))
    }
  }
  const ids = [...p.title, ...p.blocks.flatMap(b => b.parts.flatMap(p => p.fragments)), ...p.footer]
  if (ids.length !== input.content.length || new Set(ids).size !== ids.length || ids.some(id => !input.content.some(f => f.id === id))) issues.push('Every whole source fragment must occur exactly once, including numbers and notes; no character offsets.')
  if (!input.fonts.some(f => f.id === p.fontToken) || !evidence.fontTokens.includes(p.fontToken)) issues.push('FONT_TOKEN_UNAVAILABLE')
  const color = (r: typeof colorRoles[number]) => input.colors.find(c => c.id === p.colors[r])?.hex
  if (Object.values(p.colors).some(id => !input.colors.some(c => c.id === id))) issues.push('unknown-color-token')
  else for (const [fg, bg] of [['primary', 'background'], ['secondary', 'background'], ['onSurface', 'surface'], ['onAccent', 'accent']] as const) {
    if (contrastRatio(color(fg)!, color(bg)!) < 4.5) issues.push(`insufficient-contrast:${fg}/${bg}`)
  }
  for (const t of adaptiveTexts(p, input)) {
    if (!t.text.trim()) issues.push(`empty-text:${t.id}`)
    if (t.role === 'metric' && (t.text.length > 32 || !/\d/.test(t.text))) issues.push(`metric-must-be-a-short-source-number:${t.id}`)
  }
  if (issues.length) throw new SemanticValidationError(issues)
  return p
}
export function adaptiveCandidates(plan: AdaptivePlan) {
  const n = plan.blocks.length, columns = [...new Set([n <= 3 ? n : n === 4 ? 2 : 3, 2, 3, 1].filter(c => c <= n))]
  // Exhaust structural alternatives at each type scale before reducing any text.
  return adaptiveTypography.title.flatMap((_, fontStep) => columns.map(columns => ({ columns, fontStep })))
}
const finite = z.number().finite().min(-100000).max(1000000)
const rectSchema = z.object({ x: finite, y: finite, width: finite, height: finite }).strict()
const boxSchema = rectSchema.extend({ id: z.string().max(80), row: z.number().int().min(-2).max(8) }).strict()
const measurementSchema = rectSchema.extend({ id: z.string().max(80), box: z.string().max(80), role: z.enum(['title', 'heading', 'body', 'metric', 'caption']), text: z.string().max(40000),
  scrollWidth: finite, scrollHeight: finite, fontSize: finite, lines: z.number().int().nonnegative().max(10000), ink: rectSchema,
}).strict()
const trialSchema = z.object({ columns: z.number().int().min(1).max(3), fontStep: z.number().int().min(0).max(4),
  boxes: z.array(boxSchema).min(2).max(10), texts: z.array(measurementSchema).min(1).max(242), issues: z.array(z.string().max(300)).max(300),
  units: z.array(rectSchema.extend({ id: z.string() }).strict()).max(240).optional(),
  components: z.array(componentMeasurementSchema).max(240).optional(),
}).strict()
export type AdaptiveTrial = z.infer<typeof trialSchema>
export const adaptiveFitSchema = z.object({ version: z.enum([ADAPTIVE_RENDER_VERSION, 'adaptive-render-2', 'adaptive-render-3', 'adaptive-render-4', 'adaptive-render-5', ADAPTIVE_COMPONENT_RENDER, ADAPTIVE_GRID_RENDER, ADAPTIVE_PALETTE_RENDER, ADAPTIVE_FLOW_RENDER, PREPARED_BOX_RENDER]), planHash: z.string().regex(/^[a-f0-9]{64}$/), passed: z.boolean(), trials: z.array(trialSchema).min(1).max(15),
  previewCheck: z.object({ width: z.number().int(), height: z.number().int(), textBlocks: z.array(z.object({ block: z.string(), pixels: z.number().int().nonnegative() }).strict()).max(1000) }).strict().optional(),
}).strict()
export type AdaptiveFit = z.infer<typeof adaptiveFitSchema>
export type AdaptiveRender = { fit: AdaptiveFit; preview: string }
const contains = (a: z.infer<typeof rectSchema>, b: z.infer<typeof rectSchema>, inset = 0) => b.x >= a.x + inset - 1 && b.y >= a.y + inset - 1 && b.x + b.width <= a.x + a.width - inset + 1 && b.y + b.height <= a.y + a.height - inset + 1
export function adaptiveIssues(t: AdaptiveTrial, plan: AdaptivePlan, input: LayoutInput, renderVersion: string = adaptiveRenderVersion(plan.version)): string[] {
  const issues: string[] = [], expected = adaptiveTexts(plan, input), { margin, gap, width, height, minHeight, minWidth, textGap } = adaptiveRules
  const renderer = Number(renderVersion.split('-').at(-1)), grid = renderer >= 7
  const inset = (id: string) => id.startsWith('block-') ? adaptiveInset(plan.blocks[Number(id.slice(6))], grid) : 0
  const canvas = { x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 }
  const expectedBoxes = ['title', ...plan.blocks.map((_, i) => `block-${i}`), ...(plan.footer.length ? ['footer'] : [])]
  if (t.boxes.length !== expectedBoxes.length || expectedBoxes.some(id => t.boxes.filter(b => b.id === id).length !== 1)) return ['incomplete-boxes']
  if (t.texts.length !== expected.length || expected.some(e => t.texts.filter(m => m.id === e.id).length !== 1)) return ['incomplete-texts']
  if (plan.version) {
    const units = plan.blocks.flatMap((b, i) => b.parts.map((p, j) => ({ id: `block-${i}-part-${j}`, box: `block-${i}`, part: p }))), components = units.filter(u => u.part.component)
    if (!t.units || t.units.length !== units.length || units.some(u => t.units!.filter(m => m.id === u.id).length !== 1)) return ['incomplete-units']
    if (!t.components || t.components.length !== components.length || components.some(u => t.components!.filter(m => m.id === u.id).length !== 1)) return ['incomplete-components']
    const family = input.fonts.find(f => f.id === plan.fontToken)!.family
    for (const u of units) {
      const m = t.units.find(m => m.id === u.id)!, owner = t.boxes.find(b => b.id === u.box)!
      if (!contains(owner, m, inset(u.box))) issues.push(`unit-overflow:${u.id}`)
      if (u.part.component) {
        const c = t.components.find(c => c.id === u.id)!
        const prepared = renderVersion === PREPARED_BOX_RENDER && input.preparedComponents?.[u.part.component.id]
        if (Math.abs(m.x - c.x) > 1 || Math.abs(m.y - c.y) > 1 || Math.abs(m.height - c.height) > 1 || c.width > m.width + 1) issues.push(`component-frame:${u.id}`)
        const contentWidth = prepared ? Math.min(m.width, prepared.profile.maxWidth) : m.width
        if (grid && Math.abs(c.width - contentWidth) > 1) issues.push(`component-visible-width:${u.id}`)
        issues.push(...componentMeasurementIssues(c, u.part.component, input, family, grid ? c.fontStep ?? -1 : t.fontStep, contentWidth, renderer >= 4, renderer < 5, grid, renderVersion === ADAPTIVE_FLOW_RENDER || renderVersion === PREPARED_BOX_RENDER, renderVersion === PREPARED_BOX_RENDER, input.colors.find(c => c.id === plan.colors.background)?.hex))
      } else {
        const text = t.texts.find(t => t.id === u.id)!
        if (['x', 'y', 'width', 'height'].some(k => Math.abs(m[k as 'x'] - text[k as 'x']) > 1)) issues.push(`text-frame:${u.id}`)
      }
    }
  } else if (t.units || t.components) issues.push('unexpected-component-evidence')
  for (const b of t.boxes) {
    if (b.width <= 0 || b.height <= 0 || !contains(canvas, b)) issues.push(`canvas-overflow:${b.id}`)
    if (b.id.startsWith('block-') && (b.width < minWidth - 1 || b.height < minHeight - 1 || b.row !== Math.floor(Number(b.id.slice(6)) / t.columns))) issues.push(`block-constraint:${b.id}`)
  }
  for (const e of expected) {
    const m = t.texts.find(m => m.id === e.id)!, owner = t.boxes.find(b => b.id === e.box)!
    if (m.text !== e.text || m.role !== e.role || m.box !== e.box) issues.push(`source-changed:${e.id}`)
    if (m.fontSize !== adaptiveTypography[e.role][t.fontStep] || m.lines < 1) issues.push(`typography:${e.id}`)
    if (m.width <= 0 || m.height <= 0 || m.ink.width <= 0 || m.ink.height <= 0 || m.scrollWidth < 0 || m.scrollHeight < 0 || m.scrollWidth > m.width + 1 || m.scrollHeight > m.height + 1 || !contains(owner, m, inset(owner.id)) || !contains(m, m.ink)) issues.push(`overflow:${e.id}`)
  }
  const title = t.boxes.find(b => b.id === 'title')!, footer = t.boxes.find(b => b.id === 'footer')
  if (Math.abs(title.x - margin) > 1 || Math.abs(title.y - margin) > 1 || Math.abs(title.width - canvas.width) > 1) issues.push('title-frame')
  if (footer && (Math.abs(footer.x - margin) > 1 || Math.abs(footer.y + footer.height - (height - margin)) > 1 || Math.abs(footer.width - canvas.width) > 1)) issues.push('footer-frame')
  let previousBottom = title.y + title.height
  for (let row = 0; row < Math.ceil(plan.blocks.length / t.columns); row++) {
    const boxes = t.boxes.filter(b => b.id.startsWith('block-') && b.row === row).sort((a, b) => Number(a.id.slice(6)) - Number(b.id.slice(6)))
    if (!boxes.length) { issues.push('missing-row'); continue }
    if (Math.abs(boxes[0].y - previousBottom - gap) > 1 || Math.abs(boxes[0].x - margin) > 1 || Math.abs(boxes.at(-1)!.x + boxes.at(-1)!.width - (width - margin)) > 1) issues.push(`row-gap:${row}`)
    boxes.forEach((b, i) => {
      if (Math.abs(b.y - boxes[0].y) > 1 || Math.abs(b.height - boxes[0].height) > 1 || i > 0 && Math.abs(b.x - boxes[i - 1].x - boxes[i - 1].width - gap) > 1) issues.push(`fixed-gap:${b.id}`)
      if (grid && row > 0) {
        const first = t.boxes.find(b => b.id === `block-${i}`)!, span = adaptiveSpan(Number(b.id.slice(6)), plan.blocks.length, t.columns)
        const last = t.boxes.find(b => b.id === `block-${i + span - 1}`)!
        if (Math.abs(b.x - first.x) > 1 || Math.abs(b.x + b.width - last.x - last.width) > 1) issues.push(`shared-column:${b.id}`)
      }
      const texts = plan.version ? plan.blocks[Number(b.id.slice(6))].parts.map((_, j) => `${b.id}-part-${j}`) : expected.filter(t => t.box === b.id).map(t => t.id)
      const items = plan.version ? t.units! : t.texts
      const parts = plan.blocks[Number(b.id.slice(6))].parts
      const padding = inset(b.id), localSteps = grid ? parts.map((_, j) => t.components!.find(c => c.id === `${b.id}-part-${j}`)?.fontStep ?? 0) : undefined
      const columns = renderer >= 3 ? componentColumns(parts, input, b.width - 2 * padding, t.fontStep, renderer >= 4, renderer < 5, localSteps) : 1
      let top = b.y + padding
      for (const layout of componentRows(parts, columns)) {
        const row = layout.indices.map(j => items.find(t => t.id === texts[j])!)
        const width = (b.width - 2 * padding - (layout.columns - 1) * textGap) / layout.columns
        for (const [col, next] of row.entries()) if (Math.abs(next.y - top) > 1 || Math.abs(next.x - b.x - padding - col * (width + textGap)) > 1 || Math.abs(next.width - width) > 1) issues.push(`text-gap:${next.id}`)
        top += Math.max(...row.map(t => t.height)) + textGap
      }
    })
    previousBottom = boxes[0].y + boxes[0].height
  }
  if (Math.abs(previousBottom + (footer ? gap : 0) - (footer ? footer.y : height - margin)) > 1) issues.push('body-frame')
  return [...new Set(issues)]
}
export function validateAdaptiveFit(raw: unknown, plan: AdaptivePlan, input: LayoutInput, hash: string, preview: string, approvedLegacy: boolean | typeof ADAPTIVE_GRID_RENDER = false): AdaptiveFit {
  const fit = adaptiveFitSchema.parse(raw), candidates = adaptiveCandidates(plan)
  const fail = () => { throw new SemanticValidationError(['invalid-adaptive-measurement']) }
  if (usesPanelColors(plan.version) && approvedLegacy !== false) fail()
  const expectedVersion = approvedLegacy === ADAPTIVE_GRID_RENDER && plan.version ? ADAPTIVE_GRID_RENDER : approvedLegacy === true && plan.version ? 'adaptive-render-2' : adaptiveRenderVersion(plan.version)
  if (fit.version !== expectedVersion || fit.planHash !== hash || fit.trials.length > candidates.length) fail()
  fit.trials.forEach((t, i) => {
    const candidate = candidates[i]
    if (t.columns !== candidate.columns || t.fontStep !== candidate.fontStep || JSON.stringify(t.issues) !== JSON.stringify(adaptiveIssues(t, plan, input, fit.version)) || i < fit.trials.length - 1 && !t.issues.length) fail()
  })
  if (fit.passed !== !fit.trials.at(-1)!.issues.length || !fit.passed && fit.trials.length !== candidates.length) fail()
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(preview) || preview.length > 4_000_000) fail()
  let pngWidth = 0, pngHeight = 0
  try {
    const bytes = Uint8Array.from(atob(preview.slice(preview.indexOf(',') + 1, preview.indexOf(',') + 45)), c => c.charCodeAt(0)), view = new DataView(bytes.buffer)
    if (bytes.length < 33 || bytes.slice(0, 8).join(',') !== '137,80,78,71,13,10,26,10' || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') fail()
    pngWidth = view.getUint32(16); pngHeight = view.getUint32(20)
    if (![1280, 1920].includes(pngWidth) || pngWidth / pngHeight !== 16 / 9) fail()
  } catch { fail() }
  if (fit.passed) {
    const p = fit.previewCheck, ids = adaptiveTexts(plan, input).map(t => t.id).concat(plan.blocks.flatMap((b, i) => b.parts.flatMap((p, j) => p.component ? componentSlots(input.components.find(t => t.id === p.component!.id)!, plan.version === PREPARED_BOX_VERSION ? input : undefined).map(s => `block-${i}-part-${j}:${s.sourceId}`) : [])))
    if (!p || p.width !== pngWidth || p.height !== pngHeight || p.textBlocks.length !== ids.length || ids.some(id => p.textBlocks.filter(b => b.block === id && b.pixels >= 3).length !== 1)) fail()
  }
  return fit
}
