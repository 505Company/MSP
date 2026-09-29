import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { authoredRecipePassport } from '../lib/presentations/recipes/passport'
import { layoutStates } from '../lib/presentations/recipes/layout-engine-v1/states'
import { applyTemplateAdaptation, compileTemplateRecipe, templateCandidates, validateTemplateAdaptation, validateTemplateProposal } from '../lib/presentations/recipes/template-contract'
import { instantiateTemplate, validateTemplatePlan } from '../lib/presentations/recipes/template-plan'
import { recipePilotCases } from '../lib/presentations/recipes/pilot-cases'
import { pilotBudget, readTemplatePilot, reservePilotRequest, validatePilotPng } from '../lib/presentations/recipes/template-pilot'
import { templateExtractionTask, templateReviewTask } from '../lib/presentations/recipes/template-task'
import { contentHash } from '../lib/design-system/catalog'
import { templateRecipeFixture } from './fixtures/template-recipe'
import { sourceText } from './fixtures/native-layout'
import { memoryBucket } from './helpers/memory-bucket'

test('author passport references all unchanged states and exact original recipe bytes', async () => {
  const passport = authoredRecipePassport(), bytes = await readFile(new URL('../lib/presentations/recipes/layout-engine-v1/SOURCE.txt', import.meta.url))
  assert.equal(passport.origin.sourceHash, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(passport.states.map(s => s.id), layoutStates.map(s => s.id))
  assert.equal(passport.scope.kind, 'portable'); assert.equal(passport.qualification.artistic, 'pending')
})

test('template compilation preserves source, all visible leaf provenance, outer grid and font sizes', async () => {
  const { snapshot, proposal, material, plan } = templateRecipeFixture(), before = structuredClone(snapshot)
  const recipe = await compileTemplateRecipe(proposal, snapshot, 'upload', 'model-run')
  assert.deepEqual(snapshot, before)
  assert.equal(recipe.ledger.length, snapshot.elements.length)
  assert.equal(recipe.passport.origin.modelRunId, 'model-run')
  assert.deepEqual(recipe.passport.scope, { kind: 'design-system', uploadId: 'upload' })
  assert.deepEqual(recipe.passport.states.map(s => s.evidence), ['observed', 'proposed'])
  const observed = recipe.stateBounds.observed['body-1'], expanded = recipe.stateBounds.expanded['body-1']
  assert.deepEqual({ ...expanded, height: observed.height }, observed)
  assert.ok(expanded.height > observed.height)
  const scene = instantiateTemplate(recipe, material, plan, 'expanded')
  assert.equal(scene.find(e => e.id === 'body-1')!.kind, 'text')
  assert.equal(JSON.stringify(scene).includes('Старый факт'), false)
  assert.equal(JSON.stringify(recipe.originalElements).includes('Старый факт'), true)
  assert.equal((scene.find(e => e.id === 'body-1') as { fontSize: number }).fontSize, 22)
  assert.deepEqual(snapshot, before)
})

test('template validation rejects wrong roles, duplicate coverage, foreign owners and invented geometry', () => {
  const { snapshot, proposal } = templateRecipeFixture()
  for (const mutate of [
    (p: typeof proposal) => { p.slots[0].role = 'heading' },
    (p: typeof proposal) => { p.slots.push(p.slots[0]) },
    (p: typeof proposal) => { p.slots.find(s => s.role === 'body')!.ownerId = 'panel-4' },
    (p: typeof proposal) => { p.graphics.pop() },
    (p: typeof proposal) => { Object.assign(p, { x: 10 }) },
    (p: typeof proposal) => { p.expandSlots.push('primary') },
  ]) { const p = structuredClone(proposal); mutate(p); assert.throws(() => validateTemplateProposal(p, snapshot, ['s01'])) }
  assert.throws(() => validateTemplateProposal(proposal, snapshot, ['s02']))
})

test('source-only numbers are never treated as reusable graphics or editable template text', async () => {
  const { snapshot, proposal, material, plan } = templateRecipeFixture()
  const image = { id: 'old-number', slide: 1, kind: 'raster', name: 'Old number', properties: { bounds: { x: 0, y: 610, width: 100, height: 50 }, visible: true, opacity: 1, rotation: 0, zIndex: 1, assetId: 'old-value', reason: 'Synthetic raster text' } }
  snapshot.elements.push(image)
  proposal.graphics.push({ sourceId: image.id, usage: 'source-only', reason: 'Raster contains the old value' })
  const recipe = await compileTemplateRecipe(proposal, snapshot, 'upload', 'run')
  assert.ok(recipe.originalElements.some(e => e.id === image.id))
  assert.equal(instantiateTemplate(recipe, material, plan, 'observed').some(e => e.id === image.id), false)
})

test('bindings preserve every whole fragment once, required slots and four-item capacity', async () => {
  const { snapshot, proposal, material, plan } = templateRecipeFixture()
  const recipe = await compileTemplateRecipe(proposal, snapshot, 'upload', 'run')
  assert.deepEqual(validateTemplatePlan(plan, recipe, material), plan)
  assert.throws(() => validateTemplatePlan({ ...plan, bindings: plan.bindings.slice(1) }, recipe, material))
  assert.throws(() => validateTemplatePlan({ ...plan, bindings: [...plan.bindings, plan.bindings[0]] }, recipe, material))
  assert.throws(() => validateTemplatePlan(plan, recipe, { ...material, itemCount: 3 }))
  assert.throws(() => instantiateTemplate(recipe, material, plan, 'invented-state'))
})

test('the twelve-request pilot allowance is atomic and cannot reset with a renderer or source revision', async () => {
  const { bucket, data } = memoryBucket()
  const attempts = await Promise.allSettled(Array.from({ length: 16 }, () => reservePilotRequest(bucket, 'upload')))
  const budget = await pilotBudget(bucket, 'upload')
  assert.ok(budget.used <= 12); assert.equal(attempts.filter(a => a.status === 'fulfilled').length, budget.used)
  while ((await pilotBudget(bucket, 'upload')).used < 12) await reservePilotRequest(bucket, 'upload')
  await assert.rejects(reservePilotRequest(bucket, 'upload'), /предел/)
  assert.deepEqual(await pilotBudget(bucket, 'upload'), { used: 12, limit: 12 })
  assert.deepEqual([...data.keys()], ['recipe-pilots/upload/pilot-1/budget.json'])
})

test('source candidates retain font warnings, exclude incomplete slides and provide geometric ownership choices', () => {
  const { snapshot } = templateRecipeFixture()
  snapshot.slides[0].warnings = ['font-substitution: Explicitly declared replacement']
  assert.equal(templateCandidates(snapshot).length, 1)
  const task = templateExtractionTask(snapshot, [{ slideId: 's01', dataUrl: 'data:image/png;base64,AA==' }])
  const input = task.messages[1].content
  assert.ok(Array.isArray(input))
  const data = JSON.parse((input[0] as { text: string }).text)
  assert.deepEqual(data.candidates[0].nodes.find((n: { id: string }) => n.id === 'body-1').containerCandidates, ['panel-1'])
  snapshot.slides[0].warnings.push('normalized-page-unavailable')
  assert.equal(templateCandidates(snapshot).length, 0)
})

test('pilot materials are independently marked synthetic and exercise increasing text loads', () => {
  const lengths = recipePilotCases.map(c => c.fragments.reduce((sum, f) => sum + f.text.length, 0))
  assert.ok(lengths[0] < lengths[1] && lengths[1] < lengths[2])
  for (const material of recipePilotCases) assert.equal(material.synthetic, true)
})

test('model refinement can widen a free context row, cannot change a body or cross a source obstacle', async () => {
  const { snapshot, proposal } = templateRecipeFixture()
  snapshot.elements.push(sourceText('context', 'Контекст', 30, 100, 100, 25, 18, 'Play'))
  proposal.slots.push({ sourceId: 'context', role: 'context', item: 0, optional: true, ownerId: null })
  const base = await compileTemplateRecipe(proposal, snapshot, 'upload', 'base-run')
  const original = structuredClone(base)
  const refined = await applyTemplateAdaptation(base, { widenSlots: ['context'], rationale: 'Measured overflow in the empty context row.' }, 'refinement-run')
  assert.deepEqual(base, original)
  assert.equal(refined.adaptation?.baseVersion, base.passport.version)
  assert.equal(refined.adaptation?.modelRunId, 'refinement-run')
  assert.equal(refined.stateBounds.rebalanced.context.width, 1140)
  assert.deepEqual(refined.stateBounds.rebalanced['body-1'], base.stateBounds.expanded['body-1'])
  assert.notEqual(refined.passport.version, base.passport.version)
  assert.throws(() => validateTemplateAdaptation({ widenSlots: ['body-1'], rationale: 'Invalid' }, base))
  assert.throws(() => validateTemplateAdaptation({ widenSlots: ['context', 'context'], rationale: 'Invalid' }, base))
  base.graphicBounds.push({ sourceId: 'obstacle', bounds: { x: 500, y: 100, width: 100, height: 25 } })
  const bounded = await applyTemplateAdaptation(base, { widenSlots: ['context'], rationale: 'Respect the row graphic.' }, 'run')
  assert.equal(bounded.stateBounds.rebalanced.context.width, 470)
})

test('a claimed render must at least contain a PNG with the exact recipe aspect and preview dimensions', () => {
  assert.throws(() => validatePilotPng('data:image/png;base64,AA==', 1600, 900))
  const png = Buffer.alloc(33)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.write('IHDR', 12); png.writeUInt32BE(1024, 16); png.writeUInt32BE(576, 20)
  const url = `data:image/png;base64,${png.toString('base64')}`
  assert.doesNotThrow(() => validatePilotPng(url, 1600, 900))
  assert.throws(() => validatePilotPng(url, 1000, 1000))
})

test('visual review clearly labels the actual target and distinguishes reconstruction from new content', async () => {
  const { snapshot, proposal, material } = templateRecipeFixture()
  const recipe = await compileTemplateRecipe(proposal, snapshot, 'upload', 'run')
  const task = templateReviewTask(recipe, material, 'source-image', 'result-image', { passed: true })
  assert.ok(String(task.messages[0].content).includes('НОВЫЙ МАТЕРИАЛ, НЕ reconstruction'))
  const content = task.messages[1].content
  assert.ok(Array.isArray(content))
  assert.deepEqual(content.at(-1), { type: 'image_url', image_url: { url: 'result-image' } })
  assert.ok('text' in content.at(-2)! && (content.at(-2) as { text: string }).text.includes('ИЗОБРАЖЕНИЕ 2'))
  assert.ok(String(templateReviewTask(recipe, null, 'source', 'result', {}).messages[0].content).includes('Это RECONSTRUCTION'))
})

test('a saved visual verdict cannot approve a replacement PNG or different measurements', async () => {
  const { snapshot, proposal } = templateRecipeFixture(), { bucket } = memoryBucket(), uploadId = 'upload'
  await bucket.put(`visual/${uploadId}/manifest.json`, JSON.stringify({ snapshot, previews: [] }))
  const prefix = `recipe-pilots/${uploadId}/pilot-1/${await contentHash(snapshot)}`
  await bucket.put(`${prefix}/extract/current.json`, JSON.stringify({ runId: 'extract' }))
  await bucket.put(`${prefix}/extract/runs/extract.json`, JSON.stringify({ id: 'extract', status: 'complete', result: proposal }))
  const recipe = await compileTemplateRecipe(proposal, snapshot, uploadId, 'extract')
  const casePrefix = `${prefix}/${recipe.passport.version}/reconstruction`
  const report = { recipeVersion: recipe.passport.version, materialHash: 'source', stateId: 'reconstruction', passed: true, issues: [], fontWarnings: [], measurements: [], trials: [], preview: 'original-preview' }
  await bucket.put(`${casePrefix}/render.json`, JSON.stringify(report))
  await bucket.put(`${casePrefix}/review/current.json`, JSON.stringify({ runId: 'review' }))
  await bucket.put(`${casePrefix}/review/runs/review.json`, JSON.stringify({ id: 'review', inputHash: 'hash', status: 'complete', result: { verdict: 'pass', issues: [] } }))
  await bucket.put(`${casePrefix}/review/inputs/hash.json`, JSON.stringify({ task: templateReviewTask(recipe, null, 'source', report.preview, { ...report, preview: undefined }) }))
  assert.equal((await readTemplatePilot(bucket, uploadId)).reconstruction.review?.id, 'review')
  await bucket.put(`${casePrefix}/render.json`, JSON.stringify({ ...report, preview: 'changed-preview' }))
  assert.equal((await readTemplatePilot(bucket, uploadId)).reconstruction.review, null)
  await bucket.put(`${casePrefix}/render.json`, JSON.stringify({ ...report, issues: ['changed'] }))
  assert.equal((await readTemplatePilot(bucket, uploadId)).reconstruction.review, null)
})
