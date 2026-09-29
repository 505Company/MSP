import test from 'node:test'
import assert from 'node:assert/strict'
import { refinementFixture, refinementConfig, passingReport } from './fixtures/refinement'
import { advanceRefinement, cancelRefinement, compileRefinementCandidate, completeRefinement, ensureAutomaticRefinement, refinementCandidate, refinementState, reportRefinement, requestRefinement, retryRefinement, undoRefinement, validateRefinementReply } from '../lib/design-system/refinement'
import { enableAutomaticRefinement, mutateRefinementJob, readRefinementJob, readRefinementRegistry, refinementRoot, reserveRefinementRequest } from '../lib/design-system/refinement-storage'
import { refinementRequestSchema } from '../lib/design-system/refinement-contract'
import { readEditableCatalog } from '../lib/design-system/editable-analysis'
import { catalogTemplates, refinementCoverage, regionSources } from '../lib/design-system/refinement-coverage'
import { readSourceScene } from '../lib/design-system/source-scene'
import type { RefinementJob } from '../lib/design-system/refinement-contract'
import { contentHash } from '../lib/design-system/catalog'
import { EDITABLE_VERSION } from '../lib/design-system/editable-contract'
import type { SourceElement } from '../lib/digital-designer/source-types'
type Fixture = Awaited<ReturnType<typeof refinementFixture>>
const request = (f: Fixture) => ({ id: crypto.randomUUID(), mode: 'scan' as const, catalogId: f.base.id, note: '' })
function modelResponse(reply: unknown) { return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }] }), { status: 200 }) }
async function stage(f: Fixture, job: RefinementJob, candidate: Awaited<ReturnType<typeof compileRefinementCandidate>>, fail = false) {
  const key = `${refinementRoot(f.id)}/candidate-test.json`
  await f.bucket.put(key, JSON.stringify(candidate))
  await mutateRefinementJob(f.bucket, f.id, job.id, j => ({ ...j, status: 'checking', tasks: j.tasks.map(t => ({ ...t, status: 'checking', candidateKey: key })) }))
  const report = passingReport(candidate.catalog)
  if (fail && report.checks.length) report.checks[0] = { ...report.checks[0], passed: false, changed: false, issues: ['Не помещается текст'] }
  await reportRefinement(f.bucket, f.id, job.id, report)
}

