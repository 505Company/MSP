import {readReconstructionCatalog} from '../design-system/reconstruction'
import {reconstructedLibrary} from '../design-system/reconstruction-resources'
import { z } from 'zod'
import { catalogLibrary, contentHash } from '../design-system/catalog'
import { SemanticValidationError } from '../design-system/semantic-contract'
import { getProject } from '../workspace/storage'
import { QwenAnalysisError, type QwenConfig } from '../uploads/qwen-analysis'
import { beginModelRun, readModelRun } from '../uploads/model-run'
import { modelIdentity, type StructuredRequest } from '../uploads/qwen-structured'
import { recipeContext, readRecipePlan } from './recipe-plan'
import { visibleFragmentText } from './material'
import { acceptedVariants, recipePreview } from './recipes/catalog'
import provenance from './recipes/archive/accepted-10-v1/provenance.json'
import { compileDeckScene, geometryIssues, resourceSupported } from './deck-compiler'
import { DECK_RENDERER, DECK_VERSION, validateScene,
  type DeckEvidence, type DeckReport, type SceneInput } from './deck-contract'
import { sceneTask } from './deck-task'
import { resourceQueries, resourceTask } from './deck-resources'
import { replacementTask } from './deck-reselection'
import { visualReviewTask, reviewGroups, type VisualReview, type VisualSample } from './deck-review'
import { initialDeck, nextOperation, slideInput, phaseAttempts, slideIssues, deckRequests, applyAux, validateAux, settleReview,
  MAX_AUX_ATTEMPTS, MAX_DECK_REQUESTS, type Attempt, type DeckState, type DeckSlideState, type AuxJob, type AuxSpec } from './deck-workflow'
export type { DeckState, DeckSlideState } from './deck-workflow'

