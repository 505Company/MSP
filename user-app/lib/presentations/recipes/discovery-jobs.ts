import { z } from 'zod'
import { contentHash } from '../../design-system/catalog'
import type { VisualManifest } from '../../digital-designer/visual-package'
import { assertUploadActive, uploadIsCancelled } from '../../uploads/cancellation-server'
import { QwenAnalysisError } from '../../uploads/qwen-analysis'
import { readRecipeBundle, readRecipeRegistry } from './library'
import { templateCandidates } from './template-contract'

export const DISCOVERY_VERSION = 'recipe-discovery-1'
export const DISCOVERY_REQUEST_LIMIT = 24
export const DISCOVERY_LEASE_MS = 45_000
export const discoveryJson = { httpMetadata: { contentType: 'application/json' } }
const queue = 'recipe-discovery-jobs/'
export const discoveryRoot = (uploadId: string, jobId: string) => `recipe-discovery/${uploadId}/${jobId}`
export type DiscoveryResult = { technical: 'passed' | 'failed' | 'unsupported'; reason: string; recipeId?: string; version?: string; slideId?: string }
export type DiscoveryJob = {
  id: string; uploadId: string; version: string; sourceHash: string; candidateSlideIds: string[]
  status: 'queued' | 'running' | 'retrying' | 'blocked' | 'complete' | 'cancelled'
  createdAt: number; updatedAt: number; attempts: number; retryAt?: number; error?: string; errorCode?: string
  owner?: string; leaseToken?: string; leaseUntil?: number
  budget: { used: number; limit: number; requests: { operation: string; at: number }[] }
  progress: { step: 'analysis'; detail: string; completed: number; total: number }
  result?: DiscoveryResult
}
export const discoveryRequestSchema = z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(32).default(DISCOVERY_REQUEST_LIMIT) }).strict()
const fail = (code: string, message: string): never => { throw new QwenAnalysisError(code, message) }
const active = (job: DiscoveryJob) => ['queued', 'running', 'retrying', 'blocked'].includes(job.status)
export function publicDiscoveryJob(job: DiscoveryJob) {
  const { owner, leaseToken, leaseUntil, budget, ...view } = job
  void owner; void leaseToken; void leaseUntil
  return { ...view, budget: { used: budget.used, limit: budget.limit } }
}
export async function readDiscoveryJobs(bucket: R2Bucket, uploadId: string): Promise<DiscoveryJob[]> {
  const file = await bucket.get(`${queue}${uploadId}.json`)
  const jobs = file ? await file.json<DiscoveryJob[]>() : []
  return await uploadIsCancelled(bucket, uploadId) ? jobs.map(j => active(j) ? { ...j, status: 'cancelled' } : j) : jobs
}
export async function changeDiscoveryJob(bucket: R2Bucket, uploadId: string, id: string, change: (job: DiscoveryJob) => DiscoveryJob) {
  const jobs = await mutate(bucket, uploadId, jobs => jobs.map(job => job.id === id ? change(job) : job))
  return jobs.find(job => job.id === id) ?? fail('RECIPE_JOB_MISSING', 'Задание рецептов не найдено.')
}
async function mutate(bucket: R2Bucket, uploadId: string, change: (jobs: DiscoveryJob[]) => DiscoveryJob[]) {
  const key = `${queue}${uploadId}.json`
  for (let attempt = 0; attempt < 8; attempt++) {
    await assertUploadActive(bucket, uploadId)
    const file = await bucket.get(key), jobs = file ? await file.json<DiscoveryJob[]>() : []
    const next = change(jobs)
    if (await bucket.put(key, JSON.stringify(next), { ...discoveryJson, onlyIf: file ? { etagMatches: file.etag } : { etagDoesNotMatch: '*' } })) return next
  }
  return fail('QWEN_ALREADY_RUNNING', 'Состояние рецептов обновляется. Повторите запрос.')
}
export async function discoverySource(bucket: R2Bucket, uploadId: string) {
  await assertUploadActive(bucket, uploadId)
  const visual = await (await bucket.get(`visual/${uploadId}/manifest.json`))?.json<VisualManifest>()
  if (!visual) return fail('RECIPE_SOURCE_MISSING', 'Сначала требуется импортировать исходный шаблон.')
  return { visual, sourceHash: await contentHash(visual.snapshot) }
}
export async function enqueueDiscoveryJob(bucket: R2Bucket, uploadId: string, raw: unknown, now = Date.now()) {
  const request = discoveryRequestSchema.parse(raw), old = (await readDiscoveryJobs(bucket, uploadId)).find(j => j.id === request.id)
  await assertUploadActive(bucket, uploadId)
  if (old) {
    if (old.budget.limit !== request.limit) fail('RECIPE_JOB_CONFLICT', 'Нельзя менять бюджет сохранённого задания.')
    return old
  }
  const { visual, sourceHash } = await discoverySource(bucket, uploadId), excluded = new Set<string>()
  for (const entry of (await readRecipeRegistry(bucket, uploadId)).entries) {
    const bundle = await readRecipeBundle(bucket, uploadId, entry)
    if (bundle?.recipe.sourceSnapshotHash === sourceHash) for (const id of bundle.recipe.passport.origin.slideIds) excluded.add(id)
  }
  for (const previous of await readDiscoveryJobs(bucket, uploadId)) if (previous.version === DISCOVERY_VERSION && previous.sourceHash === sourceHash && previous.status === 'complete') {
    if (previous.result?.slideId) excluded.add(previous.result.slideId)
    else if (previous.result?.technical === 'unsupported') previous.candidateSlideIds.forEach(id => excluded.add(id))
  }
  const candidateSlideIds = templateCandidates(visual.snapshot, { excludeSlideIds: [...excluded], limit: 5 }).map(c => c.slide.id)
  const job: DiscoveryJob = { id: request.id, uploadId, version: DISCOVERY_VERSION, sourceHash, candidateSlideIds,
    status: 'queued', createdAt: now, updatedAt: now, attempts: 0,
    budget: { used: 0, limit: request.limit, requests: [] },
    progress: { step: 'analysis', detail: 'Пополнение рецептов ожидает обработчика.', completed: 0, total: 4 } }
  // The upload's one CAS record owns both the queue and its spend ledger. A
  // lost HTTP reply, a second tab or a process restart cannot create a refill.
  await bucket.put(`${discoveryRoot(uploadId, job.id)}/source.json`, JSON.stringify(visual), { ...discoveryJson, onlyIf: { etagDoesNotMatch: '*' } })
  const pinned = await (await bucket.get(`${discoveryRoot(uploadId, job.id)}/source.json`))!.json<VisualManifest>()
  if (await contentHash(pinned) !== await contentHash(visual)) fail('RECIPE_SOURCE_CHANGED', 'Источник изменился во время создания задания.')
  const jobs = await mutate(bucket, uploadId, jobs => {
    const same = jobs.find(j => j.id === job.id)
    if (same) {
      if (same.budget.limit !== request.limit) fail('RECIPE_JOB_CONFLICT', 'Нельзя менять бюджет сохранённого задания.')
      return jobs
    }
    if (jobs.some(active)) fail('RECIPE_JOB_ACTIVE', 'Сначала завершите или остановите текущее пополнение рецептов.')
    if (jobs.length >= 100) fail('RECIPE_JOB_HISTORY_FULL', 'Достигнут предел истории заданий этой дизайн-системы.')
    return [job, ...jobs]
  })
  return jobs.find(j => j.id === job.id)!
}
export function assertDiscoveryLease(job: DiscoveryJob, token: string, now = Date.now()) {
  if (job.status !== 'running' || job.leaseToken !== token || (job.leaseUntil ?? 0) <= now) fail('RECIPE_JOB_LEASE_LOST', 'Утрачено владение пополнением рецептов.')
}
export async function ownedDiscoveryJob(bucket: R2Bucket, uploadId: string, id: string, token: string) {
  const job = (await readDiscoveryJobs(bucket, uploadId)).find(j => j.id === id)
  if (!job) return fail('RECIPE_JOB_MISSING', 'Задание рецептов не найдено.')
  assertDiscoveryLease(job, token)
  if (job.version !== DISCOVERY_VERSION) fail('RECIPE_JOB_VERSION_CHANGED', 'Обработчик обновлён. Прежние результаты и бюджет сохранены.')
  if ((await discoverySource(bucket, uploadId)).sourceHash !== job.sourceHash) fail('RECIPE_SOURCE_CHANGED', 'Источник изменился. Прежнее задание не может продолжаться.')
  return job
}
export async function reserveDiscoveryRequest(bucket: R2Bucket, job: DiscoveryJob, token: string, operation: string) {
  await ownedDiscoveryJob(bucket, job.uploadId, job.id, token)
  return changeDiscoveryJob(bucket, job.uploadId, job.id, current => {
    assertDiscoveryLease(current, token)
    if (current.budget.used >= current.budget.limit) fail('RECIPE_BUDGET_EXHAUSTED', 'Предел запросов задания достигнут. Все результаты сохранены.')
    return { ...current, budget: { ...current.budget, used: current.budget.used + 1, requests: [...current.budget.requests, { operation, at: Date.now() }] } }
  })
}
export async function commandDiscoveryJob(bucket: R2Bucket, uploadId: string, id: string, action: 'cancel' | 'resume') {
  const sourceHash = action === 'resume' ? (await discoverySource(bucket, uploadId)).sourceHash : null
  return changeDiscoveryJob(bucket, uploadId, id, job => {
    if (action === 'cancel') return active(job) ? { ...job, status: 'cancelled', leaseToken: undefined, leaseUntil: undefined, owner: undefined, updatedAt: Date.now() } : job
    if (job.status !== 'blocked') return job
    if (job.sourceHash !== sourceHash || job.version !== DISCOVERY_VERSION) return fail('RECIPE_SOURCE_CHANGED', 'Продолжение относится к прежнему источнику или обработчику.')
    if (job.budget.used >= job.budget.limit) return fail('RECIPE_BUDGET_EXHAUSTED', 'Бюджет задания исчерпан; продолжение не добавляет запросы.')
    return { ...job, status: 'queued', attempts: 0, retryAt: undefined, error: undefined, errorCode: undefined, updatedAt: Date.now() }
  })
}
export async function claimDiscoveryJob(bucket: R2Bucket, owner: string, now = Date.now()) {
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: queue, ...(cursor ? { cursor } : {}) })
    for (const entry of page.objects) {
      const uploadId = entry.key.slice(queue.length, -5)
      if (await uploadIsCancelled(bucket, uploadId)) continue
      const candidate = (await readDiscoveryJobs(bucket, uploadId)).find(j => ['queued', 'running', 'retrying'].includes(j.status) && (j.retryAt ?? 0) <= now && !(j.status === 'running' && (j.leaseUntil ?? 0) > now))
      if (!candidate) continue
      const source = await discoverySource(bucket, uploadId).catch(() => null), token = crypto.randomUUID()
      const job = await changeDiscoveryJob(bucket, uploadId, candidate.id, current => {
        if (!['queued', 'running', 'retrying'].includes(current.status) || (current.retryAt ?? 0) > now || current.status === 'running' && (current.leaseUntil ?? 0) > now) return current
        if (source?.sourceHash !== current.sourceHash || current.version !== DISCOVERY_VERSION) return { ...current, status: 'blocked', error: 'Источник или обработчик изменился. Результаты сохранены.', updatedAt: now }
        const attempts = current.attempts + Number(current.status === 'running')
        if (attempts > 2) return { ...current, status: 'blocked', error: 'Обработчик несколько раз прервался. Проверенные этапы сохранены.', updatedAt: now }
        return { ...current, attempts, status: 'running', owner, leaseToken: token, leaseUntil: now + DISCOVERY_LEASE_MS, retryAt: undefined, error: undefined, errorCode: undefined, updatedAt: now }
      })
      if (job.leaseToken === token) return job
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return null
}
export async function updateDiscoveryJob(bucket: R2Bucket, uploadId: string, token: string, update: { complete?: boolean; error?: string; errorCode?: string; retryable?: boolean }, now = Date.now()) {
  const current = (await readDiscoveryJobs(bucket, uploadId)).find(j => j.leaseToken === token)
  if (!current) return fail('RECIPE_JOB_LEASE_LOST', 'Утрачено владение пополнением рецептов.')
  return changeDiscoveryJob(bucket, uploadId, current.id, job => {
    assertDiscoveryLease(job, token, now)
    const next: DiscoveryJob = { ...job, leaseUntil: now + DISCOVERY_LEASE_MS, updatedAt: now }
    if (update.complete) {
      if (!job.result) fail('RECIPE_JOB_INCOMPLETE', 'Проверка рецепта ещё не завершена.')
      next.status = 'complete'
    }
    if (update.error) {
      next.attempts++; next.error = update.error.slice(0, 700); next.errorCode = update.errorCode
      next.status = update.retryable && next.attempts <= 2 && next.budget.used < next.budget.limit ? 'retrying' : 'blocked'
      next.retryAt = next.status === 'retrying' ? now + (next.attempts === 1 ? 15000 : 45000) : undefined
    }
    if (next.status !== 'running') { delete next.owner; delete next.leaseToken; delete next.leaseUntil }
    return next
  })
}
