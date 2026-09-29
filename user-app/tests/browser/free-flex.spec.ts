import { test, expect } from './workspace-fixture'
import { freeFlexFixture } from '../fixtures/free-flex'
import type { Page } from '@playwright/test'
async function render(page: Page, f = freeFlexFixture()) {
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.exposeFunction('__mspCaptureLayout', async (id: string) => 'data:image/png;base64,' + (await page.locator(`[data-layout-capture="${id}"]`).screenshot()).toString('base64'))
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('/processing-worker')
  return page.evaluate(async f => {
    const fontPath = '/browser/layout-fonts.ts', path = '/browser/free-flex.ts'
    await (await import(fontPath) as typeof import('../../browser/layout-fonts')).prepareLayoutFonts(f.env.input)
    return (await import(path) as typeof import('../../browser/free-flex')).renderFreeFlex(f.env, f.plan, f.hash)
  }, f)
}
for (const component of ['plain', 'free-flow', 'native'] as const) test(`free flex renders ${component}, preserves source and model typography`, async ({ page }) => {
  const f = freeFlexFixture(component !== 'plain', component === 'native'), result = await render(page, f)
  expect(result.issues, JSON.stringify(result.measurements.filter(m => m.id.includes('metric')))).toEqual([]); expect(result.passed).toBe(true); expect(result.planUnchanged).toBe(true)
  expect(result.textPixels.every(p => p.pixels > 3)).toBe(true)
  const texts = result.measurements.filter(m => m.kind === 'text-measurement')
  expect(texts.find(m => m.id === 'title')!.fontSize).toBe(64)
  expect(texts.find(m => m.id === 'body')!.fontSize).toBe(32)
  expect(texts.flatMap(t => t.refs!).length).toBe(f.env.input.content.length)
  if (component === 'free-flow') {
    const number = texts.find(m => m.id === 'metric:value')!
    expect(number.scroll!.height).toBeGreaterThan(number.scroll!.clientHeight)
    expect(number.ink!.every(b => b.y >= number.box.y && b.y + b.height <= number.box.y + number.box.height)).toBe(true)
  }
  expect(await page.locator('[data-free-flex-root]').count()).toBe(0)
})
test('overflow fails without shrinking or truncating the content', async ({ page }) => {
  const f = freeFlexFixture(); f.env.input.content.find(c => c.id === 'body')!.text = 'Полное содержание сохраняется. '.repeat(180)
  const result = await render(page, f)
  expect(result.passed).toBe(false); expect(result.issues.some(i => /overflow|canvas/u.test(i))).toBe(true)
  expect(result.measurements.find(m => m.id === 'body' && m.kind === 'text-measurement')!.text).toBe(f.env.input.content.find(c => c.id === 'body')!.text)
  expect(result.planUnchanged).toBe(true)
})
test('same-colour text cannot pass the pixel evidence because its own panel is visible', async ({ page }) => {
  const f = freeFlexFixture(); f.plan.nodes.find(n => n.id === 'body')!.css = 'color:#000000;background-color:#000000;'
  const result = await render(page, f)
  expect(result.issues).toContain('invisible-text:body')
})
test('five flex columns fit and a growing block reduces its neighbours inside the same slide', async ({ page }) => {
  const f = freeFlexFixture(), root = f.plan.nodes[0]
  root.css = 'flex-direction:row;align-items:center;gap:24px;padding:64px;background-color:#ffffff;font-family:font-1;font-size:32px;line-height:1.2;color:#000000;'
  f.plan.nodes = [root, ...f.env.input.content.map((c, i) => ({ id: `column-${i}`, parent: 'root', kind: 'text' as const, css: 'flex:1 1 0;', refs: [{ fragmentId: c.id, start: 0, end: null }], component: null }))]
  const original = await render(page, f)
  expect(original.issues).toEqual([])
  const old = original.measurements.filter(m => m.kind === 'text')
  expect(new Set(old.map(m => m.box.x)).size).toBe(5)
  f.plan.nodes[1].css = 'flex:2 1 0;'
  const changed = await page.evaluate(async f => {
    const path = '/browser/free-flex.ts'
    return (await import(path) as typeof import('../../browser/free-flex')).renderFreeFlex(f.env, f.plan, f.hash)
  }, f)
  expect(changed.issues).toEqual([])
  const next = changed.measurements.filter(m => m.kind === 'text')
  expect(next[0].box.width).toBeGreaterThan(old[0].box.width)
  expect(next.slice(1).every((m, i) => m.box.width < old[i + 1].box.width)).toBe(true)
  expect(next.reduce((s, m) => s + m.box.width, 0)).toBeCloseTo(old.reduce((s, m) => s + m.box.width, 0), 0)
})
