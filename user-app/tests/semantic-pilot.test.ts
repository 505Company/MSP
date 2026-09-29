import assert from 'node:assert/strict'
import test from 'node:test'
import type { SourceSnapshot } from '../lib/digital-designer/source-types'
import { validateSemanticReply, type SemanticContext, type SemanticReply } from '../lib/design-system/semantic-contract'
import { prepareSemanticPilot } from '../lib/design-system/semantic-pilot'
import { beginModelRun, readModelRun } from '../lib/uploads/model-run'
import {enqueueProcessingJob} from '../lib/uploads/processing-jobs'
import { validateCapabilities } from '../lib/uploads/qwen-capabilities'
import { requestStructured, type StructuredRequest } from '../lib/uploads/qwen-structured'
import { QwenAnalysisError } from '../lib/uploads/qwen-analysis'
import { memoryBucket } from './helpers/memory-bucket'

function fixture(): SemanticContext {
  const base = { rotation: 0, opacity: 1, visible: true, zIndex: 1, bounds: { x: 10, y: 10, width: 100, height: 30 } }
  const elements = [
    { id: 'heading', name: 'Heading', kind: 'text', slide: 1, properties: { ...base, text: 'Заголовок', fontFamily: 'Arial', fontSize: 20 } },
    { id: 'box', name: 'Box', kind: 'rectangle', slide: 1, properties: { ...base, fill: { type: 'solid', color: { r: 0, g: 0, b: 1, a: 1 } } } },
    { id: 'copy', name: 'Copy', kind: 'text', slide: 1, properties: { ...base, text: 'Полный исходный текст', fontFamily: 'Arial', fontSize: 14 } },
  ]
  const snapshot: SourceSnapshot = { schemaVersion: 1, sourceId: 'a'.repeat(64), name: 'Test', slideCount: 1, elements,
    slides: [{ id: 's01', number: 1, width: 960, height: 540, part: 'ppt/slides/slide1.xml', text: '', warnings: [] }], assets: [], colors: [], fonts: [], limitations: [] }
  return { snapshot, batch: { id: 'batch-1', bytes: 1000, nodes: elements.map(e => ({ ...e, styleIds: [] })), context: [], sourceGroups: [] },
    styles: [{ id: 'style-1', kind: 'typography', name: 'Arial', value: {}, occurrences: [{ elementId: 'heading', slide: 1 }], findingIds: [] }], fixedMarkerIds: [] }
}
function reply(): SemanticReply {
  return { styles: [{ styleId: 'style-1', role: 'Заголовок' }], atoms: [{ elementId: 'box', name: 'Подложка', category: 'shape' }],
    molecules: [{ name: 'Карточка', elementIds: ['box', 'copy'], textSlots: [{ elementId: 'copy', label: 'Описание' }] }],
    content: [{ elementId: 'heading', role: 'title' }], rules: [], pending: [] }
}

test('semantic pilot accounts for every supplied node without mutating the source', () => {
  const source = fixture(), before = JSON.stringify(source), result = validateSemanticReply(reply(), source)
  assert.equal(result.coverage.accounted, 3); assert.equal(result.coverage.completeDesignSystem, false)
  assert.equal(result.ledger.find(n => n.elementId === 'heading')?.role, 'title')
  assert.equal(JSON.stringify(source), before)
  const uncertain = reply(); uncertain.molecules = []; uncertain.pending = [{ elementId: 'copy', reason: 'Нужен контекст' }]
  assert.equal(validateSemanticReply(uncertain, source).coverage.unresolved, 1)
})

test('semantic validator rejects fabricated IDs, missing coverage, context-only IDs and unknown styles', () => {
  for (const mutate of [
    (r: SemanticReply) => { r.atoms[0].elementId = 'invented' },
    (r: SemanticReply) => { r.content = [] },
    (r: SemanticReply) => { r.styles[0].styleId = 'unknown-style' },
    (r: SemanticReply) => { r.pending.push({ elementId: 'copy', reason: 'Conflicting' }) },
  ]) { const r = reply(); mutate(r); assert.throws(() => validateSemanticReply(r, fixture())) }
  const source = fixture(), node = source.batch.nodes.pop()!
  source.batch.context.push(node)
  assert.throws(() => validateSemanticReply(reply(), source), /проверку объектов/)
})

