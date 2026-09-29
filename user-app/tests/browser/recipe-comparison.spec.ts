import { test, expect } from './workspace-fixture'
import { writeFile } from 'node:fs/promises'
import { balancedComparisonFixture, comparisonFixture } from '../fixtures/template-comparison'
import { validateTemplateReport } from '../../lib/presentations/recipes/template-measurement'

test('paired metrics preserve all data and fonts, verify graphics, and reject excessive text or misleading bars', async ({ page }, info) => {
  const f = await comparisonFixture(), linear = await comparisonFixture('proportional-bars')
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const result = await page.evaluate(async ({ recipe, material, plan, linear }) => {
    const path = '/browser/template-recipe-execution.ts'
    const { renderTemplateRecipe } = await import(path) as typeof import('../../browser/template-recipe-execution')
    const normal = await renderTemplateRecipe(recipe, material, plan)
    const long = structuredClone(material); long.fragments.find(f => f.id === 'body-1')!.text = 'Полный текст должен сохраниться. '.repeat(25)
    const rejected = await renderTemplateRecipe(recipe, long, plan)
    const zero = structuredClone(material); zero.fragments.find(f => f.id === 'value-1-0')!.text = '0% в 2027'
    return { normal, rejected, long, zero, zeroBar: await renderTemplateRecipe(linear, zero, plan) }
  }, { recipe: f.recipe, material: f.material, plan: f.plan, linear: linear.recipe })
  expect(result.normal.passed, result.normal.issues.join('\n')).toBe(true)
  await validateTemplateReport(result.normal, f.recipe, f.material, f.plan)
  await validateTemplateReport(result.rejected, f.recipe, result.long, f.plan)
  await validateTemplateReport(result.zeroBar, linear.recipe, result.zero, f.plan)
  expect(result.rejected.passed).toBe(false)
  expect(result.zeroBar.passed).toBe(false)
  expect(result.normal.measurements.map(m => m.text).sort()).toEqual(f.material.fragments.map(f => f.text).sort())
  expect(result.normal.measurements.every(m => m.pixels >= 3 && m.fontSize === (m.sourceId === 'primary' ? 36 : 22))).toBe(true)
  const tampered = structuredClone(result.normal); tampered.graphicMeasurements![0].box.width += 10
  await expect(validateTemplateReport(tampered, f.recipe, f.material, f.plan)).rejects.toMatchObject({ issues: expect.arrayContaining(['comparison-graphic-evidence']) })
  for (const [id, report] of Object.entries({ paired: result.normal, excessive: result.rejected, zero: result.zeroBar })) await writeFile(info.outputPath(`${id}.png`), Buffer.from(report.preview.split(',')[1], 'base64'))
})

test('measured balanced rows wrap a source-nowrap heading and preserve translated clipped graphics', async ({ page }, info) => {
  const f = await balancedComparisonFixture()
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const report = await page.evaluate(async ({ recipe, material, plan }) => {
    const path = '/browser/template-recipe-execution.ts'
    const { renderTemplateRecipe } = await import(path) as typeof import('../../browser/template-recipe-execution')
    return renderTemplateRecipe(recipe, material, plan)
  }, { recipe: f.recipe, material: f.material, plan: f.plan })
  expect(report.passed, report.issues.join('\n')).toBe(true)
  await validateTemplateReport(report, f.recipe, f.material, f.plan)
  expect(report.measurements.find(m => m.sourceId === 'heading-2')!.box.height).toBeGreaterThan(22)
  expect(report.graphicMeasurements!.find(m => m.sourceId === 'icon')!.box.y).not.toBe(375)
  await writeFile(info.outputPath('balanced.png'), Buffer.from(report.preview.split(',')[1], 'base64'))
})
