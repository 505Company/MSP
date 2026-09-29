import { test,expect } from './workspace-fixture'
import type { ComponentDefinition,RenderReport } from '../../lib/design-system/types'
import { rendererPptx, bottomAlignedPptx } from '../fixtures/renderer-pptx'

type Reader={renderComponent(c:ComponentDefinition,v:Record<string,string>,a:[]):Promise<RenderReport>;preparePresentation(b:Uint8Array,n:string):Promise<unknown>}
test.beforeEach(async({page})=>{await page.goto('/styles');await page.addScriptTag({url:'/pptx-reader.js?v=renderer-test'})})

const textComponent=(family:string):ComponentDefinition=>({id:'test-type',name:'Разный кегль',kind:'atom',source:{slide:1,rootId:'text',elementIds:['text'],ancestorIds:[],assetIds:[]},
  scene:{width:300,height:140,elements:[{id:'text',name:'43%',kind:'text',bounds:{x:0,y:0,width:300,height:140},rotation:0,opacity:1,visible:true,zIndex:0,text:'43%',fontFamily:family,fontStyle:'Regular',fontSize:96,
    styleRuns:[{start:0,end:2,fontFamily:family,fontStyle:'Regular',fontSize:96},{start:2,end:3,fontFamily:family,fontStyle:'Regular',fontSize:48}],
    colorRuns:[{start:0,end:2,fill:{type:'solid',color:{r:0,g:0,b:1,a:1}}},{start:2,end:3,fill:{type:'solid',color:{r:1,g:0,b:0,a:1}}}]}]},slots:[],fixedTextIds:['text'],issues:[],semantics:[]})

test('mixed font sizes share a typographic baseline',async({page})=>{
  const bottoms=await page.evaluate(async(component)=>{
    const report=await (window as unknown as {MspPptxReader:Reader}).MspPptxReader.renderComponent(component,{},[])
    const img=new Image();img.src=report.dataUrl;await img.decode()
    const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0)
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let blue=0,red=0
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(pixels[i+2]>150&&pixels[i]<100)blue=y;if(pixels[i]>150&&pixels[i+2]<100)red=y}
    return {blue,red,scale:canvas.width/component.scene.width}
  },textComponent('Arial'))
  expect(Math.abs(bottoms.blue-bottoms.red)/bottoms.scale).toBeLessThan(4)
})

test('Play is loaded from the app before component measurement',async({page})=>{
  const result=await page.evaluate(async(c)=>(window as unknown as {MspPptxReader:Reader}).MspPptxReader.renderComponent(c,{},[]),textComponent('Play'))
  expect(result.issues.filter(i=>i.code==='font-unavailable')).toEqual([])
  expect(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='Play'&&f.status==='loaded'))).toBe(true)
})

test('a native face alias must be registered for rendering; unavailable fonts block approval',async({page})=>{
  const native=await page.evaluate(async c=>{
    const report=await(window as unknown as {MspPptxReader:Reader}).MspPptxReader.renderComponent(c,{},[])
    return {report,registered:[...document.fonts].some(f=>f.family.replace(/^["']|["']$/g,'')==='Arial Bold'&&f.status==='loaded')}
  },textComponent('Arial Bold'))
  if(!native.report.issues.some(i=>i.code==='font-unavailable'))expect(native.registered).toBe(true)
  else expect(native.report.fits).toBe(false)
  const missing=await page.evaluate(async c=>(window as unknown as {MspPptxReader:Reader}).MspPptxReader.renderComponent(c,{},[]),textComponent('MSP Missing Font 8aa52'))
  expect(missing.issues.some(i=>i.code==='font-unavailable')).toBe(true)
  expect(missing.fits).toBe(false)
})

test('compact paragraph spacing keeps a smaller unit below its large number',async({page})=>{
  const component=textComponent('Play'),text=component.scene.elements[0]
  if(text.kind!=='text')throw new Error()
  text.text='42\nтыс';text.fontSize=58.6667
  text.styleRuns=[{start:0,end:2,fontFamily:'Play',fontStyle:'Regular',fontSize:58.6667},{start:2,end:6,fontFamily:'Play',fontStyle:'Regular',fontSize:26.6667}]
  text.colorRuns![1].end=6
  text.paragraphs=[{start:0,end:6,fontSize:58.6667,align:'LEFT',left:0,right:0,indent:0,before:0,after:0,lineHeight:{unit:'PERCENT',value:60}}]
  const result=await page.evaluate(async c=>{
    const report=await(window as unknown as {MspPptxReader:Reader}).MspPptxReader.renderComponent(c,{},[])
    const img=new Image();img.src=report.dataUrl;await img.decode()
    const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height
    const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0)
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let blueBottom=-1,redTop=Infinity
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=(y*canvas.width+x)*4;if(pixels[i+3]<200)continue
      if(pixels[i+2]>150&&pixels[i]<100)blueBottom=Math.max(blueBottom,y)
      if(pixels[i]>150&&pixels[i+2]<100)redTop=Math.min(redTop,y)
    }
    return {fits:report.fits,blueBottom,redTop}
  },component)
  expect(result.fits).toBe(true)
  expect(result.blueBottom).toBeGreaterThan(0)
  expect(Number.isFinite(result.redTop)).toBe(true)
  expect(result.redTop).toBeGreaterThan(result.blueBottom)
})

test('raised runs cannot silently extend past the text frame',async({page})=>{
  const component=textComponent('Arial'),text=component.scene.elements[0]
  if(text.kind!=='text')throw new Error()
  text.styleRuns![1].baselineShift=2
  const report=await page.evaluate(async c=>(window as unknown as {MspPptxReader:Reader}).MspPptxReader.renderComponent(c,{},[]),component)
  expect(report.issues.some(i=>i.code==='text-overflow')).toBe(true)
  expect(report.dataUrl).toBe('')
})

test('source reconstruction does not clip a bottom-aligned paragraph at its unshifted frame height',async({page})=>{
  const bottom=await page.evaluate(async raw=>{
    const prepared=await (window as unknown as {MspPptxReader:Reader}).MspPptxReader.preparePresentation(new Uint8Array(raw),'Baseline.pptx') as {previews:{dataUrl:string}[]}
    const image=new Image();image.src=prepared.previews[0].dataUrl;await image.decode()
    const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0)
    const p=ctx.getImageData(0,0,c.width,c.height).data;let last=0
    for(let y=0;y<c.height;y++)for(let x=Math.round(c.width*420/960);x<c.width;x++){const i=(y*c.width+x)*4;if(p[i]>180&&p[i+1]<70&&p[i+2]<70)last=y}
    return last/(c.width/960)
  },[...await bottomAlignedPptx()])
  expect(bottom).toBeGreaterThan(385)
})

test('roundRect adjustment 50000 renders circular corners',async({page,request})=>{
  expect((await(await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles({name:'Контроль геометрии.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:await rendererPptx()})
  await expect(page.getByRole('link',{name:'Компоненты'})).toBeVisible({timeout:60000})
  await page.locator('.cw-list button').filter({hasText:'Максимальное скругление'}).click()
  await expect(page.locator('.cw-preview img')).toBeVisible()
  const pixel=await page.locator('.cw-preview img').evaluate((img:HTMLImageElement)=>{
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0)
    return [...ctx.getImageData(Math.round(canvas.width*.20),Math.round(canvas.height*.08),1,1).data]
  })
  expect(pixel[3]).toBe(0)
})
