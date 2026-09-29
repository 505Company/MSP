import test from 'node:test'
import assert from 'node:assert/strict'
import { pixelFixture } from './fixtures/pixel-layout'
import { compactDesignerTask } from '../lib/presentations/compact-two-qwen-task'
import { leanPixelDesignerTask, decodeLeanPixelBrief } from '../lib/presentations/lean-pixel-designer'

const raw = () => ({ authorState: 'title-support-a', compositionId: null, fontToken: 'font-1', background: 'white',
  assignments: { title: -1, heading: 0, body: 0, value1: 1, label1: 1, direction: -2 },
  groups: [{ role: 'argument', placement: 'left', componentId: null, paths: [], appearance: 'Plain text' },
    { role: 'metric', placement: 'right', componentId: 'native-metric', paths: ['value', 'text'], appearance: 'Source metric card' }], typesettingBrief: 'Keep the source text and selected styling.' })

test('lean designer expands a single assignment per source into a complete validated brief without choosing or altering bindings', () => {
  const { env } = pixelFixture(true), reply = raw(), before = JSON.stringify({ env, reply })
  const b = decodeLeanPixelBrief(reply, env)
  assert.deepEqual(b.title, ['title']); assert.deepEqual(b.directions.map(d => d.sourceId), ['direction'])
  assert.deepEqual(b.groups.map(g => g.fragments), [['heading', 'body'], ['value1', 'label1']])
  assert.deepEqual(b.groups[1].component, { id: 'native-metric', fields: [{ path: 'value', fragments: ['value1'] }, { path: 'text', fragments: ['label1'] }] })
  assert.equal(b.fontToken, reply.fontToken); assert.equal(b.authorState, reply.authorState)
  assert.equal(JSON.stringify({ env, reply }), before)
})
test('lean bindings reject dropped/unknown sources, non-spatial hidden text, missing groups and incompatible component fields', () => {
  const { env } = pixelFixture(true)
  const mutations = [
    (r: ReturnType<typeof raw>) => { Reflect.deleteProperty(r.assignments, 'body') },
    (r: ReturnType<typeof raw>) => { Object.assign(r.assignments, { invented: 0 }) },
    (r: ReturnType<typeof raw>) => { r.assignments.body = -2 },
    (r: ReturnType<typeof raw>) => { r.assignments.body = 7 },
    (r: ReturnType<typeof raw>) => { r.groups[1].paths = ['title', 'text'] },
    (r: ReturnType<typeof raw>) => { r.groups[1].paths.pop() },
  ]
  for (const change of mutations) { const r = raw(); change(r); assert.throws(() => decodeLeanPixelBrief(r, env)) }
})
test('lean request restricts hidden assignments in JSON Schema and preserves the full designer data/image', () => {
  const { env } = pixelFixture(true), base = compactDesignerTask(env, 'data:image/png;base64,fixture')
  const before = JSON.stringify(base), task = leanPixelDesignerTask(base, env)
  const schema = task.schema as { properties: { assignments: { required: string[]; properties: Record<string, { enum: number[] }> } } }
  assert.deepEqual(schema.properties.assignments.required, env.input.content.map(c => c.id))
  assert.ok(schema.properties.assignments.properties.direction.enum.includes(-2))
  assert.ok(!schema.properties.assignments.properties.body.enum.includes(-2))
  assert.deepEqual(task.messages[1], base.messages[1]); assert.equal(JSON.stringify(base), before)
  const groups = (task.schema as { properties: { groups: { items: { properties: { paths: { items: { enum: string[] } } } } } } }).properties.groups
  assert.ok(groups.items.properties.paths.items.enum.includes('value'))
  assert.ok(!groups.items.properties.paths.items.enum.includes('value,unit'))
})
