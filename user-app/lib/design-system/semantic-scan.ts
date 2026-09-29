import type { VisualManifest } from '../digital-designer/visual-package'
import type { ModelMessage } from '../digital-designer/design-context'
import { contentHash } from './catalog'
import { buildSourceSystem } from './source-system'
import { planSemanticScan, SCAN_VERSION } from './semantic-scan-plan'
import { prepareSemanticPilot } from './semantic-pilot'
import { semanticPrompt, validateSemanticReply, type SemanticContext, semanticReply, SemanticValidationError } from './semantic-contract'
import { planSourceRules, RULES_VERSION, sourceRuleTask, validateSourceRules, type RuleResult } from './semantic-rules'
import { beginModelRun, type ModelRun } from '../uploads/model-run'
import { modelIdentity, type StructuredRequest } from '../uploads/qwen-structured'
import { QwenAnalysisError, type QwenConfig } from '../uploads/qwen-analysis'
import { readSourceScene } from './source-scene'
import { singleTextMember } from './semantic-structure'
import { isolateSemanticReply, localRecognitionError, rejectedModelResponse, type ImportOmission } from './semantic-isolation'
import { assertUploadActive } from '../uploads/cancellation-server'
import { sourceReadOmissions, unavailableSourceSlides } from './source-availability'
import { semanticScanProgress } from './semantic-scan-progress'
import { providerUnavailable } from '../uploads/provider-failover'

const json = { httpMetadata: { contentType: 'application/json' } }
export const scanPrefix = (id: string) => `semantic-scans/${id}`
export type SemanticBatchResult = ReturnType<typeof validateScanReply> & { omissions?: ImportOmission[] }
export type SemanticSystem = {
  version: string; sourceRevision: string; sourceId: string
  batches: { id: string; runId: string; result: SemanticBatchResult; refinedFromRunId?: string }[]
  rules: RuleResult[]; sourcePending: { elementId: string; reason: string }[]
  rulePending: string[]; retainedTableIds: string[]; omittedContainerIds: string[]
}
type Part = { id: string; kind: 'visual' | 'rules'; status: 'waiting' | 'running' | 'complete' | 'partial' | 'skipped' | 'failed'; runId?: string; cacheHit?: boolean; liveRequests?: number; error?: string; errorCode?: string }
export type ScanRun = {
  id: string; version: string; sourceRevision: string; status: 'running' | 'complete' | 'failed'
  startedAt: string; finishedAt?: string; parts: Part[]; liveRequests: number; cacheHits: number
  catalogId?: string; resultKey?: string; error?: string; errorCode?: string
  omissions?: ImportOmission[]
}
const finishedPart = (part: Part) => ['complete', 'partial', 'skipped'].includes(part.status)
export async function readScanRun(bucket: R2Bucket, uploadId: string) {
  const file = await bucket.get(`${scanPrefix(uploadId)}/current.json`)
  if (!file) return null
  const pointer = await file.json<{ runId: string }>(), run = await bucket.get(`${scanPrefix(uploadId)}/runs/${pointer.runId}.json`)
  if (!run) return null
  const state = await run.json<ScanRun>()
  if (state.status !== 'running') return state
  const claim = await bucket.get(`${scanPrefix(uploadId)}/claim.json`)
  const lease = claim ? await claim.json<{ runId: string; expiresAt: number }>() : null
  return lease?.runId === state.id && lease.expiresAt > Date.now() ? state : {
    ...state, status: 'failed' as const, error: 'Анализ прерван. Готовые части сохранены; можно продолжить.',
  }
}

/** Only structural equivalences may be normalized. Keep every change next to
 * the original provider response, never rewrite that response in storage. */
