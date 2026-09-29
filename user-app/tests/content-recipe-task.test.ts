import test from 'node:test'
import assert from 'node:assert/strict'
import { contentRecipeFixture } from './fixtures/content-recipe'
import { contentRecipeTask, validateRecipeDirection } from '../lib/presentations/recipes/content-recipe-task'
import { structuredGeneration } from '../lib/uploads/qwen-structured'
import { routeraiConfig } from '../lib/uploads/routerai'

test('director output passes the real recipe contract, including complete source coverage', () => {
  for (const family of ['headline', 'metrics-list', 'audience-feature', 'principles-evidence'] as const) {
    const f = contentRecipeFixture(family), response = { decision: 'Выбрана структура по смысловым группам.', selection: f.recipe }
    assert.deepEqual(validateRecipeDirection(response, f.env, f.brand), response)
    assert.throws(() => validateRecipeDirection({ ...response, css: 'display:flex' }, f.env, f.brand))
    const missing = structuredClone(response); missing.selection.title[0].start = 1
    assert.throws(() => validateRecipeDirection(missing, f.env, f.brand))
  }
})
test('strict task exposes only compatible IDs and source data, not a prepared answer', () => {
  const f = contentRecipeFixture('audience-feature'), before = JSON.stringify(f)
  const task = contentRecipeTask(f.env, f.brand, 'data:image/png;base64,AA==', [{ kind: 'direction', text: 'Отдельная карточка:' }])
  const schema = task.schema as { properties: { selection: { anyOf?: unknown; properties: { recipe: { enum: string[] } } } } }
  assert.equal(schema.properties.selection.anyOf, undefined)
  assert.equal(schema.properties.selection.properties.recipe.enum.length, 28)
  assert.ok(schema.properties.selection.properties.recipe.enum.includes('audience-feature'))
  assert.match(JSON.stringify(schema), /"enum":\["native-metric"\]/u)
  const content = task.messages[1].content
  assert.ok(Array.isArray(content) && content[0].type === 'text')
  const data = JSON.parse(content[0].text)
  assert.deepEqual(data.source.map((c: { text: string }) => c.text), f.env.input.content.map(c => c.text))
  assert.equal(data.compatibleComponents.length, 1)
  assert.equal(data.figmaRecipes.length, 24)
  assert.equal(data.figmaRecipes.flatMap((r: { sourceFrames: string[] }) => r.sourceFrames).length, 34)
  assert.equal('selection' in data, false)
  assert.equal('expected' in data, false)
  assert.equal(data.authorSequence[0].kind, 'direction')
  assert.equal(JSON.stringify(f), before)
})
test('director uses compact thinking low with pinned provider and full sampling settings', () => {
  const f = contentRecipeFixture(), task = contentRecipeTask(f.env, f.brand)
  assert.equal(task.maxTokens, 6144)
  const generation = structuredGeneration(task, routeraiConfig({})) as Record<string, unknown>
  assert.deepEqual(generation.reasoning, { enabled: true, effort: 'low' })
  assert.deepEqual(generation.provider, { only: ['deepinfra'], allow_fallbacks: false })
  assert.equal(generation.temperature, 1)
  assert.equal(generation.top_p, .95)
  assert.equal(generation.top_k, 20)
  assert.equal(generation.min_p, 0)
  assert.equal(generation.repetition_penalty, 1)
})
