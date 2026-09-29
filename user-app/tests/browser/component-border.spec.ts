import { build } from 'esbuild'
import { test, expect } from './workspace-fixture'
import { labTemplate } from '../../component-lab/fixtures'

test('a rounded imported outline keeps its complete stroke at edges and corners when resized', async ({ page }, info) => {
 await page.route('**/api/uploads/*/fonts', r => r.fulfill({ json: { fonts: [] } }))
 await page.goto('/processing-worker')
 const template = labTemplate('metric')
 template.width = 644; template.height = 480
 // PPTX text frames extend below the painted panel. The outline itself sits
 // on the source viewport boundary, as in an imported grouped shape.
 template.sourceLayout!.graphic = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 644 480" width="100%" height="100%" overflow="visible"><g transform="translate(0 0)"><svg viewBox="0 0 644 462" width="644" height="462" overflow="visible"><g data-source-object="panel" opacity="1"><rect width="644" height="462" rx="20" fill="#ffffff" stroke="#0077ff" stroke-width="2"/></g></svg></g></svg>'
 const bundle = await build({ stdin: { contents: "export {sourceCandidate} from './lib/component-lab/source'; export {sourceFonts} from './browser/component-lab/fonts'; export {measureComponent,renderCommittedComponent} from './browser/component-lab/measure'; export {toPng} from 'html-to-image';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'BorderRegression', write: false })
 await page.addScriptTag({ content: bundle.outputFiles[0].text })
 const results = await page.evaluate(async template => {
  const api = (window as unknown as { BorderRegression: typeof import('../../lib/component-lab/source') & typeof import('../../browser/component-lab/fonts') & typeof import('../../browser/component-lab/measure') & typeof import('html-to-image') }).BorderRegression
  const candidate = await api.sourceCandidate(template, 'fixture'), profile = candidate.profile!
  if (!profile) throw Error(candidate.reason)
  const fonts = await api.sourceFonts('fixture', profile, true), host = document.createElement('div'); document.body.appendChild(host)
  const results = []
  for (const [width, height] of [[1000, 660], [1000, 300], [320, 820]]) {
   const measured = await api.measureComponent(profile, candidate.content!, { width, maxHeight: height, widthMode: 'fill', heightMode: 'fill', allowedStates: ['vertical'] }, fonts, { target: host })
   if (measured.status !== 'fits') throw Error(JSON.stringify(measured.issues))
   await api.renderCommittedComponent(host, profile, candidate.content!, measured, fonts)
   const png = await api.toPng(host.firstElementChild as HTMLElement, { pixelRatio: 1, fontEmbedCSS: fonts.css })
   const img = new Image(); img.src = png; await img.decode()
   const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
   const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
   const data = ctx.getImageData(0, 0, width, height).data
   const blue = (x: number, y: number) => { const i = (Math.floor(y) * width + Math.floor(x)) * 4; return Math.max(0, data[i + 2] - data[i]) / 255 }
   const thickness = { top: 0, right: 0, bottom: 0, left: 0 }
   for (let i = 0; i < 40; i++) { thickness.top += blue(width / 2, i); thickness.bottom += blue(width / 2, height - 1 - i); thickness.left += blue(i, height / 2); thickness.right += blue(width - 1 - i, height / 2) }
   // A diagonal cross-section through the top-left circular corner, with
   // sqrt(2) correction from diagonal pixel spacing to normal thickness.
   let corner = 0; for (let i = 0; i < 20; i++) corner += blue(i, i) * Math.SQRT2
   results.push({ width, height, thickness, corner, png })
  }
  host.remove(); return results
 }, template)
 for (const { png, ...r } of results) {
  await info.attach(`outline-${r.width}x${r.height}.png`, { body: Buffer.from(png.split(',')[1], 'base64'), contentType: 'image/png' })
  for (const thickness of Object.values(r.thickness)) expect(thickness, JSON.stringify(r)).toBeGreaterThan(1.65)
  for (const thickness of Object.values(r.thickness)) expect(thickness, JSON.stringify(r)).toBeLessThan(2.35)
  expect(r.corner, JSON.stringify(r)).toBeGreaterThan(1.5)
  expect(r.corner, JSON.stringify(r)).toBeLessThan(2.5)
 }
})
