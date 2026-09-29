import { getProject } from '../workspace/storage'
import type { LayoutContext } from './layout-context'
import { LAYOUT_RENDER_VERSION } from './layout-contract'
import { pinPreparedContext } from './prepared-component-storage'

const prefix = 'presentation-jobs/', json = { httpMetadata: { contentType: 'application/json' } }
export const LAYOUT_JOB_LEASE_MS = 45_000
export type LayoutJob = {
  id: string; inputId: string; sourceRevision: string; renderVersion: string; status: 'queued' | 'running' | 'retrying' | 'complete' | 'blocked' | 'cancelled'
  attempts: number; updatedAt: number; retry?: boolean; retryAt?: number; error?: string; owner?: string; leaseToken?: string; leaseUntil?: number
  progress: { step: 'analysis'; detail: string; completed?: number; total?: number }
  slides?: { id: string; title: string }[]
}
export function publicLayoutJob(job: LayoutJob | null) {
  if (!job) return null
  const { owner, leaseToken, leaseUntil, ...result } = job
  void owner; void leaseToken; void leaseUntil
  return result
}
export async function readLayoutJob(bucket: R2Bucket, id: string) {
  const file = await bucket.get(`${prefix}${id}.json`)
  return file ? file.json<LayoutJob>() : null
}
export async function cancelLayoutJob(bucket:R2Bucket,id:string){
  return change(bucket,id,job=>{
    if(!job||['complete','cancelled'].includes(job.status))return job
    const next:LayoutJob={...job,status:'cancelled',updatedAt:Date.now(),progress:{...job.progress,detail:'Генерация остановлена.'}}
    delete next.owner;delete next.leaseToken;delete next.leaseUntil;delete next.retry;delete next.retryAt;delete next.error
    return next
  })
}
async function change(bucket: R2Bucket, id: string, update: (job: LayoutJob | null) => LayoutJob | null) {
  const key = `${prefix}${id}.json`
  for (let attempt = 0; attempt < 8; attempt++) {
    const file = await bucket.get(key), job = file ? await file.json<LayoutJob>() : null, next = update(job)
    if (!next) return null
    if (await bucket.put(key, JSON.stringify(next), { ...json, onlyIf: file ? { etagMatches: file.etag } : { etagDoesNotMatch: '*' } })) return next
  }
  throw Error('Состояние генерации изменилось; повторите запрос.')
}
export async function enqueueLayoutJob(bucket: R2Bucket, context: LayoutContext, retry = false, now = Date.now()) {
  await pinPreparedContext(bucket, context)
  return change(bucket, context.projectId, previous => {
    if (previous?.inputId === context.inputId && previous.sourceRevision === context.sourceRevision && previous.renderVersion === LAYOUT_RENDER_VERSION && previous.status !== 'cancelled' && !(retry && previous.status === 'blocked')) return previous
    return { id: context.projectId, inputId: context.inputId, sourceRevision: context.sourceRevision, renderVersion: LAYOUT_RENDER_VERSION, status: 'queued', attempts: 0, updatedAt: now,
      retry, slides: context.inputs.map(input => ({ id: input.slideId, title: input.title })),
      progress: { step: 'analysis', detail: 'Генерация ожидает свободного обработчика.', completed: 0, total: context.inputs.length } }
  })
}
export async function claimLayoutJob(bucket: R2Bucket, owner: string, now = Date.now()) {
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) })
    for (const entry of page.objects) {
      const candidate = await (await bucket.get(entry.key))?.json<LayoutJob>()
      if (!candidate || !['queued', 'running', 'retrying'].includes(candidate.status) || (candidate.retryAt ?? 0) > now || candidate.status === 'running' && (candidate.leaseUntil ?? 0) > now) continue
      const project = await getProject(bucket, candidate.id), leaseToken = crypto.randomUUID()
      const job = await change(bucket, candidate.id, previous => {
        if (!previous || previous.inputId !== candidate.inputId || !['queued', 'running', 'retrying'].includes(previous.status) || (previous.retryAt ?? 0) > now || previous.status === 'running' && (previous.leaseUntil ?? 0) > now) return previous
        if (!project || project.archivedAt || project.revision !== previous.sourceRevision) return { ...previous, status: 'cancelled', updatedAt: now }
        const attempts = previous.attempts + Number(previous.status === 'running')
        if (attempts > 2) return { ...previous, status: 'blocked', error: 'Обработчик несколько раз прервался. Проверенные этапы сохранены.', updatedAt: now }
        return { ...previous, status: 'running', attempts, owner, leaseToken, leaseUntil: now + LAYOUT_JOB_LEASE_MS, updatedAt: now, retryAt: undefined, error: undefined }
      })
      if (job?.leaseToken === leaseToken) return job
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return null
}
export async function updateLayoutJob(bucket: R2Bucket, id: string, token: string, update: { complete?: boolean; error?: string; retryable?: boolean; progress?: { detail: string; completed?: number; total?: number } }, now = Date.now()) {
  const project = await getProject(bucket, id)
  return change(bucket, id, previous => {
    if (!previous || previous.status !== 'running' || previous.leaseToken !== token || (previous.leaseUntil ?? 0) <= now) throw Error('Утрачено владение генерацией.')
    if (!project || project.archivedAt || project.revision !== previous.sourceRevision) throw Error('Проект изменился. Предыдущая генерация остановлена.')
    const next: LayoutJob = { ...previous, updatedAt: now, leaseUntil: now + LAYOUT_JOB_LEASE_MS,
      progress: update.progress ? { step: 'analysis', detail: update.progress.detail, completed: update.progress.completed, total: update.progress.total } : previous.progress }
    if (update.complete) { next.status = 'complete'; next.error = undefined }
    if (update.error) {
      next.attempts++; next.error = update.error.slice(0, 700)
      next.status = update.retryable === true && next.attempts <= 2 ? 'retrying' : 'blocked'
      next.retryAt = next.status === 'retrying' ? now + (next.attempts === 1 ? 15000 : 45000) : undefined
    }
    if (next.status !== 'running') { delete next.owner; delete next.leaseToken; delete next.leaseUntil; delete next.retry }
    return next
  })
}
