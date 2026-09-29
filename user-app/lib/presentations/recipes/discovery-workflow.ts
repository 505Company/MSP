import { z } from 'zod'
import type { ElementIR } from '../../../vendor/drag/src/core/model'
import type { VisualManifest } from '../../digital-designer/visual-package'
import type { ModelMessage } from '../../digital-designer/design-context'
import { contentHash } from '../../design-system/catalog'
import { SemanticValidationError } from '../../design-system/semantic-contract'
import { beginModelRun, readModelRun, type ModelRun } from '../../uploads/model-run'
import { QwenAnalysisError, type QwenConfig } from '../../uploads/qwen-analysis'
import type { StructuredRequest } from '../../uploads/qwen-structured'
import { DISCOVERY_VERSION, assertDiscoveryLease, changeDiscoveryJob, discoveryJson, discoveryRoot, ownedDiscoveryJob, reserveDiscoveryRequest, type DiscoveryJob, type DiscoveryResult } from './discovery-jobs'
import { discoveryExtractionTask, validateDiscoveryExtraction } from './discovery-task'
import { applyTemplateAdaptation, compileTemplateRecipe, validateTemplateAdaptation, type TemplateRecipe } from './template-contract'
import { applyTemplateReflow, validateTemplateReflow } from './template-reflow'
import { applyTemplateComparison } from './template-comparison'
import { comparisonEvidence, templateComparisonTask, validateComparisonReply } from './template-comparison-task'
import { templateAdaptationTask, templateBindingTask, templateReflowTask, templateReviewTask } from './template-task'
import { validateTemplatePlan, type TemplatePlan } from './template-plan'
import { familyRecipeCases } from './family-cases'
import { comparisonRecipeCases } from './comparison-cases'
import { renderReportSchema, validatePilotPng, validateTemplateReport, type TemplateRenderReport } from './template-measurement'
import type { RecipeMaterial } from './pilot-cases'
import { readRecipeRegistry, registerRecipeVersion } from './library'

type Refinement = 'adapt' | 'reflow' | 'compare'
type Check = { id: string; recipe: TemplateRecipe; material: RecipeMaterial | null; plan: ModelRun | null; planPrefix: string; report: TemplateRenderReport | null; review: ModelRun | null; prefix: string }
const visualReviewSchema = z.object({ verdict: z.enum(['pass', 'revise']), issues: z.array(z.string().min(1).max(500)).max(8) }).strict()
function validateReview(raw: unknown) {
  const result = visualReviewSchema.safeParse(raw)
  if (!result.success) throw new SemanticValidationError(result.error.issues.map(i => i.message))
  if ((result.data.verdict === 'pass') !== (result.data.issues.length === 0)) throw new SemanticValidationError(['inconsistent-visual-verdict'])
  return result.data
}
const fail = (code: string, message: string): never => { throw new QwenAnalysisError(code, message) }
async function immutable(bucket: R2Bucket, key: string, value: unknown) {
  await bucket.put(key, JSON.stringify(value), { ...discoveryJson, onlyIf: { etagDoesNotMatch: '*' } })
  if (await contentHash(await (await bucket.get(key))!.json()) !== await contentHash(value)) fail('RECIPE_EVIDENCE_CONFLICT', 'Сохранённое доказательство отличается. Прежний результат не заменён.')
}
async function pinnedSource(bucket: R2Bucket, job: DiscoveryJob) {
  const visual = await (await bucket.get(`${discoveryRoot(job.uploadId, job.id)}/source.json`))?.json<VisualManifest>()
  if (!visual || await contentHash(visual.snapshot) !== job.sourceHash) return fail('RECIPE_SOURCE_CHANGED', 'Не найден точный сохранённый источник задания.')
  return visual
}
async function sourceImage(bucket: R2Bucket, job: DiscoveryJob, visual: VisualManifest, slideId: string) {
  const ref = visual.previews.find(p => p.id === slideId)
  return image(bucket, job.uploadId, `preview-${slideId}`, ref?.mime, 2_500_000)
}
async function image(bucket: R2Bucket, uploadId: string, key: string, mime?: string, limit = 1_000_000) {
  if (!mime || !['image/png', 'image/jpeg', 'image/webp'].includes(mime)) return fail('RECIPE_PREVIEW_MISSING', 'Нет исходного изображения для проверки.')
  const file = await bucket.get(`visual/${uploadId}/${key}`)
  if (!file) return fail('RECIPE_PREVIEW_MISSING', 'Нет исходного изображения для проверки.')
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > limit) return fail('RECIPE_PREVIEW_TOO_LARGE', 'Исходное изображение превышает лимит проверки.')
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}
function reviewPassed(check: Check) { return check.report?.passed && check.review?.status === 'complete' && (check.review.result as { verdict: string }).verdict === 'pass' }
function checked(check: Check) { return check.report && (!check.report.passed || check.review?.status === 'complete') }