test('reading old systems never opts them into a model pass; new sources have one automatic admission', async () => {
  const f = await refinementFixture()
  assert.equal((await refinementState(f.bucket, f.id)).pending, null)
  assert.equal(await ensureAutomaticRefinement(f.bucket, f.id), null)
  await enableAutomaticRefinement(f.bucket, f.id, f.visual.snapshot.sourceId)
  const job = await ensureAutomaticRefinement(f.bucket, f.id); assert.ok(job); assert.equal(job.mode, 'automatic')
  assert.equal(await ensureAutomaticRefinement(f.bucket, f.id), null)
  assert.equal(job.budget.used, 0)
  await cancelRefinement(f.bucket, f.id, job.id)
  assert.equal(await ensureAutomaticRefinement(f.bucket, f.id), null, 'cancellation does not secretly re-admit automatic work')
})
test('admission is idempotent, preserves original data and serializes competing requests', async () => {
  const f = await refinementFixture(), input = request(f), before = f.data.get(f.baseKey)!.value
  const job = await requestRefinement(f.bucket, f.id, input)
  assert.equal((await requestRefinement(f.bucket, f.id, input)).id, job.id)
  await assert.rejects(() => requestRefinement(f.bucket, f.id, { ...input, note: 'changed' }), /другими параметрами/)
  await assert.rejects(() => requestRefinement(f.bucket, f.id, request(f)), /текущего дополнения/)
  assert.equal(f.data.get(f.baseKey)!.value, before)
  assert.deepEqual((await readRefinementRegistry(f.bucket, f.id)).jobs, [job.id])
})
test('concurrent admissions and budget reservations cannot double-spend the bounded task', async () => {
  const f = await refinementFixture()
  const requests = await Promise.allSettled([requestRefinement(f.bucket, f.id, request(f)), requestRefinement(f.bucket, f.id, request(f))])
  assert.equal(requests.filter(r => r.status === 'fulfilled').length, 1)
  const pending = (await readRefinementRegistry(f.bucket, f.id)).pending!
  const spends = await Promise.allSettled([1,2,3,4].map(() => reserveRefinementRequest(f.bucket, f.id, pending, 1)))
  assert.equal(spends.filter(r => r.status === 'fulfilled').length, 2)
  assert.equal((await readRefinementJob(f.bucket, f.id, pending))!.budget.used, 2)
  await cancelRefinement(f.bucket, f.id, pending)
  await assert.rejects(() => reserveRefinementRequest(f.bucket, f.id, pending, 1), /остановлено/)
})
test('region selection uses source coordinates, excludes hidden nodes and rejects empty or invalid areas', async () => {
  const f = await refinementFixture(), snapshot = structuredClone(f.visual.snapshot)
  assert.deepEqual(regionSources(snapshot, 1, { x: .47, y: 0, width: .33, height: .8 }).sort(), ['caption-second','frame-second','value-second'].sort())
  snapshot.elements.find(e => e.id === 'caption-second')!.properties.visible = false
  assert.ok(!regionSources(snapshot, 1, { x: .47, y: 0, width: .33, height: .8 }).includes('caption-second'))
  assert.throws(() => regionSources(snapshot, 1, { x: .9, y: .9, width: .1, height: .1 }), /нет доступных/)
  assert.equal(refinementRequestSchema.safeParse({ ...request(f), mode: 'region', slide: 1, region: { x: .9, y: 0, width: .4, height: 1 } }).success, false)
  assert.equal(refinementRequestSchema.safeParse({ ...request(f), mode: 'feedback' }).success, false)
  assert.ok(refinementCoverage(snapshot, f.base)[0].unassigned.includes('value-second'))
})
test('region feedback remains a model hint and rejects proposals outside the selected source', async () => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, { ...request(f), mode: 'region', slide: 1, region: { x: .47, y: 0, width: .33, height: .8 } })
  assert.equal(validateRefinementReply(f.reply, f.visual, job, 1).slides[0].blocks.length, 1)
  assert.throws(() => validateRefinementReply({ slides: [{ slide: 1, blocks: [f.first], note: '' }] }, f.visual, job, 1), /проверку объектов/)
})
test('a real executor with a mocked provider stages, checks, publishes and rolls back without changing raw evidence', async t => {
  const f = await refinementFixture(), input = request(f), before = f.data.get(f.baseKey)!.value
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return modelResponse(f.reply) })
  const job = await requestRefinement(f.bucket, f.id, input)
  await advanceRefinement(f.bucket, f.id, job.id, refinementConfig)
  assert.equal(calls, 1)
  const candidate = await refinementCandidate(f.bucket, f.id, job.id); assert.ok(candidate); assert.ok(candidate.catalog.families.length)
  assert.equal((await readEditableCatalog(f.bucket, f.id))!.id, f.base.id, 'unqualified draft is never exposed')
  const raw = [...f.data].filter(([k]) => k.includes('/responses/')).map(([key, v]) => [key, v.value])
  assert.equal(raw.length, 1); assert.match(raw[0][1], /missing/)
  await assert.rejects(() => reportRefinement(f.bucket, f.id, job.id, { ...passingReport(candidate.catalog), checks: [] }), /Неполная/)
  await reportRefinement(f.bucket, f.id, job.id, passingReport(candidate.catalog))
  const done = await completeRefinement(f.bucket, f.id, job.id)
  assert.equal(done.status, 'complete'); assert.ok(done.result!.added > 0)
  const next = (await readEditableCatalog(f.bucket, f.id))!
  assert.notEqual(next.id, f.base.id); assert.equal(next.refinement?.previousId, f.base.id)
  assert.ok(catalogTemplates(next).some(t => t.id === 'original'))
  assert.equal((await readRefinementRegistry(f.bucket, f.id)).pending, null)
  await completeRefinement(f.bucket, f.id, job.id); assert.equal(calls, 1)
  await undoRefinement(f.bucket, f.id, next.id)
  assert.equal((await readEditableCatalog(f.bucket, f.id))!.id, f.base.id)
  assert.equal(f.data.get(f.baseKey)!.value, before)
  for (const [key, value] of raw) assert.equal(f.data.get(key)!.value, value)
  assert.ok([...f.data.keys()].some(key => key.includes('/versions/')), 'undo preserves historical evidence')
})
test('feedback replacement is indivisible: failed HTML retains the original; passing correction replaces it', async () => {
  const f = await refinementFixture()
  for (const fail of [true, false]) {
    const job = await requestRefinement(f.bucket, f.id, { ...request(f), mode: 'feedback', templateId: 'original', feedback: 'incomplete' })
    const reply = { slides: [{ slide: 1, blocks: [{ ...f.first, id: 'fixed' }], note: '' }] }
    const candidate = await compileRefinementCandidate(f.visual, f.base, job, reply, f.id)
    assert.ok(candidate.removeIds.includes('original')); assert.ok(candidate.catalog.families.length)
    await stage(f, job, candidate, fail); await completeRefinement(f.bucket, f.id, job.id)
    const current = (await readEditableCatalog(f.bucket, f.id))!
    assert.equal(catalogTemplates(current).some(t => t.id === 'original'), fail)
    assert.equal(current.id === f.base.id, fail)
  }
})
test('missing-caption feedback cannot silently discard the old text; extra-element feedback may narrow it', async () => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, { ...request(f), mode: 'feedback', templateId: 'original', feedback: 'incomplete' })
  const reply = { slides: [{ slide: 1, blocks: [{ ...f.first, sourceIds: ['value'], data: { value: '43', unit: '%' } }], note: '' }] }
  assert.throws(() => validateRefinementReply(reply, f.visual, job, 1), /проверку объектов/)
  const narrowed = { ...job, input: { ...job.input, feedback: 'extra' as const } }
  assert.doesNotThrow(() => validateRefinementReply(reply, f.visual, narrowed, 1))
})
test('repeated observations are deduplicated and cannot delete or alter existing components', async () => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, request(f))
  const candidate = await compileRefinementCandidate(f.visual, f.base, job, { slides: [{ slide: 1, blocks: [f.first], note: '' }] }, f.id)
  assert.equal(candidate.catalog.families.length, 0); assert.equal(candidate.duplicates, 1)
  await stage(f, job, candidate); const done = await completeRefinement(f.bucket, f.id, job.id)
  assert.equal(done.result!.added, 0); assert.equal((await readEditableCatalog(f.bucket, f.id))!.id, f.base.id)
})
test('cancellation during a provider response cannot resurrect work or publish a candidate', async t => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, request(f))
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(r => { entered = r }), paused = new Promise<void>(r => { release = r })
  t.mock.method(globalThis, 'fetch', async () => { entered(); await paused; return modelResponse(f.reply) })
  const running = advanceRefinement(f.bucket, f.id, job.id, refinementConfig); const outcome = assert.rejects(running, /остановлено/)
  await started; await cancelRefinement(f.bucket, f.id, job.id); release(); await outcome
  assert.equal((await readRefinementJob(f.bucket, f.id, job.id))!.status, 'cancelled')
  assert.equal((await readEditableCatalog(f.bucket, f.id))!.id, f.base.id)
  await assert.rejects(() => completeRefinement(f.bucket, f.id, job.id), /Проверены не все/)
})
test('source/catalog changes fail closed and retries never reset the model budget', async t => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, request(f)); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('network failure') })
  await assert.rejects(() => advanceRefinement(f.bucket, f.id, job.id, refinementConfig))
  assert.equal((await readRefinementJob(f.bucket, f.id, job.id))!.budget.used, 1)
  await retryRefinement(f.bucket, f.id, job.id)
  await assert.rejects(() => advanceRefinement(f.bucket, f.id, job.id, refinementConfig))
  const exhausted = await retryRefinement(f.bucket, f.id, job.id)
  assert.equal(exhausted.tasks[0].status, 'skipped'); assert.equal(exhausted.budget.used, 2)
  assert.equal(calls, 2)
  await cancelRefinement(f.bucket, f.id, job.id)
  const next = await requestRefinement(f.bucket, f.id, request(f))
  const updatedBase = { ...f.base, id: 'd'.repeat(64) }; updatedBase.qualification = passingReport(updatedBase)
  await f.bucket.put(f.baseKey, JSON.stringify(updatedBase))
  await assert.rejects(() => advanceRefinement(f.bucket, f.id, next.id, refinementConfig), /Каталог изменился/)
  assert.equal((await readRefinementJob(f.bucket, f.id, next.id))!.status, 'failed'); assert.equal(calls, 2)
})
test('publication recovers after losing the final job receipt without another version or paid call', async t => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, request(f)), candidate = await compileRefinementCandidate(f.visual, f.base, job, f.reply, f.id)
  await stage(f, job, candidate)
  const put = f.bucket.put.bind(f.bucket); let crashed = false
  t.mock.method(f.bucket, 'put', async (key: string, value: string, options: R2PutOptions) => {
    if (!crashed && key.endsWith(`/requests/${job.id}.json`) && JSON.parse(value).status === 'complete') { crashed = true; throw Error('crash') }
    return put(key, value, options)
  })
  await assert.rejects(() => completeRefinement(f.bucket, f.id, job.id), /crash/)
  const published = (await readEditableCatalog(f.bucket, f.id))!.id
  assert.notEqual(published, f.base.id); assert.equal((await readRefinementRegistry(f.bucket, f.id)).pending, job.id)
  await completeRefinement(f.bucket, f.id, job.id)
  assert.equal((await readEditableCatalog(f.bucket, f.id))!.id, published)
  assert.equal((await readRefinementRegistry(f.bucket, f.id)).history.length, 1)
  assert.equal((await readRefinementRegistry(f.bucket, f.id)).pending, null)
})
test('coverage is an observation ledger, not a claim that all unassigned text is a missing component', async () => {
  const f = await refinementFixture(), scene = readSourceScene(f.visual.snapshot)
  assert.equal(scene.invalid.size, 0)
  const coverage = refinementCoverage(f.visual.snapshot, f.base)
  assert.equal(coverage[0].reviewed, false); assert.equal(coverage[0].visible, 6)
  assert.equal(coverage[0].represented, 3); assert.equal(coverage[0].unassigned.length, 2)
})

