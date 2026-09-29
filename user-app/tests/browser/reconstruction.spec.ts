import {test,expect} from './workspace-fixture'

test('reconstructed graph stays editable through movement and native PPTX export/import',async({page})=>{
 await page.goto('/styles')
 const result=await page.evaluate(async()=>{
  const load=(path:string)=>import(/* webpackIgnore: true */ path)
  const [{recognizedDiagram,graphElements,diagramHtml},{writeEditablePptx},{PptxCatalogReader},{readSlide},{flatten},{hydrateEditableHtml}]=await Promise.all([load('/lib/design-system/diagram-graph.ts'),load('/lib/slides/pptx.ts'),load('/vendor/drag/src/formats/pptx/catalog.ts'),load('/vendor/drag/src/formats/pptx/scene.ts'),load('/lib/design-system/compiler.ts'),load('/lib/design-system/editable-hydrate.ts')])
  const g=recognizedDiagram({kind:'diagram',name:'Схема',description:'Процесс',width:400,height:240,background:'#ffffff',nodes:[{id:'a',bounds:{x:20,y:20,width:100,height:60},shape:'capsule',fill:'#0077ff',stroke:null,strokeWidth:0,text:'Начало',textColor:'#ffffff',fontSize:18,font:'Arial'},{id:'b',bounds:{x:260,y:140,width:100,height:60},shape:'rectangle',fill:'#ff3985',stroke:null,strokeWidth:0,text:'Результат',textColor:'#ffffff',fontSize:18,font:'Arial'}],edges:[{id:'ab',from:{nodeId:'a',u:1,v:.5},to:{nodeId:'b',u:0,v:.5},points:[{x:120,y:50},{x:200,y:50},{x:200,y:170},{x:260,y:170}],arrow:'end',color:'#000000',width:1}],patches:[],uncertain:[]},'',['Arial'])
  const changes={nodes:{a:{y:40}},texts:{'a-text':'Старт'}},elements=graphElements(g,changes)
  const host=document.createElement('div');host.innerHTML=diagramHtml(g,'',changes);document.body.appendChild(host);const issues=await hydrateEditableHtml(host)
  const bytes=await writeEditablePptx({id:'test',name:'Схема',kind:'compound',source:{slide:1,rootId:'test',elementIds:[],ancestorIds:[],assetIds:[]},scene:{width:400,height:240,elements},slots:[],fixedTextIds:[],issues:[],semantics:[]},[])
  const reader=new PptxCatalogReader(bytes),catalog=reader.analyze(),slide=await readSlide(reader,catalog.pages[0]),leaves=flatten(slide.elements)
  return {issues,overflow:host.querySelectorAll('[data-native-overflow="true"]').length,texts:leaves.filter((e:{kind:string})=>e.kind==='text').map((e:{text:string})=>e.text),rasters:leaves.filter((e:{kind:string})=>e.kind==='raster').length,paths:leaves.filter((e:{kind:string})=>e.kind==='path').length}
 })
 expect(result.issues).toEqual([]);expect(result.overflow).toBe(0);expect(result.texts).toContain('Старт');expect(result.texts).toContain('Результат');expect(result.rasters).toBe(0);expect(result.paths).toBeGreaterThanOrEqual(3)
})

test('flat raster pattern becomes native pieces and quality gate rejects a lost foreground',async({page})=>{
 await page.goto('/styles')
 const result=await page.evaluate(async()=>{
  const load=(path:string)=>import(/* webpackIgnore: true */ path)
  const [{recoverPatternPixels},{assemblePattern},{compareGraphicPixels,graphicPixels,scenePreview}]=await Promise.all([load('/lib/design-system/pattern-recovery.ts'),load('/lib/design-system/pattern-geometry.ts'),load('/lib/design-system/reconstruction-browser.ts')])
  const canvas=document.createElement('canvas');canvas.width=300;canvas.height=140;const ctx=canvas.getContext('2d')!;['#0077ff','#ff3985','#7cedf8'].forEach((color,i)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(50+i*100,70,40,0,Math.PI*2);ctx.fill()});const image=ctx.getImageData(0,0,300,140),recovery=recoverPatternPixels({width:300,height:140,data:image.data})
  const p={...recovery.geometry,origin:'reconstructed',rules:{gapRatio:.04,rotations:[0,90,180,270],allowRecolor:true,basis:'observed'}};const elements=assemblePattern(p,{width:300,height:140}),rendered=await graphicPixels(await scenePreview(elements,300,140,''),300,140),comparison=compareGraphicPixels(image,rendered),blank=compareGraphicPixels(image,new ImageData(300,140))
  return {parts:p.parts.length,instances:p.instances.length,comparison,blank,kinds:elements.map((e:{kind:string})=>e.kind)}
 })
 expect(result.parts).toBe(1);expect(result.instances).toBe(3);expect(result.kinds).toEqual(['ellipse','ellipse','ellipse']);expect(result.comparison.pixelError).toBeLessThan(.025);expect(result.comparison.foregroundRecall).toBeGreaterThan(.97);expect(result.blank.foregroundRecall).toBeLessThan(.1)
})