export function validateScanReply(raw: unknown, context: SemanticContext) {
  const parsed = semanticReply.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(['semantic-schema'])
  const reply = parsed.data, scene = readSourceScene(context.snapshot), own = new Set(context.batch.nodes.map(n => n.id))
  const changes: { from: string; to: string; reason: string }[] = []
  // v13 records a non-text "content" assignment as unresolved instead of
  // discarding its graphic source. It must never become a text component.
  reply.content = reply.content.filter(c => {
    const node = scene.records.get(c.elementId)
    if (!own.has(c.elementId) || !node || node.element.kind === 'text') return true
    if (!reply.pending.some(p => p.elementId === c.elementId)) reply.pending.push({ elementId: c.elementId, reason: 'Модель указала текстовую роль для графического объекта; требуется уточнение.' })
    changes.push({ from: c.elementId, to: c.elementId, reason: 'Некорректная текстовая роль изолирована как неопределённая.' }); return false
  })
  const container = (id: string) => {
    const child = scene.records.get(id), parent = child?.source.parentId ? scene.records.get(child.source.parentId) : undefined
    if (child?.element.kind !== 'raster' || parent?.element.kind !== 'group' || !parent.element.clipsContent || parent.element.children.length !== 1 || !own.has(parent.element.id)) return id
    changes.push({ from: id, to: parent.element.id, reason: 'Единственный растр вместе с исходной маской и преобразованием.' })
    return parent.element.id
  }
  for (const atom of reply.atoms) atom.elementId = container(atom.elementId)
  reply.atoms = reply.atoms.filter((a, i, all) => all.findIndex(b => b.elementId === a.elementId && b.category === a.category) === i)
  for (const m of reply.molecules) m.elementIds = [...new Set(m.elementIds.map(container))]
  // Adapted from v13 completeNativeTextSlots: only the native text members of
  // an explicitly selected block qualify. Never add rules or fixed markers.
  const rules = new Set(reply.rules.flatMap(r => r.elementIds)), markers = new Set(context.fixedMarkerIds)
  for (const m of reply.molecules) {
    m.elementIds = m.elementIds.filter(id => {
      const child = singleTextMember(scene, id)
      if (!own.has(id) || !child || !own.has(child) || !m.elementIds.includes(child) || !m.textSlots.some(s => s.elementId === child)) return true
      changes.push({ from: id, to: child, reason: 'Оболочка единственного текстового поля сохраняется его исходным предком, без повторного извлечения.' })
      return false
    })
    const members = m.elementIds.flatMap(id => scene.records.get(id) ?? [])
    if (!members.length || members.length !== m.elementIds.length || !m.elementIds.every(id => own.has(id))) continue
    const left = Math.min(...members.map(r => r.bounds.x)), top = Math.min(...members.map(r => r.bounds.y))
    const right = Math.max(...members.map(r => r.bounds.x + r.bounds.width)), bottom = Math.max(...members.map(r => r.bounds.y + r.bounds.height))
    for (const slot of m.textSlots) {
      const record = scene.records.get(slot.elementId), b = record?.bounds
      if (m.elementIds.includes(slot.elementId) || m.elementIds.length >= 12 || !own.has(slot.elementId) || markers.has(slot.elementId) || record?.element.kind !== 'text' || record.disposition !== 'visible' || members.some(r => r.source.slide !== record.source.slide) || !b) continue
      if (b.x < left - .5 || b.y < top - .5 || b.x + b.width > right + .5 || b.y + b.height > bottom + .5) continue
      m.elementIds.push(slot.elementId)
      changes.push({ from: slot.elementId, to: slot.elementId, reason: 'Явно выбранное моделью поле внутри границ блока включено в его состав.' })
    }
  }
  for (const m of reply.molecules) for (const id of m.elementIds) {
    if (!own.has(id) || scene.records.get(id)?.element.kind !== 'text' || rules.has(id) || markers.has(id) || m.textSlots.some(s => s.elementId === id)) continue
    m.textSlots.push({ elementId: id, label: `Текст ${m.textSlots.length + 1}` })
    changes.push({ from: id, to: id, reason: 'Нативный текст внутри выбранного блока сохранён как поле будущего экземпляра.' })
  }
  const roots = new Set(reply.atoms.map(a => a.elementId))
  // The single raster child cannot be extracted separately from this clipping
  // group. Its source bytes and uncertainty are retained in the audit below.
  reply.pending = reply.pending.filter(p => {
    const r = scene.records.get(p.elementId), parent = r?.source.parentId ? scene.records.get(r.source.parentId) : undefined
    if (r?.element.kind !== 'raster' || parent?.element.kind !== 'group' || !parent.element.clipsContent || parent.element.children.length !== 1 || !roots.has(parent.element.id)) return true
    changes.push({ from: p.elementId, to: parent.element.id, reason: `Дочерний растр представлен целым атомом; исходная оговорка: ${p.reason}` }); return false
  })
  // An uncertain assignment is not usable. Retain the model's raw decisions,
  // but let pending dominate in the ledger; the compiler excludes these nodes
  // and every construction containing them. Source-rule text is checked again
  // independently. This never turns a conflict into an accepted component.
  return { ...validateSemanticReply(reply, { ...context, pendingOverridesAssignments: true }), validationVersion: 'web-semantic-validation-4', normalizations: changes }
}

