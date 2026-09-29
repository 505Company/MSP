import { test, expect } from './workspace-fixture'
import { writeFile } from 'node:fs/promises'
import { compileTemplateRecipe } from '../../lib/presentations/recipes/template-contract'
import { templateRecipeFixture } from '../fixtures/template-recipe'
import { applyTemplateReflow } from '../../lib/presentations/recipes/template-reflow'
import { sourceText } from '../fixtures/native-layout'

test('template states preserve original fonts, expand only owned text and reject excessive material', async ({ page }, info) => {
  const { snapshot, proposal, material, plan } = templateRecipeFixture()
  const recipe = await compileTemplateRecipe(proposal, snapshot, 'fixture', 'mock-run')
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const result = await page.evaluate(async ({ recipe, material, plan }) => {
    const path = '/browser/template-recipe-execution.ts'
    const { renderTemplateRecipe } = await import(path) as typeof import('../../browser/template-recipe-execution')
    const normal = await renderTemplateRecipe(recipe, material, plan)
    const long = structuredClone(material); long.fragments.find(f => f.id === 'body-1')!.text = 'Полное содержание нельзя скрыть. '.repeat(120)
    const overflow = await renderTemplateRecipe(recipe, long, plan)
    return { normal, overflow }
  }, { recipe, material, plan })
  expect(result.normal.passed, JSON.stringify(result.normal.issues)).toBe(true)
  expect(result.normal.stateId).toBe('expanded')
  expect(result.normal.trials[0].issues.some(i => i.startsWith('overflow:'))).toBe(true)
  expect(result.normal.measurements.every(m => m.pixels > 0)).toBe(true)
  expect(result.normal.measurements.find(m => m.sourceId === 'body-1')!.fontSize).toBe(22)
  expect(result.overflow.passed).toBe(false)
  expect(result.overflow.issues.some(i => i.startsWith('overflow:'))).toBe(true)
  expect(result.overflow.measurements.find(m => m.sourceId === 'body-1')!.fontSize).toBe(22)
  await writeFile(info.outputPath('template-expanded.png'), Buffer.from(result.normal.preview.split(',')[1], 'base64'))
})

test('dense material escalates to a native 2x2 grid without changing text, fonts or a fitting shorter case', async ({ page }, info) => {
  const { snapshot, proposal, material, plan } = templateRecipeFixture()
  for (let item = 1; item <= 4; item++) {
    const x = 50 + (item - 1) * 290, sourceId = `ordinal-${item}`
    snapshot.elements.push(sourceText(sourceId, String(item), x, 160, 80, 60, 42, 'Play'))
    proposal.slots.push({ sourceId, role: 'ordinal', item, optional: false, ownerId: `panel-${item}` })
    material.fragments.push({ id: sourceId, text: String(item) })
    plan.bindings.push({ sourceId, fragments: [sourceId] })
    Object.assign(snapshot.elements.find(e => e.id === `heading-${item}`)!.properties.bounds!, { y: 240, height: 40 })
    Object.assign(snapshot.elements.find(e => e.id === `body-${item}`)!.properties.bounds!, { y: 350 })
  }
  const base = await compileTemplateRecipe(proposal, snapshot, 'fixture', 'mock-extraction')
  const recipe = await applyTemplateReflow(base, { columns: 2, header: 'inline', rationale: 'Synthetic model-authorized grid' }, 'mock-reflow')
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const result = await page.evaluate(async ({ base, recipe, material, plan }) => {
    const path = '/browser/template-recipe-execution.ts'
    const { renderTemplateRecipe } = await import(path) as typeof import('../../browser/template-recipe-execution')
    const before = await renderTemplateRecipe(base, material, plan), after = await renderTemplateRecipe(recipe, material, plan)
    const dense = structuredClone(material)
    for (const f of dense.fragments) if (f.id.startsWith('body-')) f.text = 'Для каждого фрагмента сохраняется связь с исходным материалом. '.repeat(3)
    const row = await renderTemplateRecipe(base, dense, plan), grid = await renderTemplateRecipe(recipe, dense, plan)
    const excessive = structuredClone(dense); excessive.fragments.find(f => f.id === 'body-1')!.text = 'Содержание должно сохраняться целиком. '.repeat(160)
    return { before, after, row, grid, rejected: await renderTemplateRecipe(recipe, excessive, plan), dense }
  }, { base, recipe, material, plan })
  expect(result.before.passed).toBe(true)
  expect(result.after.preview).toBe(result.before.preview)
  expect(result.row.passed).toBe(false)
  expect(result.grid.passed, JSON.stringify(result.grid.issues)).toBe(true)
  expect(result.grid.stateId).toBe('grid-2x2-inline')
  expect(result.grid.measurements.every(m => m.pixels > 0)).toBe(true)
  for (const m of result.grid.measurements) {
    expect(m.fontSize).toBe(m.sourceId.startsWith('ordinal') ? 42 : m.sourceId === 'primary' ? 36 : 22)
    expect(m.text).toBe(result.dense.fragments.find(f => f.id === (m.sourceId === 'primary' ? 'title' : m.sourceId))!.text)
  }
  expect(result.rejected.passed).toBe(false)
  expect(result.rejected.stateId).toBe('grid-2x2-inline')
  expect(result.rejected.issues).toContain('overflow:body-1')
  await writeFile(info.outputPath('template-grid.png'), Buffer.from(result.grid.preview.split(',')[1], 'base64'))
})
