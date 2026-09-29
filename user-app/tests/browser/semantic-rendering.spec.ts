import { test, expect } from './workspace-fixture'
import { readFile, writeFile } from 'node:fs/promises'
import type { ComponentDefinition, RenderReport } from '../../lib/design-system/types'
import type { PreparedPresentation } from '../../lib/digital-designer/source-types'
import { flatten, instantiateComponent } from '../../lib/design-system/compiler'

// Opt-in local evidence from a completed model scan. No model calls, uploads,
// project mutations or dependency on the user's active development server.
test('model-selected components render with original assets and accept only fitting new text', async ({ page, request }, testInfo) => {
  test.skip(!process.env.MSP_SEMANTIC_FIXTURE, 'Set MSP_SEMANTIC_FIXTURE to the saved local component/asset fixture')
  const fixture = JSON.parse(await readFile(process.env.MSP_SEMANTIC_FIXTURE!, 'utf8')) as {
    components: ComponentDefinition[]; assets: { id: string; base64: string }[]; examples?: Record<string, Record<string, string>>
  }
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  expect(fixture.components.some(c => c.kind === 'compound' && c.slots.length > 0)).toBe(true)
  expect(fixture.components.some(c => c.source.assetIds.length > 0)).toBe(true)
  await page.goto('/styles')
  await page.addScriptTag({ url: '/pptx-reader.js?v=semantic-render-test' })
  for (const component of fixture.components) {
    const values = fixture.examples?.[component.id] ?? Object.fromEntries(component.slots.map((s, i) => [s.id, i ? 'Новый текст' : 'Обучение']))
    const filled = { ...component, scene: instantiateComponent(component, values), slots: [] }
    const result = await page.evaluate(async ({ component, assets, values, filled }) => {
      const reader = (window as unknown as { MspPptxReader: {
        renderComponent(c: ComponentDefinition, values: Record<string, string>, assets: { id: string; bytes: Uint8Array }[]): Promise<RenderReport>
        exportNewSlide(c: ComponentDefinition, assets: { id: string; bytes: Uint8Array }[]): Promise<Uint8Array>
        preparePresentation(bytes: Uint8Array, name: string): Promise<PreparedPresentation>
      } }).MspPptxReader
      const resources = assets.map(a => ({ id: a.id, bytes: Uint8Array.from(atob(a.base64), char => char.charCodeAt(0)) }))
      const before = JSON.stringify(component)
      const original = await reader.renderComponent(component, {}, resources)
      const changed = component.slots.length ? await reader.renderComponent(component, values, resources) : null
      const overflow = component.slots.length ? await reader.renderComponent(component, { [component.slots[0].id]: 'Очень длинное содержание. '.repeat(100) }, resources) : null
      // The text-only examples also exercise native editable export and reimport.
      const exported = component.slots.length && !resources.length ? await reader.exportNewSlide(filled, resources) : null
      const roundtrip = exported ? await reader.preparePresentation(exported, 'Text roundtrip.pptx') : null
      return { original, changed, overflow, sourceUnchanged: before === JSON.stringify(component),
        exported: exported ? [...exported] : null, roundtripTexts: roundtrip?.snapshot.elements.filter(e => e.kind === 'text').map(e => String(e.properties.text)) }
    }, { component, assets: fixture.assets.filter(a => component.source.assetIds.includes(a.id)), values, filled })
    expect(result.original.fits, JSON.stringify(result.original.issues)).toBe(true)
    expect(result.sourceUnchanged).toBe(true)
    await writeFile(testInfo.outputPath(`${component.id}-source.png`), Buffer.from(result.original.dataUrl.split(',')[1], 'base64'))
    if (result.changed && result.overflow) {
      expect(result.changed.fits, JSON.stringify(result.changed.issues)).toBe(true)
      expect(result.changed.dataUrl !== result.original.dataUrl, `${component.name}: new text must change the visible preview`).toBe(true)
      expect(result.overflow.fits).toBe(false)
      expect(result.overflow.issues.some(i => i.code === 'text-overflow')).toBe(true)
      await writeFile(testInfo.outputPath(`${component.id}-new-text.png`), Buffer.from(result.changed.dataUrl.split(',')[1], 'base64'))
    }
    if (result.exported) {
      expect(result.roundtripTexts).toEqual(flatten(filled.scene.elements).filter(e => e.kind === 'text').map(e => e.text))
      await writeFile(testInfo.outputPath(`${component.id}-editable.pptx`), Buffer.from(result.exported))
    }
  }
})
