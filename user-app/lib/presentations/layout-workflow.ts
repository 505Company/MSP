import { z } from 'zod'
import { contentHash } from '../design-system/catalog'
import { beginModelRun, readModelRun, type ModelRun } from '../uploads/model-run'
import { QwenAnalysisError, type QwenConfig } from '../uploads/qwen-analysis'
import { SemanticValidationError } from '../design-system/semantic-contract'
import { getProject } from '../workspace/storage'
import type { LayoutContext } from './layout-context'
import { LAYOUT_RENDER_VERSION, layoutCandidates, resolveLayoutPlan, validateLayoutPlan, type LayoutEvidence, type LayoutFit, type LayoutPlan, type LayoutResolution } from './layout-contract'
import { LAYOUT_RECIPE_VERSION, layoutContextBoxes, factBoxes, stateById, type Box } from './recipes/layout-engine-v1/states'
import { layoutTask, layoutReviewTask } from './layout-task'
import { replayLayoutPlan } from './layout-replay'
import { readLayoutBudget, reserveLayoutRequest } from './layout-budget'
import { assertRecipeSnapshotActive, hasRecipeSelection, LIBRARY_SELECTION_VERSION, libraryPlanTask, pinRecipeSnapshot, readRecipeSnapshot, resolveLibraryPlan, type LibraryResolution } from './recipes/library-selection'
import { templateGenerationPlan, templateRenderKey, templateReviewPrefix, templateSourcePreview, type TemplateGenerationPlan, type TemplateGenerationRender } from './recipes/template-generation'
import { validateTemplateReport, type TemplateRenderReport } from './recipes/template-measurement'
import { templateReviewTask } from './recipes/template-task'
import { ADAPTIVE_RECIPE_ID, ADAPTIVE_VERSION, adaptiveRenderKey, adaptiveReviewPrefix, validateAdaptiveFit, validateAdaptivePlan, type AdaptivePlan, type AdaptiveFit, type AdaptiveRender } from './adaptive-layout'
import { adaptiveReviewTask } from './adaptive-task'