test('large scans stop at twelve slides and prioritize the unreviewed remainder on the next request', async () => {
  const f = await refinementFixture(), snapshot = f.visual.snapshot
  snapshot.slides = Array.from({ length: 15 }, (_, i) => ({ ...snapshot.slides[0], id: `s${i + 1}`, number: i + 1 }))
  snapshot.slideCount = 15
  snapshot.elements = snapshot.slides.flatMap(s => snapshot.elements.map(e => ({ ...e, id: `${e.id}-${s.number}`, slide: s.number })))
  f.base.sourceRevision = await contentHash({ version: EDITABLE_VERSION, snapshot, catalogId: f.base.catalogId })
  await f.bucket.put(`visual/${f.id}/manifest.json`, JSON.stringify(f.visual)); await f.bucket.put(f.baseKey, JSON.stringify(f.base))
  const job = await requestRefinement(f.bucket, f.id, request(f))
  assert.equal(job.tasks.length, 12); assert.equal(job.remaining, 3); assert.equal(job.budget.limit, 24)
  // Record a finished observation of twelve slides without changing source data.
  await mutateRefinementJob(f.bucket, f.id, job.id, j => ({ ...j, tasks: j.tasks.map(t => ({ ...t, status: 'complete' })) }))
  await cancelRefinement(f.bucket, f.id, job.id)
  const second = await requestRefinement(f.bucket, f.id, request(f))
  assert.deepEqual(second.tasks.slice(0, 3).map(t => t.slide), [13,14,15]); assert.equal(second.remaining, 0)
})
test('native table selection retains the whole table and nested groups use absolute coordinates', async () => {
  const f = await refinementFixture(), source = f.visual.snapshot
  const element = (id: string, kind: string, parentId?: string, properties = {}): SourceElement => ({ id, kind, parentId, slide: 1, name: id, properties: { bounds: { x: 0, y: 0, width: 100, height: 40 }, rotation: 0, opacity: 1, visible: true, zIndex: 0, ...properties } })
  source.elements = [element('appearance','group',undefined,{ bounds: { x: 100, y: 250, width: 300, height: 100 }, tableGrid: { rowHeights: [50,50], containers: ['table'], rows: ['row1','row2'], cells: [{id:'cell1',row:0,rowSpan:1},{id:'cell2',row:1,rowSpan:1}] } }), element('table','table','appearance'), element('row1','group','table'), element('row2','group','table'), element('cell1','group','row1'), element('cell2','group','row2'), element('t1','text','cell1',{ text: '10', fontFamily: 'Arial', fontSize: 20 }), element('t2','text','cell2',{text:'20',fontFamily:'Arial',fontSize:20})]
  assert.equal(readSourceScene(source).invalid.size, 0)
  assert.deepEqual(regionSources(source, 1, { x: .04, y: .4, width: .18, height: .2 }), ['appearance'])
  source.elements = [element('root','group',undefined,{bounds:{x:1000,y:300,width:300,height:100}}), element('nested','text','root',{text:'Nested',fontFamily:'Arial',fontSize:20})]
  assert.deepEqual(regionSources(source, 1, { x: .5, y: .5, width: .1, height: .1 }), ['nested'])
})
test('model correction gets one clarification, preserves both raw replies, and succeeds within the same budget', async t => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, { ...request(f), mode: 'region', slide: 1, region: { x: .47, y: 0, width: .33, height: .8 } })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => modelResponse(++calls === 1 ? { slides: [{ slide: 1, blocks: [f.first], note: '' }] } : f.reply))
  await advanceRefinement(f.bucket, f.id, job.id, refinementConfig)
  assert.equal(calls, 2); assert.equal((await readRefinementJob(f.bucket, f.id, job.id))!.budget.used, 2)
  assert.equal((await readRefinementJob(f.bucket, f.id, job.id))!.status, 'checking')
  assert.ok([...f.data.keys()].some(k => /\/clarifications\/.+\/response.json$/.test(k)))
  assert.ok([...f.data.keys()].some(k => /\/responses\/.+\.json$/.test(k)))
})
test('a source revision change before the catalog catches up cannot trigger model analysis', async t => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, request(f)); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return modelResponse(f.reply) })
  f.visual.snapshot.name = 'Changed source'
  await f.bucket.put(`visual/${f.id}/manifest.json`, JSON.stringify(f.visual))
  await assert.rejects(() => advanceRefinement(f.bucket, f.id, job.id, refinementConfig), /Исходник обновился/)
  assert.equal(calls, 0)
})

