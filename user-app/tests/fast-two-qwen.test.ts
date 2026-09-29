import test from 'node:test'
import assert from 'node:assert/strict'
import { pixelFixture } from './fixtures/pixel-layout'
import { fastTwoDesignerTask, fastTwoTypesetterTask, fastTwoQwenProfile, type PixelTextEvidence } from '../lib/presentations/fast-two-qwen-task'

test('two sequential roles preserve the source and brief, with reasoning and a two-call time plan', () => {
  const { env, brief, hash } = pixelFixture(), before = JSON.stringify({ env, brief })
  const first = fastTwoDesignerTask(env, 'data:image/png;base64,test')
  const evidence: PixelTextEvidence = { version: 'pixel-text-evidence-1', fontToken: brief.fontToken, widths: [640], rows: [{ fragments: ['body'], fontSize: 32, weight: 400, lineHeight: 39, lines: [2] }] }
  const second = fastTwoTypesetterTask(env, brief, hash, evidence)
  assert.equal(JSON.stringify({ env, brief }), before)
  assert.equal(first.schemaName, 'pixel_designer_brief')
  assert.equal(second.schemaName, 'pixel_typesetter_plan')
  assert.equal(first.reasoningEffort, 'low'); assert.equal(second.reasoningEffort, 'low')
  assert.equal(first.thinking, true); assert.equal(second.thinking, true)
  assert.equal(first.maxTokens, 8192); assert.equal(second.maxTokens, 12288)
  assert.ok(JSON.stringify(second.messages).includes(hash))
  assert.ok(JSON.stringify(second.messages).includes('pixel-text-evidence-1'))
  assert.equal(fastTwoQwenProfile.maxRequests, 2)
  assert.equal(Object.values(fastTwoQwenProfile.plannedSeconds).reduce((a, b) => a + b, 0) * 1000, fastTwoQwenProfile.targetMs)
})
