import { z } from 'zod'
import type { VisualManifest } from '../../digital-designer/visual-package'
import type { ModelMessage } from '../../digital-designer/design-context'
import { contentHash } from '../../design-system/catalog'
import { SemanticValidationError } from '../../design-system/semantic-contract'
import { beginModelRun, readModelRun } from '../../uploads/model-run'
import { QwenAnalysisError, type QwenConfig } from '../../uploads/qwen-analysis'
import type { StructuredRequest } from '../../uploads/qwen-structured'
import { authoredRecipePassport } from './passport'
import { recipePilotCases } from './pilot-cases'
import { applyTemplateAdaptation, compileTemplateRecipe, templateCandidates, validateTemplateAdaptation, validateTemplateProposal, type TemplateProposal } from './template-contract'
import { templateAdaptationTask, templateBindingTask, templateExtractionTask, templateReflowTask, templateReviewTask } from './template-task'
import { validateTemplatePlan } from './template-plan'
import { applyTemplateReflow, validateTemplateReflow } from './template-reflow'
import { renderReportSchema, validatePilotPng, validateTemplateReport, type TemplateRenderReport } from './template-measurement'
import { registerRecipeVersion } from './library'
import { familyRecipeCases } from './family-cases'
import { comparisonRecipeCases } from './comparison-cases'
import { applyTemplateComparison } from './template-comparison'
import { comparisonEvidence, templateComparisonTask, validateComparisonReply } from './template-comparison-task'
export { renderReportSchema, validatePilotPng, type TemplateRenderReport } from './template-measurement'

