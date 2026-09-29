import test from 'node:test'
import assert from 'node:assert/strict'
import { contentRecipeFixture } from './fixtures/content-recipe'
import { figmaRecipeFixture } from './fixtures/figma-recipe'
import { BINDINGS_VERSION, normalizeRecipeBindings, type RecipeBindings } from '../lib/presentations/recipes/recipe-bindings'
import { validateRecipeDirection } from '../lib/presentations/recipes/content-recipe-task'

test('uniform model bindings preserve complete source and compile to the existing metric/list executor', () => {
  const f = contentRecipeFixture('metrics-list')
  const mapping = { title: 'title', 'a-value': 'metric1.value', 'a-caption': 'metric1.caption', 'b-value': 'metric2.value', 'b-caption': 'metric2.caption', 'list-heading': 'list.heading', 'item-1': 'list.item1.text', 'item-2': 'list.item2.text' }
  const wire: RecipeBindings = { version: BINDINGS_VERSION, recipe: 'metrics-list',
    fields: f.env.input.content.map(c => ({ slot: mapping[c.id as keyof typeof mapping], refs: [{ fragmentId: c.id, start: 0, end: null }] })),
    panels: ['metric1', 'metric2'].map(slot => ({ slot, componentId: 'native-metric' })), visuals: [] }
  const response = validateRecipeDirection({ decision: 'Метрики и список.', selection: wire }, f.env, f.brand)
  assert.deepEqual(response.selection, f.recipe)
  const missing = structuredClone(wire); missing.fields = missing.fields.filter(f => f.slot !== 'list.item2.text')
  assert.throws(() => validateRecipeDirection({ decision: 'Метрики и список.', selection: missing }, f.env, f.brand))
  const unknown = structuredClone(wire); unknown.fields.push({ slot: 'invented', refs: wire.fields[0].refs })
  assert.throws(() => normalizeRecipeBindings(unknown))
})
test('Figma families use the same wire shape and retain their exact semantic bindings', () => {
  for (const id of ['four-steps', 'text-columns', 'feature-metrics']) {
    const f = figmaRecipeFixture(id), selection = { version: BINDINGS_VERSION, recipe: `figma/${id}`, fields: f.recipe.fields, panels: f.recipe.panels, visuals: f.recipe.visuals }
    assert.deepEqual(validateRecipeDirection({ decision: 'Соответствует группам исходника.', selection }, f.env, f.brand).selection, f.recipe)
  }
})
test('a headline-only model answer cannot silently discard the rest of a content slide', () => {
  const f = contentRecipeFixture('audience-feature')
  assert.throws(() => validateRecipeDirection({ decision: 'audience-feature', selection: { version: BINDINGS_VERSION, recipe: 'headline',
    fields: [{ slot: 'title', refs: f.recipe.title }], panels: [], visuals: [] } }, f.env, f.brand), e => (e as { issues: string[] }).issues.some(i => i.startsWith('source-incomplete:')))
})