async function readCheck(bucket: R2Bucket, root: string, base: TemplateRecipe, recipe: TemplateRecipe, material: RecipeMaterial | null): Promise<Check> {
  const materialHash = await contentHash(material ?? { reconstruction: recipe.sourceSnapshotHash })
  const bindingShape = await contentHash(recipe.slots.map(({ sourceId, role, item, optional, ownerId }) => ({ sourceId, role, item, optional, ownerId })))
  const planPrefix = material ? `${root}/bindings/${bindingShape}/${materialHash}` : ''
  const prefix = material ? `${root}/checks/${recipe.passport.version}/${material.id}/${materialHash}` : `${root}/checks/${base.passport.version}/reconstruction`
  const plan = material ? await readModelRun(bucket, planPrefix) : null
  const report = await (await bucket.get(`${prefix}/render.json`))?.json<TemplateRenderReport>() ?? null
  const review = await readModelRun(bucket, `${prefix}/review`)
  return { id: material?.id ?? 'reconstruction', recipe: material ? recipe : base, material, plan, planPrefix, report, review, prefix }
}
export async function readDiscoveryEvidence(bucket: R2Bucket, job: DiscoveryJob) {
  const root = discoveryRoot(job.uploadId, job.id), visual = await pinnedSource(bucket, job)
  const extractions = [await readModelRun(bucket, `${root}/extract`)]
  if (extractions[0]?.status === 'failed' && extractions[0].error?.code === 'SEMANTIC_VALIDATION') extractions.push(await readModelRun(bucket, `${root}/extract-retry`))
  const extraction = extractions.at(-1) ?? null
  const selected = extraction?.status === 'complete' ? validateDiscoveryExtraction(extraction.result, visual.snapshot, job.candidateSlideIds) : null
  const base = selected?.proposal ? await compileTemplateRecipe(selected.proposal, visual.snapshot, job.uploadId, extraction!.sourceRunId ?? extraction!.id) : null
  const semantics = await readModelRun(bucket, `${root}/semantics`), refinements: { kind: Refinement; run: ModelRun | null }[] = []
  let recipe = base
  if (recipe && semantics?.status === 'complete') recipe = await applyTemplateComparison(base!, semantics.result, semantics.sourceRunId ?? semantics.id)
  if (recipe) for (let index = 0; index < 2; index++) {
    const descriptor = await (await bucket.get(`${root}/refinements/${index}/operation.json`))?.json<{ kind: Refinement }>()
    if (!descriptor) break
    const run = await readModelRun(bucket, `${root}/refinements/${index}/model`)
    refinements.push({ kind: descriptor.kind, run })
    if (run?.status !== 'complete') break
    recipe = descriptor.kind === 'compare' ? await applyTemplateComparison(base!, run.result, run.sourceRunId ?? run.id)
      : descriptor.kind === 'adapt' ? await applyTemplateAdaptation(recipe, run.result, run.sourceRunId ?? run.id)
        : await applyTemplateReflow(recipe, run.result, run.sourceRunId ?? run.id)
  }
  const materials = recipe && (selected?.profile !== 'paired-percent' || recipe.comparison)
    ? selected?.profile === 'paired-percent' ? comparisonRecipeCases(recipe.proposal.itemCount) : familyRecipeCases(recipe.proposal.itemCount, recipe.slots.some(s => s.role === 'ordinal' && !s.optional)) : []
  const checks: Check[] = []
  if (recipe && base) {
    checks.push(await readCheck(bucket, root, base, recipe, null))
    for (const material of materials) checks.push(await readCheck(bucket, root, base, recipe, material))
  }
  return { extraction, extractions, selected, base, recipe, semantics, refinements, checks }
}
type ModelStep = { kind: 'model'; id: string; detail: string; task: StructuredRequest; validate: (raw: unknown) => unknown }
type RenderStep = { kind: 'render'; id: string; detail: string; check: Check }
type FinalStep = { kind: 'finish'; id: string; detail: string; result: DiscoveryResult; checks: Check[] }
type Step = ModelStep | RenderStep | FinalStep
export type DiscoveryAdvance = { done: boolean; stepId?: string; render?: { recipe: TemplateRecipe; material: RecipeMaterial | null; plan: TemplatePlan | null } }

