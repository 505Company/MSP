import test from 'node:test'
import assert from 'node:assert/strict'
import { intelionCase, intelionPrices, estimateIntelionCost, canContinueSyntheticTool, INTELION_URL, INTELION_MODEL } from '../scripts/intelion-compliance'
import { captureCompletion } from '../scripts/provider-compliance-transport'
import { buildReport, type ProviderContext } from '../scripts/provider-compliance-report'
import type { Case } from '../scripts/provider-compliance-suite'

const fixture: Case = { id: 'context-24500', title: 'same content', group: 10, body: { messages: [{ role: 'user', content: 'retained fixture' }], reasoning: { enabled: false }, max_tokens: 1024, temperature: 1 },
  estimatedInputTokens: 24500, validate: () => ({ status: 'PASS', detail: '' }) }

test('Intelion translates only common thinking control and leaves paired dialect probes and source fixtures untouched', () => {
  const saved = JSON.stringify(fixture.body), adapted = intelionCase(fixture)
  assert.deepEqual(adapted.body.chat_template_kwargs, { enable_thinking: false })
  assert.equal(adapted.body.reasoning, undefined)
  assert.deepEqual(adapted.body.messages, fixture.body.messages)
  assert.equal(adapted.body.max_tokens, fixture.body.max_tokens)
  assert.equal(JSON.stringify(fixture.body), saved)
  for (const id of ['native-off', 'native-low', 'routerai-off', 'routerai-xhigh']) {
    const probe = { ...fixture, id }
    assert.equal(intelionCase(probe), probe)
  }
})

test('Intelion pricing converts kopecks per million to rubles per token and never labels estimates as billing', async () => {
  const prices = intelionPrices({ meta: { pricing: { input: 700, output: 2100, cache_read_incl_vat: 350, unit: 'RUB_KOPECKS/1M_tokens' } } })
  assert.equal(prices.promptRubPerToken, .000007)
  assert.equal(prices.completionRubPerToken, .000021)
  const capture = await captureCompletion(new Response(JSON.stringify({ model: INTELION_MODEL, choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000000, completion_tokens: 1000000, prompt_tokens_details: { cached_tokens: 500000 } } }), { headers: { 'content-type': 'application/json' } }), performance.now())
  assert.equal(estimateIntelionCost(capture, prices), 26.25)
  assert.throws(() => intelionPrices({ meta: { pricing: { input: 700, output: 2100, unit: 'unknown' } } }), /Unknown.*pricing unit/)
})

test('Intelion report distinguishes direct endpoint identity from receipts and fails declared AWQ against BF16', async () => {
  const provider: ProviderContext = { kind: 'direct', label: 'Intelion', apiModel: INTELION_MODEL, baseUrl: INTELION_URL, declaredQuantization: 'AWQ', primaryDialect: 'native' }
  const capture = await captureCompletion(new Response(JSON.stringify({ model: INTELION_MODEL, choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { headers: { 'content-type': 'application/json' } }), performance.now())
  const result = { id: fixture.id, group: fixture.group, title: '', at: '', requestHash: '', capture, receipt: null, receiptError: null,
    endpointEvidence: { baseUrl: INTELION_URL, model: INTELION_MODEL, requestedModel: INTELION_MODEL, modelMatches: true }, verdict: { status: 'PASS' as const, detail: '' } }
  const report = buildReport('intelion-test', [fixture], [result], {}, provider)
  assert.equal(report.checks.find(check => check.item === 1)?.status, 'PARTIAL')
  assert.equal(report.checks.find(check => check.item === 2)?.status, 'FAIL')
  assert.equal(report.cases[0].verdict.status, 'PASS')
  assert.equal(report.cases[0].receipt, null)
  const mismatched = buildReport('intelion-test', [fixture], [{ ...result, endpointEvidence: { ...result.endpointEvidence, modelMatches: false } }], {}, provider)
  assert.equal(mismatched.cases[0].verdict.status, 'UNVERIFIED')
})

test('only the exact harmless synthetic tool call may continue despite the incorrect stop finish reason', async () => {
  const capture = await captureCompletion(new Response(JSON.stringify({ model: INTELION_MODEL, choices: [{ message: { tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'add_numbers', arguments: '{"a":17,"b":23}' } }] }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }), performance.now())
  assert.equal(canContinueSyntheticTool(capture), true)
  assert.equal(capture.finishReason, 'stop')
  assert.equal(canContinueSyntheticTool({ ...capture, toolCalls: [capture.toolCalls[0], capture.toolCalls[0]] }), false)
  assert.equal(canContinueSyntheticTool({ ...capture, toolCalls: [{ ...capture.toolCalls[0], function: { name: 'add_numbers', arguments: '{"a":17,"b":24}' } }] }), false)
})
