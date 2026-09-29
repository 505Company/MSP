import test from 'node:test'
import assert from 'node:assert/strict'
import { compileTemplateRecipe } from '../lib/presentations/recipes/template-contract'
import { applyTemplateReflow, resizeTemplatePanel, resolveTemplateReflow, validateTemplateReflow } from '../lib/presentations/recipes/template-reflow'
import { instantiateTemplate } from '../lib/presentations/recipes/template-plan'
import { pilotBudget, readTemplatePilot, reservePilotRequest, startTemplatePilot } from '../lib/presentations/recipes/template-pilot'
import { contentHash } from '../lib/design-system/catalog'
import { primitivePath } from '../lib/design-system/pattern-geometry'
import type { ShapeElementIR } from '../vendor/drag/src/core/model'
import { templateRecipeFixture } from './fixtures/template-recipe'
import { memoryBucket } from './helpers/memory-bucket'

const reflow = { columns: 2, header: 'inline' as const, rationale: 'Synthetic model proposal, not a user slide.' }
const grid = 'grid-2x2-inline'

test('a model-authorized grid preserves existing states, exact text, fonts, paint and source evidence', async () => {
  const { snapshot, proposal, material, plan } = templateRecipeFixture()
  const base = await compileTemplateRecipe(proposal, snapshot, 'upload', 'extraction'), before = structuredClone(base)
  const recipe = await applyTemplateReflow(base, reflow, 'model-reflow')
  assert.deepEqual(base, before)
  assert.deepEqual(recipe.stateBounds.observed, base.stateBounds.observed)
  assert.deepEqual(recipe.stateBounds.expanded, base.stateBounds.expanded)
  assert.equal(recipe.passport.states.at(-1)?.evidence, 'proposed')
  assert.equal(recipe.passport.transitions.at(-1)?.level, 3)
  assert.equal(recipe.reflow?.modelRunId, 'model-reflow')
  assert.equal(recipe.reflow?.previousVersion, base.passport.version)
  const panels = recipe.stateGraphics![grid]
  assert.equal(panels['panel-1'].x, 30)
  assert.equal(panels['panel-2'].x + panels['panel-2'].width, 1170)
  assert.equal(panels['panel-3'].y, panels['panel-4'].y)
  assert.ok(panels['panel-3'].y > panels['panel-1'].y + panels['panel-1'].height)
  assert.deepEqual(recipe.stateBounds[grid].primary, base.stateBounds.observed.primary)
  const elements = instantiateTemplate(recipe, material, plan, grid)
  for (const e of elements) {
    const source = base.elements.find(s => s.id === e.id)!
    if (e.kind === 'text' && source.kind === 'text') {
      assert.equal(e.fontSize, source.fontSize)
      assert.equal(e.fontFamily, source.fontFamily)
      const binding = plan.bindings.find(b => b.sourceId === e.id)!
      assert.equal(e.text, binding.fragments.map(id => material.fragments.find(f => f.id === id)!.text).join('\n'))
    } else if ('fill' in e && 'fill' in source) assert.deepEqual(e.fill, source.fill)
  }
  assert.deepEqual(instantiateTemplate(recipe, material, plan, 'expanded'), instantiateTemplate(base, material, plan, 'expanded'))
})

test('resized native rounded panels preserve absolute radii and reject arbitrary paths or raster panels', () => {
  const corners: [number, number, number, number] = [.04, .06, .08, .02]
  const panel: ShapeElementIR = { id: 'panel', name: 'panel', kind: 'path', bounds: { x: 0, y: 0, width: 250, height: 300 }, rotation: 0, visible: true, opacity: 1, zIndex: 0,
    pathData: primitivePath({ kind: 'rounded', corners }, 250, 300), fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } } }
  const result = resizeTemplatePanel(panel, { x: 30, y: 140, width: 560, height: 240 })
  assert.equal(result.pathData, primitivePath({ kind: 'rounded', corners: corners.map(r => r * 250 / 240) as typeof corners }, 560, 240))
  assert.throws(() => resizeTemplatePanel({ ...panel, pathData: 'M 0 0 L 250 0 L 100 200 Z' }, result.bounds))
  assert.throws(() => resizeTemplatePanel({ ...panel, rotation: 30 }, result.bounds))
  assert.throws(() => resizeTemplatePanel({ ...panel, kind: 'raster', assetId: 'photo', reason: 'not an empty panel' }, result.bounds))
})

