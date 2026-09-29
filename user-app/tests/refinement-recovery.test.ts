import test from 'node:test'
import assert from 'node:assert/strict'
import { refinementFixture, refinementConfig, passingReport } from './fixtures/refinement'
import { requestRefinement, retryRefinement, advanceRefinement, refinementCandidate, reportRefinement, completeRefinement, refinementState, refreshRefinement } from '../lib/design-system/refinement'
import { mutateRefinementJob, readRefinementJob, refinementRoot } from '../lib/design-system/refinement-storage'
import { validateRefinementReply } from '../lib/design-system/refinement'
import { EDITABLE_NOTE_LIMIT, editableModelSchema } from '../lib/design-system/editable-contract'
import { readEditableCatalog } from '../lib/design-system/editable-analysis'

test('a rebuilt catalog rechecks saved proposals locally without losing budget, evidence or pending slides', async t => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, { id: crypto.randomUUID(), mode: 'scan', catalogId: f.base.id, note: '' })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(f.reply) } }] }), { status: 200 }))
  await advanceRefinement(f.bucket, f.id, job.id, refinementConfig)
  const old = (await refinementCandidate(f.bucket, f.id, job.id))!
  await reportRefinement(f.bucket, f.id, job.id, passingReport(old.catalog))
  const before = await mutateRefinementJob(f.bucket, f.id, job.id, j => ({ ...j, tasks: [...j.tasks, { slide: 2, status: 'pending', selectedIds: [] }] }))
  const evidence = new Map([...f.data].filter(([key]) => key.includes('/models/') || key.includes('/candidate-')).map(([key, value]) => [key, value.value]))
  const base = { ...f.base, id: 'd'.repeat(64) }; base.qualification = passingReport(base)
  await f.bucket.put(f.baseKey, JSON.stringify(base))
  t.mock.method(globalThis, 'fetch', async () => { throw Error('no new model request allowed') })
  const refreshed = await refreshRefinement(f.bucket, f.id, job.id)
  assert.equal(refreshed.baseId, base.id); assert.equal(refreshed.originalBaseId, base.id)
  assert.deepEqual(refreshed.budget, before.budget)
  assert.equal(refreshed.tasks[0].status, 'checking'); assert.equal(refreshed.tasks[0].report, undefined)
  assert.equal(refreshed.tasks[0].replayed, true); assert.notEqual(refreshed.tasks[0].candidateKey, before.tasks[0].candidateKey)
  assert.deepEqual(refreshed.tasks[1], before.tasks[1])
  for (const [key, value] of evidence) assert.equal(f.data.get(key)!.value, value)
  assert.deepEqual(await refreshRefinement(f.bucket, f.id, job.id), JSON.parse(JSON.stringify(refreshed)), 'idempotent refresh')
  await assert.rejects(() => reportRefinement(f.bucket, f.id, job.id, passingReport(old.catalog)), /изменилось/)
  const next = (await refinementCandidate(f.bucket, f.id, job.id))!
  await reportRefinement(f.bucket, f.id, job.id, passingReport(next.catalog))
  await mutateRefinementJob(f.bucket, f.id, job.id, j => ({ ...j, tasks: j.tasks.filter(t => t.slide === 1) }))
  const done = await completeRefinement(f.bucket, f.id, job.id)
  assert.ok(done.result!.added > 0); assert.equal((await readEditableCatalog(f.bucket, f.id))!.refinement!.baseId, base.id)
})

test('a source change cannot rebase old model evidence onto a different presentation', async () => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, { id: crypto.randomUUID(), mode: 'scan', catalogId: f.base.id, note: '' })
  await mutateRefinementJob(f.bucket, f.id, job.id, j => ({ ...j, sourceRevision: 'wrong-source', baseId: 'old' }))
  await assert.rejects(() => refreshRefinement(f.bucket, f.id, job.id), /Исходник|Каталог/)
  assert.equal((await readRefinementJob(f.bucket, f.id, job.id))!.baseId, 'old')
})