const json = { httpMetadata: { contentType: 'application/json' } }
export const PILOT_REQUEST_LIMIT = 12
export const STRUCTURAL_REQUEST_LIMIT = 6
export const SECOND_FAMILY_REQUEST_LIMIT = 12
export const COMPARISON_REQUEST_LIMIT = 18
export type PilotRound = 'pilot-1' | 'structural-1' | 'family-2' | 'comparison-1'
// Deliberately outside a source/prompt/render hash: revisions never replenish an allowance.
const pilotRoot = (uploadId: string, round: PilotRound = 'pilot-1') => `recipe-pilots/${uploadId}/${['family-2', 'comparison-1'].includes(round) ? round : 'pilot-1'}`
type Budget = { used: number; limit: number }
const budgetKey = (uploadId: string, round: PilotRound) => `${pilotRoot(uploadId, round)}/${round === 'structural-1' ? 'allowances/structural-1/' : ''}budget.json`
const comparisonCheckKey = (uploadId: string) => `${pilotRoot(uploadId, 'comparison-1')}/allowances/comparison-check-1.json`
type ComparisonAllowance = Budget & { reason: string; authorizedAt: string }
async function baseBudget(bucket: R2Bucket, uploadId: string, round: PilotRound): Promise<Budget> {
  const file = await bucket.get(budgetKey(uploadId, round))
  return file ? file.json<Budget>() : { used: 0, limit: round === 'comparison-1' ? COMPARISON_REQUEST_LIMIT : round === 'family-2' ? SECOND_FAMILY_REQUEST_LIMIT : round === 'pilot-1' ? PILOT_REQUEST_LIMIT : STRUCTURAL_REQUEST_LIMIT }
}
export async function pilotBudget(bucket: R2Bucket, uploadId: string, round: PilotRound = 'pilot-1'): Promise<Budget> {
  const base = await baseBudget(bucket, uploadId, round), additional = round === 'comparison-1' ? await (await bucket.get(comparisonCheckKey(uploadId)))?.json<ComparisonAllowance>() : null
  return additional ? { used: base.used + additional.used, limit: base.limit + additional.limit } : base
}
/** A separate, explicit, single-use grant. It never refills an earlier ledger. */
export async function authorizeComparisonCheck(bucket: R2Bucket, uploadId: string, reason: string) {
  z.string().trim().min(1).max(1000).parse(reason)
  const key = comparisonCheckKey(uploadId)
  await bucket.put(key, JSON.stringify({ used: 0, limit: 6, reason, authorizedAt: new Date().toISOString() }), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  return pilotBudget(bucket, uploadId, 'comparison-1')
}
export async function reservePilotRequest(bucket: R2Bucket, uploadId: string, round: PilotRound = 'pilot-1') {
  for (let retry = 0; retry < 8; retry++) {
    let key = budgetKey(uploadId, round), file = await bucket.get(key), budget = file ? await file.json<Budget>() : await baseBudget(bucket, uploadId, round)
    if (budget.used >= budget.limit && round === 'comparison-1') {
      const extra = await bucket.get(comparisonCheckKey(uploadId))
      if (extra) { key = comparisonCheckKey(uploadId); file = extra; budget = await extra.json<ComparisonAllowance>() }
    }
    if (budget.used >= budget.limit) throw new QwenAnalysisError('RECIPE_BUDGET_EXHAUSTED', 'Достигнут предел запросов пилота. Сохранённые результаты доступны без новых запросов.')
    if (await bucket.put(key, JSON.stringify({ ...budget, used: budget.used + 1 }), { ...json, onlyIf: file ? { etagMatches: file.etag } : { etagDoesNotMatch: '*' } })) return
  }
  throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Бюджет обновляется другим обработчиком.')
}

async function context(bucket: R2Bucket, uploadId: string, round: PilotRound = 'pilot-1') {
  const file = await bucket.get(`visual/${uploadId}/manifest.json`)
  if (!file) throw new QwenAnalysisError('RECIPE_SOURCE_MISSING', 'Сначала требуется импортировать исходный шаблон.')
  const visual = await file.json<VisualManifest>(), sourceHash = await contentHash(visual.snapshot)
  return { visual, sourceHash, prefix: `${pilotRoot(uploadId, round)}/${sourceHash}` }
}
async function preview(bucket: R2Bucket, uploadId: string, visual: VisualManifest, slideId: string) {
  const ref = visual.previews.find(p => p.id === slideId), file = await bucket.get(`visual/${uploadId}/preview-${slideId}`)
  if (!ref || !file || !['image/png', 'image/jpeg'].includes(ref.mime)) throw new QwenAnalysisError('RECIPE_PREVIEW_MISSING', 'Не найдено исходное превью.')
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > 2_500_000) throw new QwenAnalysisError('RECIPE_PREVIEW_TOO_LARGE', 'Превью превышает лимит пилота.')
  return `data:${ref.mime};base64,${Buffer.from(bytes).toString('base64')}`
}
export async function readTemplatePilot(bucket: R2Bucket, uploadId: string, round: PilotRound = 'pilot-1') {
  const ctx = await context(bucket, uploadId, round)
  const extractionPrefix = round === 'comparison-1' ? (await context(bucket, uploadId, 'family-2')).prefix : ctx.prefix
  const extraction = await readModelRun(bucket, `${extractionPrefix}/extract`)
  const base = extraction?.status === 'complete' ? await compileTemplateRecipe(extraction.result as TemplateProposal, ctx.visual.snapshot, uploadId, extraction.sourceRunId ?? extraction.id) : null
  const adaptation = base ? await readModelRun(bucket, `${ctx.prefix}/${base.passport.version}/adapt`) : null
  const refined = base && adaptation?.status === 'complete' ? await applyTemplateAdaptation(base, adaptation.result, adaptation.sourceRunId ?? adaptation.id) : base
  const reflow = round !== 'pilot-1' && refined ? await readModelRun(bucket, `${ctx.prefix}/${refined.passport.version}/${round === 'structural-1' ? 'structural-1/' : ''}reflow`) : null
  const comparison = round === 'comparison-1' && base ? await readModelRun(bucket, `${ctx.prefix}/${base.passport.version}/compare`) : null
  const comparisonRefinements = []
  if (round === 'comparison-1' && base && comparison?.status === 'complete') for (let i = 0; i < 3; i++) {
    const saved = await readModelRun(bucket, `${ctx.prefix}/${base.passport.version}/compare-refine${i ? `-${i + 1}` : ''}`)
    comparisonRefinements.push(saved)
    if (saved?.status !== 'complete') break
  }
  const [comparisonRefinement = null, comparisonFinalRefinement = null] = comparisonRefinements
  const currentComparison = comparisonRefinements.findLast(r => r?.status === 'complete') ?? comparison
  const recipe = base && currentComparison?.status === 'complete' ? await applyTemplateComparison(base, currentComparison.result, currentComparison.sourceRunId ?? currentComparison.id)
    : refined && reflow?.status === 'complete' ? await applyTemplateReflow(refined, reflow.result, reflow.sourceRunId ?? reflow.id) : refined
  const roundPath = round === 'structural-1' ? '/structural-1' : ''
  const checked = async (prefix: string) => {
    const report = await (await bucket.get(`${prefix}/render.json`))?.json<TemplateRenderReport>() ?? null
    let review = await readModelRun(bucket, `${prefix}/review`)
    if (report && review?.status === 'complete') {
      const input = await (await bucket.get(`${prefix}/review/inputs/${review.inputHash}.json`))?.json<{ task: StructuredRequest }>()
      const content = input?.task.messages[1]?.content
      const text = Array.isArray(content) && content.find(c => c.type === 'text')
      const images = Array.isArray(content) ? content.filter(c => c.type === 'image_url') : []
      const measurements = text && 'text' in text ? JSON.parse(text.text).measurements : undefined
      if (images.at(-1)?.type !== 'image_url' || (images.at(-1) as { image_url: { url: string } }).image_url.url !== report.preview || JSON.stringify(measurements) !== JSON.stringify({ ...report, preview: undefined })) review = null
    }
    return { report, review, reportKey: `${prefix}/render.json`, reviewPrefix: `${prefix}/review` }
  }
  const cases = []
  const materials = round === 'comparison-1' ? recipe?.comparison ? comparisonRecipeCases(recipe.proposal.itemCount) : []
    : round === 'family-2' ? recipe ? familyRecipeCases(recipe.proposal.itemCount, recipe.slots.some(s => s.role === 'ordinal' && !s.optional)) : [] : recipePilotCases
  for (const material of materials) {
    const prefix = recipe ? `${ctx.prefix}/${recipe.passport.version}${roundPath}/${material.id}/${await contentHash(material)}` : ''
    const planPrefix = base ? `${ctx.prefix}/${base.passport.version}/${material.id}/${await contentHash(material)}/plan` : ''
    const plan = planPrefix ? await readModelRun(bucket, planPrefix) : null
    if (plan?.status === 'complete' && recipe) validateTemplatePlan(plan.result, recipe, material)
    cases.push({ material, plan, planPrefix, ...(prefix ? await checked(prefix) : { report: null, review: null, reportKey: '', reviewPrefix: '' }) })
  }
  const reconstructionPrefix = base ? `${ctx.prefix}/${round === 'comparison-1' ? recipe!.passport.version : base.passport.version}${roundPath}/reconstruction` : ''
  const localReconstruction = reconstructionPrefix ? await checked(reconstructionPrefix) : { report: null, review: null, reportKey: '', reviewPrefix: '' }
  const sourceReconstruction = round === 'comparison-1' && base ? await checked(`${extractionPrefix}/${base.passport.version}/reconstruction`) : null
  const reuseSource = sourceReconstruction?.report?.passed && sourceReconstruction.report.recipeVersion === base!.passport.version &&
    sourceReconstruction.report.stateId === 'reconstruction' && sourceReconstruction.report.materialHash === await contentHash({ reconstruction: ctx.sourceHash }) &&
    sourceReconstruction.review?.status === 'complete' && (sourceReconstruction.review.result as { verdict?: string })?.verdict === 'pass'
  const reconstruction = reuseSource ? { ...sourceReconstruction!, reusedFrom: `${extractionPrefix}/${base!.passport.version}/reconstruction` } : localReconstruction
  const qualificationKey = recipe ? `${ctx.prefix}/${recipe.passport.version}${roundPath}/qualification.json` : ''
  const qualification = qualificationKey ? await (await bucket.get(qualificationKey))?.json() ?? null : null
  return { round, sourceHash: ctx.sourceHash, authored: authoredRecipePassport(), recipe, extraction, adaptation, reflow, ...(round === 'comparison-1' ? { comparison, comparisonRefinement, comparisonFinalRefinement, comparisonRefinements,
    comparisonAllowances: { initial: await baseBudget(bucket, uploadId, round), check: await (await bucket.get(comparisonCheckKey(uploadId)))?.json<ComparisonAllowance>() ?? null } } : {}), cases, reconstruction, qualification, qualificationKey,
    budget: await pilotBudget(bucket, uploadId, round), originalBudget: await pilotBudget(bucket, uploadId) }
}

