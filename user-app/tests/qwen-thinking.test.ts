import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryBucket } from './helpers/memory-bucket'
import { beginModelRun } from '../lib/uploads/model-run'
import type { StructuredRequest } from '../lib/uploads/qwen-structured'

test('reasoning is explicit, part of the persisted cache identity and off for legacy requests', async t => {
  const { bucket, data } = memoryBucket(), requested: boolean[] = []
  t.mock.method(globalThis, 'fetch', async (_: unknown, options: RequestInit) => {
    requested.push(JSON.parse(String(options.body)).chat_template_kwargs.enable_thinking)
    return new Response(JSON.stringify({ id: 'synthetic', model: 'test', choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }), { headers: { 'Content-Type': 'application/json' } })
  })
  const task: StructuredRequest = { messages: [{ role: 'user', content: 'Synthetic test' }], schemaName: 'test', schema: { type: 'object' }, maxTokens: 100 }
  const options = { bucket, prefix: 'test/thinking', task, config: { apiKey: 'synthetic', baseUrl: 'https://provider.invalid/v1', model: 'test' }, version: 'test', scope: {}, validate: (raw: unknown) => raw }
  const legacy = await beginModelRun(options); await legacy.execute!()
  const reasoned = await beginModelRun({ ...options, task: { ...task, thinking: true } }); await reasoned.execute!()
  assert.deepEqual(requested, [false, true])
  assert.notEqual(legacy.run.inputHash, reasoned.run.inputHash)
  const inputs = [...data].filter(([key]) => key.includes('/inputs/')).map(([, record]) => JSON.parse(record.value))
  assert.deepEqual(inputs.map(input => input.thinking), [false, true])
  const cachedLegacy = await beginModelRun(options)
  assert.equal(cachedLegacy.run.inputHash, legacy.run.inputHash)
  assert.equal(cachedLegacy.execute, null)
  const cachedReasoned = await beginModelRun({ ...options, task: { ...task, thinking: true } })
  assert.equal(cachedReasoned.run.inputHash, reasoned.run.inputHash)
  assert.equal(cachedReasoned.execute, null)
  assert.equal(requested.length, 2)
})