const fullPrompt = semanticPrompt + `
Это часть ПОЛНОГО прохода. sourceGroups может включать прозрачные оболочки текста: используй их реальные части. Отдельная группа только с графикой может быть атомом целиком. Не предлагай одновременно несколько одинаковых молекул с тем же составом. Части соседей можно объединить только если они визуально образуют существующий блок. Название — назначение компонента, а label поля — «Заголовок», «Описание», «Число», а не имя Google Shape. Контейнер одиночного растра и сам растр представляют один ресурс с сохранённой маской: выбери контейнер, не оставляй его единственного ребёнка неопределённым. Не объявляй графику служебной только потому, что она повторяется.`

function clarification(task: StructuredRequest) {
  return { version: 'web-scan-clarification-1', request: (previous: { content: string }, issues: string[]): StructuredRequest => ({ ...task,
    messages: [task.messages[0], { role: 'user', content: [{ type: 'text', text: JSON.stringify({ instruction: 'Верни полный исправленный JSON. Проверь перечисленные ошибки и все исходные ID. Для каждого объекта требуется решение. Если не хватает данных, используй pending (для текстовых правил unresolved) с причиной. Нельзя выдумывать ID, менять исходную геометрию, включать текст в графический атом или целый слайд в молекулу. У текстовых частей молекулы должны быть textSlots, кроме фиксированных маркеров и отдельно указанных правил. Для неверного состава убери всю молекулу, затем дай решения её частям. Это последнее уточнение.', issues, previousResponse: previous.content }) },
      ...task.messages.slice(1).flatMap(message => typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content as Exclude<ModelMessage['content'], string>)] }],
  }) }
}

