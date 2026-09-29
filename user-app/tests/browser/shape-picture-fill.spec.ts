import {test,expect} from '@playwright/test'
import JSZip from 'jszip'
import {controlPptx} from '../fixtures/control-pptx'

test('an image-filled ordinary shape retains its bitmap, stretch viewport, outline and readable mirrored text',async({page})=>{
 const zip=await JSZip.loadAsync(await controlPptx()),xml=await zip.file('ppt/slides/slide1.xml')!.async('string')
 const shape=`<p:sp><p:nvSpPr><p:cNvPr id="900" name="Image-filled label"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm flipH="1"><a:off x="1000000" y="1000000"/><a:ext cx="1905000" cy="952500"/></a:xfrm><a:prstGeom prst="rect"/><a:blipFill><a:blip r:embed="rImage"/><a:stretch><a:fillRect l="-10000" r="-20000"/></a:stretch></a:blipFill><a:ln w="19050"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr lIns="95250" rIns="190500" tIns="0" bIns="0"/><a:lstStyle/><a:p><a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>Readable label</a:t></a:r></a:p></p:txBody></p:sp>`
 zip.file('ppt/slides/slide1.xml',xml.replace(/(<p:spTree>)[\s\S]*?(<\/p:spTree>)/,`$1${shape}$2`))
 await page.goto('/');await page.addScriptTag({url:'/pptx-reader.js'})
 const snapshot=await page.evaluate(async data=>{
  const reader=(window as unknown as {MspPptxReader:typeof import('../../browser/prepare')}).MspPptxReader
  return (await reader.rereadSourceSlides(Uint8Array.from(atob(data),c=>c.charCodeAt(0)),'Picture fill.pptx',[1])).snapshot
 },(await zip.generateAsync({type:'nodebuffer'})).toString('base64'))
 expect(snapshot.slides[0].warnings.some(w=>w.startsWith('normalized-page-unavailable'))).toBe(false)
 const group=snapshot.elements.find(e=>e.name==='Image-filled label'&&e.kind==='group')!,children=snapshot.elements.filter(e=>e.parentId===group.id)
 const raster=children.find(e=>e.kind==='raster')
 expect(raster,'ordinary shape image fills must not disappear').toBeTruthy()
 expect(raster!.properties.bounds).toMatchObject({x:-20,y:0,width:260,height:100})
 expect(children.some(e=>e.kind==='rectangle'&&e.properties.stroke)).toBe(true)
 const text=children.find(e=>e.kind==='text')!
 expect(text.properties.centeredTransform).toMatchObject({flipH:true})
 expect(text.properties.bounds).toMatchObject({x:20,width:170})
 expect(snapshot.assets.some(a=>a.origins.includes('ppt/media/control.png'))).toBe(true)
})