test('semantic validator protects text slots, graphics and original rule quotes', () => {
  const source = fixture(), r = reply()
  r.rules = [{ title: 'Оформление', elementIds: ['copy'] }]; r.molecules = []
  const result = validateSemanticReply(r, source)
  assert.equal(result.rules[0].sourceTexts[0].text, 'Полный исходный текст')
  assert.equal(result.rules[0].status, 'candidate')
  const dual = reply(); dual.rules = [{ title: 'Правило внутри образца карточки', elementIds: ['copy'] }]
  const preserved = JSON.stringify(source.snapshot)
  const dualResult = validateSemanticReply(dual, source)
  assert.equal(dualResult.reply.molecules[0].textSlots[0].elementId, 'copy')
  assert.equal(dualResult.rules[0].sourceTexts[0].text, 'Полный исходный текст')
  assert.equal(JSON.stringify(source.snapshot), preserved)
  r.content.push({ elementId: 'copy', role: 'body' })
  assert.throws(() => validateSemanticReply(r, source))
  const marker = fixture(); marker.fixedMarkerIds = ['copy']
  assert.throws(() => validateSemanticReply(reply(), marker))
  const noSlot = reply(); noSlot.molecules[0].textSlots = []
  assert.throws(() => validateSemanticReply(noSlot, fixture()))
  const textGraphic = reply(); textGraphic.atoms.push({ elementId: 'heading', name: 'Icon', category: 'icon' })
  assert.throws(() => validateSemanticReply(textGraphic, fixture()))
})

test('semantic validator rejects cross-slide and overlapping ancestor/child molecules', () => {
  const source = fixture(); source.batch.nodes[2].slide = 2
  assert.throws(() => validateSemanticReply(reply(), source))
  const nested = fixture(); nested.snapshot.elements[2].parentId = 'box'
  assert.throws(() => validateSemanticReply(reply(), nested))
  const whole = fixture()
  whole.snapshot.elements[1].properties.bounds = { x: 0, y: 0, width: 960, height: 540 }
  assert.throws(() => validateSemanticReply(reply(), whole))
})

const task: StructuredRequest = { messages: [{ role: 'user', content: 'Synthetic test input' }], schema: { type: 'object' }, schemaName: 'test', maxTokens: 100 }
const config = { apiKey: 'test-only-key', model: 'test-model', baseUrl: 'https://provider.invalid/v1' }
const validate = (v: unknown) => { assert.deepEqual(v, { accepted: true }); return { accepted: true } }
function response(content = '{"accepted":true}') {
  return new Response(JSON.stringify({ id: 'provider-request', model: 'reported-model', choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 } }), { headers: { 'Content-Type': 'application/json' } })
}

test('durable model jobs reuse only exact validated results, retain originals, and preserve provenance', async t => {
  const { bucket, data } = memoryBucket(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response() })
  await bucket.put('visual/original.json', 'original')
  const options = { bucket, prefix: 'pilot/test', task, config, version: 'v1', scope: { sourceRevision: 'abc' }, validate }
  const first = await beginModelRun(options); await first.execute!()
  const second = await beginModelRun(options)
  assert.equal(second.run.cacheHit, true); assert.equal(second.execute, null); assert.equal(calls, 1)
  assert.equal(second.run.liveRequests, 0); assert.equal(second.run.sourceRunId, first.run.id)
  assert.equal(second.run.provenance?.requestId, 'provider-request')
  assert.equal(second.run.provenance?.reportedModel, 'reported-model')
  assert.equal(second.run.provenance?.usage.totalTokens, 16)
  assert.equal(data.get('visual/original.json')?.value, 'original')
  assert.ok([...data.values()].every(v => !v.value.includes(config.apiKey)))
  const changes = [ { config: { ...config, model: 'new-model' } }, { version: 'v2' }, { scope: { sourceRevision: 'changed' } }, { task: { ...task, messages: [{ role: 'user' as const, content: 'new evidence' }] } } ]
  for (const change of changes) { const changed = await beginModelRun({ ...options, ...change }); assert.notEqual(changed.run.inputHash, first.run.inputHash); await changed.execute!() }
  assert.equal(calls, 5)
  assert.equal((await readModelRun(bucket, 'pilot/test', first.run.id))?.status, 'complete')
})