test('parts pass independently of a changed composition and build a new diagram from uploaded data',async({page})=>{
 await page.goto('/styles')
 const result=await page.evaluate(async()=>{
  const load=(path:string)=>import(/* webpackIgnore: true */ path)
  const [{recognizedDiagram,graphElements,diagramHtml},{qualifyGraphicParts},{buildGraphicSystem,composeDiagram},{hydrateEditableHtml}]=await Promise.all([load('/lib/design-system/diagram-graph.ts'),load('/lib/design-system/reconstruction-browser.ts'),load('/lib/design-system/graphic-components.ts'),load('/lib/design-system/editable-hydrate.ts')])
  const r={id:'example',name:'Scheme',description:'',reason:'Composition changed',status:'retained',candidate:{id:'example',name:'Scheme',sourceIds:[],componentIds:[],slides:[1]},diagram:recognizedDiagram({kind:'diagram',name:'Схема',description:'Процесс',width:400,height:240,background:'#ffffff',nodes:[{id:'a',bounds:{x:20,y:20,width:100,height:60},shape:'capsule',fill:'#0077ff',stroke:null,strokeWidth:0,text:'Вход',textColor:'#ffffff',fontSize:14,font:'Arial'},{id:'b',bounds:{x:260,y:140,width:100,height:60},shape:'rectangle',fill:'#ff3985',stroke:null,strokeWidth:0,text:'Выход',textColor:'#ffffff',fontSize:14,font:'Arial'}],edges:[{id:'ab',from:{nodeId:'a',u:1,v:.5},to:{nodeId:'b',u:0,v:.5},points:[{x:120,y:50},{x:200,y:50},{x:200,y:170},{x:260,y:170}],arrow:'end',color:'#000000',width:1}],patches:[],uncertain:[]},'',['Arial']),partsQualification:undefined as unknown}
  r.partsQualification=await qualifyGraphicParts(r,'');const system=buildGraphicSystem({results:[r]}),g=composeDiagram(system,{nodes:[{id:'start',text:'Начало'},{id:'left',text:'Проверка A'},{id:'right',text:'Проверка B'},{id:'finish',text:'Результат'}],edges:[{from:'start',to:'left'},{from:'start',to:'right'},{from:'left',to:'finish'},{from:'right',to:'finish'}]})
  const host=document.createElement('div');host.innerHTML=diagramHtml(g,'');document.body.appendChild(host);const issues=await hydrateEditableHtml(host)
  return {parts:system.components.length,groups:system.groups.length,issues,overflow:host.querySelectorAll('[data-native-overflow="true"]').length,nodes:g.nodes.length,edges:g.edges.length,elements:graphElements(g).length}
 })
 expect(result.parts).toBe(3);expect(result.groups).toBe(1);expect(result.nodes).toBe(4);expect(result.edges).toBe(4);expect(result.issues).toEqual([]);expect(result.overflow).toBe(0)
})

test('saved VK raster recognition replays locally as parts without another model request',async({page})=>{
 test.skip(!process.env.MSP_RECONSTRUCTION_DIAGNOSTIC,'Requires the local user-approved VK diagnostic')
 const fs=await import('node:fs/promises'),dir='outputs/diagnostics/reconstruction',raw=JSON.parse(await fs.readFile(`${dir}/raster-recognition.json`,'utf8')),png=await fs.readFile(`${dir}/vk-scheme-raster.png`)
 await page.route('**/api/uploads/diagnostic/assets/diagnostic-vk-raster',route=>route.fulfill({contentType:'image/png',body:png}))
 await page.goto('/styles')
 const result=await page.evaluate(async({raw,url})=>{
  const load=(path:string)=>import(/* webpackIgnore: true */ path)
  const [{recognizedDiagram,graphElements},{refineDiagramGeometry},{qualifyGraphic,qualifyGraphicParts,graphicPixels,scenePreview},{buildGraphicSystem,composeDiagram}]=await Promise.all([load('/lib/design-system/diagram-graph.ts'),load('/lib/design-system/diagram-refine.ts'),load('/lib/design-system/reconstruction-browser.ts'),load('/lib/design-system/graphic-components.ts')])
  const pixels=await graphicPixels(url,raw.width,raw.height),graph=recognizedDiagram(refineDiagramGeometry(raw,pixels),'diagnostic-vk-raster',['Arial','Play']);if(pixels.data[3]===0)delete graph.background
  const r={id:'vk-raster',name:'VK',description:'',reason:'Diagnostic',status:'retained',fonts:['Arial','Play'],candidate:{id:'vk-raster',name:'VK',assetId:'diagnostic-vk-raster',sourceIds:[],componentIds:[],slides:[14]},diagram:graph,partsQualification:undefined as unknown}
  const qualification=await qualifyGraphic(r,'diagnostic');r.partsQualification=await qualifyGraphicParts(r,'diagnostic');const system=buildGraphicSystem({results:[r]}),composition=composeDiagram(system,{nodes:[{id:'a',text:'Заявка'},{id:'b',text:'Проверка'},{id:'c',text:'Решение'}],edges:[{from:'a',to:'b'},{from:'b',to:'c'}]})
  return {qualification,partsQualification:r.partsQualification,system,graph,restored:await scenePreview(graphElements(graph),graph.width,graph.height,'diagnostic'),composed:await scenePreview(graphElements(composition),composition.width,composition.height,'diagnostic'),nodes:composition.nodes.length}
 },{raw,url:`data:image/png;base64,${png.toString('base64')}`})
 expect(result.system.components.length).toBeGreaterThan(2);expect(result.nodes).toBe(3)
 await fs.writeFile(`${dir}/raster-restored.png`,Buffer.from(result.restored.split(',')[1],'base64'));await fs.writeFile(`${dir}/new-composition.png`,Buffer.from(result.composed.split(',')[1],'base64'))
 await fs.writeFile(`${dir}/raster-graph.json`,JSON.stringify(result.graph,null,2));await fs.writeFile(`${dir}/raster-qualification.json`,JSON.stringify(result.qualification,null,2));await fs.writeFile(`${dir}/raster-parts.json`,JSON.stringify({report:result.partsQualification,system:result.system},null,2))
})
