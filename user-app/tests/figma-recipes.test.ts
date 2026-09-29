import test from 'node:test'
import assert from 'node:assert/strict'
import { figmaCatalog, frames, walk } from '../lib/presentations/recipes/figma-catalog-v2/catalog'
import { compileFigmaRecipe, validateFigmaRecipe } from '../lib/presentations/recipes/figma-catalog-v2/contract'
import { validateFreeFlex } from '../lib/presentations/free-flex'
import { figmaRecipeFixture } from './fixtures/figma-recipe'

test('all 34 observed frames have unique executable states and valid source slots', () => {
  assert.equal(figmaCatalog.length, 24)
  const variants = figmaCatalog.flatMap(f => f.variants)
  assert.equal(variants.length, 34)
  assert.deepEqual(variants.map(v => v.frame).sort(), frames.map(f => f.id).sort())
  for (const v of variants) {
    const map = new Map(walk(frames.find(f => f.id === v.frame)!).map(n => [n.id, n]))
    for (const [kind, ids] of Object.entries({ fields: v.fields, panels: v.panels, visuals: v.visuals })) for (const id of Object.values(ids)) {
      assert.ok(map.has(id), `${v.frame}:${id}`)
      if (kind === 'fields') assert.equal(map.get(id)!.type, 'TEXT')
    }
  }
  assert.equal(variants.filter(v => v.aliasOf).length, 1)
})
test('every non-media family compiles through exact text coverage without CSS from the model', () => {
  for (const family of figmaCatalog.filter(f => !Object.keys(f.variants[0].visuals).length)) for (let i = 0; i < family.variants.length; i++) {
    const f = figmaRecipeFixture(family.id, i), before = JSON.stringify(f)
    assert.deepEqual(validateFigmaRecipe(f.recipe, f.env, f.brand), f.recipe)
    const compiled = compileFigmaRecipe(f.recipe, f.env, f.brand, { variant: 0, compact: false, steps: {} }, f.variant)
    assert.ok(compiled.plan.nodes.every(n => !/position|transform|overflow|left:|top:/u.test(n.css)))
    assert.equal(compiled.surfaces.length, f.recipe.panels.length)
    assert.equal(JSON.stringify(f), before)
  }
})
test('unknown slots, raw text, omitted source and unbound library panels are rejected', () => {
  const f = figmaRecipeFixture('four-steps')
  assert.throws(() => validateFigmaRecipe({ ...f.recipe, css: 'color:red' }, f.env, f.brand))
  assert.throws(() => validateFigmaRecipe({ ...f.recipe, panels: [] }, f.env, f.brand))
  const unknown = structuredClone(f.recipe); unknown.fields[0].slot = 'made-up'
  assert.throws(() => validateFigmaRecipe(unknown, f.env, f.brand))
  const missing = structuredClone(f.recipe); missing.fields[0].refs[0].start = 1
  assert.throws(() => validateFigmaRecipe(missing, f.env, f.brand))
  const duplicate = structuredClone(f.recipe); duplicate.fields.push(duplicate.fields[0])
  assert.throws(() => validateFigmaRecipe(duplicate, f.env, f.brand))
})
test('image recipes require a real available resource; empty flex leaves remain invalid by default', () => {
  const f = figmaRecipeFixture('single-visual')
  assert.throws(() => validateFigmaRecipe(f.recipe, f.env, f.brand), e => (e as { issues: string[] }).issues.some(i => i.startsWith('unknown-recipe-graphic:')))
  const compiled = compileFigmaRecipe(f.recipe, f.env, f.brand, { variant: 0, compact: false, steps: {} })
  assert.throws(() => validateFreeFlex(compiled.plan, f.env))
  assert.throws(() => validateFreeFlex(compiled.plan, f.env, compiled.visuals))
  assert.throws(() => validateFigmaRecipe({ ...f.recipe, visuals: [] }, f.env, f.brand))
})
