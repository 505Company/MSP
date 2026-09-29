import { z } from 'zod'
import type { ElementIR } from '../../../vendor/drag/src/core/model'
import { contentHash } from '../../design-system/catalog'
import { SemanticValidationError } from '../../design-system/semantic-contract'
import type { RecipeMaterial } from './pilot-cases'
import type { TemplateRecipe } from './template-contract'
import { templateCandidateStates, validateTemplatePlan, type TemplatePlan } from './template-plan'
import { resolveTemplateReflow } from './template-reflow'
import { comparisonGeometryIssues, resolveTemplateComparison } from './template-comparison'

export const TEMPLATE_RENDER_VERSION = 'template-render-1'
const finite = z.number().finite()
export const renderReportSchema = z.object({
  recipeVersion: z.string(), materialHash: z.string(), stateId: z.string(), passed: z.boolean(),
  issues: z.array(z.string()).max(100), fontWarnings: z.array(z.string()).max(50),
  measurements: z.array(z.object({ sourceId: z.string(), text: z.string(), fontSize: finite.positive(),
    box: z.object({ x: finite, y: finite, width: finite.positive(), height: finite.positive() }).strict(),
    ink: z.object({ left: finite, top: finite, right: finite, bottom: finite }).strict(),
    pixels: z.number().int().nonnegative(),
  }).strict()).max(100),
  trials: z.array(z.object({ stateId: z.string(), issues: z.array(z.string()).max(100) }).strict()).max(10),
  reflowMeasurements: z.array(z.object({ sourceId: z.string(), width: finite.positive(), height: finite.positive() }).strict()).max(60).optional(),
  comparisonMeasurements: z.array(z.object({ sourceId: z.string(), width: finite.positive(), height: finite.positive() }).strict()).max(16).optional(),
  graphicMeasurements: z.array(z.object({ sourceId: z.string(), box: z.object({ x: finite, y: finite, width: finite.nonnegative(), height: finite.positive() }).strict() }).strict()).max(80).optional(),
  preview: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/).max(4_000_000),
}).strict()
export type TemplateRenderReport = z.infer<typeof renderReportSchema>

export function validatePilotPng(preview: string, width: number, height: number) {
  const bytes = Buffer.from(preview.slice(preview.indexOf(',') + 1), 'base64')
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new SemanticValidationError(['invalid-png'])
  const scale = 1024 / Math.max(width, height)
  if (bytes.readUInt32BE(16) !== Math.round(width * scale) || bytes.readUInt32BE(20) !== Math.round(height * scale)) throw new SemanticValidationError(['wrong-png-canvas'])
}

/** Measurements are evidence of a specific binding and authorized state, not a
 * client-supplied permission to change text, font size or geometry. */
export async function validateTemplateReport(raw: unknown, recipe: TemplateRecipe, material: RecipeMaterial, rawPlan: TemplatePlan) {
  const report = renderReportSchema.parse(raw), plan = validateTemplatePlan(rawPlan, recipe, material), errors: string[] = []
  validatePilotPng(report.preview, recipe.passport.canvas.width, recipe.passport.canvas.height)
  if (report.recipeVersion !== recipe.passport.version || report.materialHash !== await contentHash(material)) errors.push('stale-render')
  const states = templateCandidateStates(recipe, plan), final = report.trials.at(-1)
  if (!final || final.stateId !== report.stateId || JSON.stringify(final.issues) !== JSON.stringify(report.issues) ||
    report.trials.some((t, i) => t.stateId !== states[i] || i < report.trials.length - 1 && !t.issues.length) ||
    report.trials.length > states.length || !report.passed && report.trials.length !== states.length) errors.push('invalid-state-trials')
  if (report.passed !== (report.issues.length === 0)) errors.push('inconsistent-render-verdict')
  const grid = recipe.stateGraphics?.[report.stateId] ? resolveTemplateReflow(recipe, report.reflowMeasurements ?? [], plan.bindings.map(b => b.sourceId)) : null
  if (report.reflowMeasurements && !grid) errors.push('reflow-measurements-on-fixed-state')
  const comparison = recipe.comparison ? resolveTemplateComparison(recipe, material, plan, report.comparisonMeasurements ?? []) : null
  if (comparison) {
    const expected = Object.entries(comparison.graphics).map(([sourceId, box]) => ({ sourceId, box }))
    if (JSON.stringify(report.graphicMeasurements) !== JSON.stringify(expected)) errors.push('comparison-graphic-evidence')
    const issues = comparisonGeometryIssues(recipe, comparison, report.measurements)
    if (report.passed && issues.length || issues.some(issue => !report.issues.includes(issue))) errors.push(...issues)
  } else if (report.comparisonMeasurements || report.graphicMeasurements) errors.push('comparison-evidence-on-fixed-state')
  const bounds = comparison?.bounds ?? grid?.bounds ?? recipe.stateBounds[report.stateId]
  if (!bounds || !states.includes(report.stateId)) errors.push('unknown-or-incompatible-state')
  const fonts = new Map<string, number>()
  const walk = (elements: ElementIR[]) => { for (const e of elements) { if (e.kind === 'text') fonts.set(e.id, e.styleRuns?.[0]?.fontSize ?? e.fontSize); if ('children' in e) walk(e.children) } }
  walk(recipe.elements)
  if (report.measurements.length !== plan.bindings.length || new Set(report.measurements.map(m => m.sourceId)).size !== plan.bindings.length) errors.push('missing-measurements')
  for (const b of plan.bindings) {
    const m = report.measurements.find(m => m.sourceId === b.sourceId), box = bounds?.[b.sourceId]
    if (!m || m.text !== b.fragments.map(id => material.fragments.find(f => f.id === id)!.text).join('\n')) errors.push(`text-evidence:${b.sourceId}`)
    if (m && (!box || Object.keys(box).some(k => m.box[k as keyof typeof box] !== box[k as keyof typeof box]))) errors.push(`box-evidence:${b.sourceId}`)
    if (m && m.fontSize !== fonts.get(b.sourceId)) errors.push(`font-size-evidence:${b.sourceId}`)
    if (!m) continue
    const { ink } = m
    if (ink.right < ink.left || ink.bottom < ink.top) errors.push(`invalid-ink:${b.sourceId}`)
    if (report.passed) {
      if (m.pixels < 3) errors.push(`invisible-text:${b.sourceId}`)
      if (m.box.x + ink.left < -2 || m.box.y + ink.top < -2 || m.box.x + ink.right > recipe.passport.canvas.width + 2 || m.box.y + ink.bottom > recipe.passport.canvas.height + 2) errors.push(`canvas-overflow:${b.sourceId}`)
      if ((grid || comparison) && (ink.left < -2 || ink.top < -2 || ink.right > m.box.width + 2 || ink.bottom > m.box.height + 2)) errors.push(`overflow:${b.sourceId}`)
    }
  }
  if (report.passed) for (let i = 0; i < report.measurements.length; i++) for (let j = i + 1; j < report.measurements.length; j++) {
    const a = report.measurements[i], b = report.measurements[j]
    if (a.box.x + a.ink.left < b.box.x + b.ink.right - 2 && b.box.x + b.ink.left < a.box.x + a.ink.right - 2 &&
      a.box.y + a.ink.top < b.box.y + b.ink.bottom - 2 && b.box.y + b.ink.top < a.box.y + a.ink.bottom - 2) errors.push(`collision:${a.sourceId}:${b.sourceId}`)
  }
  if (errors.length) throw new SemanticValidationError(errors)
  return report
}