test('multiple selections on the same slide queue separately, rebase before work and keep their own budgets',async t=>{
 const f=await refinementFixture(),region={x:.47,y:0,width:.33,height:.8},args={mode:'region',catalogId:f.base.id,slide:1,region,note:''}
 const first=await requestRefinement(f.bucket,f.id,{...args,id:crypto.randomUUID()}),second=await requestRefinement(f.bucket,f.id,{...args,id:crypto.randomUUID()})
 assert.deepEqual((await readRefinementRegistry(f.bucket,f.id)).queue,[second.id])
 await requestRefinement(f.bucket,f.id,{...args,id:second.id})
 assert.deepEqual((await readRefinementRegistry(f.bucket,f.id)).queue,[second.id])
 await assert.rejects(()=>reserveRefinementRequest(f.bucket,f.id,second.id,1),/остановлено/)
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return modelResponse(f.reply)})
 await advanceRefinement(f.bucket,f.id,first.id,refinementConfig)
 await reportRefinement(f.bucket,f.id,first.id,passingReport((await refinementCandidate(f.bucket,f.id,first.id))!.catalog))
 await completeRefinement(f.bucket,f.id,first.id)
 const catalog=(await readEditableCatalog(f.bucket,f.id))!
 assert.equal((await readRefinementRegistry(f.bucket,f.id)).pending,second.id)
 await advanceRefinement(f.bucket,f.id,second.id,refinementConfig)
 const next=(await readRefinementJob(f.bucket,f.id,second.id))!
 assert.equal(next.baseId,catalog.id);assert.equal(next.input.catalogId,f.base.id)
 assert.equal(next.budget.used,1);assert.equal(next.budget.limit,2);assert.equal(calls,2)
 assert.equal((await readRefinementJob(f.bucket,f.id,first.id))!.budget.used,1)
 await reportRefinement(f.bucket,f.id,second.id,passingReport((await refinementCandidate(f.bucket,f.id,second.id))!.catalog));await completeRefinement(f.bucket,f.id,second.id)
 assert.equal((await readEditableCatalog(f.bucket,f.id))!.id,catalog.id,'a duplicate does not replace the published catalog')
 assert.equal((await readRefinementRegistry(f.bucket,f.id)).pending,null)
})
test('cancelling a waiting area leaves the running request intact; cancelling it starts the next',async()=>{
 const f=await refinementFixture(),args={mode:'region',catalogId:f.base.id,slide:1,region:{x:.47,y:0,width:.33,height:.8},note:''}
 const jobs=[];for(let i=0;i<3;i++)jobs.push(await requestRefinement(f.bucket,f.id,{...args,id:crypto.randomUUID()}))
 await cancelRefinement(f.bucket,f.id,jobs[1].id)
 assert.equal((await readRefinementRegistry(f.bucket,f.id)).pending,jobs[0].id)
 assert.deepEqual((await readRefinementRegistry(f.bucket,f.id)).queue,[jobs[2].id])
 await cancelRefinement(f.bucket,f.id,jobs[0].id)
 assert.equal((await readRefinementRegistry(f.bucket,f.id)).pending,jobs[2].id)
 assert.equal((await readRefinementJob(f.bucket,f.id,jobs[1].id))!.budget.used,0)
})