async function comparisonTask(bucket: R2Bucket, job: DiscoveryJob, visual: VisualManifest, recipe: TemplateRecipe, checks: Check[]) {
  const details = []
  for (const detail of comparisonEvidence(recipe).imageDetails) details.push({ sourceId: detail.sourceId,
    dataUrl: await image(bucket, job.uploadId, detail.assetId, visual.assets.find(a => a.id === detail.assetId)?.mime) })
  const reports = checks.filter(c => c.material && c.report).map(c => ({ material: c.material, report: { passed: c.report!.passed, stateId: c.report!.stateId, issues: c.report!.issues }, review: c.review?.result }))
  const previews = checks.filter(c => c.material && c.report).map(c => ({ label: c.id, preview: c.report!.preview }))
  return { task: templateComparisonTask(recipe, await sourceImage(bucket, job, visual, recipe.proposal.slideId), details, reports, previews), validate: (raw: unknown) => validateComparisonReply(raw, recipe, reports) }
}
async function nextStep(bucket: R2Bucket, job: DiscoveryJob): Promise<Step> {
  const root = discoveryRoot(job.uploadId, job.id), visual = await pinnedSource(bucket, job), view = await readDiscoveryEvidence(bucket, job)
  const finish = (result: DiscoveryResult, checks = view.checks): FinalStep => ({ kind: 'finish', id: `${root}/finish`, detail: result.reason, result, checks })
  if (!job.candidateSlideIds.length) return finish({ technical: 'unsupported', reason: 'Новых исходных слайдов в пределах поддерживаемых семейств не найдено.' })
  if (!view.selected) {
    if (view.extractions.length === 2 && view.extraction?.status === 'failed' && view.extraction.error?.code === 'SEMANTIC_VALIDATION') return finish({ technical: 'failed', reason: 'Две ограниченные попытки извлечения не прошли контракт. Ответы и причины сохранены; рецепт не зарегистрирован.' })
    const previews = []
    for (const slideId of job.candidateSlideIds) previews.push({ slideId, dataUrl: await sourceImage(bucket, job, visual, slideId) })
    const previous = view.extractions.length === 2 ? view.extractions[0] : null
    const rejected = previous ? await (await bucket.get(`${root}/extract/${previous.clarificationRequests ? `clarifications/${previous.id}/response.json` : `responses/${previous.id}.json`}`))?.json<{ content: string }>() : null
    return { kind: 'model', id: `${root}/${previous ? 'extract-retry' : 'extract'}`, detail: previous ? 'Qwen проверяет другое предложение с учётом отказа.' : 'Qwen выбирает новое семейство и описывает поля.',
      task: discoveryExtractionTask(visual.snapshot, previews, job.candidateSlideIds, previous && rejected ? { issues: previous.error?.issues ?? [], response: rejected.content } : undefined), validate: raw => validateDiscoveryExtraction(raw, visual.snapshot, job.candidateSlideIds) }
  }
  if (!view.recipe) return finish({ technical: 'unsupported', reason: view.selected.reason })
  const recipe = view.recipe, reconstruction = view.checks[0]
  const result = (technical: 'passed' | 'failed', reason: string): DiscoveryResult => ({ technical, reason, recipeId: recipe.passport.id, version: recipe.passport.version, slideId: recipe.proposal.slideId })
  const checkStep = async (check: Check): Promise<Step | null> => {
    if (check.material && check.plan?.status !== 'complete') return { kind: 'model', id: check.planPrefix, detail: `Qwen связывает весь ${check.id} материал с полями.`, task: templateBindingTask(recipe, check.material), validate: raw => validateTemplatePlan(raw, recipe, check.material!) }
    if (!check.report) return { kind: 'render', id: `${check.prefix}/render.json`, check, detail: `Измеряем и проверяем изображение: ${check.id}.` }
    await validateCheckReport(check, job.sourceHash)
    if (check.report.passed) {
      const task = templateReviewTask(check.recipe, check.material, await sourceImage(bucket, job, visual, recipe.proposal.slideId), check.report.preview, { ...check.report, preview: undefined })
      if (check.review?.status !== 'complete') return { kind: 'model', id: `${check.prefix}/review`, detail: `Qwen проверяет изображение: ${check.id}.`, task, validate: validateReview }
      const input = await (await bucket.get(`${check.prefix}/review/inputs/${check.review.inputHash}.json`))?.json<{ task: StructuredRequest }>()
      if (!input || await contentHash(input.task) !== await contentHash(task)) fail('RECIPE_STALE_REVIEW', 'Визуальное ревью относится к другим измерениям или изображению.')
      validateReview(check.review.result)
    }
    return null
  }
  const reconstructionStep = await checkStep(reconstruction)
  if (reconstructionStep) return reconstructionStep
  if (!reviewPassed(reconstruction)) return finish(result('failed', 'Исходная композиция не прошла восстановление.'), [reconstruction])
  if (view.selected.profile === 'paired-percent' && !recipe.comparison) return { kind: 'model', id: `${root}/semantics`, detail: 'Qwen описывает пары показателей и правила полос.', ...await comparisonTask(bucket, job, visual, recipe, []) }
  for (const check of view.checks.slice(1)) {
    const step = await checkStep(check)
    if (step) return step
  }
  if (view.checks.length === 4 && view.checks.every(reviewPassed)) return finish(result('passed', 'Три объёма проверены. Кандидат сохранён для визуальной приёмки.'))
  const pendingIndex = view.refinements.findIndex(r => r.run?.status !== 'complete')
  const index = pendingIndex < 0 ? view.refinements.length : pendingIndex
  if (index >= 2) return finish(result('failed', 'Достигнут предел уточнений. Кандидат не прошёл проверку на всех объёмах.'))
  const issues = view.checks.flatMap(c => c.report?.issues ?? [])
  const kind: Refinement | undefined = view.refinements[index]?.kind ?? (recipe.comparison ? 'compare'
    : !recipe.adaptation && recipe.slots.some(s => s.role === 'context' && !s.ownerId && issues.includes(`overflow:${s.sourceId}`)) ? 'adapt'
      : !recipe.reflow && recipe.slots.some(s => s.role === 'body' && issues.includes(`overflow:${s.sourceId}`)) && [2, 3, 4].some(n => n < recipe.proposal.itemCount && recipe.proposal.itemCount % n === 0) ? 'reflow' : undefined)
  if (!kind) return finish(result('failed', 'Измеренные ошибки не исправляются разрешёнными состояниями этого семейства.'))
  await immutable(bucket, `${root}/refinements/${index}/operation.json`, { kind })
  const reports = view.checks.filter(c => c.material && c.report).map(c => ({ material: c.material, report: { ...c.report!, preview: undefined } }))
  const reference = await sourceImage(bucket, job, visual, recipe.proposal.slideId)
  return { kind: 'model', id: `${root}/refinements/${index}/model`, detail: 'Qwen уточняет правило семейства по измеренным ошибкам.',
    ...(kind === 'compare' ? await comparisonTask(bucket, job, visual, recipe, view.checks) : kind === 'adapt'
      ? { task: templateAdaptationTask(recipe, reports, reference), validate: (raw: unknown) => validateTemplateAdaptation(raw, recipe) }
      : { task: templateReflowTask(recipe, reports, reference), validate: (raw: unknown) => validateTemplateReflow(raw, recipe) }) }
}