test('grid cannot cross a fixed footer or silently discard a newly bound optional field', async () => {
  const { snapshot, proposal, material, plan } = templateRecipeFixture()
  const base = await compileTemplateRecipe(proposal, snapshot, 'upload', 'run')
  base.graphicBounds.push({ sourceId: 'footer', bounds: { x: 30, y: 620, width: 100, height: 30 } })
  const recipe = await applyTemplateReflow(base, reflow, 'run')
  for (const b of Object.values(recipe.stateGraphics![grid])) assert.ok(b.y + b.height <= 600)
  const withNote = { ...material, fragments: [...material.fragments, { id: 'new-note', text: 'Обязательное новое уточнение' }] }
  const withBinding = { ...plan, bindings: [...plan.bindings, { sourceId: 'note-1', fragments: ['new-note'] }] }
  assert.throws(() => instantiateTemplate(recipe, withNote, withBinding, grid), { issues: ['incompatible-bound-optional-slot'] })
  assert.ok(JSON.stringify(instantiateTemplate(recipe, withNote, withBinding, 'expanded')).includes('Обязательное новое уточнение'))
})

test('grid validation rejects invented coordinates, incomplete rows, shared owners and blocked free space', async () => {
  const { snapshot, proposal } = templateRecipeFixture(), base = await compileTemplateRecipe(proposal, snapshot, 'upload', 'run')
  for (const raw of [{ ...reflow, x: 10 }, { ...reflow, columns: 3 }, { ...reflow, columns: 4 }, { ...reflow, header: 'shrink' }]) assert.throws(() => validateTemplateReflow(raw, base))
  const shared = structuredClone(base); shared.slots.find(s => s.sourceId === 'body-2')!.ownerId = 'panel-1'
  assert.throws(() => validateTemplateReflow(reflow, shared))
  const blocked = structuredClone(base); blocked.graphicBounds.push({ sourceId: 'fixed-illustration', bounds: { x: 40, y: 150, width: 100, height: 100 } })
  assert.throws(() => validateTemplateReflow(reflow, blocked))
  const clipped = structuredClone(base)
  clipped.elements = [{ id: 'clip', name: 'clip', kind: 'group', rotation: 0, opacity: 1, visible: true, zIndex: 0,
    bounds: { x: 0, y: 0, width: 1200, height: 675 }, clipPathData: 'M 0 0 L 1200 0 L 1200 675 Z', children: clipped.elements }]
  assert.throws(() => validateTemplateReflow(reflow, clipped))
})

test('measured rows redistribute free space deterministically without crossing the footer or accepting arbitrary frames', async () => {
  const { snapshot, proposal, plan, material } = templateRecipeFixture(), base = await compileTemplateRecipe(proposal, snapshot, 'upload', 'run')
  const recipe = await applyTemplateReflow(base, reflow, 'run')
  const ids = plan.bindings.map(b => b.sourceId)
  const measured = recipe.slots.filter(s => s.item > 0 && ids.includes(s.sourceId)).map(s => ({ sourceId: s.sourceId, width: recipe.stateBounds[grid][s.sourceId].width,
    height: s.role === 'heading' ? 30 : s.item <= 2 ? 60 : 140 }))
  const layout = resolveTemplateReflow(recipe, measured, ids)
  assert.ok(layout.graphics['panel-3'].height > layout.graphics['panel-1'].height)
  assert.equal(layout.graphics['panel-4'].y + layout.graphics['panel-4'].height, 645)
  const rendered = instantiateTemplate(recipe, material, plan, grid, measured)
  assert.deepEqual(rendered.find(e => e.id === 'body-3')!.bounds, layout.bounds['body-3'])
  assert.throws(() => resolveTemplateReflow(recipe, measured.slice(1), ids))
  assert.throws(() => resolveTemplateReflow(recipe, measured.map((m, i) => i ? m : { ...m, width: m.width + 1 }), ids))
  assert.throws(() => resolveTemplateReflow(recipe, measured.map((m, i) => i ? m : { ...m, height: Infinity }), ids))
  assert.throws(() => instantiateTemplate(recipe, material, plan, 'observed', measured))
})