test('continuing a 3-of-12 scan skips an exhausted slide while preserving completed work and budget', async () => {
  const f = await refinementFixture()
  const job = await requestRefinement(f.bucket, f.id, { id: crypto.randomUUID(), mode: 'scan', catalogId: f.base.id, note: '' })
  const stalled = await mutateRefinementJob(f.bucket, f.id, job.id, j => ({ ...j, status: 'failed', budget: { used: 5, limit: 24, slides: { 1: 1, 2: 1, 3: 1, 4: 2 } }, tasks: Array.from({ length: 12 }, (_, i) => ({ slide: i + 1, selectedIds: [], status: i < 3 ? 'complete' : i === 3 ? 'failed' : 'pending', ...(i === 3 ? { error: 'Ответ модели не прошёл проверку объектов и связей. Исходная дизайн-система сохранена.' } : {}) })) }))
  const resumed = await retryRefinement(f.bucket, f.id, job.id)
  assert.equal(resumed.status, 'queued')
  assert.deepEqual(resumed.tasks.slice(0, 3), stalled.tasks.slice(0, 3))
  assert.equal(resumed.tasks[3].status, 'skipped')
  assert.equal(resumed.tasks[4].status, 'pending')
  assert.deepEqual(resumed.budget, stalled.budget)
})

test('a semantically invalid slide after one clarification does not fail the entire scan', async t => {
  const f = await refinementFixture()
  const job = await requestRefinement(f.bucket, f.id, { id: crypto.randomUUID(), mode: 'scan', catalogId: f.base.id, note: '' })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ slides: [{ slide: 1, blocks: [{ ...f.second, sourceIds: ['nonexistent-object'] }], note: '' }] }) } }] }), { status: 200 })
  })
  await advanceRefinement(f.bucket, f.id, job.id, refinementConfig)
  const current = (await readRefinementJob(f.bucket, f.id, job.id))!
  assert.equal(calls, 2)
  assert.equal(current.tasks[0].status, 'skipped')
  assert.equal(current.status, 'queued')
  assert.equal(current.budget.used, 2)
})

test('an explanatory note over 400 characters cannot invalidate an otherwise valid empty second pass', async () => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, { id: crypto.randomUUID(), mode: 'scan', catalogId: f.base.id, note: '' })
  const note = 'Область уже описана в исходном каталоге; нового самостоятельного блока нет. '.repeat(9)
  assert.ok(note.length > 400)
  const raw = { slides: [{ slide: 1, blocks: [], note }] }, before = structuredClone(raw)
  assert.equal(validateRefinementReply(raw, f.visual, job, 1).slides[0].note, note)
  assert.deepEqual(raw, before)
  assert.throws(() => validateRefinementReply({ slides: [{ slide: 1, blocks: [{ ...f.second, sourceIds: ['nonexistent'] }], note }] }, f.visual, job, 1), /проверку объектов/)
  assert.equal(editableModelSchema.properties.slides.items.properties.note.maxLength, EDITABLE_NOTE_LIMIT)
  assert.throws(() => validateRefinementReply({ slides: [{ slide: 1, blocks: [], note: 'x'.repeat(EDITABLE_NOTE_LIMIT + 1) }] }, f.visual, job, 1))
})

