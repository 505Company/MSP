import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSourceSystem, planSourceScan } from '../lib/design-system/source-system'
import { readSourceScene, nativeListMarker } from '../lib/design-system/source-scene'
import { compileLibrary, flatten, instantiateComponent } from '../lib/design-system/compiler'
import { sourceSystem } from '../lib/design-system/source-system-storage'
import { initializeCatalog, getCatalogComponent } from '../lib/design-system/catalog'
import { memoryBucket } from './helpers/memory-bucket'
import { compileLibrary as compileV1 } from '../lib/design-system/compiler-v1'
import { contentHash } from '../lib/design-system/catalog'
import type { SourceSnapshot, SourceElement } from '../lib/digital-designer/source-types'
import type { DesignAnalysis } from '../lib/digital-designer/design-analysis'
import { typographyStyleHint } from '../lib/design-system/source-typography'

const element=(id:string,kind:string,parentId?:string,properties:Record<string,unknown>={}):SourceElement=>({id,kind,parentId,slide:1,name:id,properties:{bounds:{x:0,y:0,width:100,height:40},rotation:0,opacity:1,visible:true,zIndex:0,...properties}})
const text=(id:string,value:string,parentId?:string,properties:Record<string,unknown>={})=>element(id,'text',parentId,{text:value,fontFamily:'Arial',fontSize:20,...properties})
const blue={type:'solid',color:{r:0,g:.5,b:1,a:1}}
function fixture():SourceSnapshot{return {schemaVersion:1,sourceId:'a'.repeat(64),name:'Source rules',slideCount:1,slides:[{id:'s01',number:1,width:960,height:540,part:'ppt/slides/slide1.xml',text:'',warnings:[]}],assets:[],colors:[],fonts:[],limitations:[],elements:[element('root','group',undefined,{bounds:{x:20,y:20,width:400,height:200}}),element('fill','rectangle','root',{fill:blue}),text('copy','Рабочий текст','root',{bounds:{x:120,y:0,width:200,height:40},fontStyle:'Bold'})]}}
const analysis=(snapshot:SourceSnapshot,findings:Partial<DesignAnalysis['findings'][number]>[]):DesignAnalysis=>({schemaVersion:1,sourceId:snapshot.sourceId,summary:'Candidates',findings:findings.map((f,i)=>({id:`finding-${i}`,categoryId:'C01',name:'Исходная конструкция',kind:'molecule',value:'Из источника',role:'Кандидат',confidence:.9,reviewStatus:'candidate',transforms:{allowed:[],forbidden:[],unknown:[]},evidence:{basis:'visual_observation',slideIds:['s01'],assetIds:[],elementIds:['fill','copy']},...f})),coverage:[],uncertainties:[],photoStyle:{status:'insufficient_evidence',variants:[],limitations:[]}})

test('typography merges text-box wrapping and fitting variants without changing source layout or losing uses',()=>{
  const source=fixture()
  const common={fontFamily:'Example Sans',fontSize:40,paragraphs:[{start:0,end:6,fontSize:40,align:'LEFT',left:0,right:0,indent:0,before:0,after:0,lineHeight:{unit:'PIXELS',value:44.946666666666665}}]}
  source.elements=[
    text('wrapped','Пример',undefined,{...common,textBox:{align:'LEFT',vertical:'TOP',wrap:true},flow:{columns:1,gap:0,autoFit:'SHRINK'}}),
    text('unwrapped','Пример',undefined,{...common,textBox:{align:'LEFT',vertical:'CENTER',wrap:false},flow:{columns:2,gap:12,autoFit:'NONE'}}),
  ]
  const before=JSON.stringify(source),system=buildSourceSystem(source),styles=system.styles.filter(s=>s.kind==='typography')
  assert.equal(system.ledger.some(row=>row.status==='invalid'),false)
  assert.equal(styles.length,1)
  assert.equal(styles[0].name,'Example Sans Regular · 30 pt')
  assert.deepEqual(styles[0].occurrences.map(o=>o.elementId),['wrapped','unwrapped'])
  assert.ok(system.ledger.every(row=>row.styleIds.includes(styles[0].id)))
  assert.equal(JSON.stringify(source),before)
  assert.deepEqual(system.scan.batches.flatMap(b=>b.nodes).map(n=>n.properties.textBox),source.elements.map(e=>e.properties.textBox))
})

