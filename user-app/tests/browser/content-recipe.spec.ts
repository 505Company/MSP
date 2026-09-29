import { test, expect } from './workspace-fixture'
import type { Page } from '@playwright/test'
import { contentRecipeFixture } from '../fixtures/content-recipe'

async function render(page: Page, f: ReturnType<typeof contentRecipeFixture>) {
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.exposeFunction('__mspCaptureLayout', async (id: string) => 'data:image/png;base64,' + (await page.locator(`[data-layout-capture="${id}"]`).screenshot()).toString('base64'))
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/processing-worker')
  return page.evaluate(async f => {
    const fonts = '/browser/layout-fonts.ts', renderer = '/browser/content-recipe.ts'
    await (await import(fonts) as typeof import('../../browser/layout-fonts')).prepareLayoutFonts(f.env.input)
    return (await import(renderer) as typeof import('../../browser/content-recipe')).renderContentRecipe(f.env, f.recipe, f.brand)
  }, f)
}
for (const kind of ['metrics-list', 'audience-feature', 'principles-evidence'] as const) {
  test(`recipe ${kind} renders source artwork, exact text and readable insets`, async ({ page }) => {
    const f = contentRecipeFixture(kind), before = JSON.stringify(f), result = await render(page, f)
    expect(result.trials.at(-1)!.issues).toEqual([])
    expect(result.passed).toBe(true)
    expect(result.modelCalls).toBe(0)
    expect(JSON.stringify(f)).toBe(before)
    const texts = result.render.measurements.filter(m => m.kind === 'text-measurement')
    expect(texts.map(m => m.text).sort()).toEqual(f.env.input.content.map(c => c.text).sort())
    expect(result.render.textPixels.every(m => m.pixels > 3)).toBe(true)
    expect(result.render.html).toContain('#EAF5F0')
    expect(result.render.html).toContain('#00784D')
    expect(result.render.html.includes('data-library-adaptation="compound-metrics-1"')).toBe(kind === 'audience-feature')
    for (const [id, padding] of Object.entries(result.compiled.insets)) {
      const card = result.render.measurements.find(m => m.id === id && m.kind !== 'text-measurement')!.box
      for (const t of texts) if (t.id.startsWith(`${id}:`) || t.id.startsWith(`${id}-`)) {
        expect(t.ink!.every(b => b.x >= card.x + padding - 1 && b.y >= card.y + padding - 1 && b.x + b.width <= card.x + card.width - padding + 1 && b.y + b.height <= card.y + card.height - padding + 1)).toBe(true)
      }
    }
    expect(await page.locator('[data-free-flex-root]').count()).toBe(0)
  })
}
test('long headline uses the authored smaller state without losing any words', async ({ page }) => {
  const f = contentRecipeFixture('headline')
  f.env.input.content[0].text = 'Осмысленный заголовок помогает читателю увидеть главное и принять решение без лишних усилий.'
  const result = await render(page, f)
  expect(result.passed, JSON.stringify(result.trials)).toBe(true)
  expect(result.trials[0].issues.length).toBeGreaterThan(0)
  expect(result.render.measurements.find(m => m.id === 'title' && m.kind === 'text-measurement')!.fontSize).toBe(140)
  expect(result.render.measurements.find(m => m.id === 'title' && m.kind === 'text-measurement')!.text).toBe(f.env.input.content[0].text)
})
test('unfittable content yields a bounded failure, full source and no tiny type', async ({ page }) => {
  const f = contentRecipeFixture('principles-evidence')
  f.env.input.content.find(c => c.id === 'b1')!.text = 'Полное объяснение нельзя спрятать или обрезать. '.repeat(150)
  const result = await render(page, f)
  expect(result.passed).toBe(false)
  expect(result.trials.length).toBeLessThanOrEqual(24)
  expect(result.trials.at(-1)!.issues.some(i => /overflow|overlap|inset|canvas/u.test(i))).toBe(true)
  const body = result.render.measurements.find(m => m.id === 'principle-0-body' && m.kind === 'text-measurement')!
  expect(body.text).toBe(f.env.input.content.find(c => c.id === 'b1')!.text)
  expect(body.fontSize).toBeGreaterThanOrEqual(32)
  expect(result.compiled.plan.nodes.filter(n => n.component).length).toBe(2)
  expect(await page.locator('[data-free-flex-root]').count()).toBe(0)
})
