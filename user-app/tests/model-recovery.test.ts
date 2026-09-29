import test from 'node:test'
import assert from 'node:assert/strict'
import { beginModelRun, readModelRun } from '../lib/uploads/model-run'
import { memoryBucket } from './helpers/memory-bucket'
import { processingResponse } from '../lib/uploads/processing-response'
import { processingFailure } from '../lib/uploads/automatic-recovery'
import { readProcessingCompletion } from '../lib/uploads/read-processing-response'
import { SemanticValidationError } from '../lib/design-system/semantic-contract'
import type { StructuredRequest } from '../lib/uploads/qwen-structured'

const task: StructuredRequest = { messages: [{ role: 'user', content: 'Read the source' }], schema: { type: 'object' }, schemaName: 'test', maxTokens: 100 }
function options(bucket: R2Bucket) {
  return { bucket, prefix: 'import/models/part', task, config: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', timeoutMs: 300_000 },
    version: 'test', scope: {}, validate: (raw: unknown) => raw, clarification: { version: 'one', request: () => task } }
}
test('a lost model executor can resume within one minute instead of waiting for both model timeouts', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 })
  const { bucket } = memoryBucket(), input = options(bucket), lost = await beginModelRun(input)
  t.mock.timers.tick(46_000)
  const recovered = await beginModelRun(input)
  assert.notEqual(recovered.run.id, lost.run.id)
  assert.equal((await readModelRun(bucket, input.prefix, lost.run.id))?.error?.code, 'QWEN_INTERRUPTED')
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }) })
  await assert.rejects(lost.execute!(), /устарел|владение/, 'A delayed old executor must not send another paid request')
  assert.equal(calls, 0)
  await recovered.execute!()
  assert.equal(calls, 1)
})

test('the processing stream preserves a permanent validation failure so the queue does not retry the same rejected reply', async () => {
  const { response, completion } = processingResponse({ started: true }, async () => { throw new SemanticValidationError(['unassigned-source:background']) })
  const client = response.clone()
  const lines = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
  await completion
  assert.equal(lines.at(-1).code, 'SEMANTIC_VALIDATION')
  const classified = processingFailure(409, lines.at(-1).error, lines.at(-1).code)
  assert.ok('retryable' in classified); assert.equal(classified.retryable, false)
  await assert.rejects(readProcessingCompletion(client), (error: unknown) => error instanceof Error && 'retryable' in error && error.retryable === false)
})

test('a live model request renews its lease and keeps other executors from duplicating it', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_800_000_000_000 })
  const { bucket } = memoryBucket(), input = options(bucket), first = await beginModelRun(input)
  let started!: () => void, finish!: () => void
  const sent = new Promise<void>(resolve => { started = resolve }), gate = new Promise<void>(resolve => { finish = resolve })
  t.mock.method(globalThis, 'fetch', async () => { started(); await gate; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }) })
  const running = first.execute!(); await sent
  const claimKey = `${input.prefix}/claims/${first.run.inputHash}.json`
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(15_000)
    // Let the async CAS heartbeat settle without advancing model timeouts.
    await new Promise<void>(resolve => setImmediate(resolve))
    const lease = await (await bucket.get(claimKey))!.json<{ expiresAt: number }>()
    assert.ok(lease.expiresAt > Date.now())
  }
  await assert.rejects(beginModelRun(input), { code: 'QWEN_ALREADY_RUNNING' })
  finish(); await running
  assert.equal(first.run.status, 'complete')
})

test('an interrupted completion stream remains automatically recoverable', async () => {
  const response = new Response('{"started":true}\n', { status: 202, headers: { 'Content-Type': 'application/x-ndjson' } })
  await assert.rejects(readProcessingCompletion(response), (error: unknown) => error instanceof Error && 'retryable' in error && error.retryable === true)
})

test('explicit recovery revalidates a saved rejection before paying for an answer that already passes the corrected checks', async t => {
  const { bucket } = memoryBucket(); let calls = 0, corrected = false
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }) })
  const input = { ...options(bucket), uploadId: 'import', revalidateRejected: true, validate: (raw: unknown) => {
    if (!corrected) throw new SemanticValidationError(['unknown-disposition:disclosed-parent'])
    return raw
  } }
  const first = await beginModelRun(input)
  await assert.rejects(first.execute!(), { code: 'SEMANTIC_VALIDATION' })
  assert.equal(calls, 2)
  const original = await (await bucket.get(`${input.prefix}/clarifications/${first.run.id}/response.json`))!.text()
  corrected = true
  await bucket.put('processing-jobs/import.json', JSON.stringify({ recoveryRequestedAt: Date.now() }))
  const recovered = await beginModelRun(input)
  await recovered.execute!()
  assert.equal(recovered.run.status, 'complete')
  assert.equal(recovered.run.resumedFromRunId, first.run.id)
  assert.equal(recovered.run.liveRequests, 0)
  assert.equal(calls, 2)
  assert.equal(await (await bucket.get(`${input.prefix}/clarifications/${first.run.id}/response.json`))!.text(), original)
})
