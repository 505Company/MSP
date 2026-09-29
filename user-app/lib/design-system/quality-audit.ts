import type { VisualManifest } from '../digital-designer/visual-package'
import { assertUploadActive } from '../uploads/cancellation-server'
import { beginModelRun, readModelRun } from '../uploads/model-run'
import { QwenAnalysisError, type QwenConfig } from '../uploads/qwen-analysis'
import { parseModelJson } from '../uploads/qwen-structured'
import { catalogLibrary, contentHash } from './catalog'
import { readEditableCatalog } from './editable-analysis'
import { readSourceScene } from './source-scene'
import { requestRefinement, cancelRefinement } from './refinement'
import { readRefinementJob, readRefinementRegistry } from './refinement-storage'
import { auditRoot, auditJson as json, readQualityAudit, readAuditResults, readAuditStyle, mutateQualityAudit, enableQualityAudit } from './quality-audit-storage'
import { auditEvidenceSchema, auditSlideInventory, validateAuditEvidence, qualityAuditTask, templateStyleTask, type AuditInput, type AuditEvidence } from './quality-audit-task'
import { QUALITY_AUDIT_VERSION, AUDIT_VALIDATION_VERSION, MAX_AUDIT_REPAIRS, MAX_AUDIT_REPAIRS_PER_SLIDE, auditLeafIds, validateQualityReply, validateStyleAudit, type SourceIntegrity, type QualityAuditJob, type QualityAuditState, type AuditRepair, type AuditResult } from './quality-audit-contract'

