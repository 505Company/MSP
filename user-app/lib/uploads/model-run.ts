import { contentHash } from '../design-system/catalog'
import { SemanticValidationError } from '../design-system/semantic-contract'
import { QwenAnalysisError, type QwenConfig } from './qwen-analysis'
import { modelIdentity, parseModelJson, QWEN_TRANSPORT_VERSION, requestStructured, structuredGeneration, type StructuredRequest } from './qwen-structured'
import { assertUploadActive, withUploadCancellation } from './cancellation-server'
import {acceptsProvider,providerChain,providerUnavailable} from './provider-failover'

type Reply = Awaited<ReturnType<typeof requestStructured>>
type Cache = { inputHash: string; sourceRunId: string; reply: Reply }
export type ModelRun<T = unknown> = {
  id: string; inputHash: string; status: 'running' | 'complete' | 'failed'
  startedAt: string; finishedAt: string | null; cacheHit: boolean; liveRequests: number
  scope: Record<string, unknown>; model: ReturnType<typeof modelIdentity>
  result?: T; provenance?: Omit<Reply, 'content'>; sourceRunId?: string
  error?: { code: string; message: string; issues?: string[]; diagnostic?: QwenAnalysisError['diagnostic'] }
  automaticTransportRetries: 0; clarificationRequests: number; resumedFromRunId?: string
  recoveryRequestedAt?: number
  attempts: { kind: 'initial' | 'clarification'; reused: boolean; provenance: Omit<Reply, 'content'> }[]
  providerAttempts?:{kind:'initial'|'clarification';identity:ReturnType<typeof modelIdentity>;status:'failed'|'complete';liveRequest:boolean;elapsedMs:number;error?:{code:string;message:string};responseKey?:string}[]
}
const json = { httpMetadata: { contentType: 'application/json' } }
type Claim = { runId: string; expiresAt: number }
export const MODEL_LEASE_MS = 45_000
const MODEL_HEARTBEAT_MS = 15_000
function provenance(reply: Reply): Omit<Reply, 'content'> {
  const { requestId, generationId, reportedModel, finishReason, usage, identity, elapsedMs, responseFormat, reasoning, endpoint, routingReceipt, observation } = reply
  return { requestId, reportedModel, finishReason, usage, identity, elapsedMs, responseFormat, ...(reasoning ? { reasoning } : {}),
    ...(generationId ? { generationId } : {}), ...(observation ? { observation } : {}), ...(endpoint ? { endpoint } : {}), ...(routingReceipt ? { routingReceipt } : {}) }
}
const runKey = (prefix: string, id: string) => `${prefix}/runs/${id}.json`
export async function readModelRun(bucket: R2Bucket, prefix: string, id?: string) {
  if (!id) {
    const pointer = await bucket.get(`${prefix}/current.json`)
    if (!pointer) return null
    id = (await pointer.json<{ runId: string }>()).runId
  }
  const file = await bucket.get(runKey(prefix, id))
  return file ? file.json<ModelRun>() : null
}

/** Durable single-package job. A conditional lease prevents duplicate paid
 * requests; immutable inputs/responses and a revalidated exact cache survive a
 * restart. A disconnected HTTP caller aborts work; this is not a full job queue. */