async function validateCheckReport(check: Check, sourceHash: string) {
  const report = renderReportSchema.parse(check.report), recipe = check.recipe
  if (check.material) {
    if (check.plan?.status !== 'complete') fail('RECIPE_PLAN_MISSING', 'Нет проверенной привязки материала.')
    return validateTemplateReport(report, recipe, check.material, validateTemplatePlan(check.plan!.result, recipe, check.material))
  }
  validatePilotPng(report.preview, recipe.passport.canvas.width, recipe.passport.canvas.height)
  if (report.recipeVersion !== recipe.passport.version || report.materialHash !== await contentHash({ reconstruction: sourceHash }) || report.stateId !== 'reconstruction' ||
    report.trials.length !== 1 || report.trials[0].stateId !== 'reconstruction' || JSON.stringify(report.trials[0].issues) !== JSON.stringify(report.issues) || report.passed !== !report.issues.length) throw new SemanticValidationError(['invalid-reconstruction-report'])
  const texts: { id: string; text: string; fontSize: number; box: { x: number; y: number; width: number; height: number } }[] = []
  const walk = (elements: ElementIR[], x = 0, y = 0) => { for (const e of elements) {
    if ('children' in e) walk(e.children, x + e.bounds.x, y + e.bounds.y)
    else if (e.kind === 'text') texts.push({ id: e.id, text: e.text, fontSize: e.fontSize, box: { ...e.bounds, x: x + e.bounds.x, y: y + e.bounds.y } })
  } }
  walk(recipe.originalElements)
  if (texts.length !== report.measurements.length || new Set(report.measurements.map(m => m.sourceId)).size !== texts.length) throw new SemanticValidationError(['missing-reconstruction-text'])
  for (const t of texts) {
    const m = report.measurements.find(m => m.sourceId === t.id)
    if (!m || m.text !== t.text || m.fontSize !== t.fontSize || JSON.stringify(m.box) !== JSON.stringify(t.box) || report.passed && t.text.trim() && m.pixels < 3) throw new SemanticValidationError([`reconstruction-evidence:${t.id}`])
  }
  return report
}