test('typography ignores float noise and explicit defaults but retains authored size changes',()=>{
  const source=fixture()
  source.elements=[text('a','Пример'),text('b','Пример',undefined,{fontSize:20.000000000000004,textBox:{align:'LEFT',vertical:'TOP',wrap:false},styleRuns:[{start:0,end:6,fontFamily:'Arial',fontStyle:'Regular',fontSize:20.000000000000004,letterSpacing:0,decoration:'NONE',baselineShift:0}],paragraphs:[{start:0,end:6,fontSize:20,align:'LEFT',left:0,right:0,indent:0,before:0,after:0,markerLength:2,tabs:[]}]}),text('c','Пример',undefined,{fontSize:20.01})]
  const styles=buildSourceSystem(source).styles.filter(s=>s.kind==='typography')
  assert.equal(styles.length,2)
  assert.equal(styles[0].occurrences.length,2)
  assert.notEqual(styles[0].value.fontSize,styles[1].value.fontSize)
})

test('real typography differences remain distinct and have visible descriptions including fixed line spacing',()=>{
  const source=fixture(),paragraph={start:0,end:6,fontSize:20,align:'LEFT',left:0,right:0,indent:0,before:0,after:0,lineHeight:{unit:'PIXELS',value:32}}
  const variants=[{}, {paragraphs:[{...paragraph,lineHeight:{unit:'PIXELS',value:33}}]}, {paragraphs:[{...paragraph,align:'CENTER'}]}, {paragraphs:[{...paragraph,after:4}]},
    ...[{letterSpacing:1},{decoration:'UNDERLINE'},{baselineShift:.3}].map(run=>({styleRuns:[{start:0,end:6,fontFamily:'Arial',fontSize:20,fontStyle:'Regular',...run}]}))]
  source.elements=variants.map((props,i)=>text(`v${i}`,'Пример',undefined,{paragraphs:[paragraph],...props}))
  const styles=buildSourceSystem(source).styles.filter(s=>s.kind==='typography')
  assert.equal(styles.length,variants.length)
  assert.equal(new Set(styles.map(s=>typographyStyleHint(s.value))).size,styles.length)
  assert.match(typographyStyleHint(styles[0].value),/Интерлиньяж 24 pt/)
  assert.match(typographyStyleHint(styles[1].value),/Интерлиньяж 24,75 pt/)
})

