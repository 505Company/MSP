import { test, expect } from './workspace-fixture'
import { writeFile } from 'node:fs/promises'
import { adaptiveFixture, adaptiveComponentFixture } from '../fixtures/adaptive-layout'
import { adaptiveIssues, validateAdaptiveFit, type AdaptivePlan } from '../../lib/presentations/adaptive-layout'

test('visible native edges use the outer grid, not padded invisible wrappers', async ({ page }, info) => {
  const fixture = adaptiveComponentFixture()
  fixture.plan.blocks[1].parts.unshift(fixture.plan.blocks[0].parts.shift()!)
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const result = await page.evaluate(async ({ input, plan }) => {
    const fontPath = '/browser/layout-fonts.ts', renderPath = '/browser/adaptive-layout.ts'
    const { prepareLayoutFonts } = await import(fontPath) as typeof import('../../browser/layout-fonts')
    const { fitAdaptiveLayout } = await import(renderPath) as typeof import('../../browser/adaptive-layout')
    const fonts = await prepareLayoutFonts(input)
    const options = { fontCss: Object.values(fonts.css).join('\n'), renderVersion: 'adaptive-render-7' as const }
    return fitAdaptiveLayout(input, plan, 'a'.repeat(64), options)
  }, fixture)
  await writeFile(info.outputPath('geometry.json'), JSON.stringify(result.fit, null, 2))
  await writeFile(info.outputPath('slide.png'), Buffer.from(result.preview.split(',')[1], 'base64'))
  validateAdaptiveFit(result.fit, fixture.plan, fixture.input, 'a'.repeat(64), result.preview, 'adaptive-render-7')
  // An offline replay cannot silently replace the pinned renderer-6 result.
  expect(() => validateAdaptiveFit(result.fit, fixture.plan, fixture.input, 'a'.repeat(64), result.preview)).toThrow()
  expect(result.fit.passed).toBe(true)
  const trial = result.fit.trials.at(-1)!, box = trial.boxes.find(b => b.id === 'block-0')!, neighbour = trial.boxes.find(b => b.id === 'block-1')!
  expect(trial.columns).toBe(2)
  expect(trial.components![0].x).toBeCloseTo(box.x, 0)
  expect(trial.components![0].y).toBeCloseTo(neighbour.y, 0)
  const right = Math.max(...trial.components!.map(c => c.x + c.width))
  expect(neighbour.x - right).toBeCloseTo(32, 0)
  const bad = structuredClone(result.fit)
  bad.trials.at(-1)!.components![0].width -= 10
  expect(adaptiveIssues(bad.trials.at(-1)!, fixture.plan, fixture.input, 'adaptive-render-7')).toContain('component-visible-width:block-0-part-0')
  expect(() => validateAdaptiveFit(bad, fixture.plan, fixture.input, 'a'.repeat(64), result.preview, 'adaptive-render-7')).toThrow()
})

test('uneven rows retain common column axes', async ({ page }, info) => {
  const fixture = adaptiveFixture()
  fixture.plan.version = 'adaptive-blocks-2'
  fixture.input.content.find(f => f.id === 'b1')!.text += ' Важно сохранить подробные условия обращения клиента.'.repeat(3)
  fixture.input.content.find(f => f.id === 'b4')!.text += ' Команда объясняет результат.'.repeat(2)
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const result = await page.evaluate(async ({ input, plan }) => {
    const fontPath = '/browser/layout-fonts.ts', renderPath = '/browser/adaptive-layout.ts'
    const { prepareLayoutFonts } = await import(fontPath) as typeof import('../../browser/layout-fonts')
    const { fitAdaptiveLayout } = await import(renderPath) as typeof import('../../browser/adaptive-layout')
    const fonts = await prepareLayoutFonts(input)
    return fitAdaptiveLayout(input, plan, 'a'.repeat(64), { ...{ renderVersion: 'adaptive-render-7' as const }, fontCss: Object.values(fonts.css).join('\n') })
  }, fixture)
  await writeFile(info.outputPath('geometry.json'), JSON.stringify(result.fit, null, 2))
  validateAdaptiveFit(result.fit, fixture.plan, fixture.input, 'a'.repeat(64), result.preview, 'adaptive-render-7')
  expect(result.fit.passed).toBe(true)
  const trial = result.fit.trials.at(-1)!, block = (i: number) => trial.boxes.find(b => b.id === `block-${i}`)!
  expect(trial.columns).toBe(2)
  expect(block(1).x).toBeCloseTo(block(3).x, 0)
  expect(block(0).width).toBeCloseTo(block(2).width, 0)
  const bad = structuredClone(trial)
  bad.boxes.find(b => b.id === 'block-3')!.x += 10
  expect(adaptiveIssues(bad, fixture.plan, fixture.input, 'adaptive-render-7')).toContain('shared-column:block-3')
})

