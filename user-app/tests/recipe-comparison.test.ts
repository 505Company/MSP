import test from 'node:test'
import assert from 'node:assert/strict'
import { balancedComparisonFixture, comparisonFixture } from './fixtures/template-comparison'
import { COMPARISON_STATE, applyTemplateComparison, comparisonGeometryIssues, comparisonGraphicGroups, parsePercentMetric, resolveTemplateComparison, validateTemplateComparison } from '../lib/presentations/recipes/template-comparison'
import { instantiateTemplate, validateTemplatePlan } from '../lib/presentations/recipes/template-plan'
import { comparisonRecipeCases } from '../lib/presentations/recipes/comparison-cases'
import { reservePilotRequest, pilotBudget, readTemplatePilot, startTemplatePilot, authorizeComparisonCheck } from '../lib/presentations/recipes/template-pilot'
import { memoryBucket } from './helpers/memory-bucket'
import { SemanticValidationError } from '../lib/design-system/semantic-contract'
import { contentHash } from '../lib/design-system/catalog'
import { templateReviewTask } from '../lib/presentations/recipes/template-task'
import { comparisonAllowedLayouts, comparisonDetailGroups, validateComparisonReply } from '../lib/presentations/recipes/template-comparison-task'

const issue = (text: string) => (error: unknown) => error instanceof SemanticValidationError && error.issues.some(i => i.includes(text))