const json = { httpMetadata: { contentType: 'application/json' } }
export const MAX_LAYOUT_ROUNDS = 2
const fitSchema = z.object({ version: z.literal(LAYOUT_RENDER_VERSION), planHash: z.string().regex(/^[a-f0-9]{64}$/), passed: z.boolean(), stateId: z.string().nullable(), plainComponents: z.boolean(),
  previewCheck: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), textBlocks: z.array(z.object({ block: z.string().max(80), pixels: z.number().int().nonnegative() }).strict()).max(30) }).strict().optional(),
  trials: z.array(z.object({ stateId: z.string(), level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]), plainComponents: z.boolean(),
    wideContext: z.boolean().optional(),
    issues: z.array(z.object({ code: z.string().max(80), block: z.string().max(80).optional(), message: z.string().max(500) }).strict()).max(100),
    measurements: z.array(z.object({ block: z.string().max(80), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(), scrollWidth: z.number().finite().nonnegative(), scrollHeight: z.number().finite().nonnegative(), lines: z.number().int().nonnegative(), fontSize: z.number().finite().nonnegative() }).strict()).max(30),
  }).strict()).min(1).max(60),
}).strict()
const reviewSchema = z.object({ verdict: z.enum(['pass', 'revise']), issues: z.array(z.string().min(1).max(1000)).max(6) }).strict()
export type LayoutReview = z.infer<typeof reviewSchema>
type RenderResult = { fit: LayoutFit; preview: string }
export type LayoutSlide = {
  id: string; title: string; round: number; phase: 'plan' | 'render' | 'review' | 'ready' | 'blocked' | 'failed' | 'running'
  plan?: LayoutPlan; planHash?: string; fit?: LayoutFit; error?: string; errorCode?: string; previewRound?: number
  componentFallbacks?: LayoutResolution['componentFallbacks']; replayedFrom?: { prefix: string; runId: string }
  template?: TemplateGenerationPlan; templateFit?: Omit<TemplateRenderReport, 'preview'>
  adaptive?: AdaptivePlan; adaptiveFit?: AdaptiveFit
  recipeSelection?: { id: string; version: string }
}
const roundPrefix = (c: LayoutContext, slideId: string, round: number) => `${c.prefix}/${slideId}/round-${round}`
const renderKey = (prefix: string) => `${prefix}/render-${LAYOUT_RENDER_VERSION}.json`
const reviewPrefix = (prefix: string) => `${prefix}/review-${LAYOUT_RENDER_VERSION}`
async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> { const file = await bucket.get(key); return file ? file.json<T>() : null }
function layoutFailure(error: ModelRun['error'], stage: 'plan' | 'review') {
  if (error?.code === 'QWEN_TRUNCATED') return `Ответ модели обрезан по лимиту при ${stage === 'plan' ? 'подготовке' : 'проверке'} слайда. Исходный текст и завершённые этапы сохранены. Нажмите «Продолжить создание».`
  return error?.message
}
export function validLayoutMeasurement(fit: LayoutFit, plan: LayoutPlan, hash: string) {
  const candidates = layoutCandidates(plan)
  if (fit.version !== LAYOUT_RENDER_VERSION || fit.planHash !== hash || fit.trials.length > candidates.length || !fit.trials.length) return false
  for (const [i, trial] of fit.trials.entries()) {
    const { state, plainComponents, wideContext, level } = candidates[i]
    if (trial.stateId !== state.id || trial.plainComponents !== plainComponents || Boolean(trial.wideContext) !== wideContext || trial.level !== level) return false
    if (i < fit.trials.length - 1 && !trial.issues.length) return false
  }
  const last = fit.trials.at(-1)!
  if (!fit.passed) return fit.stateId === null && fit.trials.length === candidates.length && last.issues.length > 0
  if (fit.stateId !== last.stateId || fit.plainComponents !== last.plainComponents || last.issues.length) return false
  const state = stateById(last.stateId)!, facts = state.factsY === undefined ? [state.wideInfo!] : factBoxes(state.factsY)
  const blocks: { id: string; box: Box; text: boolean }[] = [{ id: 'primary', box: state.primary, text: true },
    ...plan.context.map((_, i) => ({ id: `context-${i}`, box: layoutContextBoxes(last.wideContext)[i], text: true })),
    ...plan.facts.map((_, i) => ({ id: `fact-${i}`, box: facts[i], text: true })),
    ...plan.support.map((b, i) => ({ id: `support-${i}`, box: state.support![i], text: !b.component || last.plainComponents })),
    ...plan.visuals.map((_, i) => ({ id: `visual-${i}`, box: state.visuals![i], text: false })),
  ]
  if (plan.footer.length) blocks.push({ id: 'footer', box: state.footer!, text: true })
  if (state.context && plan.context.length === 2 && plan.connectorId) blocks.push({ id: 'connector', box: { x: 444, y: 49, width: 118, height: 58 }, text: false })
  const preview = fit.previewCheck, textBlocks = blocks.filter(b => b.text)
  if (!preview || ![1280, 1920].includes(preview.width) || preview.width / preview.height !== 16 / 9 || preview.textBlocks.length !== textBlocks.length ||
    textBlocks.some(b => !preview.textBlocks.some(p => p.block === b.id && p.pixels >= 3))) return false
  if (last.measurements.length !== blocks.length) return false
  return blocks.every(({ id, box, text }) => {
    const m = last.measurements.find(m => m.block === id)
    return m && Math.abs(m.width - box.width) <= 1 && Math.abs(m.height - box.height) <= 1 && m.scrollWidth <= m.width + 1 && m.scrollHeight <= m.height + 1 &&
      (!text || m.fontSize === box.fontSize && m.lines >= 1 && m.lines <= box.maxLines!)
  })
}
async function assertCurrent(bucket: R2Bucket, c: LayoutContext) {
  const project = await getProject(bucket, c.projectId)
  if (!project || project.archivedAt || project.revision !== c.sourceRevision || project.uploadId !== c.uploadId) throw new QwenAnalysisError('CONTENT_CHANGED', 'Содержание или стиль изменились. Прежний результат сохранён отдельно.')
}
export async function layoutView(bucket: R2Bucket, c: LayoutContext) {
  const slides: LayoutSlide[] = [], snapshot = await readRecipeSnapshot(bucket, c)
  for (const input of c.inputs) {
    let slide: LayoutSlide = { id: input.slideId, title: input.title, round: 0, phase: 'plan' }
    let previewRound: number | undefined
    for (let round = 0; round < MAX_LAYOUT_ROUNDS; round++) {
      const prefix = roundPrefix(c, input.slideId, round), run = await readModelRun(bucket, `${prefix}/plan`)
      slide = { id: input.slideId, title: input.title, round, phase: 'plan', previewRound }
      const replay = !run && round === 0 && !hasRecipeSelection(snapshot) ? await replayLayoutPlan(bucket, c, input) : null
      if (replay === 'running') { slide.phase = 'running'; break }
      if (!run && !replay) break
      if (run && run.status !== 'complete') {
        slide.phase = run.error?.code === 'SEMANTIC_VALIDATION' ? 'blocked' : run.status === 'running' && Date.now() - Date.parse(run.startedAt) < 660_000 ? 'running' : 'failed'
        slide.error = slide.phase === 'blocked' ? 'Ответ модели не прошёл проверку рецепта после уточнения. Исходное содержание и ответы сохранены.' : layoutFailure(run.error, 'plan') ?? 'Подготовка прервалась. Сохранённые ответы можно продолжить.'
        slide.errorCode = run.error?.code ?? (slide.phase === 'failed' && run.status === 'running' ? 'QWEN_INTERRUPTED' : undefined)
        break
      }
      const saved = run?.result as LayoutResolution | LibraryResolution | undefined
      if (saved && 'kind' in saved && saved.kind === 'library-incompatible') {
        slide.phase = 'blocked'; slide.error = `INCOMPATIBLE_WITH_RECIPE: ${saved.reason}`; break
      }
      if (saved && 'kind' in saved && saved.kind === 'library-adaptive') {
        if (!snapshot?.adaptiveVersion || saved.recipeId !== ADAPTIVE_RECIPE_ID || saved.recipeVersion !== snapshot.adaptiveVersion || (saved.plan.version ?? ADAPTIVE_VERSION) !== saved.recipeVersion) throw new QwenAnalysisError('RECIPE_SNAPSHOT_INVALID', 'Адаптивный рецепт отсутствует в сохранённой библиотеке.')
        const evidence = await readJson<LayoutEvidence>(bucket, `${prefix}/evidence.json`)
        const adaptive = validateAdaptivePlan(saved.plan, input, evidence!), planHash = await contentHash(saved)
        Object.assign(slide, { adaptive, planHash, phase: 'render', recipeSelection: { id: saved.recipeId, version: saved.recipeVersion } })
        let rendered = await readJson<AdaptiveRender>(bucket, adaptiveRenderKey(prefix, adaptive.version))
        let review = rendered ? await readModelRun(bucket, adaptiveReviewPrefix(prefix, adaptive.version)) : null
        let approvedLegacy = false
        if (!rendered && adaptive.version) {
          const previous = await readJson<AdaptiveRender>(bucket, `${prefix}/render-adaptive-render-2.json`)
          const checked = previous?.fit.passed ? await readModelRun(bucket, `${prefix}/review-adaptive-render-2`) : null
          const result = reviewSchema.safeParse(checked?.result)
          // Keep completed renderer-2 slides byte-for-byte. Only unfinished
          // attempts replay their unchanged model plan through the fixed renderer.
          if (previous && checked?.status === 'complete' && checked.scope.reportHash === await contentHash(previous) && result.success && result.data.verdict === 'pass' && !result.data.issues.length) {
            rendered = previous; review = checked; approvedLegacy = true
          }
        }
        if (!rendered) break
        const fit = validateAdaptiveFit(rendered.fit, adaptive, input, planHash, rendered.preview, approvedLegacy)
        slide.adaptiveFit = fit
        // Failed adaptive attempts retain a diagnostic image, never a ready status.
        slide.previewRound = previewRound = round
        if (!fit.passed) { slide.phase = 'blocked'; slide.error = 'INCOMPATIBLE_WITH_RECIPE: достигнуты минимальные размеры текста и блоков. Содержание и диагностический снимок сохранены.'; continue }
        slide.phase = 'review'
        if (!review || review.scope.reportHash !== await contentHash(rendered)) break
        if (review.status !== 'complete') {
          slide.phase = review.error?.code === 'SEMANTIC_VALIDATION' ? 'blocked' : review.status === 'running' && Date.now() - Date.parse(review.startedAt) < 360_000 ? 'running' : 'failed'
          slide.error = layoutFailure(review.error, 'review'); slide.errorCode = review.error?.code ?? (slide.phase === 'failed' ? 'QWEN_INTERRUPTED' : undefined); break
        }
        const result = reviewSchema.parse(review.result)
        if (result.verdict === 'pass' && !result.issues.length) { slide.phase = 'ready'; break }
        slide.phase = 'blocked'; slide.error = 'Визуальная проверка требует исправления: ' + result.issues.join(' '); continue
      }
      if (saved && 'kind' in saved && saved.kind === 'library-template') {
        const template = await templateGenerationPlan(saved, snapshot, input), planHash = await contentHash(saved)
        Object.assign(slide, { template, planHash, phase: 'render', recipeSelection: { id: saved.recipeId, version: saved.recipeVersion } })
        const rendered = await readJson<TemplateGenerationRender>(bucket, templateRenderKey(prefix))
        if (!rendered) break
        if (rendered.planHash !== planHash) throw new QwenAnalysisError('STALE_RENDER', 'Измерение относится к другой привязке содержания.')
        const report = await validateTemplateReport(rendered.report, template.recipe, template.material, template.plan)
        const { preview, ...templateFit } = report
        void preview
        slide.templateFit = templateFit
        if (!report.passed) { slide.phase = 'blocked'; slide.error = 'INCOMPATIBLE_WITH_RECIPE: содержание не помещается в разрешённые состояния шаблона.'; continue }
        slide.previewRound = previewRound = round; slide.phase = 'review'
        const review = await readModelRun(bucket, templateReviewPrefix(prefix))
        if (!review || review.scope.reportHash !== await contentHash(rendered)) break
        if (review.status !== 'complete') {
          slide.phase = review.error?.code === 'SEMANTIC_VALIDATION' ? 'blocked' : review.status === 'running' && Date.now() - Date.parse(review.startedAt) < 360_000 ? 'running' : 'failed'
          slide.error = layoutFailure(review.error, 'review'); slide.errorCode = review.error?.code ?? (slide.phase === 'failed' ? 'QWEN_INTERRUPTED' : undefined); break
        }
        const result = reviewSchema.parse(review.result)
        if (result.verdict === 'pass' && !result.issues.length) { slide.phase = 'ready'; break }
        slide.phase = 'blocked'; slide.error = 'Визуальная проверка требует исправления: ' + result.issues.join(' '); continue
      }
      const evidence = replay?.evidence ?? await readJson<LayoutEvidence>(bucket, `${prefix}/evidence.json`)
      const resolution = replay ?? (saved && 'kind' in saved && saved.kind === 'library-author' ? saved.resolution : saved) as LayoutResolution
      if (saved && 'kind' in saved && saved.kind === 'library-author') slide.recipeSelection = { id: saved.recipeId, version: saved.recipeVersion }
      const plan = validateLayoutPlan(resolution.plan, input, evidence!), planHash = await contentHash(plan)
      const fit = (await readJson<RenderResult>(bucket, renderKey(prefix)))?.fit
      Object.assign(slide, { plan, planHash, phase: 'render', componentFallbacks: resolution.componentFallbacks, ...(replay ? { replayedFrom: replay.source } : {}) })
      if (!fit) break
      if (fit.planHash !== planHash) throw new QwenAnalysisError('STALE_RENDER', 'Измерение относится к другой версии слайда.')
      slide.fit = fit
      if (!fit.passed) { slide.phase = 'blocked'; slide.error = 'INCOMPATIBLE_WITH_RECIPE: содержание не помещается в проверенные состояния.'; continue }
      slide.previewRound = previewRound = round
      const review = await readModelRun(bucket, reviewPrefix(prefix))
      slide.phase = 'review'
      if (!review) break
      if (review.status !== 'complete') { slide.phase = review.error?.code === 'SEMANTIC_VALIDATION' ? 'blocked' : review.status === 'running' && Date.now() - Date.parse(review.startedAt) < 360_000 ? 'running' : 'failed'; slide.error = layoutFailure(review.error, 'review'); slide.errorCode = review.error?.code ?? (slide.phase === 'failed' && review.status === 'running' ? 'QWEN_INTERRUPTED' : undefined); break }
      const result = reviewSchema.parse(review.result)
      if (result.verdict === 'pass') { slide.phase = 'ready'; break }
      slide.phase = 'blocked'; slide.error = 'Слайд собран, но визуальная проверка ещё видит проблемы: ' + result.issues.join(' ')
    }
    slides.push(slide)
  }
  const next = slides.find(s => !['ready', 'blocked'].includes(s.phase))
  return { recipe: hasRecipeSelection(snapshot) ? LIBRARY_SELECTION_VERSION : LAYOUT_RECIPE_VERSION, renderVersion: LAYOUT_RENDER_VERSION, inputId: c.inputId, materialId: c.materialId, uploadId: c.uploadId, slides, budget: await readLayoutBudget(bucket, c),
    status: slides.every(s => s.phase === 'ready') ? 'ready' : next ? 'working' : 'blocked',
    next: next ? { ...next, input: c.inputs.find(i => i.slideId === next.id)! } : null }
}
export type LayoutView = Awaited<ReturnType<typeof layoutView>>
export type LayoutAction = { action: 'plan' | 'review'; inputId: string; slideId: string; round: number; evidence?: LayoutEvidence; retry?: boolean }
  | { action: 'report'; inputId: string; slideId: string; round: number; fit: unknown; preview?: string }
