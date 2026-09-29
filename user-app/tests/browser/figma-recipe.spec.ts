import { test, expect } from './workspace-fixture'
import type { Page } from '@playwright/test'
import { figmaRecipeFixture } from '../fixtures/figma-recipe'

async function render(page: Page, f: ReturnType<typeof figmaRecipeFixture>) {
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.exposeFunction('__mspCaptureLayout', async (id: string) => 'data:image/png;base64,' + (await page.locator(`[data-layout-capture="${id}"]`).screenshot()).toString('base64'))
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('/processing-worker')
  return page.evaluate(async f => {
    const fonts = '/browser/layout-fonts.ts', renderer = '/browser/figma-recipe.ts'
    await (await import(fonts) as typeof import('../../browser/layout-fonts')).prepareLayoutFonts(f.env.input)
    return (await import(renderer) as typeof import('../../browser/figma-recipe')).renderFigmaRecipe(f.env, f.recipe, f.brand)
  }, f)
}
test('four source steps remain four aligned library panels with all text and visible ink', async ({ page }) => {
  const f = figmaRecipeFixture('four-steps'), result = await render(page, f)
  expect(result.passed, JSON.stringify(result.trials)).toBe(true)
  expect(result.compiled.surfaces).toHaveLength(4)
  const panels = result.compiled.surfaces.map(s => result.render.measurements.find(m => m.id === s.nodeId)!.box)
  expect(new Set(panels.map(b => Math.round(b.y))).size).toBe(1)
  expect(new Set(panels.map(b => Math.round(b.width))).size).toBe(1)
  expect(result.render.measurements.filter(m => m.kind === 'text-measurement').map(m => m.text).sort()).toEqual(f.env.input.content.map(c => c.text).sort())
  expect(result.render.textPixels.every(p => p.pixels > 3)).toBe(true)
})
test('mixed source grid has two shared column axes and two rows', async ({ page }) => {
  const result = await render(page, figmaRecipeFixture('feature-metrics'))
  expect(result.passed, JSON.stringify(result.trials)).toBe(true)
  const boxes = result.compiled.surfaces.slice(1).map(s => result.render.measurements.find(m => m.id === s.nodeId)!.box)
  expect(new Set(boxes.map(b => Math.round(b.x))).size).toBe(2)
  expect(new Set(boxes.map(b => Math.round(b.y))).size).toBe(2)
})
test('comparison intrinsic lists retain nonzero text height inside full-height panels', async ({ page }) => {
  const f = figmaRecipeFixture('comparison'), result = await render(page, f)
  expect(result.passed, JSON.stringify(result.trials)).toBe(true)
  expect(result.render.textPixels.every(p => p.pixels > 3)).toBe(true)
  expect(result.render.measurements.filter(m => m.kind === 'text-measurement').map(m => m.text).sort()).toEqual(f.env.input.content.map(c => c.text).sort())
})
test('source text columns keep markers at the top and body at the bottom', async ({ page }) => {
  const result = await render(page, figmaRecipeFixture('text-columns'))
  expect(result.passed, JSON.stringify(result.trials)).toBe(true)
  for (const i of [1, 2, 3]) {
    const marker = result.render.measurements.find(m => m.id === `column${i}.marker` && m.kind === 'text-measurement')!
    const body = result.render.measurements.find(m => m.id === `column${i}.body` && m.kind === 'text-measurement')!
    expect(marker.box.y).toBeLessThan(240)
    expect(body.box.y).toBeGreaterThan(700)
  }
})
test('explanation rows keep the source distribution instead of collapsing at the top', async ({ page }) => {
  const result = await render(page, figmaRecipeFixture('fact-explanations'))
  expect(result.passed, JSON.stringify(result.trials)).toBe(true)
  const ys = [1, 2, 3].map(i => result.render.measurements.find(m => m.id === `item${i}.heading` && m.kind === 'text-measurement')!.box.y)
  expect(ys[1] - ys[0]).toBeGreaterThan(220)
  expect(Math.abs((ys[2] - ys[1]) - (ys[1] - ys[0]))).toBeLessThan(2)
})
test('unfittable source fails honestly without deleting text or descending below its role floor', async ({ page }) => {
  const f = figmaRecipeFixture('intro')
  f.env.input.content.find(c => c.id === 'comment')!.text = 'Нельзя удалять слова ради красивого результата. '.repeat(200)
  const result = await render(page, f)
  expect(result.passed).toBe(false)
  expect(result.trials.length).toBeLessThanOrEqual(15)
  const text = result.render.measurements.find(m => m.id === 'comment' && m.kind === 'text-measurement')!
  expect(text.text).toBe(f.env.input.content.find(c => c.id === 'comment')!.text)
  expect(text.fontSize).toBeGreaterThanOrEqual(24)
})
