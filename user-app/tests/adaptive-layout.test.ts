import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptiveFixture, adaptiveComponentFixture } from './fixtures/adaptive-layout'
import { ADAPTIVE_COMPONENTS_VERSION, ADAPTIVE_GRID_VERSION, adaptiveComponents, adaptiveComponentData, componentElements, componentRows } from '../lib/presentations/adaptive-components'
import { adaptiveContract } from '../lib/presentations/adaptive-task'
import { adaptiveCandidates, ADAPTIVE_RECIPE_ID, ADAPTIVE_VERSION, ADAPTIVE_PALETTE_VERSION, validateAdaptivePlan } from '../lib/presentations/adaptive-layout'
import { libraryFixture } from './fixtures/recipe-library'
import { pinRecipeSnapshot, readRecipeSnapshot, resolveLibraryPlan } from '../lib/presentations/recipes/library-selection'
import { contentHash } from '../lib/design-system/catalog'
import { componentHtml } from '../browser/adaptive-components'

const evidence = { fontTokens: ['font-1'] }
test('adaptive semantic plan binds complete fragments once, no offsets, missing numbers, unknown tokens or invented text', () => {
  const { input, plan } = adaptiveFixture()
  assert.deepEqual(validateAdaptivePlan(plan, input, evidence), plan)
  for (const change of [
    (p: typeof plan) => { p.blocks[0].parts.pop() },
    (p: typeof plan) => { p.footer.push('b1') },
    (p: typeof plan) => { p.title = ['invented'] },
    (p: typeof plan) => { p.fontToken = 'missing' },
    (p: typeof plan) => { p.colors.onSurface = 'surface' },
    (p: typeof plan) => { p.blocks[0].parts[1].role = 'metric' },
  ]) { const bad = structuredClone(plan); change(bad); assert.throws(() => validateAdaptivePlan(bad, input, evidence)) }
  assert.throws(() => validateAdaptivePlan({ ...plan, title: [{ fragmentId: 'title', start: 0, end: 3 }] }, input, evidence))
  assert.throws(() => validateAdaptivePlan(plan, input, { fontTokens: [] }))
})
test('all structural candidates precede font reduction, bounded at explicit role floors', () => {
  const { plan } = adaptiveFixture(), candidates = adaptiveCandidates(plan)
  assert.deepEqual(candidates.slice(0, 3), [2, 3, 1].map(columns => ({ columns, fontStep: 0 })))
  assert.equal(candidates.length, 15); assert.equal(candidates.at(-1)!.fontStep, 4)
  plan.blocks.splice(1)
  assert.deepEqual(adaptiveCandidates(plan).map(c => c.columns), [1, 1, 1, 1, 1])
})
test('new snapshots pin adaptive support; old snapshots retain their hash and reject the new plan without changing budget', async () => {
  const f = await libraryFixture(), { input, plan } = adaptiveFixture()
  const reply = { recipeId: ADAPTIVE_RECIPE_ID, recipeVersion: ADAPTIVE_VERSION, itemCount: null, plan, reason: 'Synthetic adaptive selection' }
  const old = { version: 'library-selection-1', hash: await contentHash([]), recipes: [] }
  await f.bucket.put(`${f.context.prefix}/recipe-library.json`, JSON.stringify(old))
  assert.deepEqual(await pinRecipeSnapshot(f.bucket, f.context), old)
  assert.throws(() => resolveLibraryPlan(reply, old as Awaited<ReturnType<typeof pinRecipeSnapshot>>, input, evidence))
  const next = { ...f.context, prefix: `${f.context.prefix}-new` }
  const snapshot = await pinRecipeSnapshot(f.bucket, next)
  assert.equal(snapshot.adaptiveVersion, ADAPTIVE_PALETTE_VERSION)
  assert.throws(() => resolveLibraryPlan(reply, snapshot, input, evidence))
  assert.equal(resolveLibraryPlan({ ...reply, recipeVersion: ADAPTIVE_PALETTE_VERSION, plan: { ...plan, version: ADAPTIVE_PALETTE_VERSION } }, snapshot, input, evidence).kind, 'library-adaptive')
  const grid = { ...snapshot, adaptiveVersion: ADAPTIVE_GRID_VERSION as typeof ADAPTIVE_GRID_VERSION, hash: await contentHash({ recipes: snapshot.recipes, adaptiveVersion: ADAPTIVE_GRID_VERSION }) }
  await f.bucket.put(`${f.context.prefix}/recipe-library.json`, JSON.stringify(grid))
  assert.deepEqual(await pinRecipeSnapshot(f.bucket, f.context), grid)
  assert.equal(resolveLibraryPlan({ ...reply, recipeVersion: ADAPTIVE_GRID_VERSION, plan: { ...plan, version: ADAPTIVE_GRID_VERSION } }, grid, input, evidence).kind, 'library-adaptive')
  assert.throws(() => resolveLibraryPlan({ ...reply, recipeVersion: ADAPTIVE_PALETTE_VERSION, plan: { ...plan, version: ADAPTIVE_PALETTE_VERSION } }, grid, input, evidence))
  const native = { ...snapshot, adaptiveVersion: ADAPTIVE_COMPONENTS_VERSION as typeof ADAPTIVE_COMPONENTS_VERSION, hash: await contentHash({ recipes: snapshot.recipes, adaptiveVersion: ADAPTIVE_COMPONENTS_VERSION }) }
  await f.bucket.put(`${f.context.prefix}/recipe-library.json`, JSON.stringify(native))
  assert.deepEqual(await pinRecipeSnapshot(f.bucket, f.context), native)
  assert.equal(resolveLibraryPlan({ ...reply, recipeVersion: ADAPTIVE_COMPONENTS_VERSION, plan: { ...plan, version: ADAPTIVE_COMPONENTS_VERSION } }, native, input, evidence).kind, 'library-adaptive')
  const previous = { ...snapshot, adaptiveVersion: ADAPTIVE_VERSION as typeof ADAPTIVE_VERSION, hash: await contentHash({ recipes: snapshot.recipes, adaptiveVersion: ADAPTIVE_VERSION }) }
  await f.bucket.put(`${f.context.prefix}/recipe-library.json`, JSON.stringify(previous))
  assert.deepEqual(await pinRecipeSnapshot(f.bucket, f.context), previous)
  assert.equal(resolveLibraryPlan(reply, previous, input, evidence).kind, 'library-adaptive')
  assert.equal(await f.bucket.get(`${f.context.prefix}/budget.json`), null)
  await f.bucket.put(`${next.prefix}/recipe-library.json`, JSON.stringify({ ...snapshot, adaptiveVersion: undefined }))
  await assert.rejects(readRecipeSnapshot(f.bucket, next))
})

