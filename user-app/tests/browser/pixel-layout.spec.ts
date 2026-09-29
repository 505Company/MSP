import { test, expect } from './workspace-fixture'
import type { Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { pixelFixture } from '../fixtures/pixel-layout'
import { validatePixelPlan } from '../../lib/presentations/pixel-contract'

async function render(page: Page, fixture: ReturnType<typeof pixelFixture>) {
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.exposeFunction('__mspCaptureLayout', async (id: string) => 'data:image/png;base64,' + (await page.locator(`[data-layout-capture="${id}"]`).screenshot()).toString('base64'))
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/processing-worker')
  validatePixelPlan(fixture.plan, fixture.brief, fixture.hash, fixture.env)
  return page.evaluate(async ({ env, brief, plan, hash }) => {
    const fontPath = '/browser/layout-fonts.ts', renderPath = '/browser/pixel-layout.ts'
    const { prepareLayoutFonts } = await import(fontPath) as typeof import('../../browser/layout-fonts')
    const { renderPixelLayout } = await import(renderPath) as typeof import('../../browser/pixel-layout')
    await prepareLayoutFonts(env.input)
    return renderPixelLayout(env, brief, plan, hash)
  }, fixture)
}

for (const flow of [false, true]) test(`pixel executor preserves exact ${flow ? 'flow' : 'native'} frames and renders all glyphs`, async ({ page }, info) => {
  const fixture = pixelFixture(flow), result = await render(page, fixture)
  await writeFile(info.outputPath('slide.png'), Buffer.from(result.preview.split(',')[1], 'base64'))
  expect(result.issues).toEqual([])
  expect(result.passed).toBe(true)
  expect(result.geometryUnchanged).toBe(true)
  expect(result.textPixels.every(p => p.pixels > 3)).toBe(true)
  expect(result.measurements.map(t => t.text)).toEqual(fixture.plan.texts.map(t => t.fragments.map(id => fixture.env.input.content.find(f => f.id === id)!.text).join('\n')))
  expect(await page.locator('[data-pixel-root]').count()).toBe(0)
})

test('overflow is reported without shrinking, changing layout or truncating text', async ({ page }) => {
  const fixture = pixelFixture()
  fixture.env.input.content.find(f => f.id === 'label1')!.text = 'Полное содержание сохраняется. '.repeat(30)
  const result = await render(page, fixture)
  expect(result.passed).toBe(false)
  expect(result.geometryUnchanged).toBe(true)
  expect(result.issues.some(i => i.startsWith('overflow:caption:'))).toBe(true)
  expect(result.measurements.find(t => t.id === 'caption')!.fontSize).toBe(32)
  expect(result.measurements.find(t => t.id === 'caption')!.text).toBe(fixture.env.input.content.find(f => f.id === 'label1')!.text)
})

test('intrinsic text evidence predicts actual pixel-renderer wrapping without changing a model plan', async ({ page }) => {
  const fixture = pixelFixture(), before = JSON.stringify(fixture)
  // An ordinary text region is free geometry; component geometry stays native.
  fixture.plan.regions[1].box.width = 1120
  fixture.plan.texts.find(t => t.id === 'body')!.box.width = 1120
  const frozen = JSON.stringify(fixture), rendered = await render(page, fixture)
  const evidence = await page.evaluate(async ({ env, brief }) => {
    const path = '/browser/pixel-text-evidence.ts'
    const { measurePixelTextEvidence } = await import(path) as typeof import('../../browser/pixel-text-evidence')
    const before = JSON.stringify({ env, brief }), evidence = await measurePixelTextEvidence(env, brief)
    return { evidence, unchanged: before === JSON.stringify({ env, brief }) }
  }, fixture)
  const row = evidence.evidence.rows.find(r => r.fragments[0] === 'body' && r.fontSize === 32 && r.weight === 400)!
  expect(row.lines[evidence.evidence.widths.indexOf(1120)]).toBe(rendered.measurements.find(t => t.id === 'body')!.lines)
  expect(evidence.unchanged).toBe(true)
  expect(evidence.evidence.rows.some(r => r.fragments.includes('direction'))).toBe(false)
  expect(JSON.stringify(fixture)).toBe(frozen)
  expect(before).not.toBe(frozen)
})

test('component evidence measures complete text and matches unchanged flow geometry in the renderer', async ({ page }) => {
  const fixture = pixelFixture(true)
  fixture.env.input.content.find(f => f.id === 'label1')!.text = 'Длинная подпись полностью сохраняется в измеренной карточке.'
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const before = JSON.stringify(fixture)
  const evidence = await page.evaluate(async ({ env, brief }) => {
    const fontsPath = '/browser/layout-fonts.ts', evidencePath = '/browser/pixel-component-evidence.ts'
    await (await import(fontsPath) as typeof import('../../browser/layout-fonts')).prepareLayoutFonts(env.input)
    return (await import(evidencePath) as typeof import('../../browser/pixel-component-evidence')).measurePixelComponentEvidence(env, brief)
  }, fixture)
  expect(JSON.stringify(fixture)).toBe(before)
  const selected = evidence.groups[0].candidates.find(c => c.width === 400 && c.step === 4 && c.direction === 'stack')!
  expect(selected).toBeTruthy()
  Object.assign(fixture.plan.regions[2], { fontStep: selected.step, flowDirection: selected.direction })
  Object.assign(fixture.plan.regions[2].box, { width: selected.width, height: selected.height })
  for (const f of selected.fields) {
    const text = fixture.plan.texts.find(t => t.regionId === 'metric' && t.field === f.path)!
    Object.assign(text, { box: f.box, fontSize: f.fontSize, lineHeight: f.lineHeight, weight: f.weight, color: f.color, opacity: f.opacity })
  }
  const report = await render(page, fixture)
  expect(report.issues).toEqual([])
  expect(report.geometryUnchanged).toBe(true)
  for (const f of selected.fields) {
    const text = fixture.plan.texts.find(t => t.regionId === 'metric' && t.field === f.path)!
    const measured = report.measurements.find(m => m.id === text.id)!
    expect(measured.contentHeight + 2).toBe(f.height)
    expect(measured.text).toBe(f.fragments.map(id => fixture.env.input.content.find(c => c.id === id)!.text).join('\n'))
  }
})
