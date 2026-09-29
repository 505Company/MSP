import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeLayoutFixture,sourceText} from './fixtures/native-layout'
import {compileEditableProposal,groupEditableTemplates} from '../lib/design-system/editable-source'
import {renderEditableHtml} from '../lib/design-system/editable-render'
import {prepareEditableBlocks} from '../lib/design-system/editable-structure'
import {readSourceScene} from '../lib/design-system/source-scene'
import {initializeCatalog,listCatalog,getCatalogComponent,catalogLibrary} from '../lib/design-system/catalog'
import {CALIBRATION_VERSION,QUALIFICATION_VERSION,FUNCTIONAL_SELECTION_VERSION} from '../lib/design-system/calibration-contract'
import {buildSourceSystem} from '../lib/design-system/source-system'
import {memoryBucket} from './helpers/memory-bucket'

test('a feature preserves source layout, every text field and a contained icon omitted by the model',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 snapshot.elements.push({id:'marker',slide:1,name:'Marker',kind:'ellipse',properties:{bounds:{x:155,y:20,width:20,height:20},visible:true,opacity:1,rotation:0,zIndex:3,fill:{type:'solid',color:{r:1,g:1,b:1,a:1}}}})
 const feature={...proposal,kind:'feature' as const,data:{text:'Текст'}}
 const compiled=compileEditableProposal(feature,1,snapshot,'job',[])
 assert.ok(compiled.sourceLayout,'source geometry must replace the generic icon/paragraph renderer')
 assert.match(renderEditableHtml(compiled),/data-source-object="marker"/)
 assert.equal(compiled.sourceLayout.text[0].element.colorRuns?.[0].fill.color.r,0)
 assert.match(renderEditableHtml(compiled,{text:'Изменено'}),/Изменено/)
})

test('cards separate from external callouts and source evidence stays unchanged',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 snapshot.elements[0].properties.bounds={x:0,y:0,width:220,height:300}
 snapshot.elements.push(sourceText('number','07',10,110,150,70,60),sourceText('body','Длинное пояснение',10,200,170,80,20),sourceText('footnote','    рост показателя',10,330,200,60,20),{id:'badge',slide:1,name:'Image',kind:'raster',properties:{bounds:{x:10,y:327,width:70,height:25},assetId:'test-asset',reason:'source-image',visible:true,opacity:1,rotation:0,zIndex:3}})
 const b={...proposal,kind:'feature' as const,sourceIds:snapshot.elements.map(e=>e.id),data:{title:'07',text:'Текст',value:'Длинное пояснение'}}
 const before=structuredClone(b),blocks=prepareEditableBlocks([b],1,readSourceScene(snapshot))
 assert.equal(blocks.length,2);assert.deepEqual(b,before)
 assert.ok(!blocks[0].sourceIds.includes('footnote'));assert.ok(blocks[1].sourceIds.includes('badge'))
 assert.equal(compileEditableProposal(blocks[0],1,snapshot,'job',[]).height,300)
})

test('component gallery routes plain text to typography without deleting its definition or styles',async()=>{
 const {snapshot}=nativeLayoutFixture('diagram');snapshot.elements=snapshot.elements.filter(e=>e.kind==='text')
 const {bucket}=memoryBucket();await initializeCatalog(bucket,'job',snapshot)
 assert.equal((await listCatalog(bucket,'job',new URLSearchParams({section:'components'})))!.total,0)
 const raw=await listCatalog(bucket,'job',new URLSearchParams())
 assert.equal(raw!.total,1)
 assert.ok((await getCatalogComponent(bucket,'job',raw!.items[0].id)).component.slots.length)
 assert.ok(buildSourceSystem(snapshot).styles.some(s=>s.kind==='typography'))
})

test('a mixed semantic family cannot use its text-only representative to leak back into components',async()=>{
 const {snapshot}=nativeLayoutFixture('diagram');snapshot.elements=snapshot.elements.filter(e=>e.kind==='text')
 snapshot.elements.push({id:'art',slide:1,name:'Ring',kind:'ellipse',properties:{bounds:{x:300,y:0,width:100,height:60},visible:true,opacity:1,rotation:0,zIndex:1,stroke:{width:2,paint:{type:'solid',color:{r:0,g:0,b:1,a:1}}}}})
 const {bucket}=memoryBucket(),catalogId=await initializeCatalog(bucket,'job',snapshot),{library}=(await catalogLibrary(bucket,'job'))!
 const text=library.components.find(c=>c.source.rootId==='label')!,picture=library.components.find(c=>c.source.rootId==='art')!
 const family={id:'mixed',name:'Показатель',description:'Показатель',kind:'atom',tags:['metric','text'],parameters:[],memberIds:[text.id,picture.id],representativeId:text.id,occurrenceIds:[text.id,picture.id],slides:[1],previewOnDark:false,variants:[text,picture].map(c=>({id:c.id,label:'Образец',memberIds:[c.id],fields:[]}))}
 const root=`component-calibration/job/${catalogId}/${CALIBRATION_VERSION}`
 await bucket.put(`${root}/current.json`,JSON.stringify({id:'fixture'}))
 await bucket.put(`${root}/catalogs/fixture.json`,JSON.stringify({version:CALIBRATION_VERSION,qualificationVersion:QUALIFICATION_VERSION,functionalVersion:FUNCTIONAL_SELECTION_VERSION,id:'fixture',catalogId,families:[family],excluded:[],qualifiedCount:2}))
 assert.equal((await listCatalog(bucket,'job',new URLSearchParams({section:'components'})))!.total,0)
 const graphics=(await listCatalog(bucket,'job',new URLSearchParams({section:'graphics'})))!
 assert.equal(graphics.items[0].id,picture.id)
 assert.deepEqual(graphics.items[0].family?.variants.map(v=>v.id),[picture.id])
 assert.ok((await getCatalogComponent(bucket,'job',text.id)).component.slots.length)
})