test('adaptive library fields preserve whole fragments, native source and cleared examples; incompatible bindings fail explicitly', () => {
  const { input, plan } = adaptiveComponentFixture(), original = structuredClone(input)
  assert.deepEqual(validateAdaptivePlan(plan, input, evidence), plan)
  const binding = plan.blocks[0].parts[1].component!
  const data = adaptiveComponentData(binding, input.components[0], input)
  assert.equal(data.value, '72%'); assert.equal(data.text, 'Завершили задачу')
  assert(!JSON.stringify(data).includes('999'))
  assert.match(componentHtml(binding, input), /background:transparent;padding:0px;border-radius:0px/)
  assert.equal(componentElements(binding, input.components[0], input, 'Play', 0)[0].paragraphs, undefined)
  assert.deepEqual(componentRows(plan.blocks[0].parts, 2), [{ indices: [0], columns: 1 }, { indices: [1, 2], columns: 2 }])
  assert.deepEqual(input, original)
  for (const mutate of [
    (p: typeof plan) => { delete p.version },
    (p: typeof plan) => { p.blocks[0].emphasis = 'normal' },
    (p: typeof plan) => { p.blocks[0].parts[1].component!.id = 'unknown' },
    (p: typeof plan) => { p.blocks[0].parts[1].component!.fields.pop() },
    (p: typeof plan) => { p.blocks[0].parts[1].component!.fields[1].fragments = ['value1'] },
    (p: typeof plan) => { p.blocks[0].parts[1].component!.fields[1].path = 'invented' },
  ]) { const p = structuredClone(plan); mutate(p); assert.throws(() => validateAdaptivePlan(p, input, evidence)) }
  assert.equal(adaptiveContract(input, evidence, ADAPTIVE_COMPONENTS_VERSION).components?.length, 1)
  input.components[0].sourceLayout!.bar = { id: 'test-panel', width: 500 }
  assert.equal(adaptiveComponents(input).length, 0)
  assert.throws(() => validateAdaptivePlan(plan, input, evidence))
})