test('all source records survive; styles exclude hidden/off-slide helpers and retain exact paint, runs and paragraphs',()=>{
  const source=fixture(),copy=source.elements[2]
  copy.properties.styleRuns=[{start:0,end:7,fontFamily:'Arial',fontStyle:'Bold',fontSize:20},{start:7,end:13,fontFamily:'Play',fontStyle:'Italic',fontSize:24,letterSpacing:1.2}]
  copy.properties.paragraphs=[{start:0,end:13,align:'LEFT',left:0,right:0,indent:0,before:5,after:7,fontSize:20,lineHeight:{unit:'PERCENT',value:120}}]
  source.elements.push(element('hidden','rectangle','root',{visible:false,fill:{...blue,color:{r:1,g:0,b:0,a:1}}}),element('outside','rectangle',undefined,{bounds:{x:0,y:-100,width:50,height:20},fill:{...blue,color:{r:0,g:1,b:0,a:1}}}),element('aux','source-picture',undefined,{assetId:'not-a-drawable-node'}))
  const before=JSON.stringify(source),system=buildSourceSystem(source)
  assert.equal(JSON.stringify(source),before)
  assert.equal(system.ledger.length,source.elements.length)
  assert.equal(system.ledger.find(l=>l.elementId==='hidden')?.status,'hidden')
  assert.equal(system.ledger.find(l=>l.elementId==='outside')?.status,'outside-slide')
  assert.equal(system.ledger.find(l=>l.elementId==='aux')?.status,'source-resource')
  assert.deepEqual(system.styles.filter(s=>s.kind==='fill').map(s=>s.name),['#0080FF'])
  const italic=system.styles.find(s=>s.kind==='typography'&&s.value.fontStyle==='Italic')!
  assert.equal(italic.value.fontFamily,'Play');assert.equal(italic.value.letterSpacing,1.2)
  assert.deepEqual(italic.value.paragraph,{align:'LEFT',left:0,right:0,indent:0,before:5,after:7,lineHeight:{unit:'PERCENT',value:120}})
  assert.deepEqual(italic.occurrences,[{elementId:'copy',slide:1,start:7,end:13}])
})
test('full native tables keep their parts in the ledger without offering editable cell constructions',()=>{
  const source=fixture()
  source.elements.push(element('appearance','group',undefined,{bounds:{x:0,y:250,width:300,height:100},tableGrid:{rowHeights:[50,50],containers:['table'],rows:['row1','row2'],cells:[{id:'cell1',row:0,rowSpan:1},{id:'cell2',row:1,rowSpan:1}]}}),element('table','table','appearance'),element('row1','group','table'),element('row2','group','table'),element('cell1','group','row1'),element('cell2','group','row2'),text('t1','10','cell1'),text('t2','20','cell2'))
  const system=buildSourceSystem(source)
  assert.equal(system.summary.tables,1)
  assert.ok(system.constructions.some(c=>c.rootId==='appearance'&&c.kind==='table'&&c.slotIds.length===0))
  assert.ok(!system.constructions.some(c=>c.rootId==='cell1'||c.rootId==='table'))
  assert.equal(system.ledger.find(r=>r.elementId==='t1')?.status,'table-part')
  assert.ok(!system.scan.suppliedIds.includes('t1'))
  const large=structuredClone(source)
  for(let i=0;i<251;i++)large.elements.push(text(`large-${i}`,'Данные','cell1'))
  const limited=buildSourceSystem(large),whole=limited.constructions.find(c=>c.rootId==='appearance')!
  assert.equal(whole.available,false)
  assert.ok(whole.elementIds.includes('large-250'))
  assert.ok(limited.ledger.find(r=>r.elementId==='large-250')!.componentIds.includes(whole.id))
  assert.ok(!limited.constructions.some(c=>c.rootId==='cell1'))
  source.elements.find(e=>e.id==='appearance')!.properties.tableGrid={rowHeights:[50],containers:['missing'],rows:[],cells:[]}
  const invalid=buildSourceSystem(source)
  assert.equal(invalid.summary.tables,0)
  assert.equal(invalid.ledger.find(r=>r.elementId==='t1')?.status,'invalid')
})
test('numbers remain content; a native bullet needs matching paragraph provenance and geometry',()=>{
  const source=fixture(),number=text('number','43','root')
  const bullet=text('bullet','•','root',{bounds:{x:0,y:70,width:10,height:20}});bullet.name='List marker 1'
  const paragraph=text('paragraph','Полный пункт','root',{bounds:{x:20,y:70,width:200,height:30}});paragraph.name='Paragraph 1'
  source.elements.push(number,bullet,paragraph)
  const scene=readSourceScene(source)
  assert.equal(nativeListMarker(scene.records.get('bullet')!,scene),true)
  const root=compileLibrary(source).components.find(c=>c.source.rootId==='root')!
  assert.ok(root.slots.some(s=>s.id==='number'))
  assert.ok(!root.slots.some(s=>s.id==='bullet'))
  assert.match(root.fixedTextReasons!.bullet,/маркер/)
  paragraph.name='Другой текст';const changed=compileLibrary(source).components.find(c=>c.source.rootId==='root')!
  assert.ok(changed.slots.some(s=>s.id==='bullet'))
})
test('model-specified graphic text and direct measured rule text stay fixed; unrelated findings do not grant control',()=>{
  const source=fixture(),model=analysis(source,[{kind:'asset',evidence:{basis:'visual_observation',slideIds:['s01'],assetIds:[],elementIds:['root']}}])
  assert.equal(compileLibrary(source,model).components.find(c=>c.source.rootId==='root')!.slots.length,0)
  const wrong={...model,sourceId:'b'.repeat(64)}
  assert.equal(compileLibrary(source,wrong).components.find(c=>c.source.rootId==='root')!.slots.length,1)
  const rule=analysis(source,[{kind:'rule',evidence:{basis:'measured',slideIds:['s01'],assetIds:[],elementIds:['copy']}}])
  assert.equal(compileLibrary(source,rule).components.find(c=>c.source.rootId==='root')!.slots.length,0)
  assert.equal(buildSourceSystem(source,rule).rules[0].sourceTexts[0].text,'Рабочий текст')
})
test('explicit ungrouped source parts become a usable construction without pulling in unrelated siblings',()=>{
  const source=fixture();source.elements.push(text('unrelated','Постороннее содержание','root'))
  const model=analysis(source,[]);model.findings=analysis(source,[{}]).findings
  const library=compileLibrary(source,model),assembled=library.components.find(c=>c.id==='asm-1')!
  assert.ok(assembled);assert.deepEqual(assembled.source.elementIds,['fill','copy'])
  assert.ok(!flatten(assembled.scene.elements).some(e=>e.id==='unrelated'))
  const instance=instantiateComponent(assembled,{copy:'Новое содержание'})
  assert.ok(flatten(instance.elements).some(e=>e.kind==='text'&&e.text==='Новое содержание'))
  assert.equal(flatten(assembled.scene.elements).find(e=>e.id==='copy')!.bounds.x,120)
  const lazy=compileLibrary(source,model,{componentId:assembled.id}).components[0]
  assert.deepEqual(lazy,assembled)
  source.elements.find(e=>e.id==='copy')!.parentId=undefined
  const unsupported=compileLibrary(source,model)
  assert.ok(!unsupported.components.some(c=>c.id==='asm-1'))
  assert.equal(unsupported.assemblyIssues![0].findingId,model.findings[0].id)
  assert.ok(unsupported.components.length>0)
})
test('a multi-layer graphic atom retains all explicit parts and safe IDs without absorbing text',()=>{
  const source=fixture();source.elements.push(element('glyph','ellipse','root',{bounds:{x:20,y:10,width:20,height:20},fill:blue}))
  const model=analysis(source,[{id:'Составной значок / 1',kind:'asset',evidence:{basis:'visual_observation',slideIds:['s01'],assetIds:[],elementIds:['fill','glyph']}}])
  const atom=compileLibrary(source,model).components.find(c=>c.id==='asm-1')!
  assert.ok(atom);assert.equal(atom.kind,'atom');assert.deepEqual(atom.source.elementIds,['fill','glyph'])
  assert.equal(atom.slots.length,0);assert.equal(atom.semantics[0].findingId,'Составной значок / 1')
  model.findings[0].evidence.elementIds.push('copy')
  assert.ok(!compileLibrary(source,model).components.some(c=>c.id==='asm-1'))
})
test('complete bounded scan retains long text and local ancestor transforms; oversize input is explicit pending',()=>{
  const source=fixture();source.elements[2].properties.text='Полный текст '.repeat(120)
  source.elements.push(text('huge','Д'.repeat(20000),'root'))
  const scene=readSourceScene(source),scan=planSourceScan(scene,[],8000,1)
  assert.equal(scan.pending.length,1);assert.equal(scan.pending[0].elementId,'huge')
  assert.ok(scan.omittedContainerIds.includes('root'))
  const batch=scan.batches.find(b=>b.nodes.some(n=>n.id==='copy'))!
  assert.equal(batch.nodes[0].properties.text,source.elements[2].properties.text)
  assert.equal(batch.nodes[0].parentId,'root')
  assert.deepEqual(batch.context[0].properties.bounds,source.elements[0].properties.bounds)
  for(const b of scan.batches){assert.ok(b.bytes<=8000);assert.equal(b.nodes.length,1);const ids=new Set([...b.nodes,...b.context].map(n=>n.id));assert.ok(b.nodes.every(n=>!n.parentId||ids.has(n.parentId)))}
  assert.equal(new Set(scan.suppliedIds).size,scan.suppliedIds.length)
})
test('many styles, repeated texts and different crops keep every occurrence without 120/150 truncation',()=>{
  const source=fixture();source.elements=[]
  for(let i=0;i<181;i++)source.elements.push(text(`text-${i}`,'Повтор',undefined,{fontSize:10+i/10}))
  source.assets=[{id:'asset-1',mime:'image/png',byteLength:10,origins:['ppt/media/image1.png']}]
  source.elements.push(element('image-a','source-picture',undefined,{assetId:'asset-1',crop:{left:0,right:.2}}),element('image-b','source-picture',undefined,{assetId:'asset-1',crop:{left:.2,right:0}}))
  const system=buildSourceSystem(source)
  assert.equal(system.styles.filter(s=>s.kind==='typography').length,181)
  assert.equal(system.texts.length,1);assert.equal(system.texts[0].occurrences.length,181)
  assert.equal(system.resources[0].placements.length,2)
  assert.notDeepEqual(system.resources[0].placements[0].properties.crop,system.resources[0].placements[1].properties.crop)
})
test('derived system is idempotent, content-bound and never rewrites component definitions',async()=>{
  const source=fixture(),{bucket,data}=memoryBucket()
  await initializeCatalog(bucket,'job',source)
  const component=await getCatalogComponent(bucket,'job','cmp-root')
  const first=await sourceSystem(bucket,'job',source),second=await sourceSystem(bucket,'job',source)
  assert.deepEqual(first,second)
  assert.equal([...data.keys()].filter(k=>k.startsWith('source-systems/')).length,1)
  source.elements[2].properties.fontStyle='Italic'
  assert.notEqual((await sourceSystem(bucket,'job',source)).derivationId,first.derivationId)
  assert.deepEqual(await getCatalogComponent(bucket,'job','cmp-root'),component)
})
test('an existing v2 catalog lazily loads its original compiler and the system reports those same definitions',async()=>{
  const snapshot=fixture();snapshot.elements.push(text('number','01','root'))
  const library=compileV1(snapshot),source={snapshot,analysis:null,legacy:null},id=await contentHash({version:'web-catalog-2',source}),{bucket}=memoryBucket()
  const index={id,version:'web-catalog-2',name:snapshot.name,notes:[],items:library.components.map(c=>({id:c.id,name:c.name,kind:c.kind,slide:c.source.slide,elementCount:c.source.elementIds.length,slotCount:c.slots.length,text:'',repeatCount:1,available:true,status:'candidate'}))}
  await bucket.put(`component-catalogs/job/${id}/source.json`,JSON.stringify(source))
  await bucket.put(`component-catalogs/job/${id}/index.json`,JSON.stringify(index))
  await bucket.put('component-catalogs/job/current.json',JSON.stringify({catalogId:id}))
  const old=await getCatalogComponent(bucket,'job','cmp-root')
  assert.deepEqual(old.component,library.components.find(c=>c.id==='cmp-root'))
  assert.ok(old.component.fixedTextIds.includes('number'))
  const report=await sourceSystem(bucket,'job',snapshot)
  assert.ok(report.system.constructions.find(c=>c.id==='cmp-root')!.fixedTextIds.includes('number'))
  assert.equal((await getCatalogComponent(bucket,'job','cmp-root')).definitionId,old.definitionId)
  assert.ok(compileLibrary(snapshot).components.find(c=>c.id==='cmp-root')!.slots.some(s=>s.id==='number'))
})
test('a failed slide is reported as incomplete even when no missing native nodes exist in the snapshot',()=>{
  const source=fixture();source.elements=[]
  source.slides[0].warnings=['normalized-page-unavailable (invalid-file): неполный разбор']
  source.slides[0].text='Полный исходный текст сохранён'
  const result=buildSourceSystem(source)
  assert.equal(result.summary.records,0)
  assert.equal(result.summary.incompleteSlides,1)
  assert.deepEqual(result.incompleteSlideNumbers,[1])
  assert.equal(source.slides[0].text,'Полный исходный текст сохранён')
})
