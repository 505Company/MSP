import test from 'node:test'
import assert from 'node:assert/strict'
import { availableRecipes, readRecipeRegistry, decideRecipe, recipeEligibility } from '../lib/presentations/recipes/library'
import { libraryFixture, protocolReport } from './fixtures/recipe-library'
import { applyTemplateReflow } from '../lib/presentations/recipes/template-reflow'
import { pinRecipeSnapshot, readRecipeSnapshot, recipeCandidates, resolveLibraryPlan, libraryPlanTask } from '../lib/presentations/recipes/library-selection'
import { layoutView, startLayoutAction, readLayoutPreview } from '../lib/presentations/layout-workflow'
import { readLayoutBudget, limitLayoutRequests } from '../lib/presentations/layout-budget'
import { validateTemplateReport } from '../lib/presentations/recipes/template-measurement'
import { authoredRecipePassport } from '../lib/presentations/recipes/passport'
import { layoutPlan } from './fixtures/layout'

const evidence = { fontTokens: ['font-1'] }, config = { apiKey: 'test-only', model: 'test-model', baseUrl: 'https://provider.invalid/v1' }
const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }))
const action = (f: Awaited<ReturnType<typeof libraryFixture>>) => ({ action: 'plan' as const, inputId: f.context.inputId, slideId: f.input.slideId, round: 0, evidence })
async function enabledFixture() { const f = await libraryFixture(); await f.register(); await f.decide('accept'); await f.decide('enable'); return f }

test('a measured failed family stays a draft; neither acceptance nor activation can bypass its technical failure', async () => {
  const f = await libraryFixture(), registry = await f.register(f.recipe, 'failed')
  const result = await recipeEligibility(f.bucket, f.input.uploadId, registry.entries[0])
  assert.ok(result.reasons.includes('technical-not-passed'))
  await assert.rejects(f.decide('accept'), /technical-not-passed/)
  await assert.rejects(f.decide('enable'), /technical-not-passed/)
  assert.deepEqual(await availableRecipes(f.bucket, f.input.uploadId), [])
})