const json = { httpMetadata: { contentType: 'application/json' } }, LEASE_MS = 7 * 60_000
export async function deckContext(bucket: R2Bucket, projectId: string, config: QwenConfig) {
  const recipes = await recipeContext(bucket, projectId, config), plan = await readRecipePlan(bucket, recipes)
  if (plan?.status !== 'ready' || !plan.selections) throw new QwenAnalysisError('RECIPES_NOT_READY', 'Сначала подготовим оформление для всех слайдов.')
  const library = await catalogLibrary(bucket, recipes.brand.uploadId)
  if (!library || library.catalogId !== recipes.brand.catalogId) throw new QwenAnalysisError('DECK_INPUT_CHANGED', 'Стиль обновился. Подготовим слайды для новой версии.')
  // No first-N catalogue cut. Every compiler-supported resource is exposed in
  // bounded visual pages before slide-specific candidates are selected.
  library.library=reconstructedLibrary(library.library,await readReconstructionCatalog(bucket,recipes.brand.uploadId,library.catalogId))
  const resources = library.library.components.filter(c => recipes.brand.resources.some(r => r.id === c.id) && resourceSupported(c))
  const fragments = recipes.structure.material.fragments
  const inputs: SceneInput[] = plan.selections.map((selection, index) => {
    const outline = recipes.outline.slides[index]
    return { slideId: outline.id, title: outline.title, variant: acceptedVariants.find(v => v.id === selection.variantId)!, brand: recipes.brand, resources,
      content: outline.fragmentIds.filter(id => fragments.find(f => f.id === id)?.kind === 'content').map(id => {
        const f = fragments.find(f => f.id === id)!, block = outline.blocks.find(b => b.fragmentIds.includes(id))
        return { id, text: visibleFragmentText(f), kind: id === outline.headingFragmentId ? 'heading' : block?.kind ?? 'text', role: block?.role ?? 'primary', ...(block ? { blockId: `block-${outline.blocks.indexOf(block) + 1}` } : {}) }
      }), directions: outline.directionIds.map(id => visibleFragmentText(fragments.find(f => f.id === id)!)) }
  })
  const inputId = await contentHash({ version: DECK_VERSION, renderer: DECK_RENDERER, recipeInputId: recipes.inputId, selections: plan.selections,
    resources, model: modelIdentity(config) })
  return { inputId, projectId, recipes, inputs, prefix: `presentation-decks/${projectId}/${inputId}` }
}
export type DeckContext = Awaited<ReturnType<typeof deckContext>>
function finishScene(attempt: Attempt, slide: DeckSlideState, state: DeckState, context: DeckContext) {
  try {
    attempt.scene = validateScene(attempt.raw, slideInput(context, state, slide, attempt.variantId), slide.evidence!)
    slide.status = 'render'
  } catch (error) {
    if (!(error instanceof SemanticValidationError)) throw error
    attempt.issues = error.issues.map(message => ({ code: 'scene-contract', message })); slide.status = 'pending'
  }
}
export async function readDeck(bucket: R2Bucket, context: DeckContext, recover = false) {
  const file = await bucket.get(`${context.prefix}/state.json`)
  if (!file) return null
  const state = await file.json<DeckState>()
  if (state.inputId !== context.inputId || state.version !== DECK_VERSION || state.slides.length !== context.inputs.length) throw new QwenAnalysisError('DECK_CACHE_INVALID', 'Сохранённая колода не соответствует проекту.')
  for (const job of state.jobs.filter(j => j.status === 'complete')) validateAux(job.result, job.spec, context, state)
  for (const [index, slide] of state.slides.entries()) {
    if (slide.id !== context.inputs[index].slideId || slide.tried[0] !== context.inputs[index].variant.id || !slide.tried.includes(slide.variantId) || new Set(slide.tried).size !== slide.tried.length) throw new QwenAnalysisError('DECK_CACHE_INVALID', 'Сохранённое оформление не соответствует проекту.')
    const attempt = slide.status === 'render' ? slide.attempts.at(-1) : slide.attempts.find(a => a.number === slide.fittedAttempt)
    if (attempt) {
      const input = slideInput(context, state, slide, attempt.variantId)
      validateScene(attempt.scene, input, slide.evidence!)
      if (!attempt.sceneHash || attempt.sceneHash !== await contentHash(attempt.scene)) throw new QwenAnalysisError('DECK_CACHE_INVALID', 'Сохранённая сцена повреждена.')
      if (slide.status !== 'render' && (!attempt.report || attempt.report.sceneHash !== attempt.sceneHash || attempt.report.issues.length || geometryIssues(attempt.scene!, input, attempt.report.texts).length || !attempt.preview)) throw new QwenAnalysisError('DECK_CACHE_INVALID', 'Для слайда нет полной проверки.')
    }
  }
  if (state.status === 'ready') {
    const round = state.rounds.at(-1)
    if (!round?.settled || round.targets.length !== state.slides.length || round.targets.some((t,i) => t.slideId !== state.slides[i].id || t.sceneHash !== state.slides[i].attempts.find(a => a.number === state.slides[i].fittedAttempt)?.sceneHash) ||
      reviewGroups(round).some(g => { const job = state.jobs.find(j => j.spec.key === g.id && j.status === 'complete'); return !job || (job.result as VisualReview).slides.some(s => s.verdict !== 'pass') })) throw new QwenAnalysisError('DECK_CACHE_INVALID', 'Визуальная проверка не соответствует готовой колоде.')
  }
  const leaseFile = await bucket.get(`${context.prefix}/lease.json`), lease = leaseFile && await leaseFile.json<{ expiresAt: number }>()
  if (recover || !lease || lease.expiresAt <= Date.now()) {
    for (const job of state.jobs.filter(j => j.status === 'running' || state.status === 'failed' && j === state.jobs.at(-1) && j.status === 'failed')) {
      const model = await readModelRun(bucket, `${context.prefix}/aux/${job.id}`, job.runId)
      if (model?.status === 'complete') {
        job.runId = model.id; job.requests = model.liveRequests; job.raw = model.result
        state.status = 'working'; delete state.error
        try { applyAux(job, context, state) } catch (error) {
          if (!(error instanceof SemanticValidationError)) throw error
          job.status = 'invalid'; job.issues = error.issues
        }
      } else { job.requests = model?.liveRequests ?? job.requests; job.status = 'failed'; state.status = 'failed'; state.error = model?.error?.message ?? 'Обработка прервалась. Сохранённые результаты можно продолжить.' }
    }
    for (const slide of state.slides.filter(s => s.status === 'running' || state.status === 'failed' && s.status === 'failed')) {
      const attempt = slide.attempts.at(-1)!, model = await readModelRun(bucket, `${context.prefix}/slides/${slide.id}/attempts/${attempt.number}`, attempt.runId)
      if (model?.status === 'complete') {
        attempt.runId = model.id; attempt.requests = model.liveRequests; attempt.raw = model.result
        state.status = 'working'; delete state.error; finishScene(attempt, slide, state, context)
        if (attempt.scene) attempt.sceneHash = await contentHash(attempt.scene)
      } else { attempt.requests = model?.liveRequests ?? attempt.requests; slide.status = 'failed'; state.status = 'failed'; state.error = model?.error?.message ?? 'Создание слайдов прервалось. Готовые слайды сохранены; можно продолжить.' }
    }
  }
  return state
}
export function deckView(context: DeckContext, state: DeckState | null) {
  const current = state ?? initialDeck(context), op = nextOperation(context, current)
  const slide = 'slideId' in op ? current.slides.find(s => s.id === op.slideId) : undefined
  const input = slide ? slideInput(context, current, slide) : op.kind === 'catalog' ? { ...context.inputs[0], resources: op.page.ids.map(id => context.inputs[0].resources.find(r => r.id === id)!) } : undefined
  const attempt = slide?.attempts.at(-1)
  const view = state ? { ...state, evidence: { ...state.evidence, sheet: null }, pages: state.pages.map(p => ({ ...p, preview: undefined })),
    jobs: state.jobs.map(j => ({ ...j, raw: undefined, result: undefined })), slides: state.slides.map(s => ({ ...s, evidence: s.evidence ? { ...s.evidence, sheet: null } : undefined,
      previewHash: s.attempts.find(a => a.number === s.fittedAttempt)?.sceneHash,
      attempts: s.attempts.map(a => ({ ...a, raw: undefined, scene: undefined, report: undefined })) })) } : null
  return { inputId: context.inputId, materialId: context.recipes.structure.material.id, uploadId: context.recipes.brand.uploadId, state: view,
    requests: deckRequests(current), requestLimit: MAX_DECK_REQUESTS,
    next: op.kind === 'done' ? null : { kind: op.kind, pageId: op.kind === 'catalog' ? op.page.id : undefined, input,
      referenceUrl: op.kind === 'scene' && input ? recipePreview(input.variant) : undefined,
      scene: op.kind === 'render' ? attempt?.scene : null, sceneHash: op.kind === 'render' ? attempt?.sceneHash : null } }
}
async function current(bucket: R2Bucket, context: DeckContext) {
  const project = await getProject(bucket, context.projectId), pointer = await bucket.get(`component-catalogs/${context.recipes.brand.uploadId}/current.json`)
  if (!project || project.archivedAt || project.text !== context.recipes.structure.material.text || project.uploadId !== context.recipes.brand.uploadId || !pointer || (await pointer.json<{ catalogId: string }>()).catalogId !== context.recipes.brand.catalogId) throw new QwenAnalysisError('DECK_INPUT_CHANGED', 'Содержание или стиль изменились. Готовые слайды прежней версии сохранены отдельно.')
}
export async function pngBytes(value: string, expectedHash?: string) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) || value.length > 2_800_000) throw new QwenAnalysisError('INVALID_PREVIEW', 'Не удалось прочитать превью.')
  const bytes = Uint8Array.from(atob(value.split(',')[1]), c => c.charCodeAt(0))
  if (bytes.length < 24 || [137,80,78,71,13,10,26,10].some((b, i) => bytes[i] !== b)) throw new QwenAnalysisError('INVALID_PREVIEW', 'Превью не является PNG.')
  const dimensions = new DataView(bytes.buffer), w = dimensions.getUint32(16), h = dimensions.getUint32(20)
  if (w < 1 || h < 1 || w * h > 4_000_000) throw new QwenAnalysisError('INVALID_PREVIEW', 'Превью превышает допустимый размер.')
  if (expectedHash) {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
    if (hash !== expectedHash) throw new QwenAnalysisError('REFERENCE_CHANGED', 'Образец рецепта не соответствует принятой версии.')
  }
  return bytes
}
const evidenceSchema = z.object({ renderer: z.literal(DECK_RENDERER), fonts: z.array(z.string().max(160)).min(1).max(30), resourceIds: z.array(z.string().max(160)).max(24), sheet: z.string().max(2_800_000).nullable() }).strict()
const reportSchema = z.object({ renderer: z.literal(DECK_RENDERER), sceneHash: z.string().regex(/^[a-f0-9]{64}$/),
  texts: z.array(z.object({ id: z.string().max(160), x: z.number().finite().min(-1000).max(3000), y: z.number().finite().min(-1000).max(5000),
    width: z.number().finite().min(0).max(100_000), height: z.number().finite().min(0).max(100_000), lines: z.number().int().min(1).max(10000) }).strict()).max(80),
  issues: z.array(z.object({ code: z.string().max(80), elementId: z.string().max(160).optional(), message: z.string().max(1600), alternatives: z.array(z.string().max(160)).max(24).optional() }).strict()).max(200) }).strict()
