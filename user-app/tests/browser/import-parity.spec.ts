import { test,expect,type Page } from '@playwright/test'
import JSZip from 'jszip'
import { controlPptx } from '../fixtures/control-pptx'
import type { PreparedPresentation } from '../../lib/digital-designer/source-types'

// Minimized regressions adapted from the Figma/Drag tests. They run the actual
// browser reader, without importing code or fixtures outside MSP.
async function prepare(page:Page,zip:JSZip){
  const bytes=await zip.generateAsync({type:'uint8array'})
  return page.evaluate(async data=>{
    try{
      const reader=(window as unknown as {MspPptxReader:{preparePresentation(b:Uint8Array,n:string):Promise<PreparedPresentation>}}).MspPptxReader
      const result=await reader.preparePresentation(Uint8Array.from(data),'Import regression.pptx')
      return {snapshot:result.snapshot,error:''}
    }catch(error){return {snapshot:null,error:error instanceof Error?error.message:String(error)}}
  },[...bytes])
}
test.beforeEach(async({page})=>{await page.goto('/');await page.addScriptTag({url:'/pptx-reader.js'})})

test('stale unused Content Types are tolerated; missing referenced master still fails',async({page})=>{
  const zip=await JSZip.loadAsync(await controlPptx()),types=await zip.file('[Content_Types].xml')!.async('string')
  zip.file('[Content_Types].xml',types.replace('</Types>','<Override PartName="/ppt/slideMasters/slideMaster99.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/></Types>'))
  expect((await prepare(page,zip)).error).toBe('')
  zip.remove('ppt/slideMasters/slideMaster1.xml')
  expect((await prepare(page,zip)).error).not.toBe('')
})
test('an empty tiny decorative text body keeps its shape; impossible nonempty text marks an incomplete slide and preserves raw text',async({page})=>{
  const zip=await JSZip.loadAsync(await controlPptx()),slide=await zip.file('ppt/slides/slide1.xml')!.async('string')
  const shape=(value:string)=>`<p:sp><p:nvSpPr><p:cNvPr id="990" name="Маленький круг"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="171450" cy="171450"/></a:xfrm><a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="00CCAA"/></a:solidFill></p:spPr><p:txBody><a:bodyPr lIns="91425" rIns="91425" tIns="45700" bIns="45700"/><a:lstStyle/><a:p><a:r><a:t>${value}</a:t></a:r></a:p></p:txBody></p:sp>`
  zip.file('ppt/slides/slide1.xml',slide.replace('</p:spTree>',shape('')+'</p:spTree>'))
  const empty=await prepare(page,zip)
  expect(empty.error).toBe('')
  const group=empty.snapshot!.elements.find(e=>e.name==='Маленький круг')!
  expect(group).toBeTruthy()
  const ellipse=empty.snapshot!.elements.find(e=>e.kind==='ellipse'&&e.parentId===group.id)!
  expect(ellipse.properties.bounds).toMatchObject({width:18,height:18})
  expect(ellipse.properties.fill).toMatchObject({color:{r:0,g:.8,b:170/255}})
  zip.file('ppt/slides/slide1.xml',slide.replace('</p:spTree>',shape('Непустой текст')+'</p:spTree>'))
  const invalid=await prepare(page,zip)
  expect(invalid.snapshot!.slides[0].warnings.some(w=>w.includes('normalized-page-unavailable (invalid-file)'))).toBe(true)
  expect(invalid.snapshot!.slides[0].text).toContain('Непустой текст')
  expect(invalid.snapshot!.assets.length).toBeGreaterThan(0)
})
test('65 identity-alpha images retain native assets instead of exhausting 64 raster fallback slots',async({page})=>{
  const zip=await JSZip.loadAsync(await controlPptx()),slide=await zip.file('ppt/slides/slide1.xml')!.async('string')
  const image=slide.match(/<p:pic>[\s\S]*?<\/p:pic>/)![0]
  const pictures=Array.from({length:65},(_,i)=>image.replace(/<p:cNvPr id="\d+"/,`<p:cNvPr id="${100+i}"`).replace(/<a:blip r:embed="([^"]+)"\s*\/>/,'<a:blip r:embed="$1"><a:alphaModFix amt="100000"/></a:blip>')).join('')
  zip.file('ppt/slides/slide1.xml',slide.replace(/(<p:spTree>)[\s\S]*?(<\/p:spTree>)/,`$1${pictures}$2`))
  const result=await prepare(page,zip)
  expect(result.error).toBe('')
  const rasters=result.snapshot!.elements.filter(e=>e.kind==='raster')
  expect(rasters).toHaveLength(65)
  expect(rasters.every(e=>e.properties.reason==='source-image')).toBe(true)
  expect(new Set(rasters.map(e=>e.properties.assetId)).size).toBe(1)
})

test('negative source crop preserves an image outset and the original asset',async({page})=>{
 const zip=await JSZip.loadAsync(await controlPptx()),slide=await zip.file('ppt/slides/slide1.xml')!.async('string')
 zip.file('ppt/slides/slide1.xml',slide.replace('<a:srcRect l="25000" r="25000"/>','<a:srcRect l="-25000" r="25000" b="-25000"/>'))
 const result=await prepare(page,zip),elements=result.snapshot!.elements
 const frame=elements.find(e=>e.name==='Фото с кадрированием'&&e.kind==='group')
 expect(frame).toBeTruthy()
 const image=elements.find(e=>e.parentId===frame!.id&&e.kind==='raster')!
 expect(image).toBeTruthy()
 const box=frame!.properties.bounds as {width:number;height:number},bounds=image.properties.bounds as {x:number;y:number;width:number;height:number}
 expect(bounds.width).toBeCloseTo(box.width);expect(bounds.x).toBeCloseTo(box.width*.25)
 expect(bounds.height).toBeCloseTo(box.height*.8)
 expect(elements.some(e=>e.kind==='source-picture'&&e.properties.crop&&JSON.stringify(e.properties.crop).includes('-0.25'))).toBe(true)
})

test('source text can wrap after a hyphen without splitting the rest of a compound word',async({page})=>{
 const measured=await page.evaluate(async()=>{
  const previewUrl='/vendor/drag/src/formats/pptx/preview.ts',fontsUrl='/browser/fonts.ts'
  const {measureTextBox,renderTextSvg}=await import(previewUrl),{ensureSceneFonts}=await import(fontsUrl)
  const text={id:'heading',kind:'text',name:'Heading',bounds:{x:0,y:0,width:490,height:180},visible:true,opacity:1,rotation:0,zIndex:0,text:'Пример слайда-разделителя',fontFamily:'Play',fontSize:64,fontStyle:'Regular',textBox:{align:'LEFT',vertical:'TOP',wrap:true}}
  await ensureSceneFonts([text])
  return {metrics:await measureTextBox(text),svg:(await renderTextSvg(text)).svg}
 })
 expect(measured.metrics.lines).toBe(2);expect(measured.metrics.overflow).toBe(false)
 const chars=[...measured.svg.matchAll(/<text[^>]*y="([^"]+)"[^>]*>([^<]*)<\/text>/g)]
 const lines=new Map<string,string>();for(const [,y,text] of chars)lines.set(y,(lines.get(y)??'')+text)
 expect([...lines.values()]).toEqual(['Пример слайда-','разделителя'])
})
