import {test,expect} from '@playwright/test'
import JSZip from 'jszip'
import {nativePptx,nativePdf} from '../fixtures/native-pptx'
import {nativeDataTemplates} from '../../lib/design-system/editable-source'
import {exportEditableTemplatePptx} from '../../lib/design-system/editable-pptx'
import {nativeObjectSchema} from '../../lib/design-system/native-contract'
import type {PreparedPresentation} from '../../lib/digital-designer/source-types'
import {validateVisualManifest} from '../../lib/digital-designer/visual-package'

test('native PPTX tables, chart caches and SmartArt topology survive the browser importer',async({page})=>{
 await page.goto('/');await page.addScriptTag({url:'/pptx-reader.js'})
 const result=await page.evaluate(async bytes=>{
  const reader=(window as unknown as {MspPptxReader:{preparePresentation(b:Uint8Array,n:string):Promise<PreparedPresentation>}}).MspPptxReader
  return (await reader.preparePresentation(Uint8Array.from(bytes),'Native.pptx')).snapshot
 },[...await nativePptx()])
 const objects=result.elements.filter(e=>e.properties.native).map(e=>nativeObjectSchema.parse(e.properties.native))
 expect(objects.map(o=>o.kind).sort()).toEqual(['chart','smartart','table'])
 const chart=objects.find(o=>o.kind==='chart')!
 expect(chart.groups[0].series[0].values).toEqual([12,null,-8]);expect(chart.groups[0].series[0].color?.toLowerCase()).toBe('#e85c46')
 const graph=objects.find(o=>o.kind==='smartart')!
 expect(graph.nodes.map(n=>n.text)).toEqual(['Команда','Дизайн','Разработка']);expect(graph.edges).toHaveLength(2)
 const table=objects.find(o=>o.kind==='table')!
 expect(table.rows[2].cells[0].colSpan).toBe(2);expect(table.rows[2].cells[1].merged).toBe(true)
 const templates=nativeDataTemplates(result)
 expect(templates.map(t=>t.kind).sort()).toEqual(['chart','smartart','table'])
 expect(templates.find(t=>t.kind==='table')!.data.rows).toEqual([['Север','42'],['Общий итог','']])
 expect(templates.find(t=>t.kind==='smartart')!.data.items![1].parentId).toBe('root')
 for(const template of templates){
  const data=structuredClone(template.data)
  if(data.series)data.series[0].values=[73,null,-9]
  if(data.rows)data.rows[0][1]='73'
  if(data.items)data.items.push({id:'new',parentId:'root',text:'Новый отдел'})
  let bytes=await exportEditableTemplatePptx(template,data)
  if(template.kind==='chart'){
   const zip=await JSZip.loadAsync(bytes)
   for(const [name,file] of Object.entries(zip.files))if(/^ppt\/charts\/chart\d+\.xml$/.test(name)){
    const xml=await file.async('string');zip.file(name,xml.replace(/<c:(?:numCache|strCache)>[\s\S]*?<\/c:(?:numCache|strCache)>/g,''))
   }
   bytes=await zip.generateAsync({type:'uint8array'})
  }
  const copy=await page.evaluate(async bytes=>(await (window as unknown as {MspPptxReader:{preparePresentation(b:Uint8Array,n:string):Promise<PreparedPresentation>}}).MspPptxReader.preparePresentation(Uint8Array.from(bytes),'Export.pptx')).snapshot,[...bytes])
  const object=nativeObjectSchema.parse(copy.elements.find(e=>e.properties.native)?.properties.native)
  expect(object.kind).toBe(template.kind)
  if(object.kind==='chart')expect(object.groups[0].series[0].values).toEqual([73,null,-9])
  if(object.kind==='table')expect(object.rows[1].cells[1].text).toBe('73')
  if(object.kind==='smartart')expect(object.nodes.find(n=>n.id==='new')?.text).toBe('Новый отдел')
 }
})
test('PDF keeps native text and vectors, with a real page preview',async({page})=>{
 await page.goto('/');await page.addScriptTag({url:'/pptx-reader.js'})
 const result=await page.evaluate(async bytes=>{
  const reader=(window as unknown as {MspPptxReader:{preparePresentation(b:Uint8Array,n:string):Promise<PreparedPresentation>}}).MspPptxReader
  const r=await reader.preparePresentation(Uint8Array.from(bytes),'Native.pdf');return {snapshot:r.snapshot,previews:r.previews}
 },[...nativePdf()])
 expect(result.snapshot.slides).toHaveLength(1)
 expect(result.snapshot.elements.some(e=>e.kind==='text'&&String(e.properties.text).includes('Editable PDF text'))).toBe(true)
 expect(result.snapshot.elements.some(e=>['path','rectangle','line'].includes(e.kind))).toBe(true)
 expect(result.previews[0].dataUrl).toMatch(/^data:image\/jpeg/)
 expect(()=>validateVisualManifest({renderer:"msp-web-2026-09-25",previewKind:"reconstruction",snapshot:result.snapshot,assets:result.snapshot.assets,previews:[],sheets:[]},result.snapshot.sourceId)).not.toThrow()
})
