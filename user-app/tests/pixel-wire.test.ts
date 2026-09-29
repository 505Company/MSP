import test from 'node:test'
import assert from 'node:assert/strict'
import { decodePixelWire, pixelWireSlots, pixelWireTask, quickPixelDesignerTask } from '../lib/presentations/pixel-wire'
import { compactDesignerTask } from '../lib/presentations/compact-two-qwen-task'
import { pixelFixture } from './fixtures/pixel-layout'

function fixture() {
  const f = pixelFixture(true), { plan, env } = f
  const raw = { regions: plan.regions.map(r => [r.box.x, r.box.y, r.box.width, r.box.height,
    r.background === null ? -1 : env.input.colors.findIndex(c => c.id === r.background), r.radius,
    ['plain', 'native', 'flow'].indexOf(r.mode), r.fontStep ?? -1, r.flowDirection === null ? -1 : ['stack', 'row'].indexOf(r.flowDirection)]),
  texts: plan.texts.map(t => [t.box.x, t.box.y, t.box.width, t.box.height, env.fontTokens.indexOf(t.fontToken), t.fontSize,
    t.lineHeight, t.weight, env.input.colors.findIndex(c => c.id === t.color), t.opacity, ['left', 'center', 'right'].indexOf(t.align), Number(t.wrap)]) }
  return { ...f, raw }
}
test('numeric wire expands the actual renderer contract without changing any model geometry, styles or bindings', () => {
  const { env, brief, hash, plan, raw } = fixture(), before = JSON.stringify({ raw, brief, env })
  const decoded = decodePixelWire(raw, brief, hash, env)
  assert.deepEqual(decoded.regions, plan.regions)
  assert.deepEqual(decoded.texts.map(({ id: _id, ...t }) => { void _id; return t }), plan.texts.map(({ id: _id, ...t }) => { void _id; return t }))
  assert.equal(JSON.stringify({ raw, brief, env }), before)
  assert.ok(JSON.stringify(raw).length < JSON.stringify(plan).length * .4)
})
test('numeric wire rejects missing data, ambiguous indices and bad geometry rather than autofitting', () => {
  const { env, brief, hash, raw } = fixture()
  for (const mutate of [
    (r: typeof raw) => { r.texts.pop() }, (r: typeof raw) => { r.texts[0].pop() },
    (r: typeof raw) => { r.texts[0][4] = .5 }, (r: typeof raw) => { r.texts[0][8] = 999 },
    (r: typeof raw) => { r.texts[0][11] = 2 }, (r: typeof raw) => { r.regions[1][0] = 1800 },
    (r: typeof raw) => { r.texts[3][0] += 9 },
  ]) { const copy = structuredClone(raw); mutate(copy); assert.throws(() => decodePixelWire(copy, brief, hash, env)) }
})
test('numeric request supplies every predetermined binding, while leaving every geometry/style number for Qwen', () => {
  const { env, brief, hash } = fixture()
  const evidence = { version: 'pixel-text-evidence-1' as const, fontToken: brief.fontToken, widths: [400], rows: [] }
  const task = pixelWireTask(env, brief, hash, evidence), wire = JSON.parse(task.messages.at(-1)!.content as string)
  assert.deepEqual(wire.textOrder, pixelWireSlots(brief).texts)
  assert.deepEqual(wire.regionOrder, ['title', ...brief.groups.map(g => g.id)])
  assert.equal(task.thinking, false); assert.equal(task.reasoningEffort, undefined)
  assert.ok(wire.textOrder.every((t: object) => !('box' in t)))
  assert.equal((task.schema as { additionalProperties: boolean }).additionalProperties, false)
})

test('quick designer schema only allows hiding explicit spatial directions and leaves the original task intact', () => {
  const { env } = fixture(), base = compactDesignerTask(env, 'data:image/png;base64,fixture'), before = JSON.stringify(base)
  const task = quickPixelDesignerTask(base, env)
  const schema = task.schema as { properties: { directions: { maxItems: number; items: { properties: { sourceId: { enum: string[] } } } } } }
  assert.deepEqual(schema.properties.directions.items.properties.sourceId.enum, ['direction'])
  assert.equal(schema.properties.directions.maxItems, 1)
  assert.deepEqual(task.messages[1], base.messages[1]); assert.equal(JSON.stringify(base), before)
  const noDirections = structuredClone(env); noDirections.input.content = noDirections.input.content.filter(c => c.id !== 'direction')
  const noTask = quickPixelDesignerTask(base, noDirections)
  assert.equal((noTask.schema as typeof schema).properties.directions.maxItems, 0)
})
