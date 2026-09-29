import type { Page } from '@playwright/test'
import type { ComponentDefinition, RenderReport } from '../../lib/design-system/types'
import type { PreparedPresentation } from '../../lib/digital-designer/source-types'

/** Exercise the retained assembly/export engine without exposing a manual editor in the product. */
export async function renderSlideInBrowser(page: Page, uploadId: string, scene: ComponentDefinition) {
  await page.addScriptTag({ url: '/pptx-reader.js?v=msp-execution-v4-2026-09-25' })
  return page.evaluate(async ({ uploadId, scene }) => {
    const reader = (window as unknown as { MspPptxReader: {
      renderNewSlide(scene: ComponentDefinition, assets: Array<{ id: string; bytes: Uint8Array }>): Promise<RenderReport>
      exportNewSlide(scene: ComponentDefinition, assets: Array<{ id: string; bytes: Uint8Array }>): Promise<Uint8Array>
      preparePresentation(bytes: Uint8Array, name: string): Promise<PreparedPresentation>
    } }).MspPptxReader
    const assets = await Promise.all(scene.source.assetIds.map(async id => {
      const response = await fetch(`/api/uploads/${uploadId}/assets/${id}`)
      if (!response.ok) throw new Error('Не удалось прочитать ресурс')
      return { id, bytes: new Uint8Array(await response.arrayBuffer()) }
    }))
    const report = await reader.renderNewSlide(scene, assets)
    if (!report.fits) return { report, bytes: [], texts: [], warnings: [] }
    const bytes = await reader.exportNewSlide(scene, assets)
    const roundtrip = await reader.preparePresentation(bytes, 'Roundtrip.pptx')
    return { report, bytes: [...bytes], texts: roundtrip.snapshot.elements.filter(e => e.kind === 'text').map(e => e.properties.text), warnings: roundtrip.snapshot.slides[0].warnings }
  }, { uploadId, scene })
}
