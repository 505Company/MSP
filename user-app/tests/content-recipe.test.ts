import test from 'node:test'
import assert from 'node:assert/strict'
import { contentRecipeFixture } from './fixtures/content-recipe'
import { compileContentRecipe, initialRecipeSettings, validateContentRecipe, type ContentRecipe } from '../lib/presentations/recipes/content-recipe'

test('all recipe families preserve exact content and leave source components unchanged', () => {
  for (const kind of ['headline', 'metrics-list', 'audience-feature', 'principles-evidence'] as const) {
    const f = contentRecipeFixture(kind), before = JSON.stringify(f)
    assert.deepEqual(validateContentRecipe(f.recipe, f.env, f.brand), f.recipe)
    const compiled = compileContentRecipe(f.recipe, f.env, f.brand, initialRecipeSettings())
    if (kind !== 'headline') assert.ok(compiled.plan.nodes.some(n => n.component?.id === 'native-metric'))
    assert.equal(compiled.surfaces.length, kind === 'audience-feature' ? 1 : 0)
    assert.equal(JSON.stringify(f), before)
  }
})
test('model cannot inject CSS, coordinates, new text or an arbitrary component', () => {
  const f = contentRecipeFixture()
  for (const extra of [{ css: 'position:absolute' }, { x: 15 }, { text: 'Rewritten title' }, { nodes: [] }]) {
    assert.throws(() => validateContentRecipe({ ...f.recipe, ...extra }, f.env, f.brand))
  }
  const recipe = f.recipe as Extract<ContentRecipe, { recipe: 'metrics-list' }>
  for (const id of ['invented-card', '']) {
    const copy = structuredClone(recipe); copy.metrics[0].componentId = id
    assert.throws(() => validateContentRecipe(copy, f.env, f.brand))
  }
  const unqualified = structuredClone(f.env); unqualified.input.componentFlows = {}
  assert.throws(() => validateContentRecipe(recipe, unqualified, f.brand))
})
test('missing, duplicated and partially dropped characters fail before rendering', () => {
  const f = contentRecipeFixture()
  const recipe = f.recipe as Extract<ContentRecipe, { recipe: 'metrics-list' }>
  for (const change of [
    (p: typeof recipe) => { p.metrics[0].caption = [] },
    (p: typeof recipe) => { p.metrics[0].caption = p.metrics[1].caption },
    (p: typeof recipe) => { p.title[0].start = 1 },
  ]) {
    const copy = structuredClone(recipe); change(copy)
    assert.throws(() => validateContentRecipe(copy, f.env, f.brand))
  }
})
test('brand cannot silently substitute an unavailable font or invent a colour', () => {
  const f = contentRecipeFixture()
  assert.throws(() => validateContentRecipe(f.recipe, f.env, { ...f.brand, bodyFont: 'missing' }))
  assert.throws(() => validateContentRecipe(f.recipe, f.env, { ...f.brand, background: '#abcdef' }))
})
