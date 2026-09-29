import { assertUploadActive } from '../uploads/cancellation-server'
import { QwenAnalysisError } from '../uploads/qwen-analysis'
import { EDITABLE_COMPILER_VERSION, type EditableCatalog } from './editable-contract'
import { HTML_QUALIFICATION_VERSION } from './editable-qualification'
import { REFINEMENT_VERSION, type RefinementJob } from './refinement-contract'

export const refinementRoot = (id: string) => `editable-refinements/${id}/${REFINEMENT_VERSION}`
export const refinementJson = { httpMetadata: { contentType: 'application/json' } }
export type RefinementRegistry = { pending: string | null; queue?: string[]; jobs: string[]; activeKey: string | null; history: { requestId: string; key: string; previous: string | null }[] }
const empty = (): RefinementRegistry => ({ pending: null, jobs: [], activeKey: null, history: [] })
export async function readRefinementRegistry(bucket: R2Bucket, id: string) {
  const file = await bucket.get(`${refinementRoot(id)}/state.json`)
  return file ? file.json<RefinementRegistry>() : empty()
}
export async function mutateRefinementRegistry(bucket: R2Bucket, id: string, change: (r: RefinementRegistry) => RefinementRegistry) {
  for (let n = 0; n < 8; n++) {
    await assertUploadActive(bucket, id)
    const key = `${refinementRoot(id)}/state.json`, file = await bucket.get(key), current = file ? await file.json<RefinementRegistry>() : empty()
    const next = change(current)
    if (await bucket.put(key, JSON.stringify(next), { ...refinementJson, onlyIf: file ? { etagMatches: file.etag } : { etagDoesNotMatch: '*' } })) return next
  }
  throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Дополнение уже обновляется. Подождите немного.')
}
export async function readRefinementJob(bucket: R2Bucket, id: string, jobId: string) {
  const file = await bucket.get(`${refinementRoot(id)}/requests/${jobId}.json`)
  return file ? file.json<RefinementJob>() : null
}
export async function mutateRefinementJob(bucket: R2Bucket, id: string, jobId: string, change: (job: RefinementJob) => RefinementJob) {
  for (let n = 0; n < 8; n++) {
    await assertUploadActive(bucket, id)
    const key = `${refinementRoot(id)}/requests/${jobId}.json`, file = await bucket.get(key)
    if (!file) throw Error('Дополнение не найдено')
    const next = change(await file.json<RefinementJob>())
    if (await bucket.put(key, JSON.stringify(next), { ...refinementJson, onlyIf: { etagMatches: file.etag } })) return next
  }
  throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Дополнение уже обновляется. Подождите немного.')
}
export async function reserveRefinementRequest(bucket: R2Bucket, id: string, jobId: string, slide: number) {
  if ((await readRefinementRegistry(bucket, id)).pending !== jobId) throw Error('Дополнение уже остановлено')
  await mutateRefinementJob(bucket, id, jobId, job => {
    if (['cancelled', 'complete'].includes(job.status)) throw Error('Запрос дополнения уже завершён')
    if (job.budget.used >= job.budget.limit || (job.budget.slides[slide] ?? 0) >= 2) throw new QwenAnalysisError('REFINEMENT_BUDGET_EXHAUSTED', 'Предел запросов этого дополнения достигнут. Проверенные компоненты сохранены.')
    return { ...job, budget: { ...job.budget, used: job.budget.used + 1, slides: { ...job.budget.slides, [slide]: (job.budget.slides[slide] ?? 0) + 1 } } }
  })
}
/** New sources opt in at publication. Reading an existing style never opts in. */
export async function enableAutomaticRefinement(bucket: R2Bucket, id: string, sourceId: string) {
  await bucket.put(`${refinementRoot(id)}/automatic.json`, JSON.stringify({ sourceId }), { ...refinementJson, onlyIf: { etagDoesNotMatch: '*' } })
  const { enableQualityAudit } = await import('./quality-audit-storage')
  await enableQualityAudit(bucket, id, sourceId)
}
export async function refinedCatalog(bucket: R2Bucket, id: string, base: EditableCatalog): Promise<EditableCatalog> {
  const registry = await readRefinementRegistry(bucket, id)
  if (!registry.activeKey) return base
  const file = await bucket.get(registry.activeKey), value = file && await file.json<EditableCatalog>()
  if (value?.refinement?.baseId === base.id && value.sourceRevision === base.sourceRevision && value.compilerVersion === EDITABLE_COMPILER_VERSION && value.qualification?.version === HTML_QUALIFICATION_VERSION) return value
  const replay = await bucket.get(publishedRecheckKey(id, base.id, registry.activeKey))
  const checked = replay && await replay.json<EditableCatalog>()
  return checked && checked.sourceRevision === base.sourceRevision && (checked.refinement?.baseId ?? checked.id) === base.id && checked.compilerVersion === EDITABLE_COMPILER_VERSION && checked.qualification?.version === HTML_QUALIFICATION_VERSION && checked.qualification.catalogId === checked.id ? checked : base
}

/** Derived cache identity includes both the base and the exact published tip.
 * Undo/source/compiler/check changes cannot accidentally reuse another replay. */
export function publishedRecheckKey(id: string, baseId: string, activeKey: string) {
  const version = activeKey.split('/').at(-1)!
  if (!/^[a-f\d]{64}\.json$/.test(version) || !/^[a-f\d]{64}$/.test(baseId)) throw Error('Некорректная версия дополнения')
  return `${refinementRoot(id)}/rechecks/${EDITABLE_COMPILER_VERSION}/${HTML_QUALIFICATION_VERSION}/${baseId}/${version}`
}

export function releaseRefinement(r:RefinementRegistry,requestId:string):RefinementRegistry {
  const queue=(r.queue??[]).filter(id=>id!==requestId)
  return r.pending===requestId?{...r,pending:queue[0]??null,queue:queue.slice(1)}:{...r,queue}
}
export function admitRefinement(r:RefinementRegistry,job:RefinementJob):RefinementRegistry {
  if(r.pending===job.id||(r.queue??[]).includes(job.id))return r
  if(r.pending&&job.mode!=='region')throw Error('Сначала дождитесь текущего дополнения.')
  if((r.queue?.length??0)>=12)throw Error('В очереди уже 12 областей. Дождитесь проверки или отмените лишние.')
  return {...r,pending:r.pending??job.id,queue:r.pending?[...r.queue??[],job.id]:r.queue??[],jobs:[...new Set([...r.jobs,job.id])]}
}
