import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryBucket } from './helpers/memory-bucket'
import { beginModelRun } from '../lib/uploads/model-run'
import { completionResult } from '../lib/uploads/qwen-analysis'
import { structuredGeneration, type StructuredRequest } from '../lib/uploads/qwen-structured'
import { pixelClarification, withPixelGenerationProfile } from '../lib/presentations/pixel-task'

const base: StructuredRequest = { messages: [{ role: 'user', content: 'Synthetic test input' }], schemaName: 'test', schema: { type: 'object' }, maxTokens: 6500 }
const config = { apiKey: 'synthetic', baseUrl: 'https://provider.invalid/v1', model: 'test' }
const reply = () => new Response(JSON.stringify({ id: 'synthetic', model: 'test', choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }), { headers: { 'Content-Type': 'application/json' } })

test('recommended settings reach the HTTP body and persisted identity without rewriting prompts', async t => {
  const original = structuredClone(base), task = withPixelGenerationProfile(base), { bucket, data } = memoryBucket()
  const bodies: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (_: unknown, options: RequestInit) => { bodies.push(JSON.parse(String(options.body))); return reply() })
  const options = { bucket, prefix: 'settings', config, version: 'test', scope: {}, validate: (raw: unknown) => raw }
  const started = await beginModelRun({ ...options, task }); await started.execute!()
  assert.deepEqual(base, original)
  assert.deepEqual(task.messages, original.messages)
  assert.deepEqual(task.schema, original.schema)
  const expected = { temperature: 1, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 0, repetition_penalty: 1, reasoning_effort: 'xhigh', chat_template_kwargs: { enable_thinking: true } }
  assert.deepEqual(structuredGeneration(task), expected)
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(bodies[0][key], value)
  assert.equal(bodies[0].max_tokens, 32768)
  const saved = JSON.parse(data.get(`settings/inputs/${started.run.inputHash}.json`)!.value)
  assert.equal(saved.temperature, 1)
  assert.deepEqual(saved.generation, expected)
  assert.deepEqual(saved.task, task)
  assert.equal((await beginModelRun({ ...options, task })).execute, null)
  const changed = await beginModelRun({ ...options, task: { ...task, sampling: { ...task.sampling, topP: 0.9 } } })
  assert.notEqual(changed.run.inputHash, started.run.inputHash)
  await changed.execute!()
  assert.equal(bodies.length, 2)
  assert.deepEqual(structuredGeneration(pixelClarification(task, '{}', ['synthetic error'])), expected)
})

test('legacy settings stay byte-equivalent and invalid settings cannot reserve a request', async t => {
  assert.deepEqual(structuredGeneration(base), { temperature: 0.1, chat_template_kwargs: { enable_thinking: false } })
  const { bucket, data } = memoryBucket(); let reservations = 0, requests = 0
  t.mock.method(globalThis, 'fetch', async () => { requests++; return reply() })
  for (const task of [
    { ...base, sampling: { temperature: 3 } }, { ...base, sampling: { topP: 0 } },
    { ...base, sampling: { topK: 1.5 } }, { ...base, sampling: { minP: -1 } },
    { ...base, reasoningEffort: 'xhigh' as const },
  ]) await assert.rejects(beginModelRun({ bucket, prefix: 'invalid', task, config, version: 'test', scope: {}, validate: (raw: unknown) => raw, beforeRequest: async () => { reservations++ } }))
  assert.equal(reservations, 0); assert.equal(requests, 0); assert.equal(data.size, 0)
})

test('reasoning channel statistics survive JSON and SSE without persisting reasoning text', async () => {
  const privateText = 'Synthetic private channel', message = { content: '{"ok":true}', reasoning_content: privateText }
  const result = await completionResult(new Response(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }], usage: { completion_tokens_details: { reasoning_tokens: 7 } } }), { headers: { 'Content-Type': 'application/json' } }))
  assert.deepEqual(result.reasoning, { characters: privateText.length, tokens: 7 })
  assert.equal(JSON.stringify(result).includes(privateText), false)
  const events = [
    { choices: [{ delta: { reasoning_content: privateText, reasoning: privateText } }] },
    { choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'stop' }] },
    { usage: { completion_tokens_details: { reasoning_tokens: 7 } }, choices: [] },
  ].map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n'
  const streamed = await completionResult(new Response(events, { headers: { 'Content-Type': 'text/event-stream' } }))
  assert.deepEqual(streamed.reasoning, result.reasoning)
  assert.equal(streamed.content, result.content)
  assert.equal(JSON.stringify(streamed).includes(privateText), false)
})

test('failed completion endings retain diagnostic metadata and never validate or cache a partial plan', async t => {
  const { bucket, data } = memoryBucket()
  const privateText = 'Synthetic private reasoning that must not be persisted'
  let ending = 'error', content = '{"partial":', validations = 0, requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    const events = [
      { id: 'diagnostic-request', model: 'test', choices: [{ delta: { reasoning_content: privateText } }] },
      { choices: [{ delta: { content }, finish_reason: ending }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21, completion_tokens_details: { reasoning_tokens: 7 } } },
    ].map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n'
    return new Response(events, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  for (ending of ['error', 'content_filter', 'stop']) {
    content = ending === 'stop' ? '' : '{"partial":'
    const prefix = `failed-${ending}`
    const started = await beginModelRun({ bucket, prefix, task: base, config, version: 'test', scope: {}, validate: () => { validations++; return {} } })
    await assert.rejects(started.execute!(), { code: ending === 'stop' ? 'QWEN_EMPTY' : 'QWEN_INCOMPLETE' })
    assert.equal(started.run.status, 'failed')
    const saved = data.get(`${prefix}/responses/${started.run.id}.json`)
    assert.ok(saved, 'The failed provider response must remain available for diagnosis')
    const diagnostic = JSON.parse(saved.value)
    assert.equal(diagnostic.requestId, 'diagnostic-request')
    assert.equal(diagnostic.reportedModel, 'test')
    assert.equal(diagnostic.finishReason, ending)
    assert.equal(diagnostic.content, content)
    assert.deepEqual(diagnostic.usage, { promptTokens: 12, completionTokens: 9, totalTokens: 21 })
    assert.deepEqual(diagnostic.reasoning, { characters: privateText.length, tokens: 7 })
    assert.equal(JSON.stringify([...data.values()]).includes(privateText), false)
    assert.equal([...data.keys()].some(key => key.startsWith(`${prefix}/cache/`)), false)
  }
  assert.equal(requests, 3)
  assert.equal(validations, 0)
})
