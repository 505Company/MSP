import test from 'node:test'
import assert from 'node:assert/strict'
import { pixelFixture } from './fixtures/pixel-layout'
import { pixelComponentCatalog, validatePixelBrief, validatePixelPlan } from '../lib/presentations/pixel-contract'
import { pixelDesignerTask, pixelDesignerRecoveryTask, pixelTypesetterTask } from '../lib/presentations/pixel-task'

test('pixel contract preserves all source fragments and component bindings', () => {
  const { env, brief, plan, hash } = pixelFixture()
  assert.deepEqual(validatePixelBrief(brief, env, ['test-state']), brief)
  assert.deepEqual(validatePixelPlan(plan, brief, hash, env), plan)
  const source = JSON.stringify({ env, brief, plan })
  pixelComponentCatalog(env)
  pixelDesignerTask(env)
  pixelTypesetterTask(env, brief, hash)
  assert.equal(JSON.stringify({ env, brief, plan }), source)
})

test('first Qwen receives every supported component, no human-selected shortlist', () => {
  const { env } = pixelFixture()
  const other = structuredClone(env.input.components[0]); other.id = 'second-supported-card'; env.input.components.push(other)
  const task = pixelDesignerTask(env), user = task.messages[1].content
  assert.ok(Array.isArray(user))
  assert.equal(user[0].type, 'text')
  const input = JSON.parse('text' in user[0] ? user[0].text : '')
  assert.deepEqual(input.components.map((c: { id: string }) => c.id), ['native-metric', 'second-supported-card'])
})

test('bounded designer recovery preserves the entire catalog and source request', () => {
  const { env } = pixelFixture(), first = pixelDesignerTask(env, 'data:image/png;base64,test')
  const recovered = pixelDesignerRecoveryTask(env, 'data:image/png;base64,test', { runId: 'failed-run', code: 'QWEN_TRUNCATED' })
  assert.deepEqual(recovered.messages.slice(0, -1), first.messages)
  assert.equal(recovered.messages.length, first.messages.length + 1)
  assert.notDeepEqual(recovered.schema, first.schema)
})

test('designer cannot hide ordinary content or omit a required field', () => {
  for (const change of [
    (b: ReturnType<typeof pixelFixture>['brief']) => { b.directions.push({ sourceId: 'body', reason: 'Pretend note' }); b.groups[0].fragments.pop() },
    (b: ReturnType<typeof pixelFixture>['brief']) => { b.groups[1].component!.fields.pop() },
    (b: ReturnType<typeof pixelFixture>['brief']) => { b.groups[1].component = null },
    (b: ReturnType<typeof pixelFixture>['brief']) => { b.groups[1].fragments.pop() },
  ]) {
    const { env, brief } = pixelFixture(); change(brief)
    assert.throws(() => validatePixelBrief(brief, env, ['test-state']))
  }
})

test('renaming numeric cards to support cannot bypass the requested library usage or placement', () => {
  for (const change of [
    (b: ReturnType<typeof pixelFixture>['brief']) => { b.groups[1].role = 'support'; b.groups[1].component = null },
    (b: ReturnType<typeof pixelFixture>['brief']) => { b.groups[1].placement = 'bottom' },
  ]) {
    const { env, brief } = pixelFixture(); change(brief)
    assert.throws(() => validatePixelBrief(brief, env, ['test-state']))
  }
})

test('typesetter cannot change sources, groups, binding, fonts or source artwork', () => {
  for (const change of [
    (p: ReturnType<typeof pixelFixture>['plan']) => { p.texts.pop() },
    (p: ReturnType<typeof pixelFixture>['plan']) => { p.texts[3].fragments = ['label1']; p.texts[4].fragments = ['value1'] },
    (p: ReturnType<typeof pixelFixture>['plan']) => { p.texts[3].regionId = 'argument' },
    (p: ReturnType<typeof pixelFixture>['plan']) => { p.texts[3].fontToken = 'missing-font' },
    (p: ReturnType<typeof pixelFixture>['plan']) => { p.regions[2].background = 'blue' },
    (p: ReturnType<typeof pixelFixture>['plan']) => { p.texts[3].color = 'blue' },
    (p: ReturnType<typeof pixelFixture>['plan']) => { p.briefHash = 'b'.repeat(64) },
  ]) {
    const { env, brief, plan, hash } = pixelFixture(); change(plan)
    assert.throws(() => validatePixelPlan(plan, brief, hash, env))
  }
})

test('native field frames, scale and font sizes are validated, never corrected', () => {
  for (const change of [
    (p: ReturnType<typeof pixelFixture>['plan']) => { p.texts[3].box.x++ ; p.texts[3].box.x++ },
    (p: ReturnType<typeof pixelFixture>['plan']) => { p.regions[2].box.height += 2 },
    (p: ReturnType<typeof pixelFixture>['plan']) => { p.texts[3].fontSize -= 2 },
    (p: ReturnType<typeof pixelFixture>['plan']) => { p.regions[1].box.x = 900 },
    (p: ReturnType<typeof pixelFixture>['plan']) => { p.texts[0].box.height = 500 },
  ]) {
    const { env, brief, plan, hash } = pixelFixture(); change(plan)
    const before = JSON.stringify(plan)
    assert.throws(() => validatePixelPlan(plan, brief, hash, env))
    assert.equal(JSON.stringify(plan), before)
  }
})

test('qualified flow requires complete numerical frames obeying its profile', () => {
  const { env, brief, plan, hash } = pixelFixture(true)
  assert.deepEqual(validatePixelPlan(plan, brief, hash, env), plan)
  plan.texts[4].box.y += 2
  assert.throws(() => validatePixelPlan(plan, brief, hash, env))
  plan.texts[4].box.y -= 2
  delete env.input.componentFlows
  assert.throws(() => validatePixelPlan(plan, brief, hash, env))
})

test('composition reference alone is not evidence of exact source reproduction', () => {
  const { env, brief, plan, hash } = pixelFixture()
  env.compositions.push({ ...structuredClone(env.input.components[0]), id: 'test-composition', kind: 'composition', children: env.input.components })
  brief.compositionId = 'test-composition'; brief.compositionUse = 'exact'
  assert.throws(() => validatePixelPlan(plan, brief, hash, env))
  brief.compositionUse = 'adapted'
  assert.deepEqual(validatePixelPlan(plan, brief, hash, env), plan)
})