export async function startTemplatePilot(bucket: R2Bucket, uploadId: string, config: QwenConfig, action: 'extract' | 'adapt' | 'plan' | 'review' | 'reflow' | 'compare' | 'compare-refine', caseId?: string, rawReport?: unknown, round: PilotRound = 'pilot-1') {
  if (['compare', 'compare-refine'].includes(action) && round !== 'comparison-1' || round === 'comparison-1' && !['compare', 'compare-refine', 'plan', 'review'].includes(action)) throw new QwenAnalysisError('RECIPE_ROUND_ACTION', 'Операция не входит в уточнение парных показателей.')
  if (round === 'structural-1' && !['reflow', 'review'].includes(action) || round === 'pilot-1' && action === 'reflow') throw new QwenAnalysisError('RECIPE_ROUND_ACTION', 'Эта операция не входит в выбранный контрольный прогон.')
  const ctx = await context(bucket, uploadId, round), beforeRequest = () => reservePilotRequest(bucket, uploadId, round)
  const start = <T>(prefix: string, task: StructuredRequest, validate: (raw: unknown) => T) => beginModelRun({ bucket, uploadId, prefix, task, config,
    version: 'template-pilot-1', scope: { uploadId, sourceHash: ctx.sourceHash, caseId: caseId ?? null }, validate, beforeRequest, revalidateRejected: true,
    clarification: { version: 'template-pilot-clarify-1', request: (reply, issues) => ({ ...task, messages: [...task.messages,
      { role: 'user', content: JSON.stringify({ instruction: 'Исправь весь JSON, не меняя входные данные.', previousResponse: reply.content, issues }) } as ModelMessage] }) },
  })
  if (action === 'extract') {
    const first = round === 'family-2' ? await readTemplatePilot(bucket, uploadId) : null
    if (round === 'family-2' && !first?.recipe) throw new QwenAnalysisError('RECIPE_FIRST_FAMILY_MISSING', 'Сначала требуется исходное семейство для сравнения.')
    const options = round === 'family-2' ? { excludeSlideIds: first!.recipe!.passport.origin.slideIds, limit: 5, additionalFamily: true } : {}
    const selected = templateCandidates(ctx.visual.snapshot, options), previews = []
    if (!selected.length) throw new QwenAnalysisError('RECIPE_NO_CANDIDATES', 'Нет исходных слайдов в пределах возможностей первого пилота.')
    for (const { slide } of selected) previews.push({ slideId: slide.id, dataUrl: await preview(bucket, uploadId, ctx.visual, slide.id) })
    return start(`${ctx.prefix}/extract`, templateExtractionTask(ctx.visual.snapshot, previews, options), raw => validateTemplateProposal(raw, ctx.visual.snapshot, selected.map(c => c.slide.id)))
  }
  const view = await readTemplatePilot(bucket, uploadId, round), recipe = view.recipe
  if (!recipe) throw new QwenAnalysisError('RECIPE_NOT_EXTRACTED', 'Сначала требуется извлечь рецепт.')
  if (action === 'compare' || action === 'compare-refine') {
    if (action === 'compare' && recipe.comparison) return { run: view.comparison, execute: null }
    if (action === 'compare-refine' && view.comparisonRefinements?.length === 3 && view.comparisonRefinements.every(r => r?.status === 'complete')) return { run: view.comparisonRefinements.at(-1), execute: null }
    const previous = action === 'compare' ? await readTemplatePilot(bucket, uploadId, 'family-2') : view, details = []
    if (action === 'compare-refine' && (!recipe.comparison || !previous.cases.some(c => c.report && (!c.report.passed || (c.review?.result as { verdict?: string })?.verdict === 'revise')))) throw new QwenAnalysisError('RECIPE_NO_FEEDBACK', 'Для уточнения нужны реальные ошибки измерений или ревью.')
    for (const detail of comparisonEvidence(recipe).imageDetails) {
      const ref = ctx.visual.assets.find(a => a.id === detail.assetId), file = await bucket.get(`visual/${uploadId}/${detail.assetId}`)
      if (!ref || !file || !['image/png', 'image/jpeg', 'image/webp'].includes(ref.mime)) throw new QwenAnalysisError('RECIPE_PREVIEW_MISSING', 'Нет изображения детали показателя.')
      const bytes = await file.arrayBuffer()
      if (bytes.byteLength > 1_000_000) throw new QwenAnalysisError('RECIPE_PREVIEW_TOO_LARGE', 'Деталь показателя превышает лимит.')
      details.push({ sourceId: detail.sourceId, dataUrl: `data:${ref.mime};base64,${Buffer.from(bytes).toString('base64')}` })
    }
    const reports = previous.cases.filter(c => c.report).map(c => ({ material: c.material, report: { passed: c.report!.passed, stateId: c.report!.stateId, issues: c.report!.issues }, review: c.review?.result }))
    const feedback = action === 'compare-refine' ? previous.cases.filter(c => c.report).map(c => ({ label: c.material.id, preview: c.report!.preview })) : []
    const refinementIndex = view.comparisonRefinements?.findIndex(r => r?.status !== 'complete') ?? 0
    const index = refinementIndex < 0 ? view.comparisonRefinements?.length ?? 0 : refinementIndex
    const operation = action === 'compare-refine' ? `compare-refine${index ? `-${index + 1}` : ''}` : action
    return start(`${ctx.prefix}/${recipe.comparison?.baseVersion ?? recipe.passport.version}/${operation}`, templateComparisonTask(recipe, await preview(bucket, uploadId, ctx.visual, recipe.proposal.slideId), details, reports, feedback), raw => validateComparisonReply(raw, recipe, reports))
  }
  if (round === 'comparison-1' && !recipe.comparison) throw new QwenAnalysisError('RECIPE_COMPARISON_MISSING', 'Сначала требуется модельное уточнение показателей.')
  const baseVersion = recipe.comparison?.baseVersion ?? recipe.adaptation?.baseVersion ?? recipe.reflow?.previousVersion ?? recipe.passport.version
  if (action === 'reflow') {
    if (recipe.reflow) return { run: view.reflow, execute: null }
    const prior = await readTemplatePilot(bucket, uploadId, round === 'family-2' ? round : 'pilot-1')
    const reports = prior.cases.filter(c => c.report).map(c => ({ material: c.material, report: { ...c.report!, preview: undefined } }))
    if (!reports.some(c => c.report.issues.some(issue => recipe.slots.some(s => s.role === 'body' && issue === `overflow:${s.sourceId}`)))) throw new QwenAnalysisError('RECIPE_NO_FEEDBACK', 'Для перестройки нужны измеренные переполнения карточек.')
    return start(`${ctx.prefix}/${recipe.passport.version}/${round === 'structural-1' ? 'structural-1/' : ''}reflow`, templateReflowTask(recipe, reports, await preview(bucket, uploadId, ctx.visual, recipe.proposal.slideId)), raw => validateTemplateReflow(raw, recipe))
  }
  if (action === 'adapt') {
    if (recipe.adaptation) return { run: view.adaptation, execute: null }
    const reports = view.cases.filter(c => c.report).map(c => ({ material: c.material, report: { ...c.report!, preview: undefined } }))
    if (!reports.some(c => c.report.issues.length)) throw new QwenAnalysisError('RECIPE_NO_FEEDBACK', 'Для уточнения нужны реальные измерения переполнения.')
    return start(`${ctx.prefix}/${baseVersion}/adapt`, templateAdaptationTask(recipe, reports, await preview(bucket, uploadId, ctx.visual, recipe.proposal.slideId)), raw => validateTemplateAdaptation(raw, recipe))
  }
  const material = view.cases.find(c => c.material.id === caseId)?.material
  if (!material && caseId !== 'reconstruction') throw new QwenAnalysisError('RECIPE_UNKNOWN_CASE', 'Неизвестный проверочный материал.')
  if (caseId === 'reconstruction' && 'reusedFrom' in view.reconstruction) return { run: view.reconstruction.review, execute: null }
  const materialHash = await contentHash(material ?? { reconstruction: ctx.sourceHash })
  const prefix = `${ctx.prefix}/${material || round === 'comparison-1' ? recipe.passport.version : baseVersion}${round === 'structural-1' ? '/structural-1' : ''}/${material ? `${material.id}/${materialHash}` : 'reconstruction'}`
  if (action === 'plan') {
    if (!material) throw new QwenAnalysisError('RECIPE_UNKNOWN_CASE', 'Исходный пример не требует нового плана.')
    return start(`${ctx.prefix}/${baseVersion}/${material.id}/${materialHash}/plan`, templateBindingTask(recipe, material), raw => validateTemplatePlan(raw, recipe, material))
  }
  const report = renderReportSchema.parse(rawReport), errors: string[] = []
  validatePilotPng(report.preview, recipe.passport.canvas.width, recipe.passport.canvas.height)
  if (report.recipeVersion !== recipe.passport.version || report.materialHash !== materialHash) errors.push('stale-render')
  if (report.passed !== (report.issues.length === 0)) errors.push('inconsistent-render-verdict')
  if (!report.trials.length || report.trials.at(-1)!.stateId !== report.stateId || JSON.stringify(report.trials.at(-1)!.issues) !== JSON.stringify(report.issues)) errors.push('missing-final-trial')
  if (material) {
    const savedPlan = view.cases.find(c => c.material.id === material.id)?.plan
    if (savedPlan?.status !== 'complete') throw new QwenAnalysisError('RECIPE_PLAN_MISSING', 'Не найден проверенный план.')
    const plan = validateTemplatePlan(savedPlan.result, recipe, material)
    await validateTemplateReport(report, recipe, material, plan)
  } else if (report.stateId !== 'reconstruction' || !report.measurements.length) errors.push('reconstruction-evidence-missing')
  if (errors.length) throw new SemanticValidationError(errors)
  // A rejected fit is still valuable diagnostic evidence, but cannot enter the
  // qualified library or spend a visual review request to bypass measurements.
  await bucket.put(`${prefix}/render.json`, JSON.stringify(report), json)
  if (!report.passed) { await qualifyTemplatePilot(bucket, uploadId, round); return { run: null, execute: null } }
  const task = templateReviewTask(recipe, material ?? null, await preview(bucket, uploadId, ctx.visual, recipe.proposal.slideId), report.preview, { ...report, preview: undefined })
  const started = await start(`${prefix}/review`, task, raw => {
    const result = z.object({ verdict: z.enum(['pass', 'revise']), issues: z.array(z.string().min(1).max(500)).max(8) }).strict().parse(raw)
    if (result.verdict === 'pass' && result.issues.length || result.verdict === 'revise' && !result.issues.length) throw new SemanticValidationError(['inconsistent-visual-verdict'])
    return result
  })
  if (!started.execute) { await qualifyTemplatePilot(bucket, uploadId, round); return started }
  return { run: started.run, execute: async (signal?: AbortSignal) => { await started.execute!(signal); await qualifyTemplatePilot(bucket, uploadId, round) } }
}

