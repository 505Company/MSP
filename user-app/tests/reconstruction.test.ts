import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {XMLParser} from 'fast-xml-parser'
import {diagramRecognitionSchema,recognizedDiagram,graphElements,validateGraph,graphicHtml} from '../lib/design-system/diagram-graph'
import {recoverPatternPixels} from '../lib/design-system/pattern-recovery'
import {primitiveContains,assemblePattern,scalePath,patternSvg,observedGap} from '../lib/design-system/pattern-geometry'
import {patternGeometrySchema,type PatternDefinition} from '../lib/design-system/pattern-contract'
import {parseSceneElements} from '../vendor/drag/src/core/page-ir'
import {writeEditablePptx} from '../lib/slides/pptx'
import {flatten} from '../lib/design-system/compiler'
import {reconstructedLibrary} from '../lib/design-system/reconstruction-resources'
import type {ComponentDefinition,ComponentLibrary} from '../lib/design-system/types'
const recognition={kind:'diagram',name:'Схема',description:'Процесс',width:400,height:240,background:'#ffffff',nodes:[{id:'a',bounds:{x:20,y:20,width:100,height:60},shape:'capsule',fill:'#0077ff',stroke:null,strokeWidth:0,text:'Начало',textColor:'#ffffff',fontSize:18,font:'Arial'},{id:'b',bounds:{x:260,y:140,width:100,height:60},shape:'rectangle',fill:'#ff3985',stroke:null,strokeWidth:0,text:'Результат',textColor:'#ffffff',fontSize:18,font:'Arial'}],edges:[{id:'ab',from:{nodeId:'a',u:1,v:.5},to:{nodeId:'b',u:0,v:.5},points:[{x:120,y:50},{x:200,y:50},{x:200,y:170},{x:260,y:170}],arrow:'end',color:'#000000',width:1}],patches:[],uncertain:[]}
function component(elements:ComponentDefinition['scene']['elements'],width=400,height=240):ComponentDefinition{return {id:'test',name:'Образец',kind:'compound',source:{slide:1,rootId:'test',elementIds:flatten(elements).map(e=>e.id),ancestorIds:[],assetIds:[]},scene:{width,height,elements},slots:[],fixedTextIds:[],issues:[],semantics:[]}}
function pixels(){const width=240,height=160,data=new Uint8ClampedArray(width*height*4),p={kind:'rounded' as const,corners:[0,0,.5,.5] as [number,number,number,number]};for(const item of [{x:10,y:10,w:60,h:60,c:[255,0,80]},{x:90,y:10,w:60,h:60,c:[0,180,230]},{x:170,y:10,w:60,h:60,c:[255,255,255]}])for(let y=item.y;y<item.y+item.h;y++)for(let x=item.x;x<item.x+item.w;x++)if(primitiveContains(p,x-item.x+.5,y-item.y+.5,item.w,item.h))data.set([...item.c,255],(y*width+x)*4);return {width,height,data}}
function pattern():PatternDefinition{const result=recoverPatternPixels(pixels());assert.ok(result.geometry,result.reason);patternGeometrySchema.parse(result.geometry);return {...result.geometry,origin:'reconstructed',rules:{gapRatio:observedGap(result.geometry),rotations:[0,90,180,270],allowRecolor:true,basis:'observed'}}}
test('connected graph moves a block, reroutes the arrow, preserves text and exports separate PPTX shapes',async()=>{
 const g=recognizedDiagram(recognition,'asset',['Arial']);assert.equal(g.nodes.length,2)
 const original=graphElements(g),moved=graphElements(g,{nodes:{a:{y:40}},texts:{'a-text':'Старт'}})
 parseSceneElements(moved);const line=moved.find(e=>e.id==='ab')!;assert.equal(line.bounds.y,70);assert.ok(line.kind==='path'&&line.pathData?.endsWith('L 140 100'))
 assert.equal(flatten(moved).find(e=>e.id==='a-text')?.kind,'text');assert.notDeepEqual(original,moved);assert.equal(g.nodes[0].bounds.y,20)
 assert.throws(()=>graphElements(g,{nodes:{b:{x:399}}}),/вне схемы/)
 const zip=await JSZip.loadAsync(await writeEditablePptx(component(moved),[])),xml=await zip.file('ppt/slides/slide1.xml')!.async('string'),parsed=new XMLParser().parse(xml)
 assert.ok(parsed['p:sld']);assert.match(xml,/Старт/);assert.match(xml,/Результат/);assert.equal((xml.match(/<p:sp>/g)??[]).length,7);assert.equal(Object.keys(zip.files).filter(p=>p.includes('media/')).length,0)
})
test('diagram contracts reject invented references, executable markup fields, duplicate IDs and invalid geometry',()=>{
 assert.throws(()=>recognizedDiagram({...recognition,edges:[{...recognition.edges[0],to:{nodeId:'missing',u:0,v:0}}]},'',[]),/Разорванная/)
 assert.equal(diagramRecognitionSchema.safeParse({...recognition,html:'<script/>'}).success,false)
 const g=recognizedDiagram(recognition,'',[]);g.nodes[1].id='a';assert.throws(()=>validateGraph(g),/Повторяющиеся/)
 const html=graphicHtml(graphElements(recognizedDiagram({...recognition,nodes:recognition.nodes.map(n=>({...n,text:'<script>alert(1)</script>'}))},'',[])),400,240,'');assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/)
})
test('simple raster pattern deduplicates recoloured pieces and creates native geometry for different areas',async()=>{
 const p=pattern();assert.equal(p.parts.length,1);assert.equal(p.instances.length,3);assert.ok(p.quality!.foregroundIou>.98)
 for(const size of [{width:800,height:300},{width:300,height:800}]){const elements=assemblePattern(p,{...size,mode:'fill',seed:2});parseSceneElements(elements);assert.ok(elements.length>3);assert.ok(elements.every(e=>e.kind==='path'));const zip=await JSZip.loadAsync(await writeEditablePptx(component(elements,size.width,size.height),[]));assert.equal(Object.keys(zip.files).filter(p=>p.includes('media/')).length,0)}
 assert.throws(()=>assemblePattern(p,{width:600,height:200,palette:['#123456']}),/не разрешены/)
 assert.throws(()=>scalePath('M0 0 L0 2 "><script>',1,1),/Неподдержанный/)
 assert.ok(patternSvg(p,{width:300,height:200}).includes('data-pattern-part'))
})
test('photographic palette and unsupported isolated shapes stay raster',()=>{
 const data=new Uint8ClampedArray(128*128*4);for(let i=0;i<data.length;i+=4)data.set([(i/4)%256,Math.floor(i/512)%256,(i*31)%256,255],i)
 assert.equal(recoverPatternPixels({width:128,height:128,data}).geometry,null)
 const p=pixels();p.data.fill(0);assert.equal(recoverPatternPixels(p).geometry,null)
})
test('only verified reconstruction replaces a generation resource; source library stays unchanged',()=>{
 const p=pattern(),c=component([{id:'raster',name:'Source',kind:'raster',bounds:{x:0,y:0,width:240,height:160},rotation:0,opacity:1,visible:true,zIndex:0,assetId:'image',reason:'source'}]),library={components:[c]} as ComponentLibrary
 const result={id:'r',status:'ready' as const,name:'Pattern',description:'Pattern',reason:'',candidate:{id:'r',name:'Pattern',sourceIds:[],componentIds:['test'],slides:[1]},pattern:p}
 const catalog={version:'graphic-reconstruction-1',id:'catalog',sourceCatalogId:'source',editableCatalogId:'editable',results:[result]}
 assert.equal(reconstructedLibrary(library,{...catalog,results:[{...result,status:'retained'}]}).components[0].scene.elements[0].kind,'raster')
 assert.equal(reconstructedLibrary(library,catalog).components[0].source.assetIds.length,0)
 assert.equal(reconstructedLibrary(library,catalog).components[0].pattern,p);assert.equal(library.components[0].scene.elements[0].kind,'raster')
})