test('a recognized metric collection recovers all referenced panels and their captions',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('metric'),base=snapshot.elements[0]
 snapshot.elements=[0,1,2].flatMap(i=>[{...base,id:`panel${i}`,properties:{...base.properties,bounds:{x:i*300,y:0,width:290,height:220}}},sourceText(`v${i}`,`${i+3}%`,i*300+30,20,200,100,60),sourceText(`c${i}`,`Подпись ${i}`,i*300+20,140,240,70,20)])
 const p={...proposal,sourceIds:['panel0','c0'],data:{value:'3%',items:[0,1,2].map(i=>({value:`${i+3}%`,graphicId:`panel${i}`}))}}
 const blocks=prepareEditableBlocks([p],1,readSourceScene(snapshot))
 assert.equal(blocks.length,3)
 blocks.forEach((b,i)=>{assert.ok(b.sourceIds.includes(`c${i}`));assert.ok(b.sourceIds.includes(`v${i}`));assert.equal(b.data.value,`${i+3}%`)})
})

test('splitting metrics preserves explicitly selected captions whose text boxes extend beyond a panel',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('metric'),base=snapshot.elements[0]
 snapshot.elements=[0,1].flatMap(i=>[{...base,id:`panel${i}`,properties:{...base.properties,bounds:{x:i*340,y:0,width:290,height:220}}},sourceText(`v${i}`,`${i+3}%`,i*340+20,20,180,90,60),sourceText(`c${i}`,`Подпись ${i}`,i*340+220,130,100,70,20)])
 snapshot.elements.push(sourceText('neighbour','Чужая подпись',220,205,100,70,20))
 const p={...proposal,sourceIds:['panel0','v0','c0','panel1','v1','c1'],data:{value:'3%',items:[0,1].map(i=>({value:`${i+3}%`,graphicId:`panel${i}`}))}}
 const before=structuredClone(p),blocks=prepareEditableBlocks([p],1,readSourceScene(snapshot))
 assert.equal(blocks.length,2)
 blocks.forEach((b,i)=>{assert.ok(b.sourceIds.includes(`c${i}`));assert.ok(!b.sourceIds.includes('neighbour'));assert.match(renderEditableHtml(compileEditableProposal(b,1,snapshot,'job',[])),new RegExp(`Подпись ${i}`))})
 assert.deepEqual(p,before,'the model reply is immutable')
})

test('an ambiguous selected annotation prevents a lossy metric split',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('metric'),base=snapshot.elements[0]
 snapshot.elements=[0,1].flatMap(i=>[{...base,id:`panel${i}`,properties:{...base.properties,bounds:{x:i*340,y:0,width:290,height:220}}},sourceText(`v${i}`,`${i+3}%`,i*340+20,20,180,90,60)])
 snapshot.elements.push(sourceText('shared-caption','Общее пояснение',220,240,250,70,20))
 const p={...proposal,sourceIds:['panel0','v0','panel1','v1','shared-caption'],data:{value:'3%',items:[0,1].map(i=>({value:`${i+3}%`,graphicId:`panel${i}`}))}}
 const blocks=prepareEditableBlocks([p],1,readSourceScene(snapshot))
 assert.equal(blocks.length,1);assert.ok(blocks[0].sourceIds.includes('shared-caption'))
})

test('decorated bar charts keep interval labels and respond to new numeric series',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram'),panel=snapshot.elements[0]
 snapshot.elements=[0,1].flatMap(i=>[{...panel,id:`bar${i}`,properties:{...panel.properties,bounds:{x:200,y:i*70,width:i?260:400,height:50}}},sourceText(`label${i}`,i?'10–20%':'Более 40%',250,i*70+3,170,44,26),sourceText(`category${i}`,i?'Юг':'Север',0,i*70,180,50,22)])
 const t=compileEditableProposal({...proposal,kind:'chart',style:{font:'Arial'},config:{chartType:'bar',horizontal:true},sourceIds:snapshot.elements.map(e=>e.id),data:{categories:['Север','Юг'],series:[{name:'Рост',values:[40,15]}]}},1,snapshot,'fixture',[])
 assert.equal(t.sourceChart?.rows.length,2)
 assert.equal(t.dataStatus,'estimated','ranges must not be presented as exact midpoint observations')
 const before=renderEditableHtml(t),after=renderEditableHtml(t,{...t.data,series:[{name:'Рост',values:[30,70]}]})
 assert.match(before,/Более 40%/);assert.match(before,/10–20%/)
 assert.match(after,/70%/);assert.match(after,/transform="scale\(/)
 assert.notEqual(before,after)
})