export async function beginModelRun<T>(options: {
  bucket: R2Bucket; prefix: string; task: StructuredRequest; config: QwenConfig
  version: string; scope: Record<string, unknown>; validate: (raw: unknown) => T
  clarification?: { version: string; request: (reply: Reply, issues: string[]) => StructuredRequest }
  revalidateRejected?: boolean
  uploadId?: string
  beforeRequest?: () => Promise<void>
}) {
  const { bucket, prefix, task, config, scope, validate } = options
  // Explicit import ownership, not a source referenced in scope: saved
  // projects may still use a removed style. Never alter the model cache key.
  const uploadId = options.uploadId
  if (uploadId) await assertUploadActive(bucket, uploadId)
  const routes=providerChain(config)
  if (!routes.some(c=>c.apiKey?.trim())) throw new QwenAnalysisError('QWEN_NOT_CONFIGURED', 'Требуется настроить подключение модели на сервере.')
  const model = modelIdentity(config)
  const generation = structuredGeneration(task, config)
  const input = { version: options.version, transport: QWEN_TRANSPORT_VERSION, model, scope,
    ...(config.fallbacks?.length?{providerPolicy:{version:1,routes:routes.map(route=>({identity:modelIdentity(route),generation:structuredGeneration(task,route)}))}}:{}),
    temperature: generation.temperature, thinking: task.thinking ?? false,
    ...(task.sampling || task.reasoningEffort || config.routerai ? { generation } : {}), responseFormat: 'json_schema', task }
  const inputHash = await contentHash(input)
  const cacheId = options.clarification ? await contentHash({ inputHash, clarification: options.clarification.version }) : inputHash
  const cacheKey = `${prefix}/cache/${cacheId}.json`
  const cachedFile = await bucket.get(cacheKey), now = new Date().toISOString()
  // An explicit queue restart may request a new answer for a failed package.
  // Successful caches and all immutable provider replies remain untouched.
  const processing = uploadId ? await bucket.get(`processing-jobs/${uploadId}.json`) : null
  const recoveryRequestedAt = processing ? (await processing.json<{recoveryRequestedAt?:number}>()).recoveryRequestedAt : undefined
  const run: ModelRun<T> = { id: crypto.randomUUID(), inputHash, status: 'running', startedAt: now,
    finishedAt: null, cacheHit: false, liveRequests: 0, scope, model, automaticTransportRetries: 0, clarificationRequests: 0, attempts: [], recoveryRequestedAt }
  const save = () => bucket.put(runKey(prefix, run.id), JSON.stringify(run), json)
  const point = () => bucket.put(`${prefix}/current.json`, JSON.stringify({ runId: run.id }), json)
  const reuse = async (cached: Cache) => {
    if (cached.inputHash !== inputHash || !acceptsProvider(cached.reply.identity,routes)) throw new QwenAnalysisError('QWEN_CACHE_INVALID', 'Сохранённый ответ не соответствует текущим данным.')
    // A prior success is never trusted without current contract/reference checks.
    run.result = validate(parseModelJson(cached.reply.content))
    Object.assign(run, { status: 'complete', finishedAt: new Date().toISOString(), cacheHit: true, sourceRunId: cached.sourceRunId, provenance: provenance(cached.reply) })
    await save(); await point()
  }
  if (cachedFile) {
    await reuse(await cachedFile.json<Cache>())
    return { run, execute: null }
  }
  const claimKey = `${prefix}/claims/${inputHash}.json`, previous = await bucket.get(claimKey)
  const old = previous ? await previous.json<Claim>() : null
  if (old && old.expiresAt > Date.now()) {
    const active = await readModelRun(bucket, prefix, old.runId)
    if (!active || active.status === 'running') throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Этот пакет уже обрабатывается.')
  }
  // A process loss must not reserve a package for both full model timeouts.
  // The live executor renews a short lease while the model is responding.
  const claim: Claim = { runId: run.id, expiresAt: Date.now() + MODEL_LEASE_MS }
  const acquired = await bucket.put(claimKey, JSON.stringify(claim), { ...json, onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: '*' } })
  if (!acquired) throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Этот пакет уже обрабатывается.')
  let resumable: Reply | null = null
  let resumedClarification = false
  if (old && options.clarification) {
    const failed = await readModelRun(bucket, prefix, old.runId)
    const freshRecovery = (recoveryRequestedAt ?? 0) > (failed?.recoveryRequestedAt ?? 0)
    if ((!freshRecovery || options.revalidateRejected) && failed?.inputHash === inputHash && failed.status === 'failed' && failed.error?.code === 'SEMANTIC_VALIDATION' && (!failed.clarificationRequests || options.revalidateRejected)) {
      const file = await bucket.get(failed.clarificationRequests ? `${prefix}/clarifications/${failed.id}/response.json` : `${prefix}/responses/${failed.id}.json`)
      if (file) {
        const saved = await file.json<Reply>()
        if (acceptsProvider(saved.identity,routes)) {
          let reuseSaved = !freshRecovery
          if (freshRecovery) {
            // A corrected validator may now accept the immutable answer. An
            // explicit restart needs a paid replacement only if it still fails.
            try { validate(parseModelJson(saved.content)); reuseSaved = true }
            catch { /* Preserve the user's explicit retry for an invalid answer. */ }
          }
          if (reuseSaved) { resumable = saved; run.resumedFromRunId = failed.id; resumedClarification = Boolean(failed.clarificationRequests) }
        }
      }
    }
  }
  if (old && old.expiresAt <= Date.now()) {
    const interrupted = await readModelRun(bucket, prefix, old.runId)
    if (interrupted?.status === 'running') {
      Object.assign(interrupted, { status: 'failed', finishedAt: now, error: { code: 'QWEN_INTERRUPTED', message: 'Предыдущий запуск прервался. Исходные данные сохранены.' } })
      await bucket.put(runKey(prefix, old.runId), JSON.stringify(interrupted), json)
    }
  }
  await save(); await point()
  await bucket.put(`${prefix}/inputs/${inputHash}.json`, JSON.stringify(input), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  const assertClaim = async () => {
    const file = await bucket.get(claimKey), current = file ? await file.json<Claim>() : null
    if (!file || current?.runId !== run.id || current.expiresAt <= Date.now()) throw new QwenAnalysisError('QWEN_LEASE_LOST', 'Запуск устарел. Продолжим с сохранённого этапа.')
    return file
  }
  const request = async (requested: StructuredRequest, kind: 'initial' | 'clarification', signal?: AbortSignal) => {
   for(const [routeIndex,route] of routes.entries()){
    const started = Date.now()
    let sent=false
    const identity=modelIdentity(route),attemptKey=`${prefix}/provider-attempts/${run.id}/${kind}-${routeIndex+1}`
    try { const reply=await requestStructured(requested, route, signal, async () => {
      signal?.throwIfAborted(); if (uploadId) await assertUploadActive(bucket, uploadId)
      await assertClaim()
      await options.beforeRequest?.(); run.liveRequests++
      sent=true
      if (kind === 'clarification') run.clarificationRequests = 1
      await save()
    })
      if(config.fallbacks?.length){(run.providerAttempts??=[]).push({kind,identity,status:'complete',liveRequest:sent,elapsedMs:Date.now()-started});await save()}
      return reply
    }
    catch (error) {
      if (error instanceof QwenAnalysisError && error.partialResponse) {
        // Preserve the provider's unfinished answer, but never validate or cache it.
        const reply: Reply = { ...error.partialResponse, identity, elapsedMs: Date.now() - started, responseFormat: 'json_schema' }
        const key = kind === 'initial' ? `${prefix}/responses/${run.id}.json` : `${prefix}/clarifications/${run.id}/response.json`
        await bucket.put(key, JSON.stringify(reply), json)
        if(config.fallbacks?.length)await bucket.put(`${attemptKey}/response.json`,JSON.stringify(reply),json)
        run.attempts.push({ kind, reused: false, provenance: provenance(reply) })
      }
      if(config.fallbacks?.length){
        const failure={code:error instanceof QwenAnalysisError?error.code:'QWEN_RUN_FAILED',message:error instanceof QwenAnalysisError?error.message:'Запрос не завершён.'}
        ;(run.providerAttempts??=[]).push({kind,identity,status:'failed',liveRequest:sent,elapsedMs:Date.now()-started,error:failure,...error instanceof QwenAnalysisError&&error.partialResponse?{responseKey:`${attemptKey}/response.json`}:{}})
        await bucket.put(`${attemptKey}/failure.json`,JSON.stringify({identity,error:failure}),json);await save()
      }
      if(routeIndex<routes.length-1&&!signal?.aborted&&providerUnavailable(error))continue
      throw error
    }
   }
   throw new QwenAnalysisError('QWEN_NOT_CONFIGURED','Нет доступного подключения модели.')
  }
  const execute = async (callerSignal?: AbortSignal) => {
    const leaseAbort = new AbortController(), signal = callerSignal ? AbortSignal.any([callerSignal, leaseAbort.signal]) : leaseAbort.signal
    let timer: ReturnType<typeof setInterval> | undefined, renewing: Promise<void> | undefined
    const renew = async () => {
      const file = await assertClaim()
      const updated = await bucket.put(claimKey, JSON.stringify({ runId: run.id, expiresAt: Date.now() + MODEL_LEASE_MS }), { ...json, onlyIf: { etagMatches: file.etag } })
      if (!updated) throw new QwenAnalysisError('QWEN_LEASE_LOST', 'Утрачено владение запросом. Продолжим с сохранённого этапа.')
    }
    try {
      signal?.throwIfAborted()
      await renew()
      timer = setInterval(() => {
        if (renewing) return
        renewing = renew().catch(() => {
          leaseAbort.abort(new QwenAnalysisError('QWEN_LEASE_LOST', 'Утрачено владение запросом. Продолжим с сохранённого этапа.'))
        }).finally(() => { renewing = undefined })
      }, MODEL_HEARTBEAT_MS)
      // A prior worker may have committed between the first cache read and
      // lease acquisition. Check again before issuing a paid request.
      const raced = await bucket.get(cacheKey)
      if (raced) { await reuse(await raced.json<Cache>()); return }
      let reply: Reply
      if (resumable) reply = resumable
      else { reply = await request(task, 'initial', signal) }
      signal?.throwIfAborted()
      run.attempts.push({ kind: resumedClarification ? 'clarification' : 'initial', reused: Boolean(resumable), provenance: provenance(reply) })
      if (resumedClarification) {
        run.clarificationRequests = 1
        await bucket.put(`${prefix}/clarifications/${run.id}/response.json`, JSON.stringify(reply), json)
      }
      await bucket.put(`${prefix}/responses/${run.id}.json`, JSON.stringify(reply), json)
      await save()
      let result: T
      try { result = validate(parseModelJson(reply.content)) }
      catch (error) {
        if (!(error instanceof SemanticValidationError) || !options.clarification || resumedClarification) throw error
        const clarificationTask = options.clarification.request(reply, error.issues)
        await bucket.put(`${prefix}/clarifications/${run.id}/input.json`, JSON.stringify({ version: options.clarification.version, basedOnRequestId: reply.requestId, issues: error.issues, task: clarificationTask }), json)
        signal?.throwIfAborted(); if(uploadId)await assertUploadActive(bucket,uploadId)
        reply = await request(clarificationTask, 'clarification', signal)
        run.attempts.push({ kind: 'clarification', reused: false, provenance: provenance(reply) })
        await bucket.put(`${prefix}/clarifications/${run.id}/response.json`, JSON.stringify(reply), json)
        await save()
        result = validate(parseModelJson(reply.content))
      }
      signal.throwIfAborted()
      await assertClaim()
      await bucket.put(cacheKey, JSON.stringify({ inputHash, sourceRunId: run.id, reply } satisfies Cache), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
      Object.assign(run, { status: 'complete', result, provenance: provenance(reply), finishedAt: new Date().toISOString() })
      await save()
    } catch (error) {
      const failure = leaseAbort.signal.aborted ? leaseAbort.signal.reason : error
      const known = failure instanceof QwenAnalysisError
      Object.assign(run, { status: 'failed', finishedAt: new Date().toISOString(), error: {
        code: callerSignal?.aborted ? 'QWEN_CANCELLED' : known ? failure.code : 'QWEN_RUN_FAILED',
        message: known ? failure.message : 'Анализ не завершён. Исходная дизайн-система сохранена.',
        ...(failure instanceof SemanticValidationError ? { issues: failure.issues } : {}),
        ...(known && failure.diagnostic ? { diagnostic: failure.diagnostic } : {}),
      } })
      await save()
      throw failure
    } finally {
      clearInterval(timer)
      await renewing
    }
  }
  return { run, execute: uploadId ? (signal?: AbortSignal) => withUploadCancellation(bucket, uploadId, signal, execute) : execute }
}
