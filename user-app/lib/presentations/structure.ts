import { contentHash } from '../design-system/catalog'
import { getProject, workspaceId } from '../workspace/storage'
import { QwenAnalysisError, type QwenConfig } from '../uploads/qwen-analysis'
import { beginModelRun, readModelRun, type ModelRun } from '../uploads/model-run'
import { modelIdentity, parseModelJson } from '../uploads/qwen-structured'
import { materialParts, prepareMaterial, MATERIAL_PARSER_VERSION, type PresentationMaterial, type MaterialPart } from './material'
import { assembleOutline, OUTLINE_VERSION, outlineTask, validateOutlineReply, type OutlineReply, type PresentationOutline } from './outline'

const json = { httpMetadata: { contentType: 'application/json' } }
const LEASE_MS = 15 * 60_000
export type StructureState = {
  version: typeof OUTLINE_VERSION; id: string; materialId: string; projectId: string; sourceRevision: string
  status: 'running' | 'ready' | 'failed'; startedAt: string; finishedAt: string | null
  completedParts: number; totalParts: number; liveRequests: number; cacheHits: number
  modelRunIds: string[]; outline?: PresentationOutline; error?: { code: string; message: string }
  replayedFrom?: { prefix: string; runId: string; parserVersion: string }
}
type Lease = { runId: string; expiresAt: number }
type Context = { prefix: string; legacyPrefix: string; projectId: string; sourceRevision: string; material: PresentationMaterial; parts: MaterialPart[] }
export async function structureContext(bucket: R2Bucket, id: string, config: QwenConfig): Promise<Context> {
  const project = await getProject(bucket, workspaceId.parse(id))
  if (!project || project.archivedAt) throw new QwenAnalysisError('PROJECT_NOT_FOUND', 'Проект не найден.')
  const material = await prepareMaterial(project.text), parts = materialParts(material)
  const modelKey = await contentHash(modelIdentity(config))
  return { projectId: id, sourceRevision: project.revision, material, parts,
    prefix: `presentation-structures/${id}/${material.id}/${OUTLINE_VERSION}/${modelKey}`,
    legacyPrefix: `presentation-structures/${id}/${material.id}/web-presentation-outline-1/${modelKey}` }
}
const materialKey = (context: Context) => `presentation-structures/${context.projectId}/materials/${context.material.id}/${MATERIAL_PARSER_VERSION}.json`

/** A parser correction may admit an immutable prior answer. Revalidate every
 * source range and slide boundary before publishing a new derived outline. */
