import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pixelFixture } from './fixtures/pixel-layout'
import { adaptiveComponentFixture } from './fixtures/adaptive-layout'
import { layoutStates } from '../lib/presentations/recipes/layout-engine-v1/states'
import { adaptiveVisibleInput, validateFastAdaptive, validateFastPixel, fastPixelTask, fastGeneration, canRepairFastSlide } from '../lib/presentations/fast-slide-task'
import { structuredGeneration } from '../lib/uploads/qwen-structured'
import { routeraiConfig } from '../lib/uploads/routerai'
import { SemanticValidationError } from '../lib/design-system/semantic-contract'

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
test('combined role response retains every model coordinate; only the binding hash is computed', () => {
  const { env, brief, plan } = pixelFixture()
  brief.authorState = layoutStates[0].id
  const { briefHash: _hash, ...rawPlan } = plan
  void _hash
  const raw = { brief, plan: rawPlan }, before = JSON.stringify(raw)
  const result = validateFastPixel(raw, env, hash)
  assert.deepEqual(result.plan, { ...rawPlan, briefHash: hash(result.brief) })
  assert.equal(JSON.stringify(raw), before)
  assert.throws(() => validateFastPixel({ ...raw, plan: { ...rawPlan, texts: rawPlan.texts.slice(1) } }, env, hash))
})
test('fast autolayout cannot hide a body fragment or replace a required library number card with plain text', () => {
  const { input, plan } = adaptiveComponentFixture()
  plan.version = 'adaptive-blocks-5'
  input.content.push({ id: 'direction', text: 'Справа две карточки:' })
  const env = { input, compositions: [], fontTokens: ['font-1'] }
  const response = { directions: [{ sourceId: 'direction', reason: 'User placement' }], plan }
  assert.equal(validateFastAdaptive(response, env).plan.version, 'adaptive-blocks-5')
  assert.equal(adaptiveVisibleInput(input, response.directions).content.length, input.content.length - 1)
  assert.throws(() => adaptiveVisibleInput(input, [{ sourceId: 'body', reason: 'Hidden to fit' }]))
  const changed = structuredClone(response)
  changed.plan.blocks[0].parts[1].component = null
  assert.throws(() => validateFastAdaptive(changed, env), (e: unknown) => e instanceof SemanticValidationError && e.issues.some(i => i.startsWith('standalone-percentage')))
})
test('latency profile enables low reasoning for generation and removes it from a short visual review', () => {
  const { env } = pixelFixture()
  const generation = fastPixelTask(env, 'data:image/png;base64,AA==')
  const config = routeraiConfig({ ROUTERAI_API_KEY: 'test-only' })
  const wire = structuredGeneration(generation, config)
  assert.deepEqual('reasoning' in wire && wire.reasoning, { enabled: true, effort: 'low' })
  assert.equal(generation.maxTokens, 12288)
  assert.equal(generation.schemaName, 'combined_design_pixel')
  assert.deepEqual('provider' in wire && wire.provider, { only: ['deepinfra'], allow_fallbacks: false })
  const review = fastGeneration(generation, 'pixel', true)
  assert.equal(review.maxTokens, 768)
  assert.equal(review.reasoningEffort, undefined)
  assert.deepEqual('reasoning' in structuredGeneration(review, config) && (structuredGeneration(review, config) as { reasoning: unknown }).reasoning, { enabled: false })
  assert.equal(canRepairFastSlide('pixel', 100_000), true)
  assert.equal(canRepairFastSlide('pixel', 250_000), false)
})