test('one active claim prevents duplicate paid requests; failed replies are retained but never cached', async t => {
  const { bucket, data } = memoryBucket(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response('{"accepted":false}') })
  const options = { bucket, prefix: 'pilot/test', task, config, version: 'v1', scope: {}, validate }
  const first = await beginModelRun(options)
  await assert.rejects(beginModelRun(options), /уже обрабатывается/)
  await assert.rejects(first.execute!())
  assert.equal(calls, 1); assert.equal((await readModelRun(bucket, 'pilot/test'))?.status, 'failed')
  assert.ok([...data.keys()].some(k => k.includes('/responses/')))
  assert.ok([...data.keys()].every(k => !k.includes('/cache/')))
  const retry = await beginModelRun(options); assert.notEqual(retry.run.id, first.run.id)
})

test('cached answers are revalidated and capability probe verifies both pixels and text', async t => {
  const { bucket, data } = memoryBucket()
  t.mock.method(globalThis, 'fetch', async () => response())
  const options = { bucket, prefix: 'pilot/test', task, config, version: 'v1', scope: {}, validate }
  const first = await beginModelRun(options); await first.execute!()
  const entry = [...data].find(([key]) => key.includes('/cache/'))!
  const value = JSON.parse(entry[1].value); value.reply.content = '{"accepted":false}'
  await bucket.put(entry[0], JSON.stringify(value))
  await assert.rejects(beginModelRun(options))
  const valid = { marker: 'MSP-7K', topLeft: 'red', topRight: 'green', bottomLeft: 'blue', bottomRight: 'yellow' }
  assert.equal(validateCapabilities(valid).imageInput, 'verified')
  assert.throws(() => validateCapabilities({ ...valid, topLeft: 'blue' }))
  assert.throws(() => validateCapabilities({ ...valid, marker: 'wrong' }))
})

test('one targeted clarification reuses a rejected exact response and validates the entire result again', async t => {
  const { bucket } = memoryBucket(); let calls = 0
  const bad = reply(); bad.content = []
  const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return response(JSON.stringify(bad)) })
  const options = { bucket, prefix: 'pilot/clarify', task, config, version: 'v1', scope: {}, validate: (raw: unknown) => validateSemanticReply(raw, fixture()) }
  const first = await beginModelRun(options); await assert.rejects(first.execute!())
  const clarify = { version: 'clarify-1', request: (previous: { content: string }, issues: string[]) => {
    assert.ok(issues.includes('missing-decision:heading')); assert.deepEqual(JSON.parse(previous.content), bad)
    return { ...task, messages: [{ role: 'user' as const, content: 'Clarify the missing heading' }] }
  } }
  mock.mock.mockImplementation(async () => { calls++; return response(JSON.stringify(reply())) })
  const resumed = await beginModelRun({ ...options, clarification: clarify }); await resumed.execute!()
  assert.equal(calls, 2); assert.equal(resumed.run.resumedFromRunId, first.run.id)
  assert.equal(resumed.run.liveRequests, 1); assert.equal(resumed.run.clarificationRequests, 1)
  assert.deepEqual(resumed.run.attempts.map(a => a.reused), [true, false])
  assert.equal(resumed.run.result?.coverage.accounted, 3)
  const cached = await beginModelRun({ ...options, clarification: clarify })
  assert.equal(cached.run.cacheHit, true); assert.equal(calls, 2)
  assert.equal((await readModelRun(bucket, 'pilot/clarify', first.run.id))?.status, 'failed')
})

test('explicit recovery refreshes only rejected work once; successful caches remain reusable',async t=>{
 const {bucket}=memoryBucket();let calls=0,valid=false
 const bad=reply();bad.content=[]
 t.mock.method(globalThis,'fetch',async()=>{calls++;return response(JSON.stringify(valid?reply():bad))})
 const options={bucket,prefix:'pilot/manual-recovery',uploadId:'test',task,config,version:'v1',scope:{},revalidateRejected:true,
  validate:(raw:unknown)=>validateSemanticReply(raw,fixture()),clarification:{version:'clarify-1',request:()=>task}}
 const first=await beginModelRun(options);await assert.rejects(first.execute!());assert.equal(calls,2)
 const repeat=await beginModelRun(options);await assert.rejects(repeat.execute!());assert.equal(calls,2)
 await enqueueProcessingJob(bucket,'test','Deck',true)
 valid=true
 const recovery=await beginModelRun(options);await recovery.execute!();assert.equal(calls,3)
 assert.notEqual(recovery.run.id,first.run.id)
 assert.equal((await readModelRun(bucket,options.prefix,first.run.id))?.status,'failed')
 await enqueueProcessingJob(bucket,'test','Deck',true,Date.now()+1)
 const cached=await beginModelRun(options);assert.equal(cached.run.cacheHit,true);assert.equal(calls,3)
})

