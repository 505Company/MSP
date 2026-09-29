import test from 'node:test'
import assert from 'node:assert/strict'
import { compactDesignerTask, compactTypesetterTask, compactDiagnosticTask, compactTextEvidence, taskSize } from '../lib/presentations/compact-two-qwen-task'
import { fastTwoDesignerTask, fastTwoTypesetterTask, type PixelTextEvidence } from '../lib/presentations/fast-two-qwen-task'
import { pixelComponentCatalog } from '../lib/presentations/pixel-contract'
import { pixelFixture } from './fixtures/pixel-layout'

const evidence: PixelTextEvidence = { version: 'pixel-text-evidence-1', fontToken: 'font-1', widths: [320, 640],
  rows: [{ fragments: ['body'], fontSize: 32, weight: 400, lineHeight: 39, lines: [4, 2] }] }

test('compact designer preserves every source fragment, rule and available choice without mutating the original recipe', () => {
  const { env } = pixelFixture(true)
  env.input.rules.push('Synthetic mandatory style rule')
  const before = JSON.stringify(env), preview = 'data:image/png;base64,fixture'
  const old = fastTwoDesignerTask(env, preview), task = compactDesignerTask(env, preview)
  const parts = task.messages[1].content
  assert.ok(Array.isArray(parts)); assert.equal(parts[0].type, 'text')
  const payload = JSON.parse((parts[0] as { text: string }).text)
  assert.deepEqual(payload.source, env.input.content)
  assert.deepEqual(payload.styleRules, env.input.rules)
  assert.deepEqual(payload.components.map((c: { id: string }) => c.id), pixelComponentCatalog(env).map(c => c.id))
  assert.equal(payload.authorV1, undefined)
  assert.equal(payload.authorGuide.version, 'pixel-author-guide-1')
  assert.equal(JSON.stringify(parts[1]).includes(preview), true)
  assert.ok(taskSize(task).textCharacters < taskSize(old).textCharacters * .6)
  assert.equal(JSON.stringify(env), before)
  assert.deepEqual(task.sampling, old.sampling)
  assert.equal(task.reasoningEffort, old.reasoningEffort); assert.equal(task.maxTokens, old.maxTokens)
})

test('compact typesetter gets only the selected component with exact field geometry, bindings and lossless text measurements', () => {
  const { env, brief, hash } = pixelFixture(true)
  const extra = structuredClone(env.input.components[0]); extra.id = 'unselected-component'
  env.input.components.push(extra)
  const before = JSON.stringify({ env, brief, evidence }), task = compactTypesetterTask(env, brief, hash, evidence)
  const payload = JSON.parse(task.messages[1].content as string)
  assert.deepEqual(payload.source, env.input.content); assert.deepEqual(payload.brief, brief); assert.equal(payload.briefHash, hash)
  assert.equal(payload.components.length, 1); assert.equal(payload.components[0].id, brief.groups[1].component!.id)
  const selected = pixelComponentCatalog(env)[0]
  assert.deepEqual(payload.components[0].flow, selected.flow)
  for (let i = 0; i < selected.fields.length; i++) {
    assert.deepEqual(payload.components[0].fields[i].box, selected.fields[i].box)
    assert.equal(payload.components[0].fields[i].fontSize, selected.fields[i].fontSize)
    assert.equal(payload.components[0].fields[i].example, undefined)
  }
  const table = compactTextEvidence(evidence)
  const restored = table.rows.map(row => Object.fromEntries(table.columns.map((key, i) => [key, row[i]])))
  assert.deepEqual(restored, evidence.rows)
  assert.deepEqual(payload.textEvidence, table)
  assert.ok(taskSize(task).textCharacters < taskSize(fastTwoTypesetterTask(env, brief, hash, evidence)).textCharacters)
  assert.equal(JSON.stringify({ env, brief, evidence }), before)
})

test('small diagnostic reuses the exact designer data/image with a bounded short response', () => {
  const { env } = pixelFixture(), designer = compactDesignerTask(env, 'data:image/png;base64,fixture')
  const task = compactDiagnosticTask(designer)
  assert.deepEqual(task.messages.slice(1), designer.messages.slice(1))
  assert.equal(task.maxTokens, 2048); assert.equal(task.thinking, true); assert.equal(task.reasoningEffort, 'low')
  assert.equal(task.schemaName, 'compact_context_diagnostic_v1')
  assert.notEqual(task.schema, designer.schema)
})
