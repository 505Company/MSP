import { test, expect } from './workspace-fixture'
import { createHash } from 'node:crypto'
import { controlPptx } from '../fixtures/control-pptx'
import { nativePdf } from '../fixtures/native-pptx'
import type { PreparedPresentation } from '../../lib/digital-designer/source-types'

test('reader hashes binary input without expanding its byte iterator', async ({ page }) => {
  const source = await controlPptx()
  await page.goto('/styles')
  await page.addScriptTag({ url: '/pptx-reader.js' })
  const actual = await page.evaluate(async input => {
    const bytes = new Uint8Array(input)
    // A minimal detector for the generic iteration path that crashes Chrome on
    // the 135 MB source. Binary operations must use the buffer and exact view.
    bytes[Symbol.iterator] = function* () { throw new Error('binary-input-was-expanded-to-an-array'); yield 0 }
    const reader = (window as unknown as { MspPptxReader: { preparePresentation(bytes: Uint8Array, name: string): Promise<PreparedPresentation> } }).MspPptxReader
    const result = await reader.preparePresentation(bytes, 'binary-input.pptx')
    return { sourceHash: result.snapshot.sourceId, slides: result.snapshot.slideCount, previews: result.previews.length }
  }, [...source])
  expect(actual).toEqual({ sourceHash: createHash('sha256').update(source).digest('hex'), slides: 1, previews: 1 })
})

test('PDF importer refreshes an old reader and hashes binary input directly', async ({ page }) => {
  const source = nativePdf()
  await page.goto('/styles')
  await page.addScriptTag({ url: '/pptx-reader.js' })
  const actual = await page.evaluate(async input => {
    const bytes = new Uint8Array(input)
    Object.defineProperty(bytes, Symbol.iterator, { value: () => { throw new Error('binary-input-was-expanded-to-an-array') } })
    const scope = window as unknown as {
      MspPptxReader: { preparePresentation(bytes: Uint8Array, name: string): Promise<PreparedPresentation> }
      MspPdfReader: { executionVersion: number; preparePdf(): never }
    }
    scope.MspPdfReader = { executionVersion: 1, preparePdf() { throw new Error('stale-pdf-reader-used') } }
    const result = await scope.MspPptxReader.preparePresentation(bytes, 'binary-input.pdf')
    return { sourceHash: result.snapshot.sourceId, slides: result.snapshot.slideCount, previews: result.previews.length }
  }, [...source])
  expect(actual).toEqual({ sourceHash: createHash('sha256').update(source).digest('hex'), slides: 1, previews: 1 })
})