async function publish(bucket: R2Bucket, job: DiscoveryJob, token: string, step: FinalStep) {
  const root = discoveryRoot(job.uploadId, job.id), view = await readDiscoveryEvidence(bucket, job)
  await ownedDiscoveryJob(bucket, job.uploadId, job.id, token)
  if (step.result.recipeId) {
    if (!view.recipe || !step.checks.length || !step.checks.every(checked) || (step.result.technical === 'passed') !== (step.checks.length === 4 && step.checks.every(reviewPassed))) fail('RECIPE_UNQUALIFIED', 'Квитанция не подтверждена проверками.')
    const proofKeys = [`${root}/source.json`], completedRuns = [{ prefix: `${root}/${view.extractions.length === 2 ? 'extract-retry' : 'extract'}`, run: view.extraction }, { prefix: `${root}/semantics`, run: view.semantics },
      ...view.refinements.map((r, i) => ({ prefix: `${root}/refinements/${i}/model`, run: r.run }))]
    for (const check of step.checks) {
      await validateCheckReport(check, job.sourceHash)
      proofKeys.push(`${check.prefix}/render.json`)
      completedRuns.push({ prefix: check.planPrefix, run: check.plan }, { prefix: `${check.prefix}/review`, run: check.review })
    }
    for (const { prefix, run } of completedRuns) if (run?.status === 'complete') proofKeys.push(`${prefix}/runs/${run.id}.json`, `${prefix}/inputs/${run.inputHash}.json`)
    const receiptKey = `${root}/qualification.json`
    await immutable(bucket, receiptKey, { recipeVersion: view.recipe!.passport.version, sourceHash: job.sourceHash, technical: step.result.technical, artistic: 'pending',
      scope: `${DISCOVERY_VERSION}:${view.selected!.profile}:${step.checks.length === 4 ? 'reconstruction-and-three-fixed-volumes' : 'failed-reconstruction-only'}`,
      checks: step.checks.map(c => ({ caseId: c.id, measured: c.report!.passed, reviewRunId: c.review?.id ?? null })), reason: step.result.reason })
    await ownedDiscoveryJob(bucket, job.uploadId, job.id, token)
    const registry = await readRecipeRegistry(bucket, job.uploadId)
    await registerRecipeVersion(bucket, view.recipe!, receiptKey, proofKeys, registry.revision, () => ownedDiscoveryJob(bucket, job.uploadId, job.id, token))
  }
  await changeDiscoveryJob(bucket, job.uploadId, job.id, current => {
    assertDiscoveryLease(current, token)
    return { ...current, result: step.result, progress: { step: 'analysis', detail: step.detail, completed: step.checks.filter(checked).length, total: 4 }, updatedAt: Date.now() }
  })
}

