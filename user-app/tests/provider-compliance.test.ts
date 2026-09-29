import test from 'node:test'
import assert from 'node:assert/strict'
import { captureCompletion, hasReasoning, type JsonObject } from '../scripts/provider-compliance-transport'
import { buildReport } from '../scripts/provider-compliance-report'
import type { Case } from '../scripts/provider-compliance-suite'
import { assessCapture } from '../scripts/provider-compliance-assessment'

function streamed(parts: string[]) {
  const bytes = new TextEncoder().encode(parts.join(''))
  let offset = 0
  return new Response(new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return }
    controller.enqueue(bytes.slice(offset, offset += 7))
  } }), { headers: { 'content-type': 'text/event-stream', 'x-generation-id': 'rai-fixture' } })
}
const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`

test('compliance transport handles split SSE, UTF-8, reasoning aliases and tool arguments without logging reasoning', async () => {
  const logs: JsonObject[] = []
  const capture = await captureCompletion(streamed([
    ': ping\r\n\r\n',
    event({ id: 'upstream-id', choices: [{ delta: { reasoning: 'private рассуждение', reasoning_content: 'private рассуждение' } }] }),
    event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-7', function: { name: 'add_numbers', arguments: '{"a":' } }] } }] }),
    event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '17,"b":23}' } }] }, finish_reason: 'tool_calls' }] }),
    event({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 12 } } }),
    'data: [DONE]\r\n\r\n',
  ]), performance.now(), async value => { logs.push(value) })
  assert.equal(capture.error, null)
  assert.equal(capture.requestId, 'rai-fixture')
  assert.equal(capture.toolCalls[0].function.arguments, '{"a":17,"b":23}')
  assert.equal(capture.reasoningCharacters, 'private рассуждение'.length)
  assert.equal(hasReasoning(capture), true)
  assert.equal(capture.streamDone, true)
  assert.ok(capture.metrics.ttftMs !== null)
  assert.equal(capture.metrics.firstContentMs, null)
  assert.equal(JSON.stringify(logs).includes('рассуждение'), false)
  assert.equal(JSON.stringify(capture).includes('рассуждение'), false)
})

test('compliance transport preserves errors and partial public content when stream ends without a finish reason', async () => {
  const capture = await captureCompletion(streamed([event({ choices: [{ delta: { content: 'Ответ' } }] })]), performance.now())
  assert.equal(capture.content, 'Ответ')
  assert.match(capture.error!, /without finish_reason/)
  assert.equal(capture.streamDone, false)
  const rejected = await captureCompletion(new Response('{"error":"invalid top_k"}', { status: 400 }), performance.now())
  assert.equal(rejected.httpStatus, 400)
  assert.match(rejected.error!, /invalid top_k/)
})

test('unparsed think blocks are removed and cannot produce a fully compliant report without server evidence', async () => {
  const capture = await captureCompletion(streamed([event({ choices: [{ delta: { content: '<think>private draft</think> {"result":708}' }, finish_reason: 'stop' }] })]), performance.now())
  assert.equal(capture.content, '{"result":708}')
  assert.equal(capture.reasoningCharacters, 'private draft'.length)
  assert.equal(JSON.stringify(capture).includes('private draft'), false)
  const cases: Case[] = [{ id: 'synthetic', group: 1, title: 'Synthetic', body: {}, estimatedInputTokens: 1, validate: () => ({ status: 'PASS', detail: '' }) }]
  const report = buildReport('test', cases, [{ id: 'synthetic', group: 1, title: 'Synthetic', requestHash: 'x', at: '', capture,
    receipt: { providerName: 'deepinfra', model: 'qwen/qwen3.8-27b' }, receiptError: null, verdict: { status: 'PASS', detail: '' } }], {})
  assert.notEqual(report.overall, 'COMPLIANT')
  assert.equal(report.checks.find(check => check.item === 2)?.status, 'UNVERIFIED')
  assert.equal(report.checks.find(check => check.item === 1)?.status, 'PARTIAL')
})

test('provider compliance separates a working thinking toggle from arithmetic accuracy', async () => {
  const capture = await captureCompletion(streamed([event({ choices: [{ delta: { content: '{"result":424,"digitSum":12}' }, finish_reason: 'stop' }], usage: { completion_tokens: 23, completion_tokens_details: { reasoning_tokens: 0 } } })]), performance.now())
  const fixture: Case = { id: 'routerai-off', group: 3, title: '', body: {}, estimatedInputTokens: 1, validate: () => ({ status: 'FAIL', detail: 'arithmetic incorrect' }) }
  const assessment = assessCapture(fixture, capture)
  assert.equal(assessment.status, 'PASS')
  assert.equal(assessment.evidence?.arithmeticCorrect, false)
  assert.equal(assessCapture({ ...fixture, id: 'routerai-low' }, capture).status, 'FAIL')
})

test('HTTP-200 SSE validation error is an expected rejection, not a failed negative control', async () => {
  const capture = await captureCompletion(streamed([event({ error: JSON.stringify({ error: { message: "'top_p' must be in (0.0, 1.0]", code: 'invalid_parameter_error' } }) }), 'data: [DONE]\r\n\r\n']), performance.now())
  const fixture: Case = { id: 'reject-top_p', group: 7, title: '', body: {}, estimatedInputTokens: 1, validate: () => ({ status: 'FAIL', detail: 'HTTP200' }) }
  assert.equal(assessCapture(fixture, capture).status, 'PASS')
  assert.equal(assessCapture({ ...fixture, id: 'reject-temperature' }, capture).status, 'UNVERIFIED')
  const report = buildReport('test', [fixture], [{ id: fixture.id, group: 7, title: '', at: '', requestHash: '', capture, receipt: null, receiptError: 'not a generation', verdict: { status: 'FAIL', detail: 'initial verdict' } }], {})
  assert.equal(report.cases[0].verdict.status, 'PASS')
  assert.equal(report.cases[0].originalVerdict?.status, 'FAIL')
})