test('native artwork fills its assigned width and caption fitting does not shrink the slide title', async ({ page }, info) => {
  const fixture = adaptiveComponentFixture(), { plan, input } = fixture
  plan.footer = [...plan.blocks[0].parts[0].fragments, ...plan.blocks[1].parts.flatMap(p => p.fragments)]
  plan.blocks = plan.blocks[0].parts.slice(1).map(p => ({ emphasis: 'plain', parts: [p] })) as AdaptivePlan['blocks']
  input.content.find(f => f.id === 'label1')!.text = 'Завершили задачу и сохранили выбор'
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const result = await page.evaluate(async ({ input, plan }) => {
    const fontPath = '/browser/layout-fonts.ts', renderPath = '/browser/adaptive-layout.ts'
    const { prepareLayoutFonts } = await import(fontPath) as typeof import('../../browser/layout-fonts')
    const { fitAdaptiveLayout } = await import(renderPath) as typeof import('../../browser/adaptive-layout')
    const fonts = await prepareLayoutFonts(input)
    return fitAdaptiveLayout(input, plan, 'a'.repeat(64), { ...{ renderVersion: 'adaptive-render-7' as const }, fontCss: Object.values(fonts.css).join('\n') })
  }, fixture)
  await writeFile(info.outputPath('geometry.json'), JSON.stringify(result.fit, null, 2))
  await writeFile(info.outputPath('slide.png'), Buffer.from(result.preview.split(',')[1], 'base64'))
  validateAdaptiveFit(result.fit, plan, input, 'a'.repeat(64), result.preview, 'adaptive-render-7')
  expect(result.fit.passed).toBe(true)
  const trial = result.fit.trials.at(-1)!
  for (const card of trial.components!) {
    const unit = trial.units!.find(u => u.id === card.id)!
    expect(card.width).toBeCloseTo(unit.width, 0)
  }
  expect(trial.texts.find(t => t.id === 'title')!.fontSize).toBe(88)
  expect(trial.components![0].fontStep).toBeGreaterThan(0)
  for (const mutate of [
    (t: typeof trial) => { delete t.components![0].fontStep },
    (t: typeof trial) => { t.components![0].fontStep = 0 },
    (t: typeof trial) => { t.components![0].fields[0].fontSize = 10 },
    (t: typeof trial) => { t.components![0].assetsLoaded = false },
    (t: typeof trial) => { t.components![0].fields[0].text = '999%' },
  ]) {
    const bad = structuredClone(result.fit); mutate(bad.trials.at(-1)!)
    expect(() => validateAdaptiveFit(bad, plan, input, 'a'.repeat(64), result.preview, 'adaptive-render-7')).toThrow()
  }
})

test('an incomplete final row spans shared tracks without inventing a new column axis', async ({ page }) => {
  const fixture = adaptiveFixture()
  fixture.plan.version = 'adaptive-blocks-3'
  fixture.input.content.push({ id: 'fifth', text: 'Поддерживать связь' })
  fixture.plan.blocks.push({ emphasis: 'normal', parts: [{ role: 'heading', fragments: ['fifth'] }] })
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const result = await page.evaluate(async ({ input, plan }) => {
    const fontPath = '/browser/layout-fonts.ts', renderPath = '/browser/adaptive-layout.ts'
    const { prepareLayoutFonts } = await import(fontPath) as typeof import('../../browser/layout-fonts')
    const { fitAdaptiveLayout } = await import(renderPath) as typeof import('../../browser/adaptive-layout')
    const fonts = await prepareLayoutFonts(input)
    return fitAdaptiveLayout(input, plan, 'a'.repeat(64), { fontCss: Object.values(fonts.css).join('\n') })
  }, fixture)
  validateAdaptiveFit(result.fit, fixture.plan, fixture.input, 'a'.repeat(64), result.preview)
  expect(result.fit.passed).toBe(true)
  const trial = result.fit.trials.at(-1)!, block = (i: number) => trial.boxes.find(b => b.id === `block-${i}`)!
  expect(trial.columns).toBe(3)
  expect(block(4).x).toBeCloseTo(block(1).x, 0)
  expect(block(4).width).toBeCloseTo(block(1).width + 32 + block(2).width, 0)
})
