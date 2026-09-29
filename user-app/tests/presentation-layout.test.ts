import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { layoutInput, layoutPlan, whole } from './fixtures/layout'
import { candidateStates, componentData, resolveLayoutPlan, validateLayoutPlan, type LayoutFit, type LayoutPlan } from '../lib/presentations/layout-contract'
import { layoutStates, stateById, adaptationLevel } from '../lib/presentations/recipes/layout-engine-v1/states'
import source from '../lib/presentations/recipes/layout-engine-v1/source.json' with { type: 'json' }
import { activeRecipe } from '../lib/presentations/active-recipe'
import { acceptedVariants, recipeFamilies } from '../lib/presentations/recipes/catalog'
import { renderLayoutHtml } from '../lib/presentations/layout-html'
import { layoutTask } from '../lib/presentations/layout-task'
import { layoutView, startLayoutAction, validLayoutMeasurement, readLayoutPreview } from '../lib/presentations/layout-workflow'
import type { LayoutContext } from '../lib/presentations/layout-context'
import type { EditableTemplate } from '../lib/design-system/editable-contract'
import { addBankStyle, createProject, updateProject } from '../lib/workspace/storage'
import { memoryBucket } from './helpers/memory-bucket'
import { replayLayoutPlan } from '../lib/presentations/layout-replay'
import { beginModelRun } from '../lib/uploads/model-run'
import { readLayoutBudget, limitLayoutRequests } from '../lib/presentations/layout-budget'
import { contentHash } from '../lib/design-system/catalog'

