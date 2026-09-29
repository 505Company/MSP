import { test, expect } from './workspace-fixture'
import { readFile, writeFile } from 'node:fs/promises'
import type { ComponentDefinition, RenderReport } from '../../lib/design-system/types'

// Opt-in acceptance audit of a complete persisted catalog. Compiler eligibility
// is not proof that a particular source text fits in the browser with its fonts.
test('audit every saved component with its original resources and short replacement text', async ({ page, request }, testInfo) => {
  test.skip(!process.env.MSP_RENDER_AUDIT_FIXTURE, 'Set MSP_RENDER_AUDIT_FIXTURE to a saved local catalog and assets')
  const fixture = JSON.parse(await readFile(process.env.MSP_RENDER_AUDIT_FIXTURE!, 'utf8')) as {
    components: ComponentDefinition[]; assets: { id: string; base64: string }[]
  }
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  await page.goto('/styles')
  await page.addScriptTag({ url: '/pptx-reader.js?v=semantic-audit' })
  const results = []
  let previews = 0
  for (const component of fixture.components) {
    const result = await page.evaluate(async ({ component, assets }) => {
      const reader = (window as unknown as { MspPptxReader: {
        renderComponent(c: ComponentDefinition, values: Record<string, string>, assets: { id: string; bytes: Uint8Array }[]): Promise<RenderReport>
      } }).MspPptxReader
      const resources = assets.map(a => ({ id: a.id, bytes: Uint8Array.from(atob(a.base64), c => c.charCodeAt(0)) }))
      const before = JSON.stringify(component)
      const original = await reader.renderComponent(component, {}, resources)
      const changed = component.slots.length ? await reader.renderComponent(component, Object.fromEntries(component.slots.map(s => [s.id, '1'])), resources) : null
      return { original, changed, sourceUnchanged: before === JSON.stringify(component) }
    }, { component, assets: fixture.assets.filter(a => component.source.assetIds.includes(a.id)) })
    expect(result.sourceUnchanged, component.id).toBe(true)
    if (result.original.fits && previews < 5) {
      await writeFile(testInfo.outputPath(`${component.id}.png`), Buffer.from(result.original.dataUrl.split(',')[1], 'base64')); previews++
    }
    results.push({ id: component.id, name: component.name, slide: component.source.slide, slots: component.slots.length,
      original: { fits: result.original.fits, issues: result.original.issues }, changed: result.changed && { fits: result.changed.fits, issues: result.changed.issues } })
  }
  await writeFile(testInfo.outputPath('render-audit.json'), JSON.stringify(results, null, 2))
  expect(results.length).toBe(fixture.components.length)
  expect(results.some(r => r.original.fits)).toBe(true)
})
