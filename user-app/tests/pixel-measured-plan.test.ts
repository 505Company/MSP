import test from 'node:test'
import assert from 'node:assert/strict'
import { pixelFixture } from './fixtures/pixel-layout'
import { pixelWireSlots, pixelWireTask } from '../lib/presentations/pixel-wire'
import { measuredPixelTask, decodeMeasuredPixel, type ComponentEvidence } from '../lib/presentations/pixel-measured-plan'

function fixture() {
  const f = pixelFixture(true), slots = pixelWireSlots(f.brief)
  const evidence: ComponentEvidence = { version: 'pixel-component-measurements-1', fontToken: f.brief.fontToken, note: 'Synthetic fixture', groups: [{ regionId: 'metric', componentId: 'native-metric', candidates: [{
    width: f.plan.regions[2].box.width, height: f.plan.regions[2].box.height, step: 0, direction: 'stack', fields: f.plan.texts.filter(t => t.regionId === 'metric').map(t => ({
      path: t.field!, fragments: t.fragments, fontSize: t.fontSize, lineHeight: t.lineHeight, weight: t.weight, height: t.box.height, color: t.color, opacity: t.opacity, box: t.box,
    })),
  }] }] }
  const blocks = Object.fromEntries(f.plan.regions.map(r => [r.id, { frame: r.box, mode: r.mode, step: r.fontStep, direction: r.flowDirection,
    texts: Object.fromEntries(slots.texts.filter(t => t.regionId === r.id).map(s => {
      const t = f.plan.texts.find(t => JSON.stringify(t.fragments) === JSON.stringify(s.fragments))!
      return [s.id, { box: [t.box.x, t.box.y, t.box.width, t.box.height], size: t.fontSize, leading: t.lineHeight, weight: t.weight, color: t.color, opacity: t.opacity, align: t.align, wrap: t.wrap }]
    })),
  }]))
  return { ...f, evidence, raw: { blocks } }
}

test('measured block plan preserves every emitted frame and binding, and rejects mixed component variants', () => {
  const { env, brief, hash, plan, evidence, raw } = fixture(), before = JSON.stringify({ raw, evidence })
  const decoded = decodeMeasuredPixel(raw, env, brief, hash, evidence)
  assert.deepEqual(decoded.regions, plan.regions)
  assert.deepEqual(decoded.texts.map(t => ({ ...t, id: '' })), plan.texts.map(t => ({ ...t, id: '' })))
  assert.equal(JSON.stringify({ raw, evidence }), before)
  const wrong = structuredClone(raw); wrong.blocks.metric.texts['wire-t4'].box[3] -= 2
  assert.throws(() => decodeMeasuredPixel(wrong, env, brief, hash, evidence), /не прошёл/)
  const outside = structuredClone(raw); outside.blocks.metric.frame.x = 1800
  assert.throws(() => decodeMeasuredPixel(outside, env, brief, hash, evidence))
})

test('measured schema ties dependent component dimensions while leaving global placement and plain frames to Qwen', () => {
  const { env, brief, hash, evidence } = fixture()
  const base = pixelWireTask(env, brief, hash, { version: 'pixel-text-evidence-1', fontToken: brief.fontToken, widths: [], rows: [] })
  const task = measuredPixelTask(base, env, brief, evidence)
  const schema = task.schema as { properties: { blocks: { properties: Record<string, { anyOf?: { properties: { frame: { properties: Record<string, { const?: number }> } } }[]; properties?: unknown }> } } }
  const variants = schema.properties.blocks.properties.metric.anyOf!
  assert.equal(variants.length, 1)
  assert.equal(variants[0].properties.frame.properties.width.const, evidence.groups[0].candidates[0].width)
  assert.equal(variants[0].properties.frame.properties.x.const, undefined)
  assert.equal(schema.properties.blocks.properties.argument.anyOf, undefined)
  assert.equal(task.thinking, false)
})