async function qualifyTemplatePilot(bucket: R2Bucket, uploadId: string, round: PilotRound) {
    const current = await readTemplatePilot(bucket, uploadId, round), ctx = await context(bucket, uploadId, round), recipe = current.recipe
    if (!recipe) return
    const checks = [current.reconstruction, ...current.cases]
    const complete = checks.every(c => c.report && (!c.report.passed || c.review?.status === 'complete'))
    if (!complete) return
    const passed = checks.every(c => c.report?.passed && (c.review?.result as { verdict?: string })?.verdict === 'pass')
    const receipt = { recipeVersion: recipe.passport.version, sourceHash: ctx.sourceHash,
      technical: passed ? 'passed' : 'failed', artistic: 'pending', scope: round === 'comparison-1' ? `three-synthetic-${recipe.proposal.itemCount}-paired-percent-cases` : round === 'family-2' ? `three-synthetic-${recipe.proposal.itemCount}-item-cases` : 'three-synthetic-four-item-cases',
      stateIds: [...new Set(checks.map(c => c.report!.stateId))],
      checks: checks.map((c, i) => ({ caseId: i ? current.cases[i - 1].material.id : 'reconstruction', measured: c.report!.passed, reviewRunId: c.review?.id ?? null })),
    }
    const receiptKey = `${ctx.prefix}/${recipe.passport.version}${round === 'structural-1' ? '/structural-1' : ''}/qualification.json`
    await bucket.put(receiptKey, JSON.stringify(receipt), json)
    await bucket.put(`recipe-library/${uploadId}/versions/${recipe.passport.id}/${recipe.passport.version}.json`, JSON.stringify({ ...recipe.passport,
      qualification: { technical: receipt.technical, artistic: 'pending', receipt: receiptKey }, generationEnabled: false,
    }), json)
    await bucket.put(`recipe-library/${uploadId}/${recipe.passport.id}.json`, JSON.stringify({ ...recipe.passport,
      qualification: { technical: receipt.technical, artistic: 'pending', receipt: receiptKey },
      generationEnabled: false, reason: 'Pilot evidence only; artistic approval and normal generation integration pending.',
    }), json)
}