test('legacy exhausted tasks revalidate the exact saved clarification without a model call or overwritten evidence', async t => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, { id: crypto.randomUUID(), mode: 'scan', catalogId: f.base.id, note: '' })
  const runId = crypto.randomUUID(), prefix = `${refinementRoot(f.id)}/models/${'d'.repeat(64)}`
  const run = { id: runId, status: 'failed', clarificationRequests: 1, liveRequests: 2, scope: { uploadId: f.id, sourceRevision: f.base.sourceRevision }, error: { code: 'SEMANTIC_VALIDATION', message: 'Ответ модели не прошёл проверку объектов и связей.', issues: ['slides.0.note: String must contain at most 400 character(s)'] } }
  const reply = { slides: [{ slide: 1, blocks: [], note: 'Объекты уже разобраны. '.repeat(25) }] }
  await f.bucket.put(`${prefix}/runs/${runId}.json`, JSON.stringify(run))
  await f.bucket.put(`${prefix}/clarifications/${runId}/response.json`, JSON.stringify({ content: JSON.stringify(reply), finishReason: 'stop' }))
  await mutateRefinementJob(f.bucket, f.id, job.id, j => ({ ...j, status: 'failed', budget: { used: 2, limit: 2, slides: { 1: 2 } }, tasks: j.tasks.map(t => ({ ...t, status: 'failed', runId, error: run.error.message })) }))
  const evidence = [...f.data].filter(([key]) => key.startsWith(prefix)).map(([key, item]) => [key, item.value])
  const originalJob = (await readRefinementJob(f.bucket, f.id, job.id))!
  const visible = await refinementState(f.bucket, f.id)
  assert.match(visible.jobs[0].tasks[0].error!, /пояснение.*длинным/)
  assert.deepEqual(await readRefinementJob(f.bucket, f.id, job.id), originalJob, 'GET does not rewrite old state')
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('must not call model') })
  const resumed = await retryRefinement(f.bucket, f.id, job.id)
  assert.equal(resumed.status, 'checking'); assert.equal(resumed.tasks[0].replayed, true)
  assert.equal(resumed.tasks[0].note, reply.slides[0].note); assert.equal(resumed.budget.used, 2); assert.equal(calls, 0)
  const candidate = (await refinementCandidate(f.bucket, f.id, job.id))!
  await reportRefinement(f.bucket, f.id, job.id, passingReport(candidate.catalog))
  const complete = await completeRefinement(f.bucket, f.id, job.id)
  assert.equal(complete.result!.skipped, 0); assert.equal(complete.status, 'complete')
  assert.equal((await readEditableCatalog(f.bucket, f.id))!.id, f.base.id)
  for (const [key, value] of evidence) assert.equal(f.data.get(key)!.value, value)
})

test('a partial scan publishes only qualified additions and keeps a visible skipped-slide receipt', async t => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, { id: crypto.randomUUID(), mode: 'scan', catalogId: f.base.id, note: '' })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(f.reply) } }] }), { status: 200 }))
  await advanceRefinement(f.bucket, f.id, job.id, refinementConfig)
  const candidate = (await refinementCandidate(f.bucket, f.id, job.id))!
  await reportRefinement(f.bucket, f.id, job.id, passingReport(candidate.catalog))
  await mutateRefinementJob(f.bucket, f.id, job.id, j => ({ ...j, status: 'failed', budget: { ...j.budget, used: 3, limit: 4, slides: { 1: 1, 2: 2 } }, tasks: [...j.tasks, { slide: 2, status: 'failed', selectedIds: [], error: 'Неверные ссылки на объекты' }] }))
  await assert.rejects(() => completeRefinement(f.bucket, f.id, job.id), /Проверены не все/)
  await retryRefinement(f.bucket, f.id, job.id)
  const done = await completeRefinement(f.bucket, f.id, job.id)
  assert.equal(done.result!.skipped, 1); assert.ok(done.result!.added > 0)
  assert.equal(done.tasks[1].error, 'Неверные ссылки на объекты')
  assert.equal(done.budget.used, 3)
  const catalog = (await readEditableCatalog(f.bucket, f.id))!
  assert.notEqual(catalog.id, f.base.id); assert.ok(catalog.families.flatMap(f => f.variants).some(t => t.id === 'original'))
})