test('comparison parses exact percentages without mistaking periods for values', () => {
  assert.deepEqual(parsePercentMetric('72,5% в 2027'), { value: 72.5, label: '2027' })
  assert.deepEqual(parsePercentMetric('0% группа A'), { value: 0, label: 'группа A' })
  assert.equal(parsePercentMetric('100% в 2026').value, 100)
  for (const text of ['101% в 2027', '-1% в 2027', '72 в 2027', '72% и 50% в 2027', '72%', '72%\n2027']) assert.throws(() => parsePercentMetric(text))
})
test('comparison is a new model-authored version, preserving source and old failed recipe', async () => {
  const f = await comparisonFixture(), before = structuredClone(f.base)
  const next = await applyTemplateComparison(f.base, f.comparison, 'another-run')
  assert.deepEqual(f.base, before); assert.deepEqual(next.originalElements, f.base.originalElements)
  assert.equal(next.passport.id, f.base.passport.id); assert.notEqual(next.passport.version, f.base.passport.version)
  assert.deepEqual(next.passport.states.map(s => s.id), [COMPARISON_STATE])
  assert.ok(next.slots.filter(s => s.role === 'metric').every(s => !s.optional))
  assert.equal(next.passport.qualification.artistic, 'pending')
  assert.equal(next.passport.version, f.recipe.passport.version)
})
test('paired values are mandatory, single-fragment and ordered consistently across all items', async () => {
  const f = await comparisonFixture()
  validateTemplatePlan(f.plan, f.recipe, f.material)
  const noValue = structuredClone(f.plan); noValue.bindings.pop()
  assert.throws(() => validateTemplatePlan(noValue, f.recipe, f.material))
  const swapped = structuredClone(f.plan), a = swapped.bindings.find(b => b.sourceId === 'value-2-0')!, b = swapped.bindings.find(b => b.sourceId === 'value-2-1')!
  ;[a.fragments, b.fragments] = [b.fragments, a.fragments]
  assert.throws(() => validateTemplatePlan(swapped, f.recipe, f.material), issue('inconsistent-new-series'))
  const invalid = structuredClone(f.material); invalid.fragments.find(f => f.id === 'value-1-0')!.text = 'Здесь только текст'
  assert.throws(() => validateTemplatePlan(f.plan, f.recipe, invalid), issue('percent-and-series'))
  const same = structuredClone(f.material)
  for (const fragment of same.fragments) if (fragment.id.startsWith('value')) fragment.text = '42% в 2027'
  assert.throws(() => validateTemplatePlan(f.plan, f.recipe, same), issue('indistinguishable-new-series'))
})
test('badge widths are equal and proportional bars use new values with a shared zero-based scale', async () => {
  const f = await comparisonFixture(), fixed = resolveTemplateComparison(f.recipe, f.material, f.plan)
  assert.equal(new Set(Object.values(fixed.graphics).map(b => b.width)).size, 1)
  const linear = await applyTemplateComparison(f.base, { ...f.comparison, encoding: 'proportional-bars' }, 'linear-run')
  const geometry = resolveTemplateComparison(linear, f.material, f.plan)
  assert.equal(geometry.graphics['bar-1-0'].width, 250 * .9)
  assert.equal(geometry.graphics['bar-2-1'].width, 250 * .4)
  const zero = structuredClone(f.material); zero.fragments.find(f => f.id === 'value-1-0')!.text = '0% в 2027'
  assert.equal(resolveTemplateComparison(linear, zero, f.plan).graphics['bar-1-0'].width, 0)
  assert.ok(instantiateTemplate(linear, zero, f.plan, COMPARISON_STATE).every(e => e.id !== 'bar-1-0'))
  assert.throws(() => instantiateTemplate(f.recipe, f.material, f.plan, 'observed'))
})
test('comparison rejects incomplete pairs, unrelated exclusions, and false measurements', async () => {
  const f = await comparisonFixture()
  assert.throws(() => validateTemplateComparison({ ...f.comparison, pairs: [f.comparison.pairs[0], f.comparison.pairs[0]] }, f.base))
  assert.throws(() => validateTemplateComparison({ ...f.comparison, excludeGraphics: [{ sourceId: 'background', reason: 'forbidden' }] }, f.base))
  assert.throws(() => resolveTemplateComparison(f.recipe, f.material, f.plan, []), issue('incomplete-measurements'))
  assert.throws(() => resolveTemplateComparison(f.recipe, f.material, f.plan, f.recipe.slots.filter(s => ['heading', 'body'].includes(s.role)).map(s => ({ sourceId: s.sourceId, width: 999, height: 20 }))), issue('invalid-measurement'))
})
test('comparison materials retain two periods with increases, decreases and equal values at all volumes', () => {
  const cases = comparisonRecipeCases(6)
  assert.deepEqual(cases, comparisonRecipeCases(6))
  assert.ok(cases[0].fragments.reduce((n, f) => n + f.text.length, 0) < cases[2].fragments.reduce((n, f) => n + f.text.length, 0))
  assert.ok(cases.every(c => c.fragments.filter(f => f.text.includes('%')).length === 12))
  assert.deepEqual(cases[0].fragments.filter(f => f.text.includes('%')), cases[2].fragments.filter(f => f.text.includes('%')))
})
test('balanced rows translate complete clipped icons with their wrappers and restore adaptive text wrapping', async () => {
  const f = await balancedComparisonFixture(), geometry = resolveTemplateComparison(f.recipe, f.material, f.plan)
  const instantiated = instantiateTemplate(f.recipe, f.material, f.plan, COMPARISON_STATE)
  const wrapper = instantiated.find(e => e.id === 'icon-wrapper')!
  assert.equal(wrapper.bounds.y, geometry.graphics.icon.y)
  assert.ok('children' in wrapper); assert.equal(wrapper.children[0].bounds.y, 0)
  assert.equal(wrapper.clipsContent, true)
  const heading = instantiated.find(e => e.id === 'heading-2')!
  assert.ok(heading.kind === 'text'); assert.equal(heading.textBox?.wrap, true)
  assert.equal(heading.fontSize, 22)
})
test('new comparison proposals preserve complete overlapping icon groups; old replies remain readable failures', async () => {
  const f = await comparisonFixture()
  f.base.graphicBounds.push({ sourceId: 'circle', bounds: { x: 322, y: 143, width: 24, height: 24 } },
    { sourceId: 'arrow', bounds: { x: 328, y: 150, width: 14, height: 8 } })
  assert.deepEqual(comparisonGraphicGroups(f.base, f.comparison), [['arrow', 'circle']])
  const partial = { ...f.comparison, excludeGraphics: [{ sourceId: 'arrow', reason: 'Incorrect earlier interpretation' }] }
  assert.throws(() => validateTemplateComparison(partial, f.base, true), issue('comparison-partial-icon'))
  const old = await applyTemplateComparison(f.base, partial, 'old-run')
  const geometry = resolveTemplateComparison(old, f.material, f.plan)
  assert.ok(comparisonGeometryIssues(old, geometry, []).some(i => i.startsWith('comparison-partial-icon')))
  assert.doesNotThrow(() => validateTemplateComparison(f.comparison, f.base, true))
  assert.doesNotThrow(() => validateTemplateComparison({ ...partial, excludeGraphics: [...partial.excludeGraphics, { sourceId: 'circle', reason: 'Remove complete marker' }] }, f.base, true))
  const groups = comparisonDetailGroups(f.base)
  assert.deepEqual(groups, [{ id: 'detail-1', sourceIds: ['arrow', 'circle'] }])
  const { excludeGraphics: _excluded, ...choice } = f.comparison
  void _excluded
  const reply = { ...choice, layout: 'balanced-rows', graphics: [{ groupId: groups[0].id, action: 'retain', reason: 'Neutral icon' }] }
  assert.deepEqual(validateComparisonReply(reply, f.base).excludeGraphics, [])
  assert.deepEqual(validateComparisonReply({ ...reply, graphics: [{ ...reply.graphics[0], action: 'exclude' }] }, f.base).excludeGraphics.map(g => g.sourceId), ['arrow', 'circle'])
  assert.throws(() => validateComparisonReply({ ...reply, graphics: [] }, f.base), issue('every-graphic-group'))
  assert.throws(() => validateComparisonReply({ ...reply, graphics: [{ ...reply.graphics[0], groupId: 'unrelated' }] }, f.base), issue('every-graphic-group'))
})
test('comparison reuses only an exact passed source reconstruction without writing or requesting Qwen', async () => {
  const f = await comparisonFixture(), { bucket, data } = memoryBucket(), uploadId = 'fixture'
  const sourceHash = await contentHash(f.snapshot), prefix = `recipe-pilots/${uploadId}/family-2/${sourceHash}`
  await bucket.put(`visual/${uploadId}/manifest.json`, JSON.stringify({ snapshot: f.snapshot, previews: [] }))
  const saveRun = async (key: string, id: string, result: unknown, inputHash = 'hash') => {
    await bucket.put(`${key}/current.json`, JSON.stringify({ runId: id }))
    await bucket.put(`${key}/runs/${id}.json`, JSON.stringify({ id, inputHash, status: 'complete', result }))
  }
  await saveRun(`${prefix}/extract`, 'synthetic-extraction', f.proposal)
  await saveRun(`recipe-pilots/${uploadId}/comparison-1/${sourceHash}/${f.base.passport.version}/compare`, 'synthetic-comparison', f.comparison)
  const reconstructionPrefix = `${prefix}/${f.base.passport.version}/reconstruction`
  const report = { recipeVersion: f.base.passport.version, materialHash: await contentHash({ reconstruction: sourceHash }), stateId: 'reconstruction', passed: true,
    issues: [], fontWarnings: [], measurements: [], trials: [], preview: 'original-preview' }
  await bucket.put(`${reconstructionPrefix}/render.json`, JSON.stringify(report))
  await saveRun(`${reconstructionPrefix}/review`, 'source-review', { verdict: 'pass', issues: [] })
  await bucket.put(`${reconstructionPrefix}/review/inputs/hash.json`, JSON.stringify({ task: templateReviewTask(f.base, null, 'source', report.preview, { ...report, preview: undefined }) }))
  const before = structuredClone([...data]), view = await readTemplatePilot(bucket, uploadId, 'comparison-1')
  assert.equal(view.reconstruction.report?.recipeVersion, f.base.passport.version)
  assert.ok('reusedFrom' in view.reconstruction)
  const cached = await startTemplatePilot(bucket, uploadId, { apiKey: 'test', model: 'test', baseUrl: 'https://provider.invalid' }, 'review', 'reconstruction', undefined, 'comparison-1')
  assert.equal(cached.execute, null); assert.equal(cached.run?.id, 'source-review')
  assert.deepEqual([...data], before)
  await bucket.put(`${reconstructionPrefix}/render.json`, JSON.stringify({ ...report, preview: 'changed-preview' }))
  assert.equal('reusedFrom' in (await readTemplatePilot(bucket, uploadId, 'comparison-1')).reconstruction, false)
})
test('comparison gets a bounded separate allowance without refilling prior experiments', async () => {
  const { bucket, data } = memoryBucket()
  await reservePilotRequest(bucket, 'fixture', 'family-2')
  const prior = structuredClone([...data])
  for (let i = 0; i < 18; i++) await reservePilotRequest(bucket, 'fixture', 'comparison-1')
  assert.deepEqual(await pilotBudget(bucket, 'fixture', 'comparison-1'), { used: 18, limit: 18 })
  await assert.rejects(reservePilotRequest(bucket, 'fixture', 'comparison-1'))
  assert.deepEqual([...data].filter(([key]) => key.includes('/family-2/')), prior)
})
test('explicit comparison continuation has a separate idempotent ledger and cannot refill its initial allowance', async () => {
  const { bucket, data } = memoryBucket()
  for (let i = 0; i < 18; i++) await reservePilotRequest(bucket, 'fixture', 'comparison-1')
  const initial = structuredClone([...data])
  assert.deepEqual(await authorizeComparisonCheck(bucket, 'fixture', 'User delegated continued requests'), { used: 18, limit: 24 })
  for (let i = 0; i < 6; i++) await reservePilotRequest(bucket, 'fixture', 'comparison-1')
  assert.deepEqual(await authorizeComparisonCheck(bucket, 'fixture', 'Repeated grant does not refill'), { used: 24, limit: 24 })
  await assert.rejects(reservePilotRequest(bucket, 'fixture', 'comparison-1'))
  assert.deepEqual([...data].filter(([key]) => !key.includes('/allowances/')), initial)
})
test('comparison feedback cannot return to a row layout already shown to overflow unchanged content', async () => {
  const f = await comparisonFixture(), source = await applyTemplateComparison(f.base, { ...f.comparison, layout: 'source-rows' }, 'source-rows')
  const failed = [{ report: { issues: ['overflow:body-2'] } }]
  assert.deepEqual(comparisonAllowedLayouts(source, failed), ['balanced-rows'])
  const { excludeGraphics: _excluded, ...choice } = f.comparison
  void _excluded
  assert.throws(() => validateComparisonReply({ ...choice, layout: 'source-rows', graphics: [] }, source, failed), issue('layout-already-failed'))
  assert.doesNotThrow(() => validateComparisonReply({ ...choice, layout: 'balanced-rows', graphics: [] }, source, failed))
  const balanced = await applyTemplateComparison(f.base, { ...f.comparison, layout: 'balanced-rows' }, 'balanced')
  assert.deepEqual(comparisonAllowedLayouts(balanced, [{ report: { issues: ['comparison-partial-icon:circle,arrow'] } }]), ['balanced-rows'])
})