test('repeated rasterisations share an alphabet while distinct shapes remain separate',async()=>{
 const {samePatternFamily}=await import('../lib/design-system/pattern-families')
 const a=pattern(),b=structuredClone(a);const primitive=b.parts[0].primitive!;if(primitive.kind==='rounded')primitive.corners=[0,0,.49,.49];b.parts[0].aspect*=1.01
 assert.equal(samePatternFamily(a,b),true);b.parts[0].primitive={kind:'ellipse'};assert.equal(samePatternFamily(a,b),false)
})
test('source patches may be graph nodes, but unknown references and out-of-image routes fail',()=>{
 const d={...recognition,nodes:recognition.nodes.map(n=>({...n,text:'Первая\\nВторая'})),patches:[{id:'icon',nodeId:'image-node',bounds:{x:340,y:20,width:50,height:50}}],edges:[{...recognition.edges[0],to:{nodeId:'image-node',u:0,v:.5}}]}
 const graph=recognizedDiagram(d,'source-image',['Arial']);assert.equal(graph.nodes.length,3);assert.equal(flatten(graph.nodes[0].elements).find(e=>e.kind==='text')?.text,'Первая\nВторая')
 assert.ok(flatten(graph.nodes[2].elements).some(e=>e.kind==='raster'));assert.ok(!graphicHtml(graphElements(graph),400,240,'source').includes('clip-0'))
 assert.throws(()=>recognizedDiagram({...recognition,edges:[{...recognition.edges[0],points:[{x:120,y:50},{x:600,y:170}]}]},'',['Arial']),/ребро/)
})
test('native source connectors infer direction from the path and preserve the unmodified scene',async()=>{
 const {readSourceScene}=await import('../lib/design-system/source-scene'),{nativeDiagramGraph}=await import('../lib/design-system/diagram-native')
 const base={rotation:0,opacity:1,visible:true,zIndex:0},fill={type:'solid',color:{r:0,g:.5,b:1,a:1}}
 const source:import('../lib/digital-designer/source-types').SourceSnapshot={schemaVersion:1,sourceId:'source',name:'Native',slideCount:1,slides:[{id:'s1',number:1,width:300,height:100,part:'slide1',text:'',warnings:[]}],assets:[],colors:[],fonts:[],limitations:[],elements:[{id:'a',slide:1,name:'a',kind:'rectangle',properties:{...base,bounds:{x:0,y:0,width:60,height:50},fill}},{id:'b',slide:1,name:'b',kind:'rectangle',properties:{...base,bounds:{x:200,y:0,width:60,height:50},fill}},{id:'line',slide:1,name:'line',kind:'path',properties:{...base,bounds:{x:65,y:25,width:130,height:0},windingRule:'NONZERO',pathData:'M130 0 L0 0',stroke:{paint:fill,width:1}}}]}
 const graph=nativeDiagramGraph(readSourceScene(source),['a','b','line']);assert.ok(graph);assert.equal(graph.edges[0].from.nodeId,'b');assert.equal(graph.edges[0].to.nodeId,'a');assert.deepEqual(graphElements(graph),graph.sourceElements)
 assert.throws(()=>graphElements(graph,{nodes:{a:{x:-10}}}),/вне схемы/)
})
test('working components survive a rejected source composition and assemble a different diagram from data',async()=>{
 const {graphicParts,buildGraphicSystem,GRAPHIC_COMPONENTS_VERSION,composeDiagram,instantiateGraphicPart}=await import('../lib/design-system/graphic-components'),{dataMaterial}=await import('../lib/presentations/data-material'),{bindDataMaterial}=await import('../lib/presentations/data-assembly')
 const r:import('../lib/design-system/reconstruction-contract').ReconstructionResult={id:'recovered',name:'Source',description:'',status:'retained',reason:'Whole composition differs',candidate:{id:'recovered',name:'Source',sourceIds:[],componentIds:[],slides:[1]},diagram:recognizedDiagram(recognition,'',['Arial'])}
 const parts=graphicParts(r);r.partsQualification={version:GRAPHIC_COMPONENTS_VERSION,checks:parts.map(p=>({id:p.id,passed:true,changed:true,issues:[]}))}
 const system=buildGraphicSystem({results:[r]});assert.equal(system.groups.length,1);assert.equal(system.compositions[0].complete,true);assert.ok(system.components.some(p=>p.role==='connector'));assert.equal(system.components.filter(p=>p.role==='block').length,2)
 const data={nodes:[{id:'one',text:'Вход'},{id:'two',text:'Обработка'},{id:'three',text:'Результат 73'}],edges:[{from:'one',to:'two'},{from:'two',to:'three'}]},g=composeDiagram(system,data);assert.equal(g.nodes.length,3);assert.equal(g.edges.length,2)
 const scene=graphElements(g);parseSceneElements(scene);assert.deepEqual(flatten(scene).filter(e=>e.kind==='text').map(e=>e.text),data.nodes.map(n=>n.text));const cyclic=composeDiagram(system,{...data,edges:[...data.edges,{from:'three',to:'one'}]});assert.equal(cyclic.edges.length,3);parseSceneElements(graphElements(cyclic));assert.throws(()=>composeDiagram(system,{...data,edges:[{from:'missing',to:'one'}]}),/Некорректные/)
 const connector=system.components.find(p=>p.role==='connector')!;assert.ok(connector.palette.includes('#000000'));const recolored=instantiateGraphicPart(connector,{width:300,height:40,color:'#000000'});assert.ok(recolored.elements.some(e=>'stroke' in e&&e.stroke?.paint.color.r===0));
 const block=system.components.find(p=>p.role==='block')!;assert.throws(()=>instantiateGraphicPart(block,{width:200,height:80,color:'#012345'}),/палитры/)
 const material=dataMaterial(JSON.stringify({...data,title:'Новая схема'}))![0],bound=bindDataMaterial(material,[],system,'upload');assert.equal(bound[0].template.kind,'diagram');assert.equal(bound[0].template.diagramGraph?.nodes.length,3)
 r.diagram!.sourceSurface='#161616';assert.equal(composeDiagram(buildGraphicSystem({results:[r]}),data).sourceSurface,'#161616')
 r.partsQualification.checks.find(c=>c.id.includes('connector'))!.passed=false;assert.throws(()=>composeDiagram(buildGraphicSystem({results:[r]}),data),/проверенных блоков и связей/)
})
test('a local geometry revision reuses model evidence, while a different source gets its own input cache',async()=>{
 const {recognitionPrefix}=await import('../lib/design-system/reconstruction'),{memoryBucket}=await import('./helpers/memory-bucket'),{bucket}=memoryBucket()
 const root='reconstructions/upload/graphic-reconstruction-1',key=root+'/old-revision/catalogs/old.json'
 await bucket.put(root+'/current.json',JSON.stringify({key}));await bucket.put(key,JSON.stringify({sourceCatalogId:'source',results:[{id:'image',modelRunId:'run'}]}))
 assert.equal(await recognitionPrefix(bucket,'upload','source','image'),root+'/old-revision/models/image')
 assert.equal(await recognitionPrefix(bucket,'upload','new-source','image'),root+'/models/image')
})
