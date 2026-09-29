import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptiveGridFixture, adaptivePaletteFixture } from './fixtures/adaptive-layout'
import { adaptivePaletteContract, adaptivePaletteTask, adaptivePaletteCorrectionTask, compatiblePanelColorsJsonSchema, applyAdaptivePalette } from '../lib/presentations/adaptive-palette'
import { adaptiveContract, adaptivePlanJsonSchema } from '../lib/presentations/adaptive-task'
import { ADAPTIVE_PALETTE_VERSION, adaptivePanelColors, adaptiveRenderVersion, validateAdaptivePlan } from '../lib/presentations/adaptive-layout'
import { contrastRatio } from '../lib/presentations/layout-html'

const evidence = { fontTokens: ['font-1'] }
test('panel colors are independent palette pairs, gated by version, framing and contrast', () => {
  const { input, plan } = adaptivePaletteFixture()
  assert.deepEqual(validateAdaptivePlan(plan, input, evidence), plan)
  assert.equal(adaptiveRenderVersion(plan.version), 'adaptive-render-8')
  assert.deepEqual(adaptivePanelColors(plan.blocks[1], plan), { background: 'accent', foreground: 'white' })
  assert.deepEqual(adaptivePanelColors(plan.blocks[0], plan), { background: null, foreground: plan.colors.primary })
  for (const mutate of [
    (p: typeof plan) => { p.version = 'adaptive-blocks-3' },
    (p: typeof plan) => { p.version = 'adaptive-blocks-2' },
    (p: typeof plan) => { delete p.version },
    (p: typeof plan) => { p.blocks[0].panelColors = { background: 'accent', foreground: 'white' } },
    (p: typeof plan) => { p.blocks[1].panelColors!.foreground = 'accent' },
    (p: typeof plan) => { p.blocks[1].panelColors!.background = '#004EA8' },
    (p: typeof plan) => { p.blocks[1].panelColors!.foreground = 'missing' },
    (p: typeof plan) => { p.blocks[1].emphasis = 'plain' },
  ]) { const bad = structuredClone(plan); mutate(bad); assert.throws(() => validateAdaptivePlan(bad, input, evidence)) }
  plan.blocks[1].panelColors = null
  assert.deepEqual(adaptivePanelColors(plan.blocks[1], plan), { background: plan.colors.surface, foreground: plan.colors.onSurface })
})

test('appearance task cannot alter geometry, source, semantic bindings or native artwork', () => {
  const { input, plan } = adaptiveGridFixture(), original = structuredClone({ input, plan })
  const choice = { panels: [{ block: 1, colors: { background: 'accent', foreground: 'white' } }], rationale: 'Synthetic palette choice' }
  const result = applyAdaptivePalette(choice, plan, input, evidence)
  assert.deepEqual(applyAdaptivePalette(choice, plan, input, evidence, true), result)
  assert.throws(() => applyAdaptivePalette({ ...choice, panels: [{ block: 1, colors: null }] }, plan, input, evidence, true))
  assert.throws(() => applyAdaptivePalette({ ...choice, panels: [{ block: 1, colors: { background: 'surface', foreground: plan.colors.onSurface } }] }, plan, input, evidence, true))
  assert.equal(result.plan.version, ADAPTIVE_PALETTE_VERSION)
  const withoutPaint = structuredClone(result.plan)
  withoutPaint.version = plan.version
  for (const block of withoutPaint.blocks) delete block.panelColors
  assert.deepEqual(withoutPaint, original.plan)
  assert.deepEqual({ input, plan }, original)
  for (const bad of [
    { ...choice, panels: [] },
    { ...choice, panels: [...choice.panels, ...choice.panels] },
    { ...choice, panels: [{ ...choice.panels[0], block: 0 }] },
    { ...choice, panels: [{ ...choice.panels[0], block: 7 }] },
    { ...choice, title: ['replacement'] },
    { ...choice, panels: [{ ...choice.panels[0], padding: 0 }] },
    { ...choice, panels: [{ ...choice.panels[0], colors: { background: 'white', foreground: 'white' } }] },
  ]) assert.throws(() => applyAdaptivePalette(bad, plan, input, evidence))
})

test('ordinary planning gets the same bounded palette contract without extra model stages', () => {
  const { input, plan } = adaptiveGridFixture(), contract = adaptivePaletteContract(input)
  for (const p of contract.contrastPairs) for (const id of p.foregrounds) assert(contrastRatio(input.colors.find(c => c.id === id)!.hex, input.colors.find(c => c.id === p.background)!.hex) >= 4.5)
  const latest = adaptivePlanJsonSchema(ADAPTIVE_PALETTE_VERSION), previous = adaptivePlanJsonSchema('adaptive-blocks-3')
  assert(latest.properties.blocks.items.required.includes('panelColors'))
  assert(!previous.properties.blocks.items.required.includes('panelColors'))
  assert.deepEqual(adaptiveContract(input, evidence, ADAPTIVE_PALETTE_VERSION).appearance, contract)
  assert.equal(adaptiveContract(input, evidence, 'adaptive-blocks-3').appearance, undefined)
  const task = adaptivePaletteTask(input, plan, 'data:image/png;base64,TEST')
  assert.equal(task.schemaName, 'adaptive_panel_palette')
  assert.match(JSON.stringify(task.messages), /allowedPanels/)
  const pairs = compatiblePanelColorsJsonSchema(input)
  assert(pairs.anyOf)
  for (const p of pairs.anyOf) for (const foreground of p.properties.foreground.enum) {
    assert(contrastRatio(input.colors.find(c => c.id === foreground)!.hex, input.colors.find(c => c.id === p.properties.background.const)!.hex) >= 4.5)
  }
  const schema = adaptivePlanJsonSchema(ADAPTIVE_PALETTE_VERSION, input)
  assert.deepEqual(schema.properties.blocks.items.properties.panelColors!.anyOf[0], pairs)
  const correction = adaptivePaletteCorrectionTask(task, input, 'unchanged raw reply', ['insufficient-panel-contrast'])
  assert.match(JSON.stringify(correction.messages.at(-1)), /insufficient-panel-contrast/)
  assert.match(JSON.stringify(correction.schema), /foreground.*enum/)
  assert.deepEqual(compatiblePanelColorsJsonSchema({ ...input, colors: [{ id: 'only-white', hex: '#FFFFFF' }] }), { type: 'null' })
})
