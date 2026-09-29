import test from 'node:test'
import assert from 'node:assert/strict'
import { pixelFixture } from './fixtures/pixel-layout'
import { pixelWireSlots, pixelWireTask } from '../lib/presentations/pixel-wire'
import { namedPixelTask, decodeNamedPixel } from '../lib/presentations/pixel-named-wire'

test('named compact geometry reaches the same strict pixel contract with no altered numbers or source bindings', () => {
  const { env, brief, plan, hash } = pixelFixture(true), slots = pixelWireSlots(brief)
  const array = (b: typeof plan.regions[number]['box']) => [b.x, b.y, b.width, b.height]
  const raw = { regions: Object.fromEntries(plan.regions.map(r => [r.id, { box: array(r.box), mode: r.mode, step: r.fontStep, direction: r.flowDirection }])),
    texts: Object.fromEntries(plan.texts.map((t, i) => [slots.texts[i].id, { box: array(t.box), size: t.fontSize, leading: t.lineHeight,
      weight: t.weight, color: t.color, opacity: t.opacity, align: t.align, wrap: t.wrap }])) }
  const before = JSON.stringify(raw), decoded = decodeNamedPixel(raw, brief, hash, env)
  assert.deepEqual(decoded.regions, plan.regions)
  assert.deepEqual(decoded.texts.map(t => ({ ...t, id: '' })), plan.texts.map(t => ({ ...t, id: '' })))
  assert.equal(JSON.stringify(raw), before)
  const bad = structuredClone(raw); bad.texts[slots.texts[3].id].box[0] += 9
  assert.throws(() => decodeNamedPixel(bad, brief, hash, env))
  const missing = structuredClone(raw); delete missing.texts[slots.texts[0].id]
  assert.throws(() => decodeNamedPixel(missing, brief, hash, env))
})
test('named schema restricts native ink and plain contrast while keeping the full source, measurements and model geometry', () => {
  const { env, brief, hash } = pixelFixture(true)
  const base = pixelWireTask(env, brief, hash, { version: 'pixel-text-evidence-1', fontToken: brief.fontToken, widths: [], rows: [] })
  const before = JSON.stringify(base), task = namedPixelTask(base, env, brief)
  const schema = task.schema as { properties: { regions: { properties: Record<string, { properties: Record<string, { const?: string; type?: string }> }> }; texts: { properties: Record<string, { properties: { color: { enum?: string[]; const?: string } } }> } } }
  assert.equal(schema.properties.regions.properties.title.properties.mode.const, 'plain')
  assert.equal(schema.properties.regions.properties.title.properties.step.type, 'null')
  assert.ok(!schema.properties.texts.properties['wire-t0'].properties.color.enum!.includes('white'))
  assert.equal(schema.properties.texts.properties['wire-t3'].properties.color.const, 'black')
  assert.deepEqual(task.messages[1], base.messages[1]); assert.equal(JSON.stringify(base), before)
  assert.ok(!task.messages.some(m => typeof m.content === 'string' && m.content.includes('"protocol":"pixel-numeric-wire-1"')))
})