export type DeckAction = { inputId: string; action: 'advance'; reference?: string; evidence?: DeckEvidence; retry?: boolean }
  | { inputId: string; action: 'catalog'; pageId: string; evidence: DeckEvidence }
  | { inputId: string; action: 'evidence'; slideId: string; evidence: DeckEvidence }
  | { inputId: string; action: 'report'; slideId: string; report: DeckReport; preview: string }
async function imageData(bucket: R2Bucket, key?: string) {
  if (!key) return undefined
  const file = await bucket.get(key)
  return file ? `data:image/png;base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}` : undefined
}
async function checkedEvidence(value: DeckEvidence, input: SceneInput) {
  const evidence = evidenceSchema.parse(value)
  if (new Set(evidence.fonts).size !== evidence.fonts.length || evidence.fonts.some(f => !input.brand.tokens.fonts.some(t => t.family === f)) || new Set(evidence.resourceIds).size !== evidence.resourceIds.length || evidence.resourceIds.some(id => !input.resources.some(r => r.id === id)) || Boolean(evidence.resourceIds.length) !== Boolean(evidence.sheet)) throw new QwenAnalysisError('EVIDENCE_INVALID', 'Шрифты или ресурсы не соответствуют выбранному стилю.')
  if (evidence.sheet) await pngBytes(evidence.sheet)
  return evidence
}
async function auxTask(bucket: R2Bucket, context: DeckContext, state: DeckState, spec: AuxSpec): Promise<StructuredRequest> {
  if (spec.kind === 'search') {
    const page = state.pages.find(p => p.id === spec.pageId)!, query = resourceQueries(context.inputs).find(q => q.id === spec.queryId)!
    const image = await imageData(bucket, page.preview)
    if (!image) throw new QwenAnalysisError('RESOURCE_PREVIEW_MISSING', 'Не удалось открыть сохранённые образцы графики.')
    return resourceTask(page, query, context.inputs, image)
  }
  if (spec.kind === 'reselect') {
    const slide = state.slides.find(s => s.id === spec.slideId)!, previous = slide.attempts.at(-1)
    return replacementTask(slideInput(context,state,slide), acceptedVariants.filter(v => spec.choices.includes(v.id)), slide.tried, slideIssues(slide), await imageData(bucket, previous?.preview))
  }
  const round = state.rounds.find(r => r.number === spec.round)!, first = round.targets.findIndex(t => t.slideId === spec.targets[0].slideId)
  const neighbors = round.targets.slice(Math.max(0,first-1), Math.min(round.targets.length,first+spec.targets.length+1)), samples: VisualSample[] = []
  for (const target of neighbors) {
    const slide = state.slides.find(s => s.id === target.slideId)!, attempt = slide.attempts.find(a => a.number === target.attempt)!, input = slideInput(context,state,slide,attempt.variantId)
    const preview = await imageData(bucket, attempt.preview), isTarget = spec.targets.some(t => t.slideId === target.slideId)
    const reference = isTarget ? await imageData(bucket, `${context.prefix}/references/${attempt.variantId}.png`) : undefined
    if (!preview || isTarget && !reference) throw new QwenAnalysisError('REVIEW_PREVIEW_MISSING', 'Не удалось открыть слайды для визуальной проверки.')
    samples.push({ input, scene: attempt.scene!, fonts: slide.evidence!.fonts, hash: target.sceneHash, preview, reference, target: isTarget })
  }
  return visualReviewTask(samples)
}
/** Durable, bounded operations. Model replies remain immutable; every visual
 * correction returns through exactly the same source and geometry checks. */