test('an invalid clarification stops after the single allowed follow-up, while expired jobs can restart', async t => {
  const { bucket, data } = memoryBucket(); let calls = 0
  const bad = reply(); bad.content = []
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(JSON.stringify(bad)) })
  const options = { bucket, prefix: 'pilot/bounded', task, config, version: 'v1', scope: {}, validate: (raw: unknown) => validateSemanticReply(raw, fixture()), clarification: { version: 'clarify-1', request: () => task } }
  const run = await beginModelRun(options); await assert.rejects(run.execute!())
  assert.equal(calls, 2); assert.equal(run.run.clarificationRequests, 1); assert.equal(run.run.status, 'failed')
  assert.ok([...data.keys()].every(k => !k.includes('/cache/')))
  const waiting = await beginModelRun(options)
  const [key, entry] = [...data].find(([key]) => key.includes('/claims/'))!
  await bucket.put(key, JSON.stringify({ ...JSON.parse(entry.value), expiresAt: 0 }))
  const resumed = await beginModelRun(options)
  assert.notEqual(waiting.run.id, resumed.run.id)
  assert.equal((await readModelRun(bucket, 'pilot/bounded', waiting.run.id))?.error?.code, 'QWEN_INTERRUPTED')
})

test('transport records streaming metadata and rejects truncated, rejected and cancelled attempts without retries', async t => {
  const events = [ { id: 'sse-id', model: 'reported', choices: [{ delta: { content: '{"accepted":true}' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } } ]
  let calls = 0
  const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }) })
  const result = await requestStructured(task, config)
  assert.equal(result.requestId, 'sse-id'); assert.equal(result.usage.totalTokens, 10)
  mock.mock.mockImplementation(async () => { calls++; return new Response('Provider details must not escape', { status: 401 }) })
  await assert.rejects(requestStructured(task, config), (e: unknown) => e instanceof Error && !e.message.includes('Provider details'))
  assert.equal(calls, 2)
  mock.mock.mockImplementation(async () => { calls++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })) })
  await assert.rejects(requestStructured(task, config), /обрезан/)
  const controller = new AbortController(); controller.abort()
  mock.mock.mockImplementation(async (_input: unknown, options?: RequestInit) => { options?.signal?.throwIfAborted(); throw new Error('should not reach') })
  await assert.rejects(requestStructured(task, config, controller.signal), /прерван/)
  mock.mock.mockImplementation(async (_input: unknown, options?: RequestInit) => { assert.equal(options?.redirect, 'manual'); return new Response(null, { status: 302 }) })
  await assert.rejects(requestStructured(task, config), /302/)
})