const inputKey = (id: string, revision: string) => `${auditRoot(id)}/${revision}/input.json`
const batchModelPrefix = (prefix: string, batch: QualityAuditJob['overview']) => `${prefix}/models/${batch.id}${batch.attempt ? `/retry-${batch.attempt}` : ''}`
export async function qualityAuditState(bucket: R2Bucket, id: string): Promise<QualityAuditState> {
  const [job, policy, source] = await Promise.all([readQualityAudit(bucket, id), bucket.get(`${auditRoot(id)}/policy.json`), bucket.get(`visual/${id}/manifest.json`)])
  const visual = source ? await source.json<VisualManifest>() : null
  const enabled = !!policy && (await policy.json<{sourceId:string}>()).sourceId === visual?.snapshot.sourceId
  const stale = !!job && (!visual || job.sourceHash !== await contentHash(visual.snapshot))
  return { enabled, job, stale, results: job ? await readAuditResults(bucket, id, job) : [], style: job ? await readAuditStyle(bucket, id, job) : null }
}
export async function startQualityAudit(bucket: R2Bucket, id: string, integrity: SourceIntegrity, explicit = false) {
  await assertUploadActive(bucket, id)
  const state = await qualityAuditState(bucket, id)
  if (!explicit && !state.enabled) return null
  const [file, catalog, library] = await Promise.all([bucket.get(`visual/${id}/manifest.json`), readEditableCatalog(bucket, id), catalogLibrary(bucket, id)])
  if (!file || !catalog?.qualification) throw Error('Аудит начинается после проверки компонентов')
  const visual = await file.json<VisualManifest>(), sourceHash = await contentHash(visual.snapshot)
  if (state.job && !state.stale && state.job.sourceRevision === catalog.sourceRevision) return state.job
  if (explicit) await enableQualityAudit(bucket, id, visual.snapshot.sourceId)
  const revision = await contentHash({ version: QUALITY_AUDIT_VERSION, sourceHash, catalogId: catalog.id })
  const snapshot = visual.snapshot, scene = readSourceScene(snapshot)
  const batches: QualityAuditJob['batches'] = []
  // Two ordinary slides per request; dense slides retain their whole context
  // in a separate request, without slicing off a related paragraph.
  for (const s of snapshot.slides) {
    const objects = [...scene.records.values()].filter(r => r.source.slide === s.number && r.disposition === 'visible').length
    const previous = batches.at(-1)
    if (previous && previous.slides.length === 1 && objects < 160 && [...scene.records.values()].filter(r => previous.slides.includes(r.source.slide) && r.disposition === 'visible').length < 160) previous.slides.push(s.number)
    else batches.push({ id: `slides-${s.number}`, slides: [s.number], status: 'pending' })
  }
  const job: QualityAuditJob = { version: QUALITY_AUDIT_VERSION, id: revision, sourceHash, sourceRevision: catalog.sourceRevision, catalogId: catalog.id, sourceCatalogId: catalog.catalogId,
    createdAt: Date.now(), updatedAt: Date.now(), batches, overview: { id: 'template-style', slides: [], status: 'pending' }, status: 'auditing', integrity, repairs: [], repairPlanReady: false, modelRequests: 0 }
  const input: AuditInput = { visual, catalog, graphics: (library?.library.components ?? []).map(c => ({ id: c.id, name: c.name, slides: [c.source.slide], sourceIds: c.source.elementIds, role: c.semantics.map(s => s.role).join(", ") })) }
  await bucket.put(inputKey(id, revision), JSON.stringify(input), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  await bucket.put(`${auditRoot(id)}/${revision}/job.json`, JSON.stringify(job), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  await bucket.put(`${auditRoot(id)}/current.json`, JSON.stringify({ id: revision }), json)
  return readQualityAudit(bucket, id, revision)
}
async function context(bucket: R2Bucket, id: string, revision: string) {
  const state = await qualityAuditState(bucket, id), file = await bucket.get(inputKey(id, revision))
  if (state.job?.id !== revision || state.stale || !file) throw new QwenAnalysisError('SOURCE_CHANGED', 'Источник аудита изменился; прежние результаты сохранены')
  return { job: state.job, input: await file.json<AuditInput>() }
}
export async function qualityAuditPacket(bucket: R2Bucket, id: string, revision: string) {
  const { job, input } = await context(bucket, id, revision), batch = job.batches.find(b => b.status === 'pending')
  if (!batch) return null
  return { batch, catalogId: job.catalogId, templates: input.catalog.families.flatMap(f => f.variants).filter(t => batch.slides.includes(t.slide)),
    evidenceSaved: !!await bucket.head(`${auditRoot(id)}/${revision}/evidence/${batch.id}.json`) }
}

/** Replay exact saved replies after validator fixes. Separate derived receipts
 * preserve the original result, model run and billing. Never resend a packet,
 * re-plan an already admitted repair, or consume an unfinished provider reply. */
export async function recheckQualityAudit(bucket: R2Bucket, id: string, revision: string) {
  await assertUploadActive(bucket,id)
  const {job,input}=await context(bucket,id,revision)
  if(job.repairPlanReady)return job
  for(const batch of job.batches.filter(b=>b.status!=='pending'&&b.runId)){
    const prefix=`${auditRoot(id)}/${revision}`,key=`${prefix}/validated/${AUDIT_VALIDATION_VERSION}/${batch.id}.json`
    let file=await bucket.get(key)
    if(!file){
      const modelPrefix=batchModelPrefix(prefix,batch),run=await readModelRun(bucket,modelPrefix,batch.runId)
      if(!run||run.status!=='complete')continue
      const response=await bucket.get(`${modelPrefix}/responses/${run.id}.json`)??(run.sourceRunId?await bucket.get(`${modelPrefix}/responses/${run.sourceRunId}.json`):null)
      const saved=response?await response.json<{content:string;finishReason?:string}>():null
      if(!saved||saved.finishReason&&saved.finishReason!=='stop')continue
      const result=validateQualityReply(parseModelJson(saved.content),input.visual.snapshot,input.catalog,batch.slides)
      await context(bucket,id,revision);await assertUploadActive(bucket,id)
      await bucket.put(key,JSON.stringify(result),{...json,onlyIf:{etagDoesNotMatch:'*'}})
      file=await bucket.get(key)
    }
    if(file){
      const result=await file.json<AuditResult>(),status=result.rejected.length?'partial':'complete'
      if(batch.status!==status)await mutateQualityAudit(bucket,id,revision,j=>j.repairPlanReady?j:{...j,batches:j.batches.map(b=>b.id===batch.id&&b.runId===batch.runId?{...b,status,error:undefined}:b)})
    }
  }
  return readQualityAudit(bucket,id,revision)
}

/** Explicit, bounded recovery of interrupted transport, never a hidden repeat
 * of a completed judgement. Original runs/responses remain immutable. */
export async function retryInterruptedQualityAudit(bucket: R2Bucket, id: string, revision: string) {
  await assertUploadActive(bucket,id)
  const {job}=await context(bucket,id,revision)
  if(job.repairPlanReady)return job
  for(const batch of [...job.batches,job.overview]){
    if(batch.attempt || !['pending','skipped'].includes(batch.status))continue
    const run=await readModelRun(bucket,batchModelPrefix(`${auditRoot(id)}/${revision}`,batch))
    if(run?.status!=='failed'||!['QWEN_CANCELLED','QWEN_TIMEOUT','QWEN_LEASE_LOST'].includes(run.error?.code??''))continue
    await mutateQualityAudit(bucket,id,revision,j=>{
      const previous=batch.id===j.overview.id?j.overview:j.batches.find(b=>b.id===batch.id)!
      if(j.repairPlanReady||previous.attempt||!['pending','skipped'].includes(previous.status))return j
      const next={...previous,attempt:1,status:'pending' as const,runId:undefined,error:undefined,liveRequests:undefined}
      return {...j,modelRequests:j.modelRequests+(previous.status==='pending'?run.liveRequests:0),...(batch.id===j.overview.id?{overview:next}:{batches:j.batches.map(b=>b.id===batch.id?next:b)})}
    })
  }
  return (await readQualityAudit(bucket,id,revision))!
}

/** One bounded independent pass. Failed packets stay visible and the next
 * packet continues. Restarts reuse a saved model result, never its paid call. */
export async function advanceQualityAudit(bucket: R2Bucket, id: string, revision: string, config: QwenConfig, evidence?: AuditEvidence, signal?: AbortSignal) {
  await assertUploadActive(bucket, id); signal?.throwIfAborted()
  await recheckQualityAudit(bucket,id,revision)
  const { job, input } = await context(bucket, id, revision)
  const batch = job.batches.find(b => b.status === 'pending') ?? (job.overview.status === 'pending' ? job.overview : null)
  if (!batch) return job
  const prefix = `${auditRoot(id)}/${revision}`, modelPrefix = batchModelPrefix(prefix,batch), overview = batch.id === 'template-style'
  let runId: string | undefined, requests = 0
  const save = (status: 'complete' | 'partial' | 'skipped', error?: string) => mutateQualityAudit(bucket, id, revision, j => {
    const prior = overview ? j.overview : j.batches.find(b => b.id === batch.id)!
    if (prior.status !== 'pending' || (prior.attempt??0)!==(batch.attempt??0)) return j
    const value = { ...prior, status, error, runId, liveRequests: requests }
    return { ...j, modelRequests: j.modelRequests + requests, ...(overview ? { overview: value } : { batches: j.batches.map(b => b.id === batch.id ? value : b) }) }
  })
  try {
    const results = await readAuditResults(bucket, id, job)
    let storedEvidence: AuditEvidence = { boards: [], failed: [] }
    if (!overview) {
      const key = `${prefix}/evidence/${batch.id}.json`, previous = await bucket.get(key)
      if (previous) storedEvidence = auditEvidenceSchema.parse(await previous.json())
      else {
        storedEvidence = validateAuditEvidence(evidence, input, batch)
        await bucket.put(key, JSON.stringify(storedEvidence), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
        storedEvidence = auditEvidenceSchema.parse(await (await bucket.get(key))!.json())
      }
    }
    const task = overview ? templateStyleTask(results) : await qualityAuditTask(bucket, id, input, batch, storedEvidence)
    const validate = (raw: unknown) => overview ? validateStyleAudit(raw, input.visual.snapshot, results) : validateQualityReply(raw, input.visual.snapshot, input.catalog, batch.slides)
    if (JSON.stringify(task).length > 12_000_000) throw Error('Пакет слишком велик; требуется отдельная проверка')
    const previous = await readModelRun(bucket, modelPrefix)
    let result: ReturnType<typeof validate>
    if (previous?.status === 'complete' && previous.result) { result = previous.result as typeof result; runId = previous.id; requests = previous.liveRequests }
    else {
      if (previous) {
        if (previous.status === 'running') {
          const lease = await bucket.get(`${modelPrefix}/claims/${previous.inputHash}.json`)
          if (lease && (await lease.json<{expiresAt:number}>()).expiresAt > Date.now()) throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Пакет аудита уже обрабатывается')
        }
        runId = previous.id; requests = previous.liveRequests
        throw Error(previous.error?.message ?? 'Запрос аудита прервался. Продолжаем остальные слайды без повторной оплаты этого пакета')
      }
      const started = await beginModelRun({ bucket, uploadId: id, prefix: modelPrefix, version: QUALITY_AUDIT_VERSION,
        scope: { uploadId: id, revision, batchId: batch.id, slides: batch.slides, ...(batch.attempt?{attempt:batch.attempt}:{}) }, task, config: { ...config, timeoutMs: 240000 }, validate })
      runId = started.run.id
      try { await started.execute?.(signal) } finally { requests = started.run.liveRequests }
      result = started.run.result!
    }
    signal?.throwIfAborted(); await assertUploadActive(bucket, id); await context(bucket, id, revision)
    await bucket.put(overview ? `${prefix}/style.json` : `${prefix}/results/${batch.id}.json`, JSON.stringify(result), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
    return save(!overview && (result as AuditResult).rejected.length ? 'partial' : 'complete')
  } catch (error) {
    signal?.throwIfAborted(); await assertUploadActive(bucket, id)
    if (error instanceof QwenAnalysisError && ['QWEN_ALREADY_RUNNING', 'SOURCE_CHANGED'].includes(error.code)) throw error
    return save('skipped', error instanceof Error ? error.message : 'Пакет аудита не проверен')
  }
}

export function planAuditRepairs(input: AuditInput, results: AuditResult[]): AuditRepair[] {
  const scene = readSourceScene(input.visual.snapshot), repairs: AuditRepair[] = [], signatures = new Set<string>(), perSlide = new Map<number,number>()
  const qualified=new Set(input.catalog.qualification?.checks.filter(c=>c.passed).map(c=>c.id))
  const templates=input.catalog.families.flatMap(f=>f.variants)
  for (const result of results) for (const slide of result.slides) for (const finding of slide.findings) {
    const source = input.visual.snapshot.slides.find(s => s.number === slide.slide)!, unit = slide.units.find(u => u.id === finding.unitId) ?? null
    // Repair the relationship, not another isolated copy of its paragraph.
    // Only direct neighbours are included; no transitive whole-slide crawl.
    const neighbours = unit && finding.kind==='lost-relationship'
      ? new Set(slide.relations.filter(r=>r.from===unit.id||r.to===unit.id).flatMap(r=>[r.from,r.to])) : new Set<string>()
    const sourceIds = [...new Set([...finding.sourceIds, ...unit?.sourceIds ?? [], ...slide.units.filter(u=>neighbours.has(u.id)).flatMap(u=>u.sourceIds)])]
    const signature = auditLeafIds(input.visual.snapshot, sourceIds).sort().join('|')
    if (signatures.has(signature)) continue
    signatures.add(signature)
    const boxes = sourceIds.map(id => scene.records.get(id)!.bounds), x = Math.max(0, Math.min(...boxes.map(b => b.x))), y = Math.max(0, Math.min(...boxes.map(b => b.y)))
    const right = Math.min(source.width, Math.max(...boxes.map(b => b.x + b.width))), bottom = Math.min(source.height, Math.max(...boxes.map(b => b.y + b.height)))
    const region = { x: x / source.width, y: y / source.height, width: (right - x) / source.width, height: (bottom - y) / source.height }
    // A model can overlook an existing composition even though its complete
    // membership is in the inventory. Preserve that observation for review,
    // but do not spend a repair on an identical already qualified structure.
    const required=auditLeafIds(input.visual.snapshot,sourceIds)
    const existing=['missing-unit','fragmented-unit'].includes(finding.kind)&&required.length
      ? templates.find(t=>t.slide===slide.slide&&qualified.has(t.id)&&required.every(id=>auditLeafIds(input.visual.snapshot,t.sourceIds).includes(id))):null
    const runnable = !existing && finding.repair !== 'review' && region.width >= .005 && region.height >= .005
    const withinBudget = repairs.filter(r => r.status === 'pending').length < MAX_AUDIT_REPAIRS && (perSlide.get(slide.slide) ?? 0) < MAX_AUDIT_REPAIRS_PER_SLIDE
    const status = runnable && withinBudget ? 'pending' : 'deferred'
    if (status === 'pending') perSlide.set(slide.slide, (perSlide.get(slide.slide) ?? 0) + 1)
    const batchId = `s${slide.slide}`
    repairs.push({ id: `${batchId}-${finding.id}`, batchId, findingId: finding.id, slide: slide.slide, sourceIds, unit, reason: finding.reason, target: finding.repair, region, status,
      ...(status === 'deferred' ? { detail: existing ? `Целая конструкция уже есть в проверенном компоненте ${existing.id}; замечание сохранено для проверки без создания дубля` : runnable ? 'Достигнут лимит адресных исправлений этого аудита' : 'Требуется проверка; автоматическое исправление не доказано' } : {}) })
  }
  return repairs
}
export async function prepareAuditRepairs(bucket: R2Bucket, id: string, revision: string) {
  await recheckQualityAudit(bucket,id,revision)
  const { job, input } = await context(bucket, id, revision)
  if (job.batches.some(b => b.status === 'pending') || job.overview.status === 'pending') throw Error('Аудит ещё не закончен')
  if (job.repairPlanReady) return job
  const repairs = planAuditRepairs(input, await readAuditResults(bucket, id, job))
  return mutateQualityAudit(bucket, id, revision, j => j.repairPlanReady ? j : { ...j, repairs, repairPlanReady: true, status: repairs.some(r => r.status === 'pending') ? 'repairing' : 'complete' })
}
export async function queueAuditRepair(bucket: R2Bucket, id: string, revision: string) {
  const { job } = await context(bucket, id, revision), repair = job.repairs.find(r => ['pending', 'queued'].includes(r.status))
  if (!repair) return null
  if (repair.requestId) return repair
  const registry = await readRefinementRegistry(bucket, id)
  if (registry.pending) {
    await mutateQualityAudit(bucket,id,revision,j=>{
      const repairs=j.repairs.map(r=>r.id===repair.id?{...r,status:'deferred' as const,detail:'Уже выполняется другое дополнение; автоматическое исправление отложено'}:r)
      return {...j,repairs,status:repairs.some(r=>['pending','queued'].includes(r.status))?'repairing':'complete'}
    })
    return null
  }
  const catalog = await readEditableCatalog(bucket, id)
  if (!catalog?.qualification || catalog.sourceRevision !== job.sourceRevision) throw new QwenAnalysisError('SOURCE_CHANGED', 'Каталог аудита изменился')
  const hash = await contentHash({ revision, finding: repair.id }), requestId = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`
  // Save admission parameters before requesting, so a lost acknowledgment
  // reuses exactly the same id and base rather than creating another repair.
  await mutateQualityAudit(bucket, id, revision, j => ({ ...j, repairs: j.repairs.map(r => r.id === repair.id ? { ...r, requestId, catalogId: catalog.id } : r) }))
  return admitAuditRepair(bucket, id, revision, repair.id)
}
export async function admitAuditRepair(bucket: R2Bucket, id: string, revision: string, findingId: string) {
  const { job } = await context(bucket, id, revision), repair = job.repairs.find(r => r.id === findingId)!
  if (!repair.requestId || !repair.catalogId) throw Error('Дополнение ещё не подготовлено')
  const existing = await readRefinementJob(bucket, id, repair.requestId)
  if (!existing) await requestRefinement(bucket, id, { id: repair.requestId, mode: 'region', catalogId: repair.catalogId, slide: repair.slide, region: repair.region,
    target: repair.target === 'graphic' ? 'graphic' : 'component', note: repair.reason.slice(0,600), audit: { revision, findingId: repair.id } })
  await mutateQualityAudit(bucket, id, revision, j => ({ ...j, repairs: j.repairs.map(r => r.id === findingId ? { ...r, status: 'queued' } : r) }))
  return { ...repair, status: 'queued' as const }
}
export async function settleAuditRepair(bucket: R2Bucket, id: string, revision: string, findingId: string, failure?: string) {
  const { job, input } = await context(bucket, id, revision), repair = job.repairs.find(r => r.id === findingId)
  if (!repair?.requestId) throw Error('Дополнение аудита не найдено')
  const task = await readRefinementJob(bucket, id, repair.requestId)
  if (failure && task && !['complete','cancelled'].includes(task.status)) await cancelRefinement(bucket, id, task.id)
  if (!failure && task && !['complete','cancelled'].includes(task.status)) throw Error('Проверка дополнения ещё не закончена')
  const catalog = await readEditableCatalog(bucket, id), passed = new Set(catalog?.qualification?.checks.filter(c => c.passed).map(c => c.id))
  const required = auditLeafIds(input.visual.snapshot, repair.sourceIds)
  const added = new Set(task?.result?.items?.map(t => t.id) ?? [])
  const componentIds = catalog?.families.flatMap(f => f.variants).filter(t => added.has(t.id) && passed.has(t.id) && required.every(id => auditLeafIds(input.visual.snapshot, t.sourceIds).includes(id))).map(t=>t.id)??[]
  const status = !failure && task?.status === 'complete' && componentIds.length ? 'accepted' : 'unresolved'
  return mutateQualityAudit(bucket, id, revision, j => {
    const repairs = j.repairs.map(r => r.id === findingId ? { ...r, status: status as AuditRepair['status'], componentIds:status==='accepted'?componentIds:[], detail: failure ?? (status === 'accepted' ? 'Целый блок добавлен и прошёл проверку исходного и изменённого содержания' : 'Целая проверенная конструкция не получена; исходные компоненты сохранены') } : r)
    return { ...j, repairs, status: repairs.some(r => ['pending','queued'].includes(r.status)) ? 'repairing' : 'complete' }
  })
}

export { auditSlideInventory }