/** Publication copies an evaluated version; it neither accepts the artwork nor
 * enables generation, and never changes the pilot's responses or allowance. */
export async function registerTemplatePilot(bucket: R2Bucket, uploadId: string, round: PilotRound, expectedRevision: string) {
  const view = await readTemplatePilot(bucket, uploadId, round), recipe = view.recipe
  if (!recipe || !view.qualification) throw new QwenAnalysisError('RECIPE_UNQUALIFIED', 'Не найден завершённый проверочный прогон.')
  const evidenceKeys: string[] = []
  const technical = [view.reconstruction, ...view.cases].every(c => c.report?.passed && c.review?.status === 'complete' && (c.review.result as { verdict?: string })?.verdict === 'pass') ? 'passed' : 'failed'
  if ((view.qualification as { technical?: string }).technical !== technical) throw new QwenAnalysisError('RECIPE_UNQUALIFIED', 'Квитанция не соответствует текущим результатам проверки.')
  for (const check of [{ ...view.reconstruction, material: null, plan: null, planPrefix: '' }, ...view.cases]) {
    if (!check.report || check.report.passed && (check.review?.status !== 'complete' ||
      !['pass', 'revise'].includes((check.review.result as { verdict: string })?.verdict)) ||
      check.report.recipeVersion !== recipe.passport.version && (check.material || check.report.recipeVersion !== recipe.comparison?.baseVersion)) {
      throw new QwenAnalysisError('RECIPE_UNQUALIFIED', 'Текущие измерения и визуальные проверки не подтверждают допуск.')
    }
    if (check.report.passed) {
      const review = z.object({ verdict: z.enum(['pass', 'revise']), issues: z.array(z.string().min(1)).max(8) }).strict().parse(check.review!.result)
      if ((review.verdict === 'pass') !== (review.issues.length === 0)) throw new SemanticValidationError(['inconsistent-visual-verdict'])
    }
    if (check.material) {
      if (check.plan?.status !== 'complete') throw new QwenAnalysisError('RECIPE_UNQUALIFIED', 'Нет проверенной привязки материала.')
      await validateTemplateReport(check.report, recipe, check.material, validateTemplatePlan(check.plan.result, recipe, check.material))
      evidenceKeys.push(`${check.planPrefix}/runs/${check.plan.id}.json`)
    } else {
      const report = renderReportSchema.parse(check.report)
      validatePilotPng(report.preview, recipe.passport.canvas.width, recipe.passport.canvas.height)
      if (report.stateId !== 'reconstruction' || report.materialHash !== await contentHash({ reconstruction: view.sourceHash }) || report.passed !== (report.issues.length === 0)) throw new QwenAnalysisError('RECIPE_UNQUALIFIED', 'Не подтверждено восстановление исходника.')
    }
    evidenceKeys.push(check.reportKey)
    if (check.review?.status === 'complete') evidenceKeys.push(`${check.reviewPrefix}/runs/${check.review.id}.json`, `${check.reviewPrefix}/inputs/${check.review.inputHash}.json`)
  }
  return registerRecipeVersion(bucket, recipe, view.qualificationKey, evidenceKeys, expectedRevision)
}
