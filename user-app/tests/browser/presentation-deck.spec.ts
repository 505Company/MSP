import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { deckInput, deckScene } from '../fixtures/deck'
import type { renderDeckSlide, prepareDeckEvidence } from '../../browser/deck-execution'
import type { BoundScene, SceneInput } from '../../lib/presentations/deck-contract'
import type { renderComponent } from '../../browser/component-execution'
import type { ComponentDefinition } from '../../lib/design-system/types'
import { roundedPath } from '../../lib/presentations/deck-compiler'

test('actual renderer measures fonts, line limits, flow and sampled contrast without clipping source text', async ({ page }, info) => {
  await page.goto('/')
  await page.addScriptTag({ url: '/pptx-reader.js' })
  const render = (input: SceneInput, scene: BoundScene) => page.evaluate(async ({ input, scene }) => {
    const reader = (window as typeof window & { MspPptxReader: { renderDeckSlide: typeof renderDeckSlide } }).MspPptxReader
    return reader.renderDeckSlide(scene, input, 'a'.repeat(64), [])
  }, { input, scene })
  const input = deckInput(), scene = deckScene(input)
  const result = await render(input, scene)
  expect(result.report.issues).toEqual([])
  expect(result.report.texts.every(t => t.lines >= 1 && t.height > 0)).toBe(true)
  expect(result.component.scene.elements.filter(e => e.kind === 'text').map(e => e.text)).toEqual(input.content.map(c => c.text))
  await writeFile(info.outputPath('minimal-native.png'), Buffer.from(result.preview.split(',')[1], 'base64'))
  const overflow = structuredClone(input); overflow.content[1].text = 'Условие не сокращается и остаётся полностью. '.repeat(40)
  const failed = await render(overflow, deckScene(overflow))
  expect(failed.report.issues.some(i => i.code === 'text-overflow')).toBe(true)
  expect(failed.component.scene.elements.find(e => e.kind === 'text' && e.id === 'subtitle')).toMatchObject({ text: overflow.content[1].text, fontSize: 32 })
  const lowContrast = structuredClone(scene); lowContrast.colors.find(c => c.role === 'white')!.hex = '#000000'
  expect((await render(input, lowContrast)).report.issues.some(i => i.code === 'text-contrast')).toBe(true)
  const fonts = await page.evaluate(async () => {
    const reader = (window as typeof window & { MspPptxReader: { prepareDeckEvidence: typeof prepareDeckEvidence } }).MspPptxReader
    return reader.prepareDeckEvidence([], ['Play', 'Nonexistent MSP Font'], [])
  })
  expect(fonts.fonts).toEqual(['Play'])
  const base = { id: 'mask', name: 'Mask', bounds: { x: 0, y: 0, width: 200, height: 100 }, visible: true, opacity: 1, rotation: 0, zIndex: 0 }
  const masked: ComponentDefinition = { id: 'masked', name: 'Rounded art', kind: 'atom', source: { slide: 1, rootId: 'mask', elementIds: ['mask', 'art'], ancestorIds: [], assetIds: [] },
    scene: { width: 200, height: 100, elements: [{ ...base, kind: 'group', clipsContent: true, clipPathData: roundedPath(200, 100, [0, 0, 20, 20]), children: [
      { ...base, id: 'art', kind: 'rectangle', fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } } },
    ] }] }, slots: [], fixedTextIds: [], issues: [], semantics: [] }
  const pixels = await page.evaluate(async component => {
    const reader = (window as typeof window & { MspPptxReader: { renderComponent: typeof renderComponent } }).MspPptxReader
    const rendered = await reader.renderComponent(component, {}, [])
    const image = new Image(); image.src = rendered.dataUrl; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
    return { top: ctx.getImageData(1, 1, 1, 1).data[3], bottom: ctx.getImageData(1, canvas.height - 2, 1, 1).data[3] }
  }, masked)
  expect(pixels).toEqual({ top: 255, bottom: 0 })
  const invisibleInput = structuredClone(input), invisibleScene = deckScene(invisibleInput), whiteArt = structuredClone(masked)
  whiteArt.scene.elements = [{ ...base, kind: 'rectangle', fill: { type: 'solid', color: { r: 1, g: 1, b: 1, a: 1 } } }]
  invisibleInput.resources = [whiteArt]
  invisibleInput.brand.resources.push({ id: whiteArt.id, name: whiteArt.name, roles: ['decoration'], width: 200, height: 100, uses: ['art'] })
  invisibleInput.variant.recipe.elements.splice(1, 0, { id: 'visual', kind: 'asset', resourceRole: 'art1', x: 32, y: 350, width: 300, height: 200 })
  invisibleScene.resources.push({ role: 'art1', componentId: whiteArt.id })
  invisibleScene.colors = [{ role: 'purple', hex: '#FFFFFF' }, { role: 'ink', hex: '#FFFFFF' }, { role: 'white', hex: '#000000' }]
  expect((await render(invisibleInput, invisibleScene)).report.issues.some(i => i.code === 'graphic-invisible')).toBe(true)
  whiteArt.scene.elements[0] = { ...base, kind: 'rectangle', fill: { type: 'solid', color: { r: 0, g: .46, b: 1, a: 1 } } }
  expect((await render(invisibleInput, invisibleScene)).report.issues.some(i => i.code === 'graphic-invisible')).toBe(false)
})