test('a structure-only pass splits coarse native groups with zero model budget and ordinary qualification',async t=>{
 const f=await refinementFixture(),{compileEditableProposal,groupEditableTemplates}=await import('../lib/design-system/editable-source')
 const coarse=compileEditableProposal({...f.first,id:'coarse',kind:'diagram',data:{},sourceIds:f.visual.snapshot.elements.map(e=>e.id)},1,f.visual.snapshot,f.id,[])
 f.base.families=await groupEditableTemplates([coarse]);f.base.qualification=passingReport(f.base);await f.bucket.put(f.baseKey,JSON.stringify(f.base))
 const before=f.data.get(f.baseKey)!.value,job=await requestRefinement(f.bucket,f.id,{...request(f),nativeOnly:true});assert.equal(job.budget.limit,0)
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('model forbidden')})
 await advanceRefinement(f.bucket,f.id,job.id,refinementConfig)
 const candidate=(await refinementCandidate(f.bucket,f.id,job.id))!;assert.ok(candidate.catalog.families.flatMap(f=>f.variants).filter(t=>t.kind==='feature').length>=2)
 await reportRefinement(f.bucket,f.id,job.id,passingReport(candidate.catalog));const done=await completeRefinement(f.bucket,f.id,job.id)
 assert.equal(calls,0);assert.equal(done.budget.used,0);assert.ok(done.result!.added>=2);assert.equal(f.data.get(f.baseKey)!.value,before)
})

test('an exhausted invalid region is reported and releases the next queued selection without a third model call',async t=>{
 const f=await refinementFixture(),args={mode:'region',catalogId:f.base.id,slide:1,region:{x:.47,y:0,width:.33,height:.8},note:''}
 const first=await requestRefinement(f.bucket,f.id,{...args,id:crypto.randomUUID()}),second=await requestRefinement(f.bucket,f.id,{...args,id:crypto.randomUUID()})
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return modelResponse({slides:[{slide:1,blocks:[{...f.second,sourceIds:['missing-id']}],note:''}]})})
 await advanceRefinement(f.bucket,f.id,first.id,refinementConfig)
 const failed=(await readRefinementJob(f.bucket,f.id,first.id))!
 assert.equal(failed.tasks[0].status,'skipped');assert.equal(failed.budget.used,2);assert.equal(calls,2)
 await completeRefinement(f.bucket,f.id,first.id)
 assert.equal((await readRefinementRegistry(f.bucket,f.id)).pending,second.id)
 assert.equal((await readRefinementJob(f.bucket,f.id,second.id))!.budget.used,0)
})