export async function startDeckAction(bucket: R2Bucket, context: DeckContext, action: DeckAction, config: QwenConfig) {
  if (action.inputId !== context.inputId) throw new QwenAnalysisError('DECK_INPUT_CHANGED', 'Проект изменился. Продолжим для сохранённой версии.')
  await current(bucket, context)
  const leaseKey = `${context.prefix}/lease.json`, oldFile = await bucket.get(leaseKey), old = oldFile && await oldFile.json<{ expiresAt: number }>(), runId = crypto.randomUUID()
  if (old && old.expiresAt > Date.now()) throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Презентация уже обрабатывается.')
  if (!await bucket.put(leaseKey, JSON.stringify({ runId, expiresAt: Date.now() + LEASE_MS }), { ...json, onlyIf: oldFile ? { etagMatches: oldFile.etag } : { etagDoesNotMatch: '*' } })) throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Презентация уже обрабатывается.')
  const release = async () => { const file = await bucket.get(leaseKey); if (file && (await file.json<{ runId: string }>()).runId === runId) await bucket.put(leaseKey, JSON.stringify({ runId, expiresAt: 0 }), { ...json, onlyIf: { etagMatches: file.etag } }) }
  let state: DeckState
  const save = async () => {
    const file = await bucket.get(leaseKey)
    if (!file || (await file.json<{ runId: string }>()).runId !== runId) throw new QwenAnalysisError('QWEN_LEASE_LOST', 'Запуск был заменён.')
    state.updatedAt = new Date().toISOString(); await bucket.put(`${context.prefix}/state.json`, JSON.stringify(state), json)
  }
  const done = async () => { await save(); await release(); return { state, execute: null } }
  try {
    const prior = await readDeck(bucket, context, true)
    state = prior ?? initialDeck(context)
    if (!prior) { await bucket.put(`${context.prefix}/input.json`, JSON.stringify({ version: DECK_VERSION, renderer: DECK_RENDERER, inputs: context.inputs }), { ...json, onlyIf: { etagDoesNotMatch: '*' } }); await save() }
    if (state.status === 'failed') {
      if (action.action !== 'advance' || !action.retry) return done()
      state.status = 'working'; delete state.error
    }
    if (action.action === 'report') {
      const slide = state.slides.find(s => s.id === action.slideId), attempt = slide?.attempts.at(-1), report = reportSchema.parse(action.report)
      if (!slide || !attempt?.scene || report.sceneHash !== attempt.sceneHash || !['render','fitted','ready'].includes(slide.status)) throw new QwenAnalysisError('STALE_RENDER', 'Проверка относится к другой версии слайда.')
      if (slide.status !== 'render') return done()
      const input = slideInput(context,state,slide), evidence = slide.evidence!
      for (const issue of report.issues) if (issue.alternatives && (issue.code !== 'graphic-invisible' || issue.alternatives.some(id => !evidence.resourceIds.includes(id) || !input.resources.some(r => r.id === id)))) throw new QwenAnalysisError('INVALID_MEASUREMENTS', 'Подсказка проверки ссылается на недоступную графику.')
      const ids = attempt.scene.texts.map(t => t.id)
      if (new Set(report.texts.map(t => t.id)).size !== ids.length || report.texts.length !== ids.length || report.texts.some(t => !ids.includes(t.id))) throw new QwenAnalysisError('INVALID_MEASUREMENTS', 'Не все текстовые области измерены.')
      report.issues = [...new Map([...report.issues,...geometryIssues(attempt.scene,input,report.texts)].map(i => [JSON.stringify(i),i])).values()]
      await current(bucket,context)
      if (action.preview) {
        const bytes = await pngBytes(action.preview); attempt.preview = `${context.prefix}/slides/${slide.id}/attempt-${attempt.number}.png`
        await bucket.put(attempt.preview,bytes,{ httpMetadata: { contentType: 'image/png' } })
      }
      if (!action.preview && !report.issues.length) throw new QwenAnalysisError('PREVIEW_REQUIRED', 'Не удалось получить превью слайда.')
      attempt.report = report; attempt.issues = report.issues; slide.status = report.issues.length ? 'pending' : 'fitted'
      if (slide.status === 'fitted') {
        slide.fittedAttempt = attempt.number
        await bucket.put(`${context.prefix}/slides/${slide.id}/scene.json`,JSON.stringify({ scene: attempt.scene, sceneHash: attempt.sceneHash, component: compileDeckScene(attempt.scene,input,report.texts), report }),json)
      }
      state.status = 'working'; return done()
    }
    let op = nextOperation(context,state)
    if (action.action === 'catalog') {
      if (op.kind !== 'catalog' || action.pageId !== op.page.id) throw new QwenAnalysisError('STALE_EVIDENCE', 'Каталог уже обновлён. Продолжим с актуальной страницы.')
      const input = { ...context.inputs[0], resources: op.page.ids.map(id => context.inputs[0].resources.find(r => r.id === id)!) }, evidence = await checkedEvidence(action.evidence,input)
      op.page.availableIds = evidence.resourceIds
      if (evidence.sheet) { op.page.preview = `${context.prefix}/resources/${op.page.id}.png`; await bucket.put(op.page.preview,await pngBytes(evidence.sheet),{ httpMetadata: { contentType: 'image/png' } }) }
      state.evidence.fonts = evidence.fonts; state.evidence.resourceIds = state.pages.flatMap(p => p.availableIds ?? [])
      return done()
    }
    if (action.action === 'evidence' || action.action === 'advance' && action.evidence && op.kind === 'evidence') {
      if (op.kind !== 'evidence' || action.action === 'evidence' && action.slideId !== op.slideId) throw new QwenAnalysisError('STALE_EVIDENCE', 'Подбор графики изменился. Проверим актуальный набор.')
      const slideId = op.slideId, slide = state.slides.find(s => s.id === slideId)!
      slide.evidence = await checkedEvidence(action.evidence!,slideInput(context,state,slide)); await save()
      if (action.action === 'evidence') return done()
      op = nextOperation(context,state)
    }
    if (action.action !== 'advance') throw new QwenAnalysisError('DECK_ACTION_INVALID', 'Обновите страницу для продолжения.')
    if (op.kind === 'done' || op.kind === 'wait' || op.kind === 'render' || op.kind === 'catalog' || op.kind === 'evidence') return done()
    if (op.kind === 'limit') { state.status = 'blocked'; state.error = op.message; return done() }
    if (op.kind === 'begin-review') {
      state.rounds.push({ number: state.rounds.length+1, targets: state.slides.map(s => { const a = s.attempts.find(a => a.number === s.fittedAttempt)!; return { slideId: s.id, sceneHash: a.sceneHash!, attempt: a.number } }), settled: false })
      return done()
    }
    if (op.kind === 'settle-review') { settleReview(state); return done() }
    if (deckRequests(state) >= MAX_DECK_REQUESTS) { state.status = 'blocked'; state.error = 'Достигнут лимит автоматических запросов. Содержание и проверенные результаты сохранены.'; return done() }
    if (!config.apiKey?.trim()) throw new QwenAnalysisError('QWEN_NOT_CONFIGURED', 'Для создания слайдов требуется подключение модели.')
    if (op.kind !== 'scene') {
      const spec: AuxSpec = op, previous = state.jobs.filter(j => j.spec.key === spec.key)
      if (previous.length >= MAX_AUX_ATTEMPTS) { state.status = 'blocked'; state.error = 'Не удалось завершить автоматическую проверку. Содержание и полученные слайды сохранены.'; return done() }
      let task = await auxTask(bucket,context,state,spec)
      if (previous.at(-1)?.raw !== undefined) task = { ...task, messages: [...task.messages,{ role: 'user',content: `Предыдущий ответ: ${JSON.stringify(previous.at(-1)?.raw)}. Ошибки: ${JSON.stringify(previous.at(-1)?.issues)}. Верни полный корректный JSON для тех же данных, без новых ID или изменения текста.` }] }
      const job: AuxJob = { id: crypto.randomUUID(), spec, status: 'running', requests: 0 }; state.jobs.push(job); await save()
      const execute = async (signal?: AbortSignal) => {
        try {
          await current(bucket,context); signal?.throwIfAborted()
          const model = await beginModelRun({ bucket,prefix: `${context.prefix}/aux/${job.id}`,task,config: { ...config,timeoutMs: 300_000 },version: DECK_VERSION,scope: { inputId: context.inputId,spec },validate: raw => raw })
          job.runId = model.run.id; await save()
          try { await model.execute?.(signal) }
          catch (error) {
            if (!(error instanceof QwenAnalysisError) || error.code !== 'QWEN_INVALID_JSON') throw error
            const file = await bucket.get(`${context.prefix}/aux/${job.id}/responses/${model.run.id}.json`)
            job.raw = file ? (await file.json<{ content: string }>()).content : null; job.status = 'invalid'; job.issues = ['invalid-json']; await save(); return
          } finally { job.requests = model.run.liveRequests; await save() }
          await current(bucket,context); signal?.throwIfAborted(); job.raw = model.run.result
          try { applyAux(job,context,state) } catch (error) {
            if (!(error instanceof SemanticValidationError)) throw error
            job.status = 'invalid'; job.issues = error.issues
          }
          await save()
        } catch (error) { job.status = 'failed'; state.status = 'failed'; state.error = error instanceof QwenAnalysisError ? error.message : 'Обработка прервалась. Все исходные данные сохранены.'; await save(); throw error }
        finally { await release() }
      }
      return { state,execute }
    }
    const slide = state.slides.find(s => s.id === op.slideId)!, input = slideInput(context,state,slide), reference = action.reference ?? ''
    const bytes = await pngBytes(reference,provenance.previews[input.variant.preview as keyof typeof provenance.previews])
    await bucket.put(`${context.prefix}/references/${input.variant.id}.png`,bytes,{ httpMetadata: { contentType: 'image/png' } })
    const previous = phaseAttempts(slide).at(-1) ?? (slide.visualIssues?.length ? slide.attempts.find(a => a.number === slide.fittedAttempt) : undefined)
    const task = sceneTask(input,slide.evidence!,reference,previous ? { scene: previous.scene ?? previous.raw,issues: slideIssues(slide),preview: await imageData(bucket,previous.preview) } : undefined)
    const attempt: Attempt = { number: slide.attempts.length+1,variantId: slide.variantId,correctionRound: slide.correctionRound,requests: 0 }
    slide.attempts.push(attempt); slide.status = 'running'; state.status = 'working'; delete state.error; await save()
    const execute = async (signal?: AbortSignal) => {
      try {
        await current(bucket,context); signal?.throwIfAborted()
        const model = await beginModelRun({ bucket,prefix: `${context.prefix}/slides/${slide.id}/attempts/${attempt.number}`,task,config: { ...config,timeoutMs: 300_000 },version: DECK_VERSION,
          scope: { inputId: context.inputId,slideId: slide.id,attempt: attempt.number },validate: raw => raw })
        attempt.runId = model.run.id; await save()
        try { await model.execute?.(signal) }
        catch (error) {
          if (!(error instanceof QwenAnalysisError) || error.code !== 'QWEN_INVALID_JSON') throw error
          const file = await bucket.get(`${context.prefix}/slides/${slide.id}/attempts/${attempt.number}/responses/${model.run.id}.json`)
          attempt.raw = file ? (await file.json<{ content: string }>()).content : null; attempt.issues = [{ code: 'invalid-scene-json',message: 'Верни полный корректный JSON по заданной схеме.' }]; slide.status = 'pending'; await save(); return
        } finally { attempt.requests = model.run.liveRequests; await save() }
        await current(bucket,context); signal?.throwIfAborted(); attempt.raw = model.run.result; finishScene(attempt,slide,state,context)
        if (attempt.scene) attempt.sceneHash = await contentHash(attempt.scene)
        await save()
      } catch (error) { slide.status = 'failed'; state.status = 'failed'; state.error = error instanceof QwenAnalysisError ? error.message : 'Создание слайдов прервалось. Содержание и готовые слайды сохранены.'; await save(); throw error }
      finally { await release() }
    }
    return { state,execute }
  } catch (error) { await release(); throw error }
}