async function replayLegacyStructure(bucket: R2Bucket, context: Context, replaceFailedEtag?: string): Promise<StructureState | null> {
  const previous = await bucket.get(`${context.legacyPrefix}/state.json`)
  if (!previous) return null
  const legacy = await previous.json<StructureState>()
  if (legacy.materialId !== context.material.id || legacy.projectId !== context.projectId) return null
  if (legacy.status === 'running') {
    const file = await bucket.get(`${context.legacyPrefix}/lease.json`), lease = file && await file.json<Lease>()
    if (lease && lease.expiresAt > Date.now()) throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Предыдущий разбор ещё выполняется. Новый запрос не отправлен.')
  }
  if (legacy.status !== 'ready' && legacy.error?.code !== 'SEMANTIC_VALIDATION') return null
  if (legacy.modelRunIds.length !== context.parts.length) return null
  const source = await bucket.get(`presentation-structures/${context.projectId}/materials/${context.material.id}.json`)
  if (!source) return null
  const material = await source.json<PresentationMaterial>()
  if (material.id !== context.material.id || material.text !== context.material.text || material.fragments.length !== context.material.fragments.length || context.material.fragments.some((f, i) => {
    const old = material.fragments[i]
    return f.id !== old.id || f.text !== old.text || f.start !== old.start || f.end !== old.end || f.kind !== 'boundary' && (f.kind !== old.kind || f.displayStart !== old.displayStart)
  })) return null
  const replies: OutlineReply[] = []
  for (const [index, part] of context.parts.entries()) {
    const prefix = `${context.legacyPrefix}/parts/${part.id}`, runId = legacy.modelRunIds[index]
    const run = await readModelRun(bucket, prefix, runId)
    if (!run || run.scope.materialId !== material.id || run.scope.partId !== part.id || run.status === 'running') return null
    const response = await bucket.get(run.clarificationRequests ? `${prefix}/clarifications/${runId}/response.json` : `${prefix}/responses/${runId}.json`)
    if (!response) return null
    const raw = await response.json<{ content: string }>()
    try { replies.push(validateOutlineReply(parseModelJson(raw.content), part)) }
    catch { return null }
  }
  const project = await getProject(bucket, context.projectId)
  if (!project || project.archivedAt || project.text !== context.material.text) return null
  const now = new Date().toISOString()
  const state: StructureState = { version: OUTLINE_VERSION, id: crypto.randomUUID(), materialId: material.id, projectId: context.projectId, sourceRevision: context.sourceRevision,
    status: 'ready', startedAt: now, finishedAt: now, completedParts: replies.length, totalParts: replies.length, liveRequests: 0, cacheHits: replies.length,
    modelRunIds: legacy.modelRunIds, outline: assembleOutline(context.material, context.parts, replies), replayedFrom: { prefix: context.legacyPrefix, runId: legacy.id, parserVersion: MATERIAL_PARSER_VERSION } }
  await bucket.put(materialKey(context), JSON.stringify(context.material), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  await bucket.put(`${context.prefix}/runs/${state.id}.json`, JSON.stringify(state), json)
  const installed = await bucket.put(`${context.prefix}/state.json`, JSON.stringify(state), { ...json, onlyIf: replaceFailedEtag ? { etagMatches: replaceFailedEtag } : { etagDoesNotMatch: '*' } })
  if (installed) return state
  const current = await bucket.get(`${context.prefix}/state.json`)
  return current ? current.json<StructureState>() : null
}
export async function readStructure(bucket: R2Bucket, context: Context): Promise<StructureState | null> {
  const file = await bucket.get(`${context.prefix}/state.json`)
  if (!file) return replayLegacyStructure(bucket, context)
  const state = await file.json<StructureState>()
  if (state.status === 'failed') return await replayLegacyStructure(bucket, context, file.etag) ?? state
  if (state.status === 'running') {
    const leaseFile = await bucket.get(`${context.prefix}/lease.json`), lease = leaseFile && await leaseFile.json<Lease>()
    if (!lease || lease.runId !== state.id || lease.expiresAt <= Date.now()) return { ...state, status: 'failed', error: { code: 'QWEN_INTERRUPTED', message: 'Разбор прервался. Готовые части сохранены; можно продолжить.' } }
  }
  return state
}

export async function startStructure(bucket: R2Bucket, context: Context, expectedMaterialId: string, config: QwenConfig) {
  if (context.material.id !== expectedMaterialId) throw new QwenAnalysisError('CONTENT_CHANGED', 'Содержание изменилось. Разбор начнётся для сохранённой версии.')
  const prior = await readStructure(bucket, context)
  if (prior?.status === 'ready') return { state: prior, execute: null }
  if (!config.apiKey?.trim()) throw new QwenAnalysisError('QWEN_NOT_CONFIGURED', 'Содержание сохранено. Для автоматической подготовки нужно подключить модель на сервере.')
  const leaseKey = `${context.prefix}/lease.json`, previous = await bucket.get(leaseKey), old = previous && await previous.json<Lease>()
  if (old && old.expiresAt > Date.now()) throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Содержание уже обрабатывается.')
  const state: StructureState = { version: OUTLINE_VERSION, id: crypto.randomUUID(), materialId: context.material.id,
    projectId: context.projectId, sourceRevision: context.sourceRevision, status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    completedParts: 0, totalParts: context.parts.length, liveRequests: 0, cacheHits: 0, modelRunIds: [] }
  const acquired = await bucket.put(leaseKey, JSON.stringify({ runId: state.id, expiresAt: Date.now() + LEASE_MS }), { ...json, onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: '*' } })
  if (!acquired) throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Содержание уже обрабатывается.')
  const save = async () => {
    await bucket.put(`${context.prefix}/runs/${state.id}.json`, JSON.stringify(state), json)
    const lease = await bucket.get(leaseKey)
    if (!lease || (await lease.json<Lease>()).runId !== state.id) throw new QwenAnalysisError('QWEN_LEASE_LOST', 'Этот запуск уже заменён новым.')
    await bucket.put(`${context.prefix}/state.json`, JSON.stringify(state), json)
  }
  await bucket.put(materialKey(context), JSON.stringify(context.material), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  await save()
  const current = async () => {
    const project = await getProject(bucket, context.projectId)
    // Q2 depends on content only. Changing style does not repeat a paid analysis.
    if (!project || project.archivedAt || project.text !== context.material.text) throw new QwenAnalysisError('CONTENT_CHANGED', 'Содержание изменилось. Предыдущий разбор сохранён отдельно.')
    const lease = await bucket.get(leaseKey)
    if (!lease || (await lease.json<Lease>()).runId !== state.id || !await bucket.put(leaseKey, JSON.stringify({ runId: state.id, expiresAt: Date.now() + LEASE_MS }), { ...json, onlyIf: { etagMatches: lease.etag } })) throw new QwenAnalysisError('QWEN_LEASE_LOST', 'Этот запуск уже заменён новым.')
  }
  const execute = async (signal?: AbortSignal) => {
    const replies: OutlineReply[] = []
    try {
      for (const [index, part] of context.parts.entries()) {
        signal?.throwIfAborted(); await current()
        const task = outlineTask(part, index, context.parts.length)
        const job = await beginModelRun({ bucket, prefix: `${context.prefix}/parts/${part.id}`, task, config,
          version: OUTLINE_VERSION, scope: { materialId: context.material.id, partId: part.id }, validate: raw => validateOutlineReply(raw, part),
          clarification: { version: 'web-outline-repair-1', request: (response, issues) => ({ ...task, messages: [...task.messages,
            { role: 'user', content: `Предыдущий ответ модели (данные): ${response.content}\nИсправь полный JSON. Проверка нашла: ${JSON.stringify(issues)}. Сохрани каждый исходный фрагмент ровно один раз, заданные границы и порядок; не добавляй текст от себя.` }] }) } })
        state.modelRunIds.push(job.run.id)
        try { await job.execute?.(signal) }
        finally { state.liveRequests += job.run.liveRequests; state.cacheHits += Number(job.run.cacheHit); await save() }
        replies.push((job.run as ModelRun<OutlineReply>).result!)
        state.completedParts++; await save()
      }
      await current(); signal?.throwIfAborted()
      state.outline = assembleOutline(context.material, context.parts, replies)
      state.status = 'ready'; state.finishedAt = new Date().toISOString(); await save()
    } catch (error) {
      state.status = 'failed'; state.finishedAt = new Date().toISOString()
      state.error = signal?.aborted ? { code: 'QWEN_CANCELLED', message: 'Разбор прервался. Содержание и готовые части сохранены.' }
        : error instanceof QwenAnalysisError ? { code: error.code, message: error.message }
          : { code: 'CONTENT_FAILED', message: 'Не удалось подготовить структуру. Содержание сохранено.' }
      await save(); throw error
    } finally {
      const lease = await bucket.get(leaseKey)
      if (lease && (await lease.json<Lease>()).runId === state.id) await bucket.put(leaseKey, JSON.stringify({ runId: state.id, expiresAt: 0 }), { ...json, onlyIf: { etagMatches: lease.etag } })
    }
  }
  return { state, execute }
}