test('structurally different features do not hide each other behind one family',async()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 const badge=compileEditableProposal({...proposal,id:'badge',kind:'feature',data:{text:'Текст'}},1,snapshot,'job',[])
 const cardSnapshot=structuredClone(snapshot)
 cardSnapshot.elements[0].properties.bounds={x:0,y:0,width:200,height:400}
 cardSnapshot.elements.push(sourceText('number','01',10,110,150,90,70),sourceText('body','Объяснение',10,230,170,100,20))
 const card=compileEditableProposal({...proposal,id:'card',kind:'feature',sourceIds:cardSnapshot.elements.map(e=>e.id),data:{title:'01',text:'Текст',value:'Объяснение'}},1,cardSnapshot,'job',[])
 const repeated={...badge,id:'badge2',data:{text:'Другие данные'}}
 const families=await groupEditableTemplates([badge,card,repeated])
 assert.equal(families.length,2)
 assert.ok(families.some(f=>f.variants.some(v=>v.id==='card')))
 assert.equal(families.find(f=>f.variants.some(v=>v.id==='badge'))?.variants.length,2,'all observed instances remain available for qualification and compositions')
 assert.match(renderEditableHtml(card),/Объяснение/)
})

test('diagram family identity preserves distinct native arrangements and typography roles',async()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram')
 const card=compileEditableProposal({...proposal,id:'card'},1,snapshot,'job',[])
 const two=structuredClone(snapshot)
 two.elements.push({...structuredClone(two.elements[0]),id:'second',properties:{...two.elements[0].properties,bounds:{x:250,y:0,width:200,height:100}}},sourceText('second-label','Другой узел',260,10,180,80,22))
 const graph=compileEditableProposal({...proposal,id:'graph',sourceIds:two.elements.map(e=>e.id)},1,two,'job',[])
 const code=structuredClone(card);code.id='code';code.sourceLayout!.text[0].element.fontFamily='JetBrains Mono'
 const copy=structuredClone(card);copy.id='copy';copy.name='Другие слова';copy.data={items:[{text:'Новый текст'}]}
 const families=await groupEditableTemplates([card,graph,code,copy])
 assert.equal(families.length,3,'a text panel, multi-node scheme and code panel must remain discoverable')
 assert.equal(families.find(f=>f.variants.some(v=>v.id==='card'))!.variants.length,2)
})

test('independent native panels survive a broad diagram classification; connectors prevent splitting',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('diagram'),base=snapshot.elements[0]
 snapshot.elements=[0,1,2,3].flatMap(i=>[{...base,id:`p${i}`,properties:{...base.properties,bounds:{x:i%2*300,y:Math.floor(i/2)*250,width:280,height:220}}},sourceText(`h${i}`,`Заголовок ${i}`,i%2*300+20,Math.floor(i/2)*250+20,240,40,28),sourceText(`c${i}`,`Пояснение ${i}`,i%2*300+20,Math.floor(i/2)*250+90,240,80,20)])
 const p={...proposal,sourceIds:snapshot.elements.map(e=>e.id),data:{}},before=structuredClone(p)
 const blocks=prepareEditableBlocks([p],1,readSourceScene(snapshot))
 assert.equal(blocks.filter(b=>b.kind==='feature').length,4);assert.equal(blocks.at(-1)!.kind,'composition');assert.equal(blocks.at(-1)!.config.columns,2);assert.deepEqual(p,before)
 for(const b of blocks.filter(b=>b.kind==='feature'))assert.equal(compileEditableProposal(b,1,snapshot,'job',[]).sourceLayout!.text.length,2)
 snapshot.elements.push({id:'connector',slide:1,name:'Connection',kind:'line',properties:{bounds:{x:260,y:100,width:80,height:2},visible:true,opacity:1,rotation:0,zIndex:5}})
 p.sourceIds.push('connector')
 assert.equal(prepareEditableBlocks([p],1,readSourceScene(snapshot)).length,1)
})
test('caption words are not kept as an invisible independent metric unit',()=>{
 const {snapshot,proposal}=nativeLayoutFixture('metric')
 snapshot.elements=snapshot.elements.map(e=>e.id==='caption'?sourceText('caption','Количество новых обращений',24,340,570,80,32,'Play'):e)
 const p={...proposal,data:{value:'43%',unit:'обращений'}}
 const t=compileEditableProposal(p,1,snapshot,'job',[])
 assert.equal(t.data.unit,undefined);assert.ok(t.sourceLayout!.text.some(s=>s.element.text==='Количество новых обращений'))
 assert.equal(p.data.unit,'обращений')
})