/** A renderer asks only to advance. The server owns ordering, scope, retries,
 * qualification and spend; neither the UI nor a script supplies a model plan. */
export async function advanceDiscovery(bucket: R2Bucket, uploadId: string, jobId: string, token: string, config: QwenConfig, report?: { stepId: string; value: unknown }): Promise<{ value: DiscoveryAdvance; execute?: (signal?: AbortSignal) => Promise<void> }> {
  const job = await ownedDiscoveryJob(bucket, uploadId, jobId, token)
  if (job.result) return { value: { done: true } }
  const step = await nextStep(bucket, job)
  const completed = (await readDiscoveryEvidence(bucket, job)).checks.filter(checked).length
  await changeDiscoveryJob(bucket, uploadId, jobId, current => {
    assertDiscoveryLease(current, token)
    return { ...current, progress: { ...current.progress, detail: step.detail, completed }, updatedAt: Date.now() }
  })
  if (report && (step.kind !== 'render' || report.stepId !== step.id)) fail('RECIPE_STALE_RENDER', 'Измерения относятся к другому этапу задания.')
  if (step.kind === 'finish') { await publish(bucket, job, token, step); return { value: { done: true } } }
  if (step.kind === 'render') {
    if (report) {
      const rendered = await validateCheckReport({ ...step.check, report: renderReportSchema.parse(report.value) }, job.sourceHash)
      await ownedDiscoveryJob(bucket, uploadId, jobId, token)
      await immutable(bucket, step.id, rendered)
      return { value: { done: false } }
    }
    return { value: { done: false, stepId: step.id, render: { recipe: step.check.recipe, material: step.check.material, plan: step.check.plan ? validateTemplatePlan(step.check.plan.result, step.check.recipe, step.check.material!) : null } } }
  }
  const started = await beginModelRun({ bucket, uploadId, prefix: step.id, config, task: step.task, version: DISCOVERY_VERSION,
    scope: { uploadId, jobId, sourceHash: job.sourceHash }, validate: step.validate, revalidateRejected: true,
    beforeRequest: () => reserveDiscoveryRequest(bucket, job, token, step.id.slice(discoveryRoot(uploadId, jobId).length + 1)).then(() => undefined),
    clarification: { version: 'recipe-discovery-clarify-1', request: (reply, issues) => ({ ...step.task, messages: [...step.task.messages,
      { role: 'user', content: JSON.stringify({ instruction: 'Исправь весь JSON по ошибкам контракта, не меняя входные данные.', previousResponse: reply.content, issues }) } as ModelMessage] }) },
  })
  return { value: { done: false }, ...(started.execute ? { execute: async (signal?: AbortSignal) => {
    try { await started.execute!(signal); await ownedDiscoveryJob(bucket, uploadId, jobId, token) }
    catch (error) {
      const known = error instanceof QwenAnalysisError
      const code = known ? error.code : 'RECIPE_JOB_FAILED'
      // An invalid extraction is local evidence, not a service outage. Move
      // through the one bounded alternative, then retain a completed rejection.
      if (code === 'SEMANTIC_VALIDATION' && /\/extract(?:-retry)?$/.test(step.id)) {
        await ownedDiscoveryJob(bucket, uploadId, jobId, token)
        return
      }
      await changeDiscoveryJob(bucket, uploadId, jobId, current => {
        assertDiscoveryLease(current, token)
        return { ...current, errorCode: code, error: known ? error.message : 'Этап рецепта не завершён.' }
      }).catch(() => {})
      throw error
    }
  } } : {}) }
}