test('technical registration, artistic acceptance and activation are independent and versioned', async () => {
  const f = await libraryFixture(), registered = await f.register()
  assert.equal(registered.entries[0].artistic, 'pending'); assert.equal(registered.entries[0].enabled, false)
  await assert.rejects(f.decide('enable'), /artistic-not-accepted/)
  await f.decide('accept'); assert.deepEqual(await availableRecipes(f.bucket, f.input.uploadId), [])
  await f.decide('enable'); assert.equal((await availableRecipes(f.bucket, f.input.uploadId)).length, 1)
  const next = await applyTemplateReflow(f.recipe, { columns: 2, header: 'stacked', rationale: 'Synthetic new version' }, 'mock-grid')
  await f.register(next)
  await assert.rejects(f.decide('enable', next), /artistic-not-accepted/)
  await f.decide('accept', next); await f.decide('enable', next)
  assert.equal((await availableRecipes(f.bucket, f.input.uploadId))[0].entry.version, next.passport.version)
  await f.decide('enable') // An explicit rollback retains the old evidence and acceptance.
  assert.equal((await availableRecipes(f.bucket, f.input.uploadId))[0].entry.version, f.recipe.passport.version)
  await f.decide('reject'); assert.deepEqual(await availableRecipes(f.bucket, f.input.uploadId), [])
  assert.ok([...f.data.keys()].filter(k => k.includes('/history/')).length >= 7)
  assert.equal((await readLayoutBudget(f.bucket, f.context)).used, 0)
})
test('library decisions are fenced by revision; concurrent acceptance cannot overwrite a rejection', async () => {
  const f = await libraryFixture(), r = await f.register(), common = { expectedRevision: r.revision, recipeId: f.recipe.passport.id, version: f.recipe.passport.version, reason: 'Test' }
  const results = await Promise.allSettled([decideRecipe(f.bucket, f.input.uploadId, { ...common, action: 'accept' }), decideRecipe(f.bucket, f.input.uploadId, { ...common, action: 'reject' })])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  await assert.rejects(decideRecipe(f.bucket, f.input.uploadId, { ...common, action: 'enable' }))
})
test('delegated visual review is explicit and survives activation without being labelled user acceptance', async () => {
  const f = await libraryFixture(), registered = await f.register()
  const accepted = await decideRecipe(f.bucket, f.input.uploadId, { action: 'accept', expectedRevision: registered.revision,
    recipeId: f.recipe.passport.id, version: f.recipe.passport.version, reviewer: 'delegated-agent', reason: 'User delegated review; checked source and three rendered cases' })
  assert.equal(accepted.entries[0].artisticReview?.reviewer, 'delegated-agent')
  const enabled = await f.decide('enable')
  assert.deepEqual(enabled.entries[0].artisticReview, accepted.entries[0].artisticReview)
  assert.equal((await availableRecipes(f.bucket, f.input.uploadId)).length, 1)
  assert.equal(registered.entries[0].artisticReview, undefined)
})
test('changed source, proof or bundle revokes eligibility without editing acceptance or spending', async () => {
  for (const target of ['source', 'proof', 'bundle']) {
    const f = await enabledFixture(), registry = await readRecipeRegistry(f.bucket, f.input.uploadId)
    const entry = registry.entries[0], { bundle } = await recipeEligibility(f.bucket, f.input.uploadId, entry)
    const key = target === 'source' ? `visual/${f.input.uploadId}/manifest.json` : target === 'proof' ? bundle!.evidence[0].key : `recipe-library/${f.input.uploadId}/bundles/${entry.id}/${entry.version}.json`
    const data = await (await f.bucket.get(key))!.json<Record<string, unknown>>()
    if (target === 'source') (data.snapshot as { name: string }).name += ' changed'
    else data.changed = true
    await f.bucket.put(key, JSON.stringify(data))
    assert.deepEqual(await availableRecipes(f.bucket, f.input.uploadId), [])
    assert.deepEqual(await readRecipeRegistry(f.bucket, f.input.uploadId), registry)
    assert.equal((await readLayoutBudget(f.bucket, f.context)).used, 0)
  }
})
test('GET is read-only; a pinned empty library never changes when a recipe is enabled later', async () => {
  const f = await libraryFixture(), before = [...f.data].map(([k, v]) => [k, v.value])
  await layoutView(f.bucket, f.context)
  assert.deepEqual([...f.data].map(([k, v]) => [k, v.value]), before)
  assert.equal(await readRecipeSnapshot(f.bucket, f.context), null)
  const pinned = await pinRecipeSnapshot(f.bucket, f.context)
  await f.register(); await f.decide('accept'); await f.decide('enable')
  assert.deepEqual(await pinRecipeSnapshot(f.bucket, f.context), pinned)
  assert.equal(pinned.recipes.length, 0)
})
test('the selector enforces design-system scope, real item count and exact fragment coverage', async () => {
  const f = await enabledFixture(), snapshot = await pinRecipeSnapshot(f.bucket, f.context)
  const before = JSON.stringify(f.input), selected = resolveLibraryPlan(f.reply, snapshot, f.input, evidence)
  assert.equal(selected.kind, 'library-template')
  assert.equal(recipeCandidates(snapshot, { ...f.input, uploadId: 'another-style' }).length, 0)
  for (const count of [3, 5]) assert.throws(() => resolveLibraryPlan({ ...f.reply, itemCount: count }, snapshot, f.input, evidence))
  assert.throws(() => resolveLibraryPlan({ ...f.reply, recipeVersion: 'f'.repeat(64) }, snapshot, f.input, evidence))
  for (const bindings of [f.source.plan.bindings.slice(1), [...f.source.plan.bindings, f.source.plan.bindings[0]], [...f.source.plan.bindings, { sourceId: 'note-1', fragments: ['invented'] }]]) {
    assert.throws(() => resolveLibraryPlan({ ...f.reply, plan: { ...f.source.plan, bindings } }, snapshot, f.input, evidence))
  }
  assert.equal(resolveLibraryPlan({ recipeId: null, recipeVersion: null, itemCount: null, plan: null, reason: 'No compatible structure' }, snapshot, f.input, evidence).kind, 'library-incompatible')
  assert.equal(JSON.stringify(f.input), before)
  assert.ok(libraryPlanTask(snapshot, f.input, evidence).messages[0].content.toString().includes('фактическое число'))
})
test('template measurements reject skipped states, changed text/font/geometry, missing pixels and stale hashes', async () => {
  const f = await libraryFixture(), report = await protocolReport(f.recipe, f.source.material, f.source.plan)
  await validateTemplateReport(report, f.recipe, f.source.material, f.source.plan)
  const changes = [
    (r: typeof report) => { r.measurements[0].fontSize = 12 },
    (r: typeof report) => { r.measurements[0].text = 'Shortened' },
    (r: typeof report) => { r.measurements[0].box.width++ },
    (r: typeof report) => { r.measurements[0].pixels = 0 },
    (r: typeof report) => { r.measurements.pop() },
    (r: typeof report) => { r.trials[0].stateId = 'expanded' },
    (r: typeof report) => { r.materialHash = 'f'.repeat(64) },
    (r: typeof report) => { r.passed = false; r.issues = r.trials[0].issues = ['overflow'] },
  ]
  for (const change of changes) { const bad = structuredClone(report); change(bad); await assert.rejects(validateTemplateReport(bad, f.recipe, f.source.material, f.source.plan)) }
})
test('normal generation uses the admitted template, persists binding/render/review, and serves ready slides after disable', async t => {
  const f = await enabledFixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    calls++; const body = JSON.parse(init!.body as string)
    return response(body.response_format.json_schema.name === 'template_recipe_review' ? { verdict: 'pass', issues: [] } : f.reply)
  })
  await (await startLayoutAction(f.bucket, f.context, action(f), config)).execute!()
  const v = await layoutView(f.bucket, f.context), target = v.next!
  assert.equal(target.phase, 'render'); assert.equal(target.plan, undefined); assert.ok(target.template)
  assert.equal(target.template.material.synthetic, false)
  const report = await protocolReport(target.template.recipe, target.template.material, target.template.plan)
  await startLayoutAction(f.bucket, f.context, { ...action(f), action: 'report', fit: report }, config)
  await (await startLayoutAction(f.bucket, f.context, { ...action(f), action: 'review' }, config)).execute!()
  assert.equal((await layoutView(f.bucket, f.context)).status, 'ready'); assert.equal(calls, 2)
  assert.equal(await readLayoutPreview(f.bucket, f.context, f.input.slideId, 0), report.preview)
  await f.decide('disable')
  assert.equal((await layoutView(f.bucket, f.context)).status, 'ready')
  assert.equal((await startLayoutAction(f.bucket, f.context, action(f), config)).execute, null)
  assert.equal((await readLayoutBudget(f.bucket, f.context)).used, 2)
  assert.equal(calls, 2)
})
test('a failed fit goes back to Qwen with measurements, then an explicit incompatibility blocks without fabrication', async t => {
  const f = await enabledFixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    calls++
    if (calls === 1) return response(f.reply)
    const body = JSON.parse(init!.body as string), input = JSON.parse(body.messages[1].content)
    assert.ok(input.correction.templateFit.issues.includes('overflow:body-1'))
    assert.equal(input.correction.templateFit.preview, undefined)
    return response({ recipeId: null, recipeVersion: null, itemCount: null, plan: null, reason: 'No compatible recipe for the complete material' })
  })
  await (await startLayoutAction(f.bucket, f.context, action(f), config)).execute!()
  const target = (await layoutView(f.bucket, f.context)).next!.template!
  await startLayoutAction(f.bucket, f.context, { ...action(f), action: 'report', fit: await protocolReport(target.recipe, target.material, target.plan, false) }, config)
  await (await startLayoutAction(f.bucket, f.context, { ...action(f), round: 1 }, config)).execute!()
  const final = await layoutView(f.bucket, f.context)
  assert.equal(final.status, 'blocked'); assert.equal(final.next, null); assert.equal(calls, 2)
})
test('revocation and exhausted shared budgets prevent provider requests, including clarification', async t => {
  const f = await enabledFixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response({ invalid: true }) })
  await limitLayoutRequests(f.bucket, f.context, 1)
  await assert.rejects((await startLayoutAction(f.bucket, f.context, action(f), config)).execute!(), /предел/)
  assert.equal(calls, 1)
  await f.decide('disable')
  await assert.rejects(startLayoutAction(f.bucket, f.context, { ...action(f), retry: true }, config), /Допуск/)
  assert.equal(calls, 1); assert.equal((await readLayoutBudget(f.bucket, f.context)).used, 1)
})
test('the author recipe remains a valid explicit choice and is never relabelled as technically or artistically accepted', async () => {
  const f = await enabledFixture(), snapshot = await pinRecipeSnapshot(f.bucket, f.context), author = authoredRecipePassport()
  const plan = layoutPlan(f.input)
  plan.primary = f.input.content.map(c => ({ fragmentId: c.id, start: 0, end: c.text.length }))
  const result = resolveLibraryPlan({ recipeId: author.id, recipeVersion: author.version, itemCount: null, plan, reason: 'Explicit authored composition' }, snapshot, f.input, evidence)
  assert.equal(result.kind, 'library-author'); assert.equal(author.qualification.technical, 'unverified'); assert.equal(author.qualification.artistic, 'pending')
})
