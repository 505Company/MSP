import { test, expect } from './workspace-fixture'
import type { ComponentDefinition } from '../../lib/design-system/types'
import type { ComponentQualification } from '../../lib/design-system/calibration-contract'
type Reader = { qualifyComponent(c: ComponentDefinition, assets: []): Promise<ComponentQualification> }
const sample = (): ComponentDefinition => ({ id: 'editable', name: 'Показатель', kind: 'compound', source: { slide: 1, rootId: 'value', elementIds: ['value'], ancestorIds: [], assetIds: [] },
  scene: { width: 240, height: 100, elements: [{ id: 'value', name: 'Значение', kind: 'text', visible: true, opacity: 1, rotation: 0, zIndex: 0, bounds: { x: 10, y: 10, width: 220, height: 80 }, text: '12%', fontFamily: 'Arial', fontStyle: 'Regular', fontSize: 50,
    styleRuns: [{ start: 0, end: 2, fontFamily: 'Arial', fontStyle: 'Regular', fontSize: 50 }, { start: 2, end: 3, fontFamily: 'Arial', fontStyle: 'Regular', fontSize: 30 }] }] },
  slots: [{ id: 'number', elementId: 'value', label: 'Значение', defaultText: '12', policy: 'fixed-box', maxLength: 5000, range: { start: 0, end: 2 } }, { id: 'unit', elementId: 'value', label: 'Единица', defaultText: '%', policy: 'fixed-box', maxLength: 5000, range: { start: 2, end: 3 } }], fixedTextIds: [], issues: [], semantics: [] })
async function qualify(page: import('@playwright/test').Page, c: ComponentDefinition) {
  await page.goto('/styles'); await page.addScriptTag({ url: '/pptx-reader.js?test=qualification' })
  return page.evaluate(async c => (window as unknown as { MspPptxReader: Reader }).MspPptxReader.qualifyComponent(c, []), c)
}
test('qualification checks substitutions, mixed text styles and editable PPTX round trip', async ({ page }) => {
  const c = sample(), before = structuredClone(c), q = await qualify(page, c)
  expect(q.ready).toBe(true); expect(q.cases[0].roundTrip).toBe(true)
  expect(q.cases.find(c => c.name === 'typical')!.roundTrip).toBe(true)
  expect(q.cases.find(c => c.name === 'long')!.fits).toBe(false)
  expect(q.fields.map(f => f.kind)).toEqual(['number', 'unit']); expect(q.signature.length).toBe(4800)
  expect(c).toEqual(before)
})
test('missing fonts and content outside the component frame never qualify', async ({ page }) => {
  const c = sample(), text = c.scene.elements[0]; if (text.kind !== 'text') throw new Error()
  text.fontFamily = 'MSP Unavailable Qualification Font'; text.styleRuns?.forEach(r => r.fontFamily = text.fontFamily)
  const font = await qualify(page, c)
  expect(font.ready).toBe(false); expect(font.issues.some(i => i.code === 'font-unavailable')).toBe(true)
  const outside = sample(); outside.scene.width = 20
  const crop = await qualify(page, outside)
  expect(crop.ready).toBe(false); expect(crop.issues.some(i => i.code === 'component-clipping')).toBe(true)
})
test('a malformed text-field definition becomes an unavailable candidate instead of aborting the catalog', async ({ page }) => {
  const c = sample(), text = c.scene.elements[0]; if (text.kind !== 'text') throw new Error()
  text.styleRuns = undefined
  const result = await qualify(page, c)
  expect(result.ready).toBe(false); expect(result.issues.some(i => i.code === 'qualification-render')).toBe(true)
  expect(result.cases.length).toBe(5)
})

for (const [source, replacement] of [['Unavailable Brand Sans', 'Noto Sans'], ['Unavailable Consolas', 'Roboto Mono']]) test(`Google Fonts resolves ${source} after reopening and records the replacement`,async({page})=>{
 await page.route('**/api/uploads/font-fixture/fonts',route=>route.fulfill({json:{fonts:[],requested:[{family:source,style:'Regular'}]}}))
 await page.route('**/api/fonts/google?**',route=>{const family=new URL(route.request().url()).searchParams.get('family');return route.fulfill({json:{family,style:'Regular',files:family===replacement?[{url:'/fonts/play/Play-Regular.ttf'}]:[]}})})
 const c=sample(),text=c.scene.elements[0];if(text.kind!=='text')throw Error()
 text.fontFamily=source;text.styleRuns?.forEach(r=>r.fontFamily=text.fontFamily)
 for(let i=0;i<2;i++){
  await page.goto('/styles');await page.addScriptTag({url:'/pptx-reader.js?font-reopen-test'})
  const result=await page.evaluate(async c=>{
   const path='/browser/fonts.ts';const {ensureUploadFonts,materializeFontSubstitutions}=await import(path);const warnings=await ensureUploadFonts('font-fixture')
   const q=await (window as unknown as {MspPptxReader:Reader}).MspPptxReader.qualifyComponent(c,[])
   return {q,warnings,exported:materializeFontSubstitutions(c),original:c}
  },c)
  expect(result.q.ready,JSON.stringify(result.q.issues)).toBe(true)
  expect(result.warnings.join()).toContain(`${replacement} (Google Fonts)`);expect(result.q.issues.some(i=>i.code==='font-substitution'&&i.severity==='warning')).toBe(true)
  expect(result.q.issues.some(i=>i.code==='font-unavailable')).toBe(false)
  const resolved=result.exported.scene.elements[0],original=result.original.scene.elements[0];expect(resolved.kind==='text'&&resolved.fontFamily).toBe(replacement);expect(original.kind==='text'&&original.fontFamily).toBe(source)
 }
})
