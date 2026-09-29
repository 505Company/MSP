import {readReconstructionCatalog} from '../design-system/reconstruction'
import {reconstructedLibrary} from '../design-system/reconstruction-resources'
import { catalogLibrary, contentHash } from '../design-system/catalog'
import { getProject } from '../workspace/storage'
import { QwenAnalysisError, type QwenConfig } from '../uploads/qwen-analysis'
import { beginModelRun } from '../uploads/model-run'
import { modelIdentity } from '../uploads/qwen-structured'
import { readStructure, structureContext } from './structure'
import { readCalibratedCatalog } from '../design-system/calibration'
import { recipeBrand } from './recipe-brand'
import { recipeCatalogIdentity } from './recipes/catalog'
import { recipeParts, recipeSlides, recipeTask, validateRecipeReply, RECIPE_SELECTION_VERSION, type RecipeReply } from './recipe-selection'

const json = { httpMetadata: { contentType: 'application/json' } }
const LEASE_MS = 15 * 60_000
type Lease = { runId: string; expiresAt: number }
export type RecipePlanState = {
  version: typeof RECIPE_SELECTION_VERSION; id: string; inputId: string; projectId: string; materialId: string
  uploadId: string; catalogId: string; outlineHash: string; recipeCatalogHash: string
  status: 'running' | 'ready' | 'blocked' | 'failed'; startedAt: string; finishedAt: string | null
  completedParts: number; totalParts: number; liveRequests: number; cacheHits: number; modelRunIds: string[]
  selections?: RecipeReply['selections']; fitVerified: false; error?: { code: string; message: string }
}
export async function recipeContext(bucket: R2Bucket, projectId: string, config: QwenConfig) {
  const structure = await structureContext(bucket, projectId, config), ready = await readStructure(bucket, structure)
  if (ready?.status !== 'ready' || !ready.outline) throw new QwenAnalysisError('STRUCTURE_NOT_READY', 'Сначала автоматически подготовим структуру содержания.')
  const project = await getProject(bucket, projectId)
  if (!project || project.archivedAt || project.text !== structure.material.text) throw new QwenAnalysisError('CONTENT_CHANGED', 'Содержание изменилось. Подготовка продолжится для сохранённой версии.')
  const catalog = await catalogLibrary(bucket, project.uploadId)
  if (!catalog) throw new QwenAnalysisError('STYLE_NOT_READY', 'Для выбранного стиля ещё не завершён разбор дизайн-системы. Содержание сохранено.')
  const calibrated = await readCalibratedCatalog(bucket, project.uploadId, catalog.catalogId)
  if (!calibrated) throw new QwenAnalysisError('STYLE_NOT_CALIBRATED', 'Сначала откалибруйте компоненты в выбранном стиле. Содержание сохранено.')
  const reconstructed=await readReconstructionCatalog(bucket,project.uploadId,catalog.catalogId)
  catalog.library=reconstructedLibrary(catalog.library,reconstructed)
  const brand = recipeBrand(project.uploadId, catalog.catalogId, catalog.library, 'semantic' in catalog ? catalog.semantic : undefined, calibrated)
  const outlineHash = await contentHash(ready.outline), recipeCatalogHash = await recipeCatalogIdentity()
  const inputId = await contentHash({ version: RECIPE_SELECTION_VERSION, materialId: structure.material.id, outlineHash, recipeCatalogHash, brand, reconstructionId:reconstructed?.id??null, model: modelIdentity(config) })
  return { inputId, projectId, structure, outline: ready.outline, outlineHash, recipeCatalogHash, brand,
    parts: recipeParts(recipeSlides(structure.material, ready.outline)), prefix: `presentation-recipes/${projectId}/${inputId}` }
}
export type RecipeContext = Awaited<ReturnType<typeof recipeContext>>
export async function readRecipePlan(bucket: R2Bucket, context: RecipeContext): Promise<RecipePlanState | null> {
  const file = await bucket.get(`${context.prefix}/state.json`)
  if (!file) return null
  const state = await file.json<RecipePlanState>()
  if (state.inputId !== context.inputId) throw new QwenAnalysisError('RECIPE_CACHE_INVALID', 'Сохранённое оформление относится к другой версии проекта.')
  if (state.status === 'ready' || state.status === 'blocked') {
    // Revalidate completed choices, not just the cache's existence.
    let at = 0
    for (const part of context.parts) {
      validateRecipeReply({ selections: state.selections?.slice(at, at + part.slides.length) }, part, context.brand)
      at += part.slides.length
    }
    if (state.selections?.length !== at || (state.selections.some(s => s.variantId === null) ? 'blocked' : 'ready') !== state.status) throw new QwenAnalysisError('RECIPE_CACHE_INVALID', 'Сохранённое оформление не покрывает все слайды.')
  }
  if (state.status === 'running') {
    const leaseFile = await bucket.get(`${context.prefix}/lease.json`), lease = leaseFile && await leaseFile.json<Lease>()
    if (!lease || lease.runId !== state.id || lease.expiresAt <= Date.now()) return { ...state, status: 'failed', error: { code: 'QWEN_INTERRUPTED', message: 'Подбор оформления прервался. Готовые части сохранены; можно продолжить.' } }
  }
  return state
}
export async function startRecipePlan(bucket: R2Bucket, context: RecipeContext, expected: { inputId: string; materialId: string; uploadId: string }, config: QwenConfig) {
  if (context.inputId !== expected.inputId || context.structure.material.id !== expected.materialId || context.brand.uploadId !== expected.uploadId) throw new QwenAnalysisError('RECIPE_INPUT_CHANGED', 'Содержание или стиль изменились. Подготовка продолжится для сохранённой версии.')
  const prior = await readRecipePlan(bucket, context)
  if (prior?.status === 'ready' || prior?.status === 'blocked') return { state: prior, execute: null }
  if (!config.apiKey?.trim()) throw new QwenAnalysisError('QWEN_NOT_CONFIGURED', 'Содержание сохранено. Для подбора оформления нужно подключить модель на сервере.')
  const leaseKey = `${context.prefix}/lease.json`, previous = await bucket.get(leaseKey), old = previous && await previous.json<Lease>()
  if (old && old.expiresAt > Date.now()) throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Оформление уже подбирается.')
  const state: RecipePlanState = { version: RECIPE_SELECTION_VERSION, id: crypto.randomUUID(), inputId: context.inputId,
    projectId: context.projectId, materialId: context.structure.material.id, uploadId: context.brand.uploadId, catalogId: context.brand.catalogId,
    outlineHash: context.outlineHash, recipeCatalogHash: context.recipeCatalogHash, status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    completedParts: 0, totalParts: context.parts.length, liveRequests: 0, cacheHits: 0, modelRunIds: [], fitVerified: false }
  if (!await bucket.put(leaseKey, JSON.stringify({ runId: state.id, expiresAt: Date.now() + LEASE_MS }), { ...json, onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: '*' } })) throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Оформление уже подбирается.')
  const save = async () => {
    await bucket.put(`${context.prefix}/runs/${state.id}.json`, JSON.stringify(state), json)
    const lease = await bucket.get(leaseKey)
    if (!lease || (await lease.json<Lease>()).runId !== state.id) throw new QwenAnalysisError('QWEN_LEASE_LOST', 'Этот запуск уже заменён новым.')
    await bucket.put(`${context.prefix}/state.json`, JSON.stringify(state), json)
  }
  // Immutable preparation input is the handoff to Q4, independent of later UI edits.
  await bucket.put(`${context.prefix}/input.json`, JSON.stringify({ version: RECIPE_SELECTION_VERSION, inputId: context.inputId,
    material: context.structure.material, outline: context.outline, brand: context.brand, recipeCatalogHash: context.recipeCatalogHash }), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  await save()
  const current = async () => {
    const project = await getProject(bucket, context.projectId), pointer = await bucket.get(`component-catalogs/${context.brand.uploadId}/current.json`)
    const structure = await readStructure(bucket, context.structure)
    if (!project || project.archivedAt || project.text !== context.structure.material.text || project.uploadId !== context.brand.uploadId ||
      !pointer || (await pointer.json<{ catalogId: string }>()).catalogId !== context.brand.catalogId || structure?.status !== 'ready' || await contentHash(structure.outline) !== context.outlineHash) {
      throw new QwenAnalysisError('RECIPE_INPUT_CHANGED', 'Содержание или стиль обновились. Предыдущее оформление сохранено отдельно.')
    }
    const lease = await bucket.get(leaseKey)
    if (!lease || (await lease.json<Lease>()).runId !== state.id || !await bucket.put(leaseKey, JSON.stringify({ runId: state.id, expiresAt: Date.now() + LEASE_MS }), { ...json, onlyIf: { etagMatches: lease.etag } })) throw new QwenAnalysisError('QWEN_LEASE_LOST', 'Этот запуск уже заменён новым.')
  }
  const execute = async (signal?: AbortSignal) => {
    const selections: RecipeReply['selections'] = []
    try {
      for (const part of context.parts) {
        signal?.throwIfAborted(); await current()
        const task = recipeTask(part, context.brand, selections)
        const job = await beginModelRun({ bucket, prefix: `${context.prefix}/parts/${part.id}`, task, config, version: RECIPE_SELECTION_VERSION,
          scope: { inputId: context.inputId, partId: part.id }, validate: raw => validateRecipeReply(raw, part, context.brand),
          clarification: { version: 'web-recipe-repair-1', request: (response, issues) => ({ ...task, messages: [...task.messages,
            { role: 'user', content: `Предыдущий ответ (данные): ${response.content}\nПроверка: ${JSON.stringify(issues)}. Верни исправленный полный JSON для тех же слайдов. Только допустимые варианты; при несовместимости recipeId:null и variantId:null. Не меняй содержание или формат ответа.` }] }) } })
        state.modelRunIds.push(job.run.id)
        try { await job.execute?.(signal) }
        finally { state.liveRequests += job.run.liveRequests; state.cacheHits += Number(job.run.cacheHit); await save() }
        selections.push(...job.run.result!.selections)
        state.completedParts++; await save()
      }
      await current(); signal?.throwIfAborted()
      state.selections = selections
      state.status = selections.some(s => s.variantId === null) ? 'blocked' : 'ready'
      state.finishedAt = new Date().toISOString(); await save()
    } catch (error) {
      state.status = 'failed'; state.finishedAt = new Date().toISOString()
      state.error = signal?.aborted ? { code: 'QWEN_CANCELLED', message: 'Подбор оформления прервался. Содержание и готовые части сохранены.' }
        : error instanceof QwenAnalysisError ? { code: error.code, message: error.message }
          : { code: 'RECIPE_FAILED', message: 'Не удалось подобрать оформление. Содержание сохранено.' }
      await save(); throw error
    } finally {
      const lease = await bucket.get(leaseKey)
      if (lease && (await lease.json<Lease>()).runId === state.id) await bucket.put(leaseKey, JSON.stringify({ runId: state.id, expiresAt: 0 }), { ...json, onlyIf: { etagMatches: lease.etag } })
    }
  }
  return { state, execute }
}