const evidence = { fontTokens: ['font-1'] }
const config = { apiKey: 'layout-test-secret', model: 'test-model', baseUrl: 'https://provider.invalid/v1' }
const response = (result: unknown) => new Response(JSON.stringify({ id: 'fixture', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }), { headers: { 'Content-Type': 'application/json' } })
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
function fitted(hash: string, plan = layoutPlan()): LayoutFit {
  const state = candidateStates(plan)[0], b = state.primary
  return { version: 'layout-dom-3', planHash: hash, passed: true, stateId: state.id, plainComponents: false, previewCheck: { width: 1280, height: 720, textBlocks: [{ block: 'primary', pixels: 300 }] }, trials: [{ stateId: state.id, plainComponents: false, level: 0, issues: [], measurements: [{ block: 'primary', width: b.width, height: b.height, scrollWidth: b.width, scrollHeight: b.height, lines: 1, fontSize: b.fontSize! }] }] }
}
async function fixture() {
  const store = memoryBucket(), input = layoutInput(), style = { id: input.uploadId, name: 'Layout unit style', fileName: 'fixture.pptx', sourceId: 'source-1', createdAt: new Date().toISOString(), slideCount: 1, componentCount: 0, styleCount: 1, previewId: null, colors: [], fonts: [] }
  await addBankStyle(store.bucket, style)
  const project = await createProject(store.bucket, { id: crypto.randomUUID(), name: 'Layout fixture', uploadId: style.id, text: input.content[0].text }, style)
  const context: LayoutContext = { projectId: project.id, uploadId: style.id, sourceRevision: project.revision, materialId: 'material-1', inputId: 'a'.repeat(64), prefix: `presentation-layouts/${project.id}/fixture`, inputs: [input] }
  // Exercise the immutable pre-library author protocol, including saved retries.
  await store.bucket.put(`${context.prefix}/recipe-library.json`, JSON.stringify({ version: 'library-selection-1', hash: await contentHash([]), recipes: [] }))
  const action = { action: 'plan' as const, inputId: context.inputId, slideId: input.slideId, round: 0, evidence }
  return { ...store, input, context, project, action }
}
test('new recipe is active; original source is exact and ten old recipes remain recoverable', async () => {
  assert.equal(activeRecipe(), 'layout-engine-v1'); assert.equal(acceptedVariants.length, 30); assert.equal(recipeFamilies.length, 10)
  const bytes = await readFile('lib/presentations/recipes/layout-engine-v1/SOURCE.txt')
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sourceSha256); assert.equal(bytes.toString(), source.text)
  assert.equal(layoutStates.length, 15); assert.equal(new Set(layoutStates.map(s => s.family)).size, 9)
  assert.deepEqual(candidateStates(layoutPlan()).slice(0, 5).map(s => s.primary.fontSize), [184, 184, 184, 184, 140])
  assert.deepEqual(stateById('visual-mosaic')!.visuals!.map(b => [b.width, b.height]), [[380, 817], [384, 457], [384, 328]])
})
test('Qwen plan keeps exact source, arbitrary geometry and content rewriting are rejected', () => {
  const input = layoutInput(), good = layoutPlan(input)
  validateLayoutPlan(good, input, evidence)
  for (const change of [(p: LayoutPlan) => p.primary[0].end--, (p: LayoutPlan) => p.primary.push(p.primary[0]), (p: LayoutPlan) => p.fontToken = 'invented', (p: LayoutPlan) => p.colors.primary = '#123456', (p: LayoutPlan) => p.preferredState = 'old-recipe', (p: LayoutPlan) => Object.assign(p, { x: 45 }), (p: LayoutPlan) => Object.assign(p.primary[0], { text: 'A rewritten claim' })]) {
    const bad = structuredClone(good); change(bad); assert.throws(() => validateLayoutPlan(bad, input, evidence))
  }
  assert.throws(() => validateLayoutPlan(good, input, { fontTokens: [] }))
  assert.ok(String(layoutTask(input, evidence).messages[0].content).includes(source.text))
})
test('layout request bounds explanations and supplies exact UTF-16 ranges without shortening source', () => {
  const input = layoutInput(); input.content[0].text = 'Здоровье 🧬 после 40'
  const before = JSON.stringify(input), task = layoutTask(input, evidence)
  const schema = task.schema as { properties: { rationale: { maxLength?: number }; visuals: { items: { properties: { reason: { maxLength?: number } } } } } }
  assert.equal(schema.properties.rationale.maxLength, 1000)
  assert.equal(schema.properties.visuals.items.properties.reason.maxLength, 500)
  assert.equal(task.maxTokens, 10000)
  const data = JSON.parse(task.messages[1].content as string)
  assert.deepEqual(data.source, input.content.map(f => ({ ...f, whole: { fragmentId: f.id, start: 0, end: f.text.length } })))
  assert.equal(JSON.stringify(input), before)
})
test('an explicit layout retry uses the corrected request and never publishes a truncated plan', async t => {
  const f = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    calls++
    const body = JSON.parse(init!.body as string)
    if (calls === 1 || body.max_tokens < 10000 || !body.response_format.json_schema.schema.properties.rationale.maxLength) {
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"preferredState":"title-1"' } }], usage: { completion_tokens: body.max_tokens } }))
    }
    return response(layoutPlan(f.input))
  })
  await assert.rejects((await startLayoutAction(f.bucket, f.context, f.action, config)).execute!(), /обрезан/)
  const failed = await layoutView(f.bucket, f.context)
  assert.equal(failed.next!.phase, 'failed'); assert.equal(failed.next!.plan, undefined)
  assert.ok(failed.next!.error?.includes('слайда'))
  assert.ok(!failed.next!.error?.includes('анализ'))
  await assert.rejects(startLayoutAction(f.bucket, f.context, f.action, config), /Продолжить создание/)
  assert.equal(calls, 1)
  await (await startLayoutAction(f.bucket, f.context, { ...f.action, retry: true }, config)).execute!()
  assert.equal((await layoutView(f.bucket, f.context)).next!.phase, 'render')
  assert.equal(calls, 2)
})
test('component fields cannot reuse example data, split words, omit or borrow source characters', () => {
  const input = layoutInput(); input.content.push({ id: 'support', text: 'Новая поддержка' })
  const t = { id: 'qualified', kind: 'feature', data: { title: 'OLD TITLE', text: 'OLD FACT 98%', items: [{ id: 'item', text: 'OLD ITEM' }] } } as EditableTemplate
  input.components = [t]
  const p = layoutPlan(input); p.preferredState = 'title-support-a'; p.support = [{ parts: whole(input, 1), component: { id: t.id, fields: [{ path: 'text', parts: whole(input, 1) }] } }]
  validateLayoutPlan(p, input, evidence)
  assert.deepEqual(componentData(p.support[0].component!, t, input), { items: [{ id: 'item' }], text: 'Новая поддержка' })
  const bad = structuredClone(p); bad.support[0].component!.fields = [{ path: 'title', parts: [{ fragmentId: 'support', start: 0, end: 2 }] }, { path: 'text', parts: [{ fragmentId: 'support', start: 2, end: input.content[1].text.length }] }]
  assert.throws(() => validateLayoutPlan(bad, input, evidence), e => JSON.stringify(e).includes('word-or-glyph-split'))
  bad.support[0].component!.fields[0].path = 'items.1000.text'; assert.throws(() => validateLayoutPlan(bad, input, evidence))
})
test('an optional invalid component falls back to its complete source block, never repairing missing content', () => {
  const input = layoutInput(); input.content.push({ id: 'support', text: 'Полный исходный абзац.' })
  input.components = [{ id: 'two-fields', kind: 'feature', data: { title: 'Example', text: 'Example' } } as EditableTemplate]
  const plan = layoutPlan(input); plan.preferredState = 'title-support-a'
  const parts = whole(input, 1)
  plan.support = [{ parts, component: { id: 'two-fields', fields: [{ path: 'title', parts }, { path: 'text', parts }] } }]
  const original = JSON.stringify(plan), resolved = resolveLayoutPlan(plan, input, evidence)
  assert.equal(resolved.plan.support[0].component, undefined)
  assert.deepEqual(resolved.plan.support[0].parts, parts)
  assert.deepEqual(resolved.componentFallbacks.map(f => f.componentId), ['two-fields'])
  assert.equal(JSON.stringify(plan), original)
  validateLayoutPlan(resolved.plan, input, evidence)
  const missing = structuredClone(plan); missing.support[0].parts[0].end--
  assert.throws(() => resolveLayoutPlan(missing, input, evidence))
  const duplicated = structuredClone(plan); duplicated.primary.push(...parts)
  assert.throws(() => resolveLayoutPlan(duplicated, input, evidence))
})
test('authored geometry is fixed, source HTML is escaped, plain support does not change content', () => {
  const input = layoutInput(); input.content[0].text = '<script>alert(1)</script>'
  const html = renderLayoutHtml(layoutPlan(input), input, 'title-1')
  assert.ok(html.includes('left:46px;top:805px')); assert.ok(html.includes('font-size:184px')); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'))
})
test('DOM reports cannot skip earlier states, omit blocks, hide overflow or shrink fonts', () => {
  const p = layoutPlan(), hash = 'b'.repeat(64), good = fitted(hash)
  assert.ok(validLayoutMeasurement(good, p, hash))
  for (const change of [(f: LayoutFit) => f.trials[0].measurements.pop(), (f: LayoutFit) => f.trials[0].measurements[0].fontSize = 80, (f: LayoutFit) => f.trials[0].measurements[0].scrollWidth = 5000, (f: LayoutFit) => f.trials[0].stateId = 'title-extreme', (f: LayoutFit) => f.passed = false, (f: LayoutFit) => delete f.previewCheck, (f: LayoutFit) => f.previewCheck!.textBlocks[0].pixels = 0]) {
    const bad = structuredClone(good); change(bad); assert.equal(validLayoutMeasurement(bad, p, hash), false)
  }
})
test('model → real-fit report → visual review is resumable and cache replay has zero paid requests', async t => {
  const f = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => { calls++; const body = JSON.parse(init!.body as string); return response(body.response_format.json_schema.name === 'layout_engine_visual_review' ? { verdict: 'pass', issues: [] } : layoutPlan(f.input)) })
  const job = await startLayoutAction(f.bucket, f.context, f.action, config)
  await assert.rejects(() => startLayoutAction(f.bucket, f.context, f.action, config), /обрабатывается/)
  await job.execute!()
  let view = await layoutView(f.bucket, f.context); assert.equal(view.next!.phase, 'render')
  const report = { ...f.action, action: 'report' as const, fit: fitted(view.next!.planHash!), preview: png }
  await startLayoutAction(f.bucket, f.context, report, config)
  assert.equal(await readLayoutPreview(f.bucket, f.context, f.input.slideId, 0), png)
  const review = await startLayoutAction(f.bucket, f.context, { ...f.action, action: 'review' }, config); await review.execute!()
  view = await layoutView(f.bucket, f.context); assert.equal(view.status, 'ready'); assert.equal(calls, 2)
  assert.equal((await startLayoutAction(f.bucket, f.context, f.action, config)).execute, null); assert.equal(calls, 2)
  assert.ok([...f.data.values()].every(v => !v.value.includes(config.apiKey)))
})
test('all permitted states fail → Qwen receives measurements; two rounds block without old-recipe fallback', async t => {
  const f = await fixture(); let calls = 0, correction = false
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => { calls++; correction ||= (init!.body as string).includes('overflow-fixture'); return response(layoutPlan(f.input)) })
  for (let round = 0; round < 2; round++) {
    const job = await startLayoutAction(f.bucket, f.context, { ...f.action, round }, config); await job.execute!()
    const view = await layoutView(f.bucket, f.context), plan = view.next!.plan!
    const fit: LayoutFit = { version: 'layout-dom-3', planHash: view.next!.planHash!, passed: false, stateId: null, plainComponents: false, trials: candidateStates(plan).map(s => ({ stateId: s.id, level: adaptationLevel(stateById(plan.preferredState)!, s), plainComponents: false, measurements: [], issues: [{ code: 'overflow-fixture', message: 'Measured content does not fit.' }] })) }
    await startLayoutAction(f.bucket, f.context, { ...f.action, action: 'report', round, fit }, config)
  }
  const view = await layoutView(f.bucket, f.context); assert.equal(view.status, 'blocked'); assert.equal(view.next, null); assert.equal(calls, 2); assert.ok(correction)
  assert.equal((await startLayoutAction(f.bucket, f.context, f.action, config)).execute, null)
})
test('stale project revisions and forged measurement hashes never advance generation', async t => {
  const f = await fixture(); t.mock.method(globalThis, 'fetch', async () => response(layoutPlan(f.input)))
  await (await startLayoutAction(f.bucket, f.context, f.action, config)).execute!()
  await assert.rejects(() => startLayoutAction(f.bucket, f.context, { ...f.action, action: 'report', fit: fitted('c'.repeat(64)), preview: png }, config), /Неполная/)
  await updateProject(f.bucket, f.project.id, { baseRevision: f.project.revision, name: f.project.name, text: 'Изменённое содержание' })
  await assert.rejects(() => startLayoutAction(f.bucket, f.context, f.action, config), /Содержание или стиль изменились/)
})
test('two invalid model answers preserve raw evidence and block further paid retries', async t => {
  const f = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response({ wrong: 'contract' }) })
  const job = await startLayoutAction(f.bucket, f.context, f.action, config)
  await assert.rejects(() => job.execute!())
  assert.equal(calls, 2); assert.equal((await layoutView(f.bucket, f.context)).status, 'blocked')
  assert.equal((await startLayoutAction(f.bucket, f.context, { ...f.action, retry: true }, config)).execute, null)
  assert.equal(calls, 2); assert.ok([...f.data.keys()].some(k => k.includes('/clarifications/') && k.endsWith('/response.json')))
})
test('compatible complete legacy replies replay with zero requests; raw inputs and replies stay immutable', async t => {
  const f = await fixture(), legacyPrefix = `legacy/${f.project.id}`, legacyInputId = 'legacy-input', prefix = `${legacyPrefix}/${f.input.slideId}/round-0/plan`
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(layoutPlan(f.input)) })
  await f.bucket.put(prefix.replace(/\/plan$/, '/evidence.json'), JSON.stringify(evidence))
  const old = await beginModelRun({ bucket: f.bucket, prefix, config, version: 'legacy', scope: { inputId: legacyInputId }, task: layoutTask(f.input, evidence), validate: raw => validateLayoutPlan(raw, f.input, evidence) })
  await old.execute!()
  const originals = [...f.data].filter(([key]) => key.startsWith(legacyPrefix)).map(([key, value]) => [key, value.value])
  Object.assign(f.context, { legacyPrefix, legacyInputId })
  const migrated = await layoutView(f.bucket, f.context)
  assert.equal(migrated.next?.phase, 'render'); assert.equal(migrated.next?.replayedFrom?.runId, old.run.id)
  assert.equal(calls, 1); assert.equal((await readLayoutBudget(f.bucket, f.context)).used, 0)
  assert.deepEqual([...f.data].filter(([key]) => key.startsWith(legacyPrefix)).map(([key, value]) => [key, value.value]), originals)
  const changed = { ...f.context, prefix: 'changed-source' }, input = structuredClone(f.input); input.content[0].text += ' additional content'
  assert.equal(await replayLayoutPlan(f.bucket, changed, input), null)
  assert.equal(calls, 1)
})
test('the budget is reserved before clarification and exhaustion never reaches the provider', async t => {
  const f = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response({ invalid: true }) })
  await limitLayoutRequests(f.bucket, f.context, 1)
  await assert.rejects((await startLayoutAction(f.bucket, f.context, f.action, config)).execute!(), /предел/)
  assert.equal(calls, 1); assert.equal((await readLayoutBudget(f.bucket, f.context)).used, 1)
  await assert.rejects((await startLayoutAction(f.bucket, f.context, { ...f.action, retry: true }, config)).execute!(), /предел/)
  assert.equal(calls, 1)
})
test('old PNGs and visual passes cannot approve a new renderer; model plans and spent budget survive', async t => {
  const f = await fixture(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(layoutPlan(f.input)) })
  await (await startLayoutAction(f.bucket, f.context, f.action, config)).execute!()
  const before = await layoutView(f.bucket, f.context), prefix = `${f.context.prefix}/${f.input.slideId}/round-0`
  const old = JSON.stringify({ fit: { ...fitted(before.next!.planHash!), version: 'layout-dom-2', previewCheck: undefined }, preview: png })
  await f.bucket.put(`${prefix}/render.json`, old)
  await f.bucket.put(`${prefix}/review/current.json`, JSON.stringify({ runId: 'old-review' }))
  await f.bucket.put(`${prefix}/review/runs/old-review.json`, JSON.stringify({ status: 'complete', result: { verdict: 'pass', issues: [] } }))
  const current = await layoutView(f.bucket, f.context)
  assert.equal(current.next?.phase, 'render'); assert.equal(current.slides[0].previewRound, undefined)
  assert.equal(await readLayoutPreview(f.bucket, f.context, f.input.slideId, 0), null)
  assert.equal(await (await f.bucket.get(`${prefix}/render.json`))!.text(), old)
  assert.equal((await readLayoutBudget(f.bucket, f.context)).used, 1); assert.equal(calls, 1)
})
