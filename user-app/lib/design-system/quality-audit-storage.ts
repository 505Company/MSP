import { assertUploadActive } from '../uploads/cancellation-server'
import { QwenAnalysisError } from '../uploads/qwen-analysis'
import { QUALITY_AUDIT_VERSION, AUDIT_VALIDATION_VERSION, type QualityAuditJob, type AuditResult, type TemplateDesignIntent } from './quality-audit-contract'

export const auditRoot = (id: string) => `quality-audits/${id}/${QUALITY_AUDIT_VERSION}`
export const auditJson = { httpMetadata: { contentType: 'application/json' } }
export async function enableQualityAudit(bucket: R2Bucket, id: string, sourceId: string) {
  await bucket.put(`${auditRoot(id)}/policy.json`, JSON.stringify({ sourceId }), { ...auditJson, onlyIf: { etagDoesNotMatch: '*' } })
}
export async function readQualityAudit(bucket: R2Bucket, id: string, revision?: string) {
  if (!revision) { const f = await bucket.get(`${auditRoot(id)}/current.json`); if (!f) return null; revision = (await f.json<{ id: string }>()).id }
  const file = await bucket.get(`${auditRoot(id)}/${revision}/job.json`)
  return file ? file.json<QualityAuditJob>() : null
}
export async function readAuditResults(bucket: R2Bucket, id: string, job: QualityAuditJob) {
  return (await Promise.all(job.batches.map(async b => {
    const file = await bucket.get(`${auditRoot(id)}/${job.id}/validated/${AUDIT_VALIDATION_VERSION}/${b.id}.json`) ?? await bucket.get(`${auditRoot(id)}/${job.id}/results/${b.id}.json`)
    return file ? file.json<AuditResult>() : null
  }))).filter((r): r is AuditResult => !!r)
}
export async function readAuditStyle(bucket: R2Bucket, id: string, job: QualityAuditJob) {
  const file = await bucket.get(`${auditRoot(id)}/${job.id}/style.json`)
  return file ? file.json<TemplateDesignIntent>() : null
}
export async function mutateQualityAudit(bucket: R2Bucket, id: string, revision: string, change: (j: QualityAuditJob) => QualityAuditJob) {
  const key = `${auditRoot(id)}/${revision}/job.json`
  for (let i = 0; i < 8; i++) {
    await assertUploadActive(bucket, id)
    const file = await bucket.get(key); if (!file) throw Error('Аудит не найден')
    const next = change(await file.json<QualityAuditJob>()); next.updatedAt = Date.now()
    if (await bucket.put(key, JSON.stringify(next), { ...auditJson, onlyIf: { etagMatches: file.etag } })) return next
  }
  throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Аудит уже обновляется')
}
/** The repair worker reads validated, persisted meaning; the client cannot
 * supply invented source IDs or turn a primitive into an approved component. */
export async function auditRepairFocus(bucket: R2Bucket, id: string, audit: { revision: string; findingId: string }, sourceRevision: string) {
  const job = await readQualityAudit(bucket, id, audit.revision)
  const repair = job?.repairs.find(r => r.id === audit.findingId)
  if (!job || job.sourceRevision !== sourceRevision || !repair || repair.target === 'review' || repair.status === 'deferred') throw Error('Замечание аудита устарело или требует проверки')
  const results = await readAuditResults(bucket, id, job), slide = results.flatMap(r => r.slides).find(s => s.slide === repair.slide)
  return { ...repair, relatedUnits: slide?.units.filter(u=>u.sourceIds.every(id=>repair.sourceIds.includes(id))) ?? [], relations: slide?.relations ?? [], techniques: slide?.techniques ?? [] }
}
