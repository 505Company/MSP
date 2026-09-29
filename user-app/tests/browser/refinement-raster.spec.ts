import { test, expect } from './workspace-fixture'

test('raster qualification accepts matching source pixels and rejects a changed transcription',async({page})=>{
  await page.goto('/styles')
  const result=await page.evaluate(async()=>{
    const sourcePath='/lib/design-system/reconstruction-browser.ts',checkPath='/browser/refinement-raster.ts',htmlPath='/lib/design-system/editable-qualification.ts'
    const {scenePreview}=await import(sourcePath),{qualifyRasterRegions}=await import(checkPath),{qualifyEditableCatalog}=await import(htmlPath)
    const elements=[{id:'bg',name:'Фон',kind:'rectangle',bounds:{x:0,y:0,width:400,height:180},rotation:0,opacity:1,visible:true,zIndex:0,fill:{type:'solid',color:{r:1,g:1,b:1,a:1}}},{id:'caption',name:'Текст',kind:'text',bounds:{x:20,y:40,width:360,height:80},rotation:0,opacity:1,visible:true,zIndex:1,text:'Исходная карточка',fontFamily:'Arial',fontSize:28,fontStyle:'Regular',colorRuns:[{start:0,end:17,fill:{type:'solid',color:{r:0,g:0,b:0,a:1}}}],textBox:{align:'LEFT',vertical:'TOP',wrap:true}}]
    const dataUrl=await scenePreview(elements,400,180,'fixture')
    // The source image is independently fixed before changing the candidate.
    const OriginalImage=window.Image
    class SourceImage extends OriginalImage {set src(value:string){super.src=value.endsWith('/assets/fixture-source')?dataUrl:value} get src(){return super.src}}
    window.Image=SourceImage
    try{
      const template={id:'recovered-card',kind:'feature',name:'Карточка',description:'Текст',tags:['Карточка'],sourceIds:['source-image'],memberIds:[],slide:1,width:400,height:180,style:{padding:0,background:'#ffffff'},config:{},data:{items:[{id:'caption',text:'Исходная карточка'}]},dataStatus:'readable',graphicHtml:{},sourceRegion:{assetId:'fixture-source',sourceId:'source-image',region:{x:0,y:0,width:1,height:1},representation:'reconstructed',elements}}
      const catalog={id:'a'.repeat(64),families:[{variants:[template]}]}
      const good=await qualifyEditableCatalog(catalog);await qualifyRasterRegions('fixture',catalog,good)
      template.sourceRegion.elements[1].text='Подменённая карточка';template.data.items[0].text='Подменённая карточка'
      const bad=await qualifyEditableCatalog(catalog);await qualifyRasterRegions('fixture',catalog,bad)
      return {good:good.checks[0],bad:bad.checks[0]}
    }finally{window.Image=OriginalImage}
  })
  expect(result.good.passed).toBe(true)
  expect(result.bad.passed).toBe(false)
  expect(result.bad.visual?.textRecall).toBeLessThan(.97)
})