export async function startLayoutAction(bucket: R2Bucket, c: LayoutContext, action: LayoutAction, config: QwenConfig) {
  if (action.inputId !== c.inputId) throw new QwenAnalysisError('CONTENT_CHANGED', 'Проект обновился. Предыдущее оформление сохранено.')
  await assertCurrent(bucket, c)
  const view = await layoutView(bucket, c), target = view.next
  if (!target || target.id !== action.slideId || target.round !== action.round) return { state: view, execute: null }
  const input = target.input, prefix = roundPrefix(c, target.id, target.round)
  if (action.action === 'report') {
    if (target.phase === 'render' && target.adaptive) {
      const fit = validateAdaptiveFit(action.fit, target.adaptive, input, target.planHash!, action.preview ?? '')
      await assertCurrent(bucket, c)
      await bucket.put(adaptiveRenderKey(prefix, target.adaptive.version), JSON.stringify({ fit, preview: action.preview }), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
      return { state: await layoutView(bucket, c), execute: null }
    }
    if (target.phase === 'render' && target.template) {
      const { recipe, material, plan } = target.template
      const report = await validateTemplateReport(action.fit, recipe, material, plan)
      await assertCurrent(bucket, c)
      await bucket.put(templateRenderKey(prefix), JSON.stringify({ planHash: target.planHash, report }), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
      return { state: await layoutView(bucket, c), execute: null }
    }
    if (target.phase !== 'render' || !target.plan) throw new QwenAnalysisError('STALE_RENDER', 'Слайд уже перешёл к следующему этапу.')
    const fit = fitSchema.parse(action.fit)
    if (!validLayoutMeasurement(fit, target.plan, target.planHash!)) throw new QwenAnalysisError('INVALID_MEASUREMENT', 'Неполная проверка состояний слайда.')
    if (fit.passed) {
      if (!action.preview || !/^data:image\/png;base64,iVBOR/.test(action.preview) || action.preview.length > 4_000_000) throw new QwenAnalysisError('INVALID_PREVIEW', 'Для визуальной проверки нужен реальный снимок слайда.')
    }
    await assertCurrent(bucket, c)
    // One conditional object keeps the screenshot and its measurements inseparable.
    await bucket.put(renderKey(prefix), JSON.stringify({ fit, preview: fit.passed ? action.preview : '' }), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
    return { state: await layoutView(bucket, c), execute: null }
  }
  if (target.phase === 'running') throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Слайд уже обрабатывается.')
  if (target.phase === 'failed' && !action.retry) throw new QwenAnalysisError('RETRY_REQUIRED', 'Нажмите «Продолжить создание», чтобы повторить прерванный запрос.')
  const expected = target.plan && target.fit?.passed || target.template && target.templateFit?.passed || target.adaptive && target.adaptiveFit?.passed ? 'review' : 'plan'
  if (action.action !== expected) throw new QwenAnalysisError('STALE_LAYOUT_ACTION', 'Этот шаг уже завершён.')
  if (action.action === 'plan') {
    const snapshot = await pinRecipeSnapshot(bucket, c)
    const selection = hasRecipeSelection(snapshot)
    if (snapshot.recipes.length) await assertRecipeSnapshotActive(bucket, c, snapshot)
    const supplied = z.object({ fontTokens: z.array(z.string()).min(1).max(200) }).strict().parse(action.evidence)
    if (supplied.fontTokens.some(id => !input.fonts.some(f => f.id === id))) throw new QwenAnalysisError('FONT_TOKEN_UNAVAILABLE', 'Шрифт отсутствует в дизайн-системе.')
    await bucket.put(`${prefix}/evidence.json`, JSON.stringify(supplied), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
    const evidence = (await readJson<LayoutEvidence>(bucket, `${prefix}/evidence.json`))!
    const previous = target.round ? roundPrefix(c, target.id, target.round - 1) : null
    const previousRun = previous ? await readModelRun(bucket, `${previous}/plan`) : null
    const previousReplay = previous && !previousRun && !selection ? await replayLayoutPlan(bucket, c, input) : null
    const previousTemplate = previous && snapshot.recipes.length ? (await readJson<TemplateGenerationRender>(bucket, templateRenderKey(previous)))?.report : undefined
    const correction = previous ? { plan: (previousRun?.result as LayoutResolution | undefined)?.plan ?? (previousReplay && previousReplay !== 'running' ? previousReplay.plan : undefined), fit: (await readJson<RenderResult>(bucket, renderKey(previous)))?.fit, review: (await readModelRun(bucket, reviewPrefix(previous)))?.result,
      ...(selection ? { selection: previousRun?.result, templateFit: previousTemplate ? { ...previousTemplate, preview: undefined } : undefined, templateReview: (await readModelRun(bucket, templateReviewPrefix(previous)))?.result,
        adaptiveFit: (await readJson<AdaptiveRender>(bucket, adaptiveRenderKey(previous, snapshot.adaptiveVersion)))?.fit, adaptiveReview: (await readModelRun(bucket, adaptiveReviewPrefix(previous, snapshot.adaptiveVersion)))?.result } : {}) } : undefined
    const task = selection ? libraryPlanTask(snapshot, input, evidence, correction) : layoutTask(input, evidence, correction)
    const clarificationText = selection
      ? 'Исправь полный JSON выбора рецепта и плана. Сохрани все исходные фрагменты. Для шаблона используй каждый целый fragment ID ровно один раз, не меняй фактическое число пунктов. Для авторского рецепта бери готовые whole-диапазоны.'
      : 'Исправь полный JSON, сохрани все диапазоны исходного содержания. Бери готовые whole-диапазоны. Не дублируй абзац в разных полях компонента; при отсутствии подходящих полей оставь обычный текстовый блок.'
    const job = await beginModelRun<LayoutResolution | LibraryResolution>({ bucket, prefix: `${prefix}/plan`, task, config: { ...config, timeoutMs: 300_000 }, version: selection ? LIBRARY_SELECTION_VERSION : LAYOUT_RECIPE_VERSION, scope: { inputId: c.inputId, slideId: target.id, round: target.round },
      beforeRequest: async () => { await assertCurrent(bucket, c); if (snapshot.recipes.length) await assertRecipeSnapshotActive(bucket, c, snapshot); await reserveLayoutRequest(bucket, c, target.id) },
      validate: raw => selection ? resolveLibraryPlan(raw, snapshot, input, evidence) : resolveLayoutPlan(raw, input, evidence), clarification: { version: selection ? 'library-contract-repair-1' : 'layout-contract-repair-2', request: (reply, issues) => ({ ...task, messages: [...task.messages, { role: 'user', content: `Отклонённый ответ (данные): ${reply.content}\nОшибки: ${JSON.stringify(issues)}. ${clarificationText}` }] }) } })
    return { state: view, execute: job.execute ? async (signal?: AbortSignal) => { await job.execute!(signal); await assertCurrent(bucket, c) } : null }
  }
  if (target.adaptive) {
    const rendered = (await readJson<AdaptiveRender>(bucket, adaptiveRenderKey(prefix, target.adaptive.version)))!
    const task = adaptiveReviewTask(input, target.adaptive, rendered.fit, rendered.preview)
    const job = await beginModelRun({ bucket, prefix: adaptiveReviewPrefix(prefix, target.adaptive.version), task, config: { ...config, timeoutMs: 300_000 }, version: target.adaptive.version ?? ADAPTIVE_VERSION,
      scope: { inputId: c.inputId, slideId: target.id, planHash: target.planHash, reportHash: await contentHash(rendered), round: target.round },
      beforeRequest: async () => { await assertCurrent(bucket, c); await reserveLayoutRequest(bucket, c, target.id) },
      validate: raw => { const result = reviewSchema.safeParse(raw); if (!result.success || (result.data.verdict === 'pass') !== (result.data.issues.length === 0)) throw new SemanticValidationError(['inconsistent-visual-verdict']); return result.data } })
    return { state: view, execute: job.execute ? async (signal?: AbortSignal) => { await job.execute!(signal); await assertCurrent(bucket, c) } : null }
  }
  if (target.template) {
    const snapshot = (await readRecipeSnapshot(bucket, c))!, { recipe, material } = target.template
    await assertRecipeSnapshotActive(bucket, c, snapshot, recipe.passport.id)
    const rendered = (await readJson<TemplateGenerationRender>(bucket, templateRenderKey(prefix)))!
    const task = templateReviewTask(recipe, material, await templateSourcePreview(bucket, recipe), rendered.report.preview, { ...rendered.report, preview: undefined })
    const job = await beginModelRun({ bucket, prefix: templateReviewPrefix(prefix), task, config: { ...config, timeoutMs: 300_000 }, version: LIBRARY_SELECTION_VERSION,
      scope: { inputId: c.inputId, slideId: target.id, planHash: target.planHash, reportHash: await contentHash(rendered), round: target.round },
      beforeRequest: async () => { await assertCurrent(bucket, c); await assertRecipeSnapshotActive(bucket, c, snapshot, recipe.passport.id); await reserveLayoutRequest(bucket, c, target.id) },
      validate: raw => { const result = reviewSchema.safeParse(raw); if (!result.success || (result.data.verdict === 'pass') !== (result.data.issues.length === 0)) throw new SemanticValidationError(['inconsistent-visual-verdict']); return result.data } })
    return { state: view, execute: job.execute ? async (signal?: AbortSignal) => { await job.execute!(signal); await assertCurrent(bucket, c) } : null }
  }
  const preview = (await readJson<RenderResult>(bucket, renderKey(prefix)))?.preview
  if (!preview) throw new QwenAnalysisError('INVALID_PREVIEW', 'Снимок слайда не сохранён.')
  const task = layoutReviewTask(input, target.plan!, target.fit!.stateId!, preview, target.fit!)
  const job = await beginModelRun({ bucket, prefix: reviewPrefix(prefix), task, config: { ...config, timeoutMs: 300_000 }, version: LAYOUT_RECIPE_VERSION,
    beforeRequest: () => reserveLayoutRequest(bucket, c, target.id),
    scope: { inputId: c.inputId, slideId: target.id, planHash: target.planHash, stateId: target.fit!.stateId, round: target.round }, validate: raw => {
      const result = reviewSchema.safeParse(raw)
      if (!result.success || (result.data.verdict === 'pass') !== (result.data.issues.length === 0)) throw new SemanticValidationError(['Review must say pass with no issues or revise with specific issues.'])
      return result.data
    } })
  return { state: view, execute: job.execute ? async (signal?: AbortSignal) => { await job.execute!(signal); await assertCurrent(bucket, c) } : null }
}
export async function readLayoutPreview(bucket: R2Bucket, c: LayoutContext, slideId: string, round: number) {
  if (!c.inputs.some(i => i.slideId === slideId) || !Number.isInteger(round) || round < 0 || round >= MAX_LAYOUT_ROUNDS) return null
  const prefix = roundPrefix(c, slideId, round)
  const snapshot = await readRecipeSnapshot(bucket, c)
  return (await readJson<AdaptiveRender>(bucket, adaptiveRenderKey(prefix, snapshot?.adaptiveVersion)))?.preview ?? (snapshot?.adaptiveVersion ? (await readJson<AdaptiveRender>(bucket, `${prefix}/render-adaptive-render-2.json`))?.preview : undefined) ?? (await readJson<TemplateGenerationRender>(bucket, templateRenderKey(prefix)))?.report.preview ?? (await readJson<RenderResult>(bucket, renderKey(prefix)))?.preview ?? null
}
