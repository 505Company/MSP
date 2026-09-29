import { assertUploadActive } from '../uploads/cancellation-server'
import { readEditableCatalog } from './editable-analysis'
import type { EditableCatalog } from './editable-contract'
import { HTML_QUALIFICATION_VERSION } from './editable-qualification'
import { completeRefinement, refreshRefinement, refinementCandidate, reportRefinement } from './refinement'
import { refinementTaskFinished, type RefinementCandidate, type RefinementJob } from './refinement-contract'
import { publishedRecheckKey, readRefinementJob, readRefinementRegistry, refinementJson, refinementRoot } from './refinement-storage'

export type PublishedRecheck = { complete: boolean; candidate: RefinementCandidate | null }

/** Reuse the ordinary compiler, source guards and qualification protocol in a
 * private namespace. No original request, reply, candidate or undo entry changes.
 * This path intentionally has no advance/model operation. */
function replayBucket(bucket: R2Bucket, prefix: string, uploadId: string): R2Bucket {
  return new Proxy(bucket, {
    get(target, property) {
      if (property === 'get') return async (key: string) => await target.get(`${prefix}/${key}`) ?? target.get(key)
      if (property === 'put') return async (key: string, value: string, options?: R2PutOptions) => {
        if (!key.startsWith(refinementRoot(uploadId) + '/')) throw Error('Повторная проверка может записывать только собственные результаты')
        await assertUploadActive(target, uploadId)
        return target.put(`${prefix}/${key}`, value, options)
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** Replay only the currently published chain. Cancelled/undone proposals are
 * excluded. The final cache is published only after every saved task is checked. */
export async function recheckPublishedRefinements(bucket: R2Bucket, id: string, report?: unknown): Promise<PublishedRecheck> {
  await assertUploadActive(bucket, id)
  const registry = await readRefinementRegistry(bucket, id), base = await readEditableCatalog(bucket, id)
  if (!registry.activeKey) return { complete: true, candidate: null }
  if (!base?.qualification || base.qualification.version !== HTML_QUALIFICATION_VERSION || registry.pending) return { complete: false, candidate: null }
  const file = await bucket.get(registry.activeKey), published = file && await file.json<EditableCatalog>()
  if (!published || published.sourceRevision !== base.sourceRevision) throw Error('Исходник изменился. Старое дополнение нельзя переносить на другую презентацию.')
  const baseId = base.refinement?.baseId ?? base.id, key = publishedRecheckKey(id, baseId, registry.activeKey)
  if (base.refinement || await bucket.get(key)) return { complete: true, candidate: null }
  const chain = [], seen = new Set<string>()
  let current: string | null = registry.activeKey
  while (current) {
    const entry = registry.history.find(h => h.key === current)
    if (!entry || seen.has(current)) throw Error('История дополнений неполна. Исходная версия сохранена.')
    seen.add(current); chain.unshift(entry); current = entry.previous
  }
  const prefix = key.replace(/\.json$/, ''), replay = replayBucket(bucket, prefix, id)
  // Conditional writes make interrupted initialization safe to repeat.
  for (const entry of chain) {
    const job = await readRefinementJob(bucket, id, entry.requestId)
    if (!job || job.status !== 'complete' || job.sourceRevision !== base.sourceRevision || !job.tasks.every(refinementTaskFinished)) throw Error('Нет завершённого сохранённого дополнения для повторной проверки.')
    const next: RefinementJob = { ...job, baseId: '', originalBaseId: base.id, status: 'queued', result: undefined, error: undefined }
    await replay.put(`${refinementRoot(id)}/requests/${job.id}.json`, JSON.stringify(next), { ...refinementJson, onlyIf: { etagDoesNotMatch: '*' } })
  }
  const ids = chain.map(e => e.requestId)
  await replay.put(`${refinementRoot(id)}/state.json`, JSON.stringify({ pending: ids[0], queue: ids.slice(1), jobs: ids, activeKey: null, history: [] }), { ...refinementJson, onlyIf: { etagDoesNotMatch: '*' } })
  if (report !== undefined) {
    const pending = (await readRefinementRegistry(replay, id)).pending
    if (!pending) throw Error('Дополнение уже проверено')
    await reportRefinement(replay, id, pending, report)
  }
  for (;;) {
    const state = await readRefinementRegistry(replay, id)
    if (!state.pending) break
    const job = await refreshRefinement(replay, id, state.pending)
    if (job.tasks.some(t => t.status === 'checking')) return { complete: false, candidate: await refinementCandidate(replay, id, job.id) }
    if (!job.tasks.every(refinementTaskFinished)) throw Error('Нет сохранённого ответа. Повторная проверка не отправляет новые запросы модели.')
    await completeRefinement(replay, id, job.id)
    // Cache qualified prefixes too: undo must immediately reveal the preceding
    // checked addition, without a temporary fall back to the bare base.
    const entry = chain.find(e => e.requestId === job.id)!
    if (entry.key !== registry.activeKey) {
      const previous = await readEditableCatalog(replay, id)
      if (!previous?.qualification) throw Error('Отсутствует проверка промежуточной версии')
      await assertUploadActive(bucket, id)
      await bucket.put(publishedRecheckKey(id, base.id, entry.key), JSON.stringify(previous), { ...refinementJson, onlyIf: { etagDoesNotMatch: '*' } })
    }
  }
  const checked = await readEditableCatalog(replay, id), latest = await readEditableCatalog(bucket, id), state = await readRefinementRegistry(bucket, id)
  if (!checked?.qualification || latest?.id !== base.id || state.activeKey !== registry.activeKey || state.pending) throw Error('Каталог изменился во время повторной проверки. Сохранённые дополнения не заменены.')
  await assertUploadActive(bucket, id)
  await bucket.put(key, JSON.stringify(checked), { ...refinementJson, onlyIf: { etagDoesNotMatch: '*' } })
  return { complete: true, candidate: null }
}