test('transport or authentication failure pauses the scan instead of hiding a global outage as skipped slides', async t => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, { id: crypto.randomUUID(), mode: 'scan', catalogId: f.base.id, note: '' })
  t.mock.method(globalThis, 'fetch', async () => new Response('Unauthorized', { status: 401 }))
  await assert.rejects(() => advanceRefinement(f.bucket, f.id, job.id, refinementConfig))
  assert.equal((await readRefinementJob(f.bucket, f.id, job.id))!.status, 'failed')
  assert.equal((await readRefinementJob(f.bucket, f.id, job.id))!.tasks[0].status, 'failed')
})

test('saved but unfinished JSON cannot be promoted to a complete slide on retry', async t => {
  const f = await refinementFixture(), job = await requestRefinement(f.bucket, f.id, { id: crypto.randomUUID(), mode: 'scan', catalogId: f.base.id, note: '' })
  const runId = crypto.randomUUID(), prefix = `${refinementRoot(f.id)}/models/${'e'.repeat(64)}`
  await f.bucket.put(`${prefix}/runs/${runId}.json`, JSON.stringify({ id: runId, status: 'failed', clarificationRequests: 0, scope: { uploadId: f.id, sourceRevision: f.base.sourceRevision } }))
  await f.bucket.put(`${prefix}/responses/${runId}.json`, JSON.stringify({ content: JSON.stringify(f.reply), finishReason: 'length' }))
  await mutateRefinementJob(f.bucket, f.id, job.id, j => ({ ...j, status: 'failed', budget: { used: 2, limit: 2, slides: { 1: 2 } }, tasks: j.tasks.map(t => ({ ...t, status: 'failed', runId, modelPrefix: prefix, error: 'Модель не завершила ответ.' })) }))
  t.mock.method(globalThis, 'fetch', async () => { throw Error('must not call model') })
  const resumed = await retryRefinement(f.bucket, f.id, job.id)
  assert.equal(resumed.tasks[0].status, 'skipped'); assert.equal(resumed.tasks[0].replayed, undefined)
  assert.equal(await refinementCandidate(f.bucket, f.id, job.id), null)
  assert.equal(resumed.budget.used, 2)
})
test('large source typography is valid and numeric bounds are advertised to the model',async()=>{
  const f=await refinementFixture(),job=await requestRefinement(f.bucket,f.id,{id:crypto.randomUUID(),mode:'scan',catalogId:f.base.id,note:''})
  const reply=structuredClone(f.reply);reply.slides[0].blocks[0].style.fontSize=92
  assert.equal(validateRefinementReply(reply,f.visual,job,1).slides[0].blocks[0].style.fontSize,92)
  const schema=JSON.parse(JSON.stringify(editableModelSchema)),style=schema.properties.slides.items.properties.blocks.items.anyOf[0].properties.style.properties
  assert.ok(style.fontSize.maximum>=92);assert.equal(style.fontSize.minimum,10)
  reply.slides[0].blocks[0].style.fontSize=100000
  assert.throws(()=>validateRefinementReply(reply,f.visual,job,1))
})
test('valid neighbouring blocks do not invalidate the card inside a user selection',async()=>{
  const f=await refinementFixture(),job=await requestRefinement(f.bucket,f.id,{id:crypto.randomUUID(),mode:'scan',catalogId:f.base.id,note:''})
  job.mode='region';job.tasks[0].selectedIds=[f.second.sourceIds[0]]
  const reply=structuredClone(f.reply);reply.slides[0].blocks.push(f.first)
  const before=structuredClone(reply)
  const selected=validateRefinementReply(reply,f.visual,job,1)
  assert.ok(selected.slides[0].blocks.some(b=>b.id===f.second.id))
  assert.ok(selected.slides[0].blocks.length<reply.slides[0].blocks.length)
  assert.deepEqual(reply,before)
  assert.throws(()=>validateRefinementReply({slides:[{slide:1,blocks:[{...f.second,sourceIds:['nonexistent']}],note:''}]},f.visual,job,1),/проверку объектов/)
})
