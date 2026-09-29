import { build } from 'esbuild'
import { test, expect } from './workspace-fixture'
import { nativeLayoutFixture } from '../fixtures/native-layout'
import { compileEditableProposal, sourceGraphic } from '../../lib/design-system/editable-source'
import { readSourceScene } from '../../lib/design-system/source-scene'
import { graphicHtml } from '../../lib/design-system/diagram-graph'

test('source glyph ink outside a PPTX text frame remains visible while new overflowing text is rejected', async ({ page }) => {
 await page.goto('/processing-worker')
 const { snapshot, proposal } = nativeLayoutFixture('metric')
 snapshot.elements = snapshot.elements.filter(e => e.id !== 'frame')
 proposal.sourceIds = snapshot.elements.map(e => e.id)
 const value = snapshot.elements[0]
 Object.assign(value.properties, { text: 'XX', bounds: { x: 0, y: 50, width: 220, height: 35 }, fontSize: 72, fontStyle: 'Bold', flow: { columns: 1, gap: 0, autoFit: 'NONE' }, textBox: { align: 'LEFT', vertical: 'TOP', wrap: true }, styleRuns: [{ start: 0, end: 2, fontFamily: 'Play', fontStyle: 'Bold', fontSize: 72 }], colorRuns: [{ start: 0, end: 2, fill: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } } }], paragraphs: [{ start: 0, end: 2, fontSize: 72, align: 'LEFT', left: 0, right: 0, indent: 0, before: 0, after: 0, lineHeight: { unit: 'PERCENT', value: 90 } }] })
 snapshot.elements[1].properties.bounds = { x: 0, y: 0, width: 220, height: 35 }
 proposal.data = { value: 'XX', unit: '', items: [{ text: 'Описание показателя' }] }
 const template = compileEditableProposal(proposal, 1, snapshot, 'test', [])
 const bundle = await build({ stdin: { contents: "export {renderEditableHtml} from './lib/design-system/editable-render'; export {hydrateEditableHtml} from './lib/design-system/editable-hydrate';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'Regression', write: false })
 await page.addScriptTag({ content: bundle.outputFiles[0].text })
 const result = await page.evaluate(async template => {
  const api = (window as unknown as { Regression: typeof import('../../lib/design-system/editable-render') & typeof import('../../lib/design-system/editable-hydrate') }).Regression
  const host = document.createElement('div'); document.body.appendChild(host)
  host.innerHTML = api.renderEditableHtml(template)
  await api.hydrateEditableHtml(host)
  const source = { overflow: !!host.querySelector('[data-native-overflow="true"]'), aspect: host.querySelector<HTMLElement>('[data-native-layout]')!.style.aspectRatio }
  // Preserve the source font to test refusal, bypassing changed-text autofit.
  const field = host.querySelector<SVGSVGElement>('[data-source-text="value"]')!, text = JSON.parse(field.dataset.nativeText!)
  text.text = 'Too much new content '.repeat(100); text.styleRuns[0].end = text.text.length; text.colorRuns[0].end = text.text.length; text.paragraphs[0].end = text.text.length
  field.dataset.nativeText = JSON.stringify(text)
  await api.hydrateEditableHtml(host)
  const rejected = field.dataset.nativeOverflow === 'true'
  host.remove(); return { source, rejected }
 }, template)
 expect(result.source.overflow).toBe(false)
 expect(result.source.aspect).not.toBe(`${template.width} / ${template.height}`)
 expect(result.rejected).toBe(true)
})

test('linear and radial native gradients match the original canvas preview and stay visible on dark surfaces', async ({ page }) => {
 await page.goto('/processing-worker')
 const bundle = await build({ stdin: { contents: "export {renderSlidePreview} from './vendor/drag/src/formats/pptx/preview';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'GradientRegression', write: false })
 await page.addScriptTag({ content: bundle.outputFiles[0].text })
 for (const type of ['linear', 'radial'] as const) {
  const { snapshot } = nativeLayoutFixture('metric'), frame = snapshot.elements[0]
  frame.properties.bounds = { x: 0, y: 0, width: 200, height: 100 }; delete frame.properties.fill
  frame.properties.gradient = { type, start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, stops: [{ position: 0, color: { r: 0, g: .7, b: 1, a: .6 } }, { position: 1, color: { r: .2, g: .3, b: 1, a: 1 } }] }
  snapshot.elements = [frame]
  const scene = readSourceScene(snapshot), source = sourceGraphic(scene, frame.id, 'test').replace('width="100%" height="100%"', 'width="200" height="100"')
  const graph = graphicHtml(scene.roots, 200, 100, 'test').match(/<svg\b[\s\S]*?<\/svg>/)![0].replace('width="100%" height="100%"', 'width="200" height="100"')
  for (const svg of [source, graph]) {
  const error = await page.evaluate(async ({ svg, element }) => {
   const api = (window as unknown as { GradientRegression: typeof import('../../vendor/drag/src/formats/pptx/preview') }).GradientRegression
   const raster = async (url: string) => { const image = new Image(); image.src = url; await image.decode(); const c = document.createElement('canvas'); c.width = 200; c.height = 100; const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0, 200, 100); return ctx.getImageData(0, 0, 200, 100).data }
   const original = await api.renderSlidePreview({ schemaVersion: 1, id: 'page', sourceIndex: 0, width: 200, height: 100, elements: [element], degradations: [] }, 200, undefined, true)
   const [a, b] = await Promise.all([raster(original), raster('data:image/svg+xml;base64,' + btoa(svg))])
   let error = 0; for (let i = 0; i < a.length; i++) error += Math.abs(a[i] - b[i])
   return { error: error / a.length / 255, samples: [0, 100, 10100, 19999].map(p => ({ a: Array.from(a.slice(p * 4, p * 4 + 4)), b: Array.from(b.slice(p * 4, p * 4 + 4)) })) }
  }, { svg, element: scene.records.get(frame.id)!.element })
  expect(error.error, JSON.stringify({ type, ...error })).toBeLessThan(.01)
  }
 }
})