test('truncated initial and clarification replies retain exact diagnostics but never enter result or cache', async t => {
  for (const clarification of [false, true]) {
    const { bucket, data } = memoryBucket(); let calls = 0
    const partial = '{"accepted":true}', bad = reply(); bad.content = []
    const mock = t.mock.method(globalThis, 'fetch', async () => {
      calls++
      if (clarification && calls === 1) return response(JSON.stringify(bad))
      const events = [
        { id: 'truncated-id', model: 'reported', choices: [{ delta: { content: partial } }] },
        { choices: [{ delta: {}, finish_reason: 'length' }] },
        { choices: [], usage: { prompt_tokens: 20, completion_tokens: 100, total_tokens: 120 } },
      ]
      return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const job = await beginModelRun({ bucket, prefix: 'pilot/truncated', task, config, version: 'v1', scope: {},
      validate: (raw: unknown) => validateSemanticReply(raw, fixture()),
      ...(clarification ? { clarification: { version: 'one-followup', request: () => task } } : {}),
    })
    await assert.rejects(job.execute!(), e => e instanceof QwenAnalysisError && e.code === 'QWEN_TRUNCATED')
    const key = clarification ? `pilot/truncated/clarifications/${job.run.id}/response.json` : `pilot/truncated/responses/${job.run.id}.json`
    const saved = await bucket.get(key)
    assert.ok(saved, 'Keep the provider response even when finish_reason is length')
    const raw = await saved.json<{ content: string; finishReason: string; usage: { completionTokens: number } }>()
    assert.equal(raw.content, partial); assert.equal(raw.finishReason, 'length'); assert.equal(raw.usage.completionTokens, 100)
    const run = (await readModelRun(bucket, 'pilot/truncated'))!
    assert.equal(run.status, 'failed'); assert.equal(run.result, undefined)
    assert.equal(run.error?.diagnostic?.kind, 'output-limit')
    assert.equal(run.attempts.at(-1)?.kind, clarification ? 'clarification' : 'initial')
    assert.equal(run.attempts.at(-1)?.provenance.requestId, 'truncated-id')
    assert.equal(calls, clarification ? 2 : 1)
    assert.ok([...data.keys()].every(k => !k.includes('/cache/')))
    assert.ok([...data.values()].every(v => !v.value.includes(config.apiKey)))
    if (clarification) assert.equal((await (await bucket.get(`pilot/truncated/responses/${job.run.id}.json`))!.json<{ content: string }>()).content, JSON.stringify(bad))
    mock.mock.restore()
  }
})

test('provider rejection retains a safe cause without exposing echoed credentials or material', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Response(JSON.stringify({ error: `Maximum images limit exceeded; Authorization: ${config.apiKey}; private source text` }), { status: 400 })
  })
  await assert.rejects(requestStructured(task, config), (error: unknown) => {
    assert.ok(error instanceof QwenAnalysisError)
    assert.equal(error.code, 'QWEN_HTTP_400')
    assert.equal(error.diagnostic?.kind, 'image-limit')
    assert.ok(!JSON.stringify(error).includes(config.apiKey) && !JSON.stringify(error).includes('private source text'))
    return true
  })
  assert.equal(calls, 1)
})

test('pilot preparation includes verbatim text, measured styles and labelled evidence, and refuses missing previews', async () => {
  const source = fixture().snapshot, { bucket } = memoryBucket()
  const visual = { renderer: 'msp-web-2026-09-25', previewKind: 'reconstruction' as const, snapshot: source, previews: [{ id: 's01', mime: 'image/png' }], assets: [], sheets: [] }
  await assert.rejects(prepareSemanticPilot(bucket, 'test', visual), /превью/)
  await bucket.put('visual/test/preview-s01', 'synthetic-image-bytes')
  const prepared = await prepareSemanticPilot(bucket, 'test', visual)
  const content = JSON.stringify(prepared.task.messages)
  assert.ok(content.includes('Полный исходный текст'))
  assert.ok(content.includes('data:image/png;base64,'))
  assert.equal(prepared.scope.completeDesignSystem, false)
  const first = prepared.scope.sourceRevision
  source.elements[2].properties.text = 'Changed text'
  assert.notEqual((await prepareSemanticPilot(bucket, 'test', visual)).scope.sourceRevision, first)
})

test('a rejected final reply can be rechecked locally without paying for an extra clarification', async t => {
  const {bucket}=memoryBucket();let calls=0,allowPending=false
  const source=fixture(),raw=reply();raw.pending=[{elementId:'copy',reason:'Не уверен'}]
  t.mock.method(globalThis,'fetch',async()=>{calls++;return response(JSON.stringify(raw))})
  const options={bucket,prefix:'full/recheck',task,config,version:'same-prompt',scope:{},revalidateRejected:true,
    validate:(value:unknown)=>validateSemanticReply(value,{...source,pendingOverridesAssignments:allowPending}),
    clarification:{version:'one-followup',request:()=>task}}
  const first=await beginModelRun(options);await assert.rejects(first.execute!());assert.equal(calls,2)
  const stillRejected=await beginModelRun(options);await assert.rejects(stillRejected.execute!());assert.equal(calls,2)
  allowPending=true
  const recovered=await beginModelRun(options);await recovered.execute!()
  assert.equal(calls,2);assert.equal(recovered.run.liveRequests,0);assert.equal(recovered.run.result?.coverage.unresolved,1)
  assert.equal(recovered.run.attempts[0].kind,'clarification');assert.equal(recovered.run.attempts[0].reused,true)
  const cached=await beginModelRun(options);assert.equal(cached.run.cacheHit,true);assert.equal(calls,2)
})