export async function startSemanticScan(bucket: R2Bucket, uploadId: string, visual: VisualManifest, config: QwenConfig,
  publish: (system: SemanticSystem) => Promise<string>, onProgress?: (completed: number, total: number) => Promise<void>) {
  await assertUploadActive(bucket, uploadId)
  if (!config.apiKey?.trim()) throw new QwenAnalysisError('QWEN_NOT_CONFIGURED', 'Подключение модели пока не настроено.')
  // An 8k-token streamed packet can legitimately exceed three minutes. Keep
  // the previous first-response deadline; only the bounded full reply grows.
  const scanConfig = { ...config, timeoutMs: config.timeoutMs ?? 360_000, connectTimeoutMs: config.connectTimeoutMs ?? 180_000 }
  const system = buildSourceSystem(visual.snapshot), plan = planSemanticScan(visual.snapshot, system)
  const unavailable = new Set(unavailableSourceSlides(visual.snapshot).map(s => s.number))
  if (unavailable.size === visual.snapshot.slides.length) throw new QwenAnalysisError('SEMANTIC_SOURCE_INCOMPLETE', 'Не удалось прочитать ни одного слайда. Исходный файл сохранён; требуется повторить чтение.')
  const rulePlan = planSourceRules({ ...system, texts: system.texts.map(t => ({ ...t, occurrences: t.occurrences.filter(o => !unavailable.has(o.slide)) })).filter(t => t.occurrences.length) })
  const sourceRevision = await contentHash(visual.snapshot), prefix = scanPrefix(uploadId), now = new Date().toISOString()
  const run: ScanRun = { id: crypto.randomUUID(), version: SCAN_VERSION, sourceRevision, status: 'running', startedAt: now, liveRequests: 0, cacheHits: 0,
    omissions: sourceReadOmissions(visual.snapshot),
    parts: [...plan.batches.map(b => ({ id: b.id, kind: 'visual' as const, status: 'waiting' as const })), ...rulePlan.batches.map((_, i) => ({ id: `rules-${i + 1}`, kind: 'rules' as const, status: 'waiting' as const }))] }
  const lockKey = `${prefix}/claim.json`, old = await bucket.get(lockKey)
  if (old && (await old.json<{ expiresAt: number }>()).expiresAt > Date.now()) throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Дизайн-система уже обрабатывается.')
  const acquired = await bucket.put(lockKey, JSON.stringify({ runId: run.id, expiresAt: Date.now() + 900000 }), { ...json, onlyIf: old ? { etagMatches: old.etag } : { etagDoesNotMatch: '*' } })
  if (!acquired) throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Дизайн-система уже обрабатывается.')
  const assertOwner = async () => {
    await assertUploadActive(bucket, uploadId)
    const current = await bucket.get(lockKey)
    if (!current || (await current.json<{ runId: string }>()).runId !== run.id) throw new QwenAnalysisError('QWEN_LEASE_LOST', 'Запуск заменён более новым.')
    return current
  }
  let writing = Promise.resolve()
  const save = () => {
    writing = writing.then(async () => {
      const current = await assertOwner()
      const renewed = await bucket.put(lockKey, JSON.stringify({ runId: run.id, expiresAt: run.status === 'running' ? Date.now() + 900000 : 0 }), { ...json, onlyIf: { etagMatches: current.etag } })
      if (!renewed) throw new QwenAnalysisError('QWEN_LEASE_LOST', 'Запуск заменён более новым.')
      await bucket.put(`${prefix}/runs/${run.id}.json`, JSON.stringify(run), json)
    }); return writing
  }
  await save(); await bucket.put(`${prefix}/current.json`, JSON.stringify({ runId: run.id }), json)
  const execute = async (signal?: AbortSignal) => {
    const output: SemanticSystem = { version: SCAN_VERSION, sourceRevision, sourceId: visual.snapshot.sourceId, batches: [], rules: [], sourcePending: plan.pending,
      rulePending: rulePlan.pending.map(t => t.id), retainedTableIds: plan.retainedTableIds, omittedContainerIds: plan.omittedContainerIds }
    let next = 0, serviceFailures = 0, serviceFailure: QwenAnalysisError | undefined
    const recordFailure = (error: unknown) => {
      if (!(error instanceof QwenAnalysisError)) return
      if (['QWEN_NOT_CONFIGURED', 'QWEN_HTTP_401', 'QWEN_HTTP_402', 'QWEN_HTTP_403', 'QWEN_HTTP_404', 'QWEN_INVALID_SETTINGS', 'QWEN_MODEL_MISMATCH'].includes(error.code)) {
        serviceFailure = error; return
      }
      const activeReplyTimedOut = error.code === 'QWEN_TIMEOUT' && error.diagnostic?.phase === 'response'
      if (providerUnavailable(error) && !activeReplyTimedOut) {
        if (++serviceFailures >= 2) serviceFailure ??= new QwenAnalysisError('SEMANTIC_SERVICE_UNAVAILABLE',
          'Сервис модели не ответил на несколько запросов подряд. Готовые части сохранены; повтор продолжит оставшиеся пакеты.')
      } else if (localRecognitionError(error) || activeReplyTimedOut) serviceFailures = 0
    }
    const worker = async () => {
      while (!serviceFailure && next < run.parts.length) {
        signal?.throwIfAborted()
        const part = run.parts[next++]; part.status = 'running'; await save()
        let started: { run: ModelRun; execute: ((signal?: AbortSignal) => Promise<void>) | null } | undefined
        try {
          if (part.kind === 'visual') {
            const batch = plan.batches.find(b => b.id === part.id)!
            const prepared = await prepareSemanticPilot(bucket, uploadId, visual, undefined, { system, batch, prompt: fullPrompt })
            started = await beginModelRun({ bucket, uploadId, prefix: `${prefix}/parts/${part.id}`, task: prepared.task, config: scanConfig, version: SCAN_VERSION, scope: prepared.scope,
              validate: raw => validateScanReply(raw, prepared.context), clarification: clarification(prepared.task), revalidateRejected: true })
            part.runId = started.run.id; await save(); await started.execute?.(signal)
            output.batches.push({ id: part.id, runId: started.run.id, result: started.run.result as SemanticBatchResult })
          } else {
            const texts = rulePlan.batches[Number(part.id.slice(6)) - 1], task = sourceRuleTask(texts)
            started = await beginModelRun({ bucket, uploadId, prefix: `${prefix}/parts/${part.id}`, task, config: scanConfig, version: RULES_VERSION,
              scope: { sourceRevision, uploadId, textIds: texts.map(t => t.id) }, validate: raw => validateSourceRules(raw, texts), clarification: clarification(task), revalidateRejected: true })
            part.runId = started.run.id; await save(); await started.execute?.(signal)
            output.rules.push(started.run.result as RuleResult)
          }
          part.status = 'complete'
          if (started.run.liveRequests) serviceFailures = 0
        } catch (error) {
          part.status = 'failed'; part.error = error instanceof QwenAnalysisError ? error.message : 'Не удалось разобрать часть презентации.'
          if (error instanceof QwenAnalysisError) part.errorCode = error.code
          signal?.throwIfAborted(); await assertOwner()
          recordFailure(error)
          if (localRecognitionError(error) && started) {
            if (part.kind === 'visual') {
              const batch = plan.batches.find(b => b.id === part.id)!
              const prepared = await prepareSemanticPilot(bucket, uploadId, visual, undefined, { system, batch, prompt: fullPrompt })
              const modelRun = started.run, raw = await rejectedModelResponse(bucket, `${prefix}/parts/${part.id}`, modelRun)
              const result = isolateSemanticReply(raw, prepared.context, validateScanReply)
              output.batches.push({ id: part.id, runId: modelRun.id, result })
              run.omissions = [...run.omissions ?? [], ...result.omissions]
              part.status = result.coverage.unresolved < result.coverage.supplied ? 'partial' : 'skipped'
            } else {
              const texts = rulePlan.batches[Number(part.id.slice(6)) - 1]
              output.rulePending.push(...texts.map(t => t.id))
              run.omissions = [...run.omissions ?? [], { name: 'Правила оформления', elementIds: texts.flatMap(t => t.occurrences.map(o => o.elementId)), slides: [...new Set(texts.flatMap(t => t.occurrences.map(o => o.slide)))], reason: 'Часть правил не удалось подтвердить. Компоненты продолжают создаваться, исходные инструкции сохранены.' }]
              part.status = 'skipped'
            }
          }
        } finally {
          if (started) { part.runId = started.run.id; part.cacheHit = started.run.cacheHit; part.liveRequests = started.run.liveRequests }
          run.liveRequests = run.parts.reduce((sum, p) => sum + (p.liveRequests ?? 0), 0); run.cacheHits = run.parts.filter(p => p.cacheHit).length
          await save(); await onProgress?.(semanticScanProgress(run).completed, run.parts.length)
        }
      }
    }
    try {
      const workers = await Promise.allSettled([worker(), worker()])
      const failedWorker = workers.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failedWorker) throw failedWorker.reason
      signal?.throwIfAborted(); await assertOwner()
      // One bounded second pass for unresolved decisions. It has its own input,
      // cache and audit history; never repeat the successful full scan to fix a
      // handful of objects. The complete source batch prevents context-only IDs
      // or fragments of an existing construction from becoming standalone parts.
      if (run.parts.every(finishedPart)) {
        const pending = output.batches.filter(b => b.result.coverage.unresolved > 0 && !b.result.omissions?.length)
        const refinements = pending.map(b => ({ batch: b, part: { id: `refine-${b.id}`, kind: 'visual' as const, status: 'waiting' as Part['status'] } as Part }))
        run.parts.push(...refinements.map(r => r.part)); await save()
        let refinementIndex = 0
        const refine = async () => {
          while (!serviceFailure && refinementIndex < refinements.length) {
            signal?.throwIfAborted()
            const { batch: previous, part } = refinements[refinementIndex++]
            part.status = 'running'; await save()
            let started: { run: ModelRun; execute: ((signal?: AbortSignal) => Promise<void>) | null } | undefined
            try {
              const batch = plan.batches.find(b => b.id === previous.id)!
              const prepared = await prepareSemanticPilot(bucket, uploadId, visual, undefined, { system, batch, prompt: fullPrompt + `
Это отдельный адресный проход по оставшимся неопределённым объектам. Ниже дан предыдущий проверенный результат. Верни ПОЛНЫЙ результат пакета с решениями для всех requiredNodeIds. Уже определённые объекты не переводить в pending. Уточни pending по реальной сцене и превью. Повтор карточки — отдельное появление, а не основание удалить её или оставить неопределённой: сохраняй её реальные ID и варианты. Фигура без текста может быть атомом shape/decoration. Графика не является content. Если графический атом включает несколько масок и растров, все потомки представлены целым атомом; сохрани его реальные ресурсы. Если доказательств нет, сохрани pending с конкретной причиной. Не придумывай состав, оформление или новые ID.` })
              const task: StructuredRequest = { ...prepared.task, messages: [...prepared.task.messages, { role: 'user', content: JSON.stringify({ previousValidatedResult: previous.result.reply, unresolved: previous.result.ledger.filter(d => d.role === 'unresolved') }) }] }
              const resolved = new Set(previous.result.ledger.filter(d => d.role !== 'unresolved').map(d => d.elementId))
              started = await beginModelRun({ bucket, uploadId, prefix: `${prefix}/parts/${part.id}`, task, config: scanConfig, version: 'web-semantic-refinement-1',
                scope: { ...prepared.scope, phase: 'unresolved-refinement', previousResultHash: await contentHash(previous.result.reply) },
                validate: raw => {
                  const result = validateScanReply(raw, prepared.context)
                  const lost = result.ledger.filter(d => resolved.has(d.elementId) && d.role === 'unresolved')
                  if (lost.length) throw new SemanticValidationError(lost.map(d => `refinement-lost-previously-resolved-object:${d.elementId}`))
                  return result
                }, clarification: clarification(task), revalidateRejected: true })
              part.runId = started.run.id; await save(); await started.execute?.(signal)
              previous.refinedFromRunId = previous.runId; previous.runId = started.run.id; previous.result = started.run.result as SemanticBatchResult
              part.status = 'complete'
              if (started.run.liveRequests) serviceFailures = 0
            } catch (error) {
              signal?.throwIfAborted(); await assertOwner()
              part.status = 'failed'; part.error = error instanceof QwenAnalysisError ? error.message : 'Не удалось уточнить объекты.'
              if (error instanceof QwenAnalysisError) part.errorCode = error.code
              recordFailure(error)
              if (localRecognitionError(error)) {
                // The earlier validated packet remains authoritative when an
                // optional refinement fails. Its unresolved objects stay out.
                const elementIds = previous.result.ledger.filter(d => d.role === 'unresolved').map(d => d.elementId)
                run.omissions = [...run.omissions ?? [], { name: 'Неуточнённые объекты', elementIds, slides: [...new Set(previous.result.ledger.filter(d => elementIds.includes(d.elementId)).map(d => d.slide))], reason: 'Уточнение не прошло проверку. Ранее подтверждённые компоненты сохранены.' }]
                part.status = 'skipped'
              }
            }
            finally {
              if (started) { part.runId = started.run.id; part.cacheHit = started.run.cacheHit; part.liveRequests = started.run.liveRequests }
              run.liveRequests = run.parts.reduce((sum, p) => sum + (p.liveRequests ?? 0), 0); run.cacheHits = run.parts.filter(p => p.cacheHit).length
              await save(); await onProgress?.(semanticScanProgress(run).completed, run.parts.length)
            }
          }
        }
        const results = await Promise.allSettled([refine(), refine()])
        const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
        if (failed) throw failed.reason
      }
      signal?.throwIfAborted(); await assertOwner()
      output.batches.sort((a, b) => plan.batches.findIndex(p => p.id === a.id) - plan.batches.findIndex(p => p.id === b.id))
      output.rules.sort((a, b) => (a.rules[0]?.textId ?? '').localeCompare(b.rules[0]?.textId ?? ''))
      run.resultKey = `${prefix}/results/${run.id}.json`
      await bucket.put(run.resultKey, JSON.stringify({ ...output, model: modelIdentity(config), parts: run.parts }), json)
      if (serviceFailure) throw serviceFailure
      if (run.parts.some(p => !finishedPart(p))) throw new QwenAnalysisError('SEMANTIC_PARTS_FAILED', 'Часть презентации ещё не разобрана. Готовые результаты сохранены; повтор продолжит с них.')
      run.catalogId = await publish(output)
      run.status = 'complete'
    } catch (error) {
      run.status = 'failed'; run.error = error instanceof QwenAnalysisError ? error.message : 'Разбор прерван. Готовые части и исходный стиль сохранены.'
      if (error instanceof QwenAnalysisError) run.errorCode = error.code
      throw error
    } finally { run.finishedAt = new Date().toISOString(); await save() }
  }
  return { run, execute }
}
