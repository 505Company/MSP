import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryBucket } from './helpers/memory-bucket'
import { beginModelRun } from '../lib/uploads/model-run'
import type { StructuredRequest } from '../lib/uploads/qwen-structured'
import { requestStructured } from '../lib/uploads/qwen-structured'
import { QwenAnalysisError, completionResult } from '../lib/uploads/qwen-analysis'
import { QwenObservationRecorder } from '../lib/uploads/qwen-observation'

const task: StructuredRequest = { messages: [{ role: 'user', content: 'Synthetic diagnostic fixture' }], schemaName: 'test', schema: { type: 'object' }, maxTokens: 100, thinking: true }
const config = { apiKey: 'synthetic-key', baseUrl: 'https://provider.invalid/v1', model: 'test' }
const privateReasoning = 'Synthetic reasoning MUST NOT be saved'
const event = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)

for (const ending of ['eof', 'timeout', 'cancel', 'socket', 'sse-error', 'invalid-json'] as const) {
  test(`interrupted ${ending} keeps partial diagnostics in durable model runs without validation or cache`, async t => {
    const { bucket, data } = memoryBucket(), timeout = new AbortController(), cancel = new AbortController()
    let calls = 0, validations = 0, chunk = 0
    t.mock.method(AbortSignal, 'timeout', () => timeout.signal)
    t.mock.method(globalThis, 'fetch', async () => {
      calls++
      const body = new ReadableStream<Uint8Array>({ pull(controller) {
        if (chunk++ === 0) controller.enqueue(event({ id: 'partial-request', model: 'reported', choices: [{ delta: { reasoning_content: privateReasoning } }] }))
        else if (chunk === 2) controller.enqueue(event({ choices: [{ delta: { content: '{"partial":' } }], usage: { prompt_tokens: 11 } }))
        else if (ending === 'eof') controller.close()
        else if (ending === 'sse-error') { controller.enqueue(event({ error: { message: 'untrusted upstream body' } })); controller.close() }
        else if (ending === 'invalid-json') { controller.enqueue(new TextEncoder().encode('data: {broken\n\n')); controller.close() }
        else {
          if (ending === 'timeout') timeout.abort(new DOMException('Timeout', 'TimeoutError'))
          if (ending === 'cancel') cancel.abort()
          controller.error(new Error('Synthetic connection loss'))
        }
      } })
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'x-generation-id': 'header-id' } })
    })
    const job = await beginModelRun({ bucket, prefix: 'observation', task, config, version: 'test', scope: {}, validate: () => { validations++; return {} } })
    await assert.rejects(job.execute!(cancel.signal))
    const saved = data.get(`observation/responses/${job.run.id}.json`)
    assert.ok(saved, 'A stream failure must preserve the partial reply and its diagnostic metadata')
    const reply = JSON.parse(saved.value)
    assert.equal(reply.requestId, 'partial-request')
    assert.equal(reply.generationId, 'header-id')
    assert.equal(reply.reportedModel, 'reported')
    assert.equal(reply.content, '{"partial":')
    assert.deepEqual(reply.usage, { promptTokens: 11, completionTokens: null, totalTokens: null })
    assert.equal(reply.reasoning.characters, privateReasoning.length)
    assert.equal(reply.reasoning.tokens, null)
    assert.equal(reply.observation.contentCharacters, reply.content.length)
    assert.equal(reply.observation.reasoningCharacters, privateReasoning.length)
    assert.ok(reply.observation.responseHeadersMs >= 0)
    assert.ok(reply.observation.firstByteMs >= reply.observation.responseHeadersMs)
    assert.ok(reply.observation.firstContentMs >= reply.observation.firstReasoningMs)
    assert.equal(reply.observation.streamComplete, false)
    assert.deepEqual(job.run.attempts[0].provenance.observation, reply.observation)
    if (ending === 'timeout') assert.equal(job.run.error?.code, 'QWEN_TIMEOUT')
    if (ending === 'cancel') assert.equal(job.run.error?.code, 'QWEN_CANCELLED')
    const all = JSON.stringify([...data.values()])
    for (const secret of [privateReasoning, config.apiKey, 'untrusted upstream body']) assert.equal(all.includes(secret), false)
    assert.equal(calls, 1); assert.equal(validations, 0)
    assert.equal([...data.keys()].some(k => k.includes('/cache/')), false)
  })
}

test('timeout before response headers is distinguishable from a stream timeout', async t => {
  const timeout = new AbortController()
  t.mock.method(AbortSignal, 'timeout', () => timeout.signal)
  t.mock.method(globalThis, 'fetch', async () => { timeout.abort(); throw timeout.signal.reason })
  await assert.rejects(requestStructured(task, config), (e: unknown) => {
    assert.ok(e instanceof QwenAnalysisError)
    assert.equal(e.code, 'QWEN_TIMEOUT'); assert.equal(e.diagnostic?.phase, 'request')
    assert.equal(e.partialResponse?.requestId, null)
    const timing = e.partialResponse!.observation!
    assert.ok(timing.requestSentMs !== null); assert.equal(timing.responseHeadersMs, null)
    assert.equal(timing.firstByteMs, null); assert.equal(timing.firstTokenMs, null)
    return true
  })
})

test('header generation ID survives an empty aborted body', async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error('Synthetic reset')) } }),
    { headers: { 'Content-Type': 'text/event-stream', 'x-generation-id': 'header-only-id' } })
  await assert.rejects(completionResult(response), (e: unknown) => {
    assert.ok(e instanceof QwenAnalysisError)
    assert.equal(e.partialResponse?.requestId, 'header-only-id')
    assert.equal(e.partialResponse?.observation?.firstByteMs, null)
    return true
  })
})

test('timing separates preflight, first bytes, reasoning and content without inventing token counts', () => {
  let now = 100
  const observer = new QwenObservationRecorder(() => now)
  now = 120; observer.sent(); now = 150; observer.headers()
  now = 160; observer.bytes(40); observer.event(); observer.delta('', 0)
  now = 180; observer.event(); observer.delta('', 12)
  now = 220; observer.event(); observer.delta('{}', 0); observer.complete()
  const result = observer.snapshot()
  assert.equal(result.ttftMs, 60); assert.equal(result.responseHeadersMs, 50)
  assert.equal(result.firstByteMs, 60); assert.equal(result.firstReasoningMs, 80)
  assert.equal(result.firstContentMs, 120); assert.equal(result.events, 3)
  assert.equal(result.contentCharacters, 2); assert.equal(result.reasoningCharacters, 12)
  assert.equal(result.contentChunks, 1); assert.equal(result.reasoningChunks, 1)
  assert.equal(result.streamComplete, true)
})

test('a complete-looking JSON and stop without DONE remain a failed partial response', async () => {
  const response = new Response(event({ id: 'missing-done', choices: [{ delta: { content: '{}' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'text/event-stream' } })
  await assert.rejects(completionResult(response), (e: unknown) => {
    assert.ok(e instanceof QwenAnalysisError)
    assert.equal(e.code, 'QWEN_STREAM_INTERRUPTED'); assert.equal(e.partialResponse?.content, '{}')
    assert.equal(e.partialResponse?.observation?.streamComplete, false)
    return true
  })
})