test('six additional requests are an independent atomic allowance; exhausted original budget stays unchanged', async () => {
  const { bucket } = memoryBucket()
  for (let i = 0; i < 12; i++) await reservePilotRequest(bucket, 'upload')
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => reservePilotRequest(bucket, 'upload', 'structural-1')))
  const budget = await pilotBudget(bucket, 'upload', 'structural-1')
  assert.ok(budget.used <= 6)
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, budget.used)
  while ((await pilotBudget(bucket, 'upload', 'structural-1')).used < 6) await reservePilotRequest(bucket, 'upload', 'structural-1')
  await assert.rejects(reservePilotRequest(bucket, 'upload', 'structural-1'), /предел/)
  await assert.rejects(reservePilotRequest(bucket, 'upload'), /предел/)
  assert.deepEqual(await pilotBudget(bucket, 'upload'), { used: 12, limit: 12 })
  assert.deepEqual(await pilotBudget(bucket, 'upload', 'structural-1'), { used: 6, limit: 6 })
})

test('a structural round reuses extraction but cannot spend on a new extraction, binding or old refinement', async () => {
  const { bucket } = memoryBucket()
  const config = { apiKey: 'test', baseUrl: 'https://example.invalid/v1', model: 'test' }
  for (const action of ['extract', 'adapt', 'plan'] as const) await assert.rejects(startTemplatePilot(bucket, 'upload', config, action, undefined, undefined, 'structural-1'), /операция/)
  assert.deepEqual(await pilotBudget(bucket, 'upload', 'structural-1'), { used: 0, limit: 6 })
})

test('reading the structural round never rewrites the original recipe, plans, reports or allowance', async () => {
  const { snapshot, proposal } = templateRecipeFixture(), { bucket, data } = memoryBucket(), uploadId = 'upload'
  await bucket.put(`visual/${uploadId}/manifest.json`, JSON.stringify({ snapshot, previews: [] }))
  const prefix = `recipe-pilots/${uploadId}/pilot-1/${await contentHash(snapshot)}`
  await bucket.put(`${prefix}/extract/current.json`, JSON.stringify({ runId: 'extract' }))
  await bucket.put(`${prefix}/extract/runs/extract.json`, JSON.stringify({ id: 'extract', status: 'complete', result: proposal }))
  const recipe = await compileTemplateRecipe(proposal, snapshot, uploadId, 'extract')
  const key = `${prefix}/${recipe.passport.version}/structural-1/reflow`
  await bucket.put(`${key}/current.json`, JSON.stringify({ runId: 'reflow' }))
  await bucket.put(`${key}/runs/reflow.json`, JSON.stringify({ id: 'reflow', status: 'complete', result: reflow }))
  const before = structuredClone([...data])
  const next = await readTemplatePilot(bucket, uploadId, 'structural-1'), original = await readTemplatePilot(bucket, uploadId)
  assert.equal(next.recipe?.reflow?.modelRunId, 'reflow')
  assert.equal(original.recipe?.reflow, undefined)
  assert.equal(original.recipe?.passport.version, recipe.passport.version)
  assert.deepEqual([...data], before)
})
