import { test, expect } from './workspace-fixture'
import { writeFile } from 'node:fs/promises'
import { adaptiveGridFixture } from '../fixtures/adaptive-layout'
import { validateAdaptiveFit, validateAdaptivePlan, type AdaptivePlan } from '../../lib/presentations/adaptive-layout'

test('palette changes only panel pixels, preserving shared grid, type fitting and native cards', async ({ page }, info) => {
  const fixture = adaptiveGridFixture(), original = structuredClone(fixture)
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.goto('/processing-worker')
  const result = await page.evaluate(async ({ input, plan }) => {
    const fontPath = '/browser/layout-fonts.ts', renderPath = '/browser/adaptive-layout.ts'
    const { prepareLayoutFonts } = await import(fontPath) as typeof import('../../browser/layout-fonts')
    const { fitAdaptiveLayout } = await import(renderPath) as typeof import('../../browser/adaptive-layout')
    const fonts = await prepareLayoutFonts(input), options = { fontCss: Object.values(fonts.css).join('\n') }
    const before = await fitAdaptiveLayout(input, plan, 'a'.repeat(64), options)
    const unpainted: AdaptivePlan = { ...plan, version: 'adaptive-blocks-4' }
    const compatible = await fitAdaptiveLayout(input, unpainted, 'b'.repeat(64), options)
    const painted: AdaptivePlan = { ...unpainted, blocks: unpainted.blocks.map((b, i) => ({ ...b, panelColors: i === 1 ? { background: 'accent', foreground: 'white' } : null })) }
    const after = await fitAdaptiveLayout(input, painted, 'c'.repeat(64), options)
    const decode = async (url: string) => {
      const image = new Image(); image.src = url; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      return { ctx, width: canvas.width, height: canvas.height }
    }
    const oldPixels = await decode(before.preview), newPixels = await decode(after.preview)
    const scale = newPixels.width / 1920, panel = after.fit.trials.at(-1)!.boxes.find(b => b.id === 'block-1')!
    const sample = [...newPixels.ctx.getImageData(Math.round((panel.x + panel.width - 14) * scale), Math.round((panel.y + panel.height - 14) * scale), 1, 1).data]
    let nativePixelsUnchanged = true
    for (const c of after.fit.trials.at(-1)!.components!) {
      const rect = [Math.ceil(c.x * scale), Math.ceil(c.y * scale), Math.floor(c.width * scale), Math.floor(c.height * scale)] as const
      const a = oldPixels.ctx.getImageData(...rect).data, b = newPixels.ctx.getImageData(...rect).data
      if (!a.every((v, i) => v === b[i])) nativePixelsUnchanged = false
    }
    return { before, compatible, after, painted, sample, nativePixelsUnchanged }
  }, fixture)
  validateAdaptivePlan(result.painted, fixture.input, { fontTokens: ['font-1'] })
  validateAdaptiveFit(result.before.fit, fixture.plan, fixture.input, 'a'.repeat(64), result.before.preview)
  validateAdaptiveFit(result.after.fit, result.painted, fixture.input, 'c'.repeat(64), result.after.preview)
  expect(result.before.fit.passed).toBe(true)
  expect(result.after.fit.passed).toBe(true)
  expect(result.compatible.preview).toBe(result.before.preview)
  expect(result.after.fit.trials).toEqual(result.before.fit.trials)
  expect(result.after.preview).not.toBe(result.before.preview)
  expect(result.sample).toEqual([0, 78, 168, 255])
  expect(result.nativePixelsUnchanged).toBe(true)
  expect(fixture).toEqual(original)
  expect(() => validateAdaptiveFit({ ...result.after.fit, version: 'adaptive-render-7' }, result.painted, fixture.input, 'c'.repeat(64), result.after.preview)).toThrow()
  expect(() => validateAdaptiveFit({ ...result.after.fit, version: 'adaptive-render-7' }, result.painted, fixture.input, 'c'.repeat(64), result.after.preview, 'adaptive-render-7')).toThrow()
  await writeFile(info.outputPath('before.png'), Buffer.from(result.before.preview.split(',')[1], 'base64'))
  await writeFile(info.outputPath('after.png'), Buffer.from(result.after.preview.split(',')[1], 'base64'))
})
