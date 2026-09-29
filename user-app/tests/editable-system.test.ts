import test from 'node:test'
import assert from 'node:assert/strict'
import {editableTableLayout} from '../lib/design-system/editable-table'
import {renderEditableHtml} from '../lib/design-system/editable-render'
import {editableHtmlDocument} from '../lib/design-system/editable-html'
import {validateEditableData,validateEditableReply,type EditableTemplate} from '../lib/design-system/editable-contract'
import {nativeObjectSchema} from '../lib/design-system/native-contract'
import {buildEditableSystem,editableState} from '../lib/design-system/editable-analysis'
import {initializeCatalog} from '../lib/design-system/catalog'
import {memoryBucket} from './helpers/memory-bucket'
import type {SourceSnapshot} from '../lib/digital-designer/source-types'
import {editablePacketIsDense} from '../lib/design-system/editable-discovery'
import {readSourceScene} from '../lib/design-system/source-scene'
export function template(kind:EditableTemplate['kind'],data:EditableTemplate['data'],config:EditableTemplate['config']={}):EditableTemplate{return {id:'t1',name:'Конструкция',description:'Проверка',tags:['Данные'],kind,slide:1,width:800,height:400,sourceIds:['s01-object1'],memberIds:[],style:{font:'Arial'},config,data,dataStatus:'readable',graphicHtml:{}}}
const snapshot=():SourceSnapshot=>({schemaVersion:1,sourceId:'a'.repeat(64),name:'Automatic',slideCount:1,assets:[],colors:[],fonts:[],limitations:[],slides:[{id:'s01',number:1,width:960,height:540,part:'ppt/slides/slide1.xml',text:'',warnings:[]}],elements:[{id:'s01-object1',name:'Text',slide:1,kind:'text',properties:{bounds:{x:20,y:20,width:300,height:200},rotation:0,opacity:1,visible:true,zIndex:1,text:'Пример',fontFamily:'Arial',fontSize:20}}]})
test('discovery isolates dense source packets before a model timeout, without limiting components',()=>{
 const source=snapshot(),first=source.elements[0]
 source.slides.push({...source.slides[0],id:'s02',number:2});source.slideCount=2
 assert.equal(editablePacketIsDense(readSourceScene(source),[1,2]),false)
 source.elements=Array.from({length:40},(_,i)=>({...first,id:`t${i}`,slide:i<20?1:2}))
 assert.equal(editablePacketIsDense(readSourceScene(source),[1,2]),true)
 assert.equal(editablePacketIsDense(readSourceScene(source),[1]),false,'one dense slide is preserved in full')
 source.elements=source.elements.map(e=>({...e,properties:{...e.properties,visible:false}}))
 assert.equal(editablePacketIsDense(readSourceScene(source),[1,2]),false,'hidden objects do not inflate the task')
})
test('table and chart geometry are driven by the edited data',()=>{
 const table=template('table',{columns:['Город','Число'],rows:[['Москва','12']]})
 assert.equal((renderEditableHtml(table).match(/<tr>/g)??[]).length,2)
 assert.equal((renderEditableHtml(table,{...table.data,rows:[['Москва','12'],['Казань','45']]}).match(/<tr>/g)??[]).length,3)
 const chart=template('chart',{categories:['A','B'],series:[{name:'Ряд',values:[20,80]}]},{chartType:'donut'})
 assert.notEqual(renderEditableHtml(chart),renderEditableHtml(chart,{...chart.data,series:[{name:'Ряд',values:[70,30]}]}))
 assert.throws(()=>validateEditableData('chart',{categories:['A'],series:[{name:'Ряд',values:[20,30]}]},chart.config))
})
test('table captions survive rendering and data changes instead of failing content qualification',()=>{
 const table=template('table',{title:'Классы объектов',text:'Пояснение к данным',columns:['Класс','Состав'],rows:[['А','Б']]})
 assert.match(renderEditableHtml(table),/Классы объектов/)
 assert.match(renderEditableHtml(table),/Пояснение к данным/)
 const changed=renderEditableHtml(table,{...table.data,title:'Новые классы',rows:[['В','Г'],['Д','Е']]})
 assert.match(changed,/Новые классы/);assert.equal((changed.match(/<tr>/g)??[]).length,3)
})
test('null chart points remain gaps, negative bars and multiple Gantt ranges remain editable',()=>{
 const line=renderEditableHtml(template('chart',{categories:['A','B','C'],series:[{name:'Тренд',values:[12,null,-5]}]},{chartType:'line'}))
 assert.equal((line.match(/data-series="Тренд"/g)??[]).length,2)
 const gantt=template('gantt',{periods:['Апр','Май','Июн'],items:[{title:'Задача',ranges:[{start:0,end:.5},{start:1,end:3}]}]})
 validateEditableData(gantt.kind,gantt.data,gantt.config)
 assert.equal((renderEditableHtml(gantt).match(/data-range-start=/g)??[]).length,2)
 assert.throws(()=>validateEditableData('gantt',{...gantt.data,items:[{ranges:[{start:1,end:4}]}]}))
})
test('SmartArt node identity and acyclic relationships are required; text is escaped',()=>{
 const t=template('smartart',{items:[{id:'root',text:'<script>evil</script>'},{id:'child',parentId:'root',text:'Child'}]},{diagramLayout:'tree'})
 validateEditableData(t.kind,t.data,t.config)
 assert.match(renderEditableHtml(t),/&lt;script&gt;/)
 assert.throws(()=>validateEditableData('smartart',{items:[{id:'a',parentId:'b'},{id:'b',parentId:'a'}]}))
 assert.throws(()=>nativeObjectSchema.parse({kind:'smartart',sourcePart:'data.xml',nodes:[{id:'a',text:'x'}],edges:[{from:'a',to:'a',order:0}],algorithms:[],layoutName:'',dataXml:'',layoutXml:''}))
 assert.ok(!editableHtmlDocument(t,t.data).includes('<script>evil'))
})
test('a visual model cannot claim another slide or turn ordinary shapes into native SmartArt',()=>{
 const source=snapshot(),t=template('text',{text:'Пример'}),b={id:t.id,name:t.name,description:t.description,tags:t.tags,kind:t.kind,sourceIds:t.sourceIds,memberIds:t.memberIds,style:t.style,config:t.config,data:t.data,dataStatus:t.dataStatus}
 assert.equal(validateEditableReply({slides:[{slide:1,blocks:[b],note:''}]},source,[1],[]).slides.length,1)
 assert.throws(()=>validateEditableReply({slides:[{slide:1,blocks:[{...b,sourceIds:['s02-object2']}],note:''}]},source,[1],[]))
 assert.throws(()=>validateEditableReply({slides:[{slide:1,blocks:[{...b,kind:'smartart',data:{items:[{id:'a',text:'x'}]}}],note:''}]},source,[1],[]))
})
test('automatic construction build uses immutable model evidence and resumes without another request',async t=>{
 const {bucket,data}=memoryBucket(),s=snapshot();await initializeCatalog(bucket,'job',s)
 await bucket.put('visual/job/manifest.json',JSON.stringify({renderer:'msp-web-2026-09-25',previewKind:'reconstruction',snapshot:s,assets:[],sheets:[],previews:[{id:'s01',mime:'image/png'}]}));await bucket.put('visual/job/preview-s01','preview')
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({slides:[{slide:1,blocks:[{id:'b1',kind:'text',name:'Текст',description:'Для пояснения',tags:['Текст'],sourceIds:['s01-object1'],memberIds:[],style:{},config:{},data:{text:'Пример'},dataStatus:'readable',adaptation:{version:'component-intent-1',family:'fixed',fields:[],layouts:[],rationale:'Один исходный текстовый блок без отдельной подписи'}}],objectRoles:{background:[],decoration:[],context:[],unresolved:[]},note:''}]})}}]}),{status:200})})
 const config={apiKey:'test',baseUrl:'https://example.test/v1',model:'test',timeoutMs:3000}
 const first=await buildEditableSystem(bucket,'job',config);assert.equal(first.families.length,1);assert.equal(calls,1)
 const immutable=[...data.keys()].filter(k=>k.includes('/responses/')||k.includes('/runs/'));assert.ok(immutable.length)
 assert.equal((await buildEditableSystem(bucket,'job',config)).id,first.id);assert.equal(calls,1)
 assert.equal((await editableState(bucket,'job')).completed,1)
})

test('an incomplete multi-slide packet splits automatically without rerunning finished slides',async t=>{
 const {bucket,data}=memoryBucket(),s=snapshot()
 s.slides=Array.from({length:4},(_,i)=>({...s.slides[0],id:`s0${i+1}`,number:i+1,part:`ppt/slides/slide${i+1}.xml`}))
 s.slideCount=4;s.elements=s.slides.map(slide=>({...s.elements[0],id:`${slide.id}-object1`,slide:slide.number}))
 await initializeCatalog(bucket,'split',s)
 await bucket.put('visual/split/manifest.json',JSON.stringify({snapshot:s,previews:s.slides.map(s=>({id:s.id,mime:'image/png'}))}))
 for(const slide of s.slides)await bucket.put(`visual/split/preview-${slide.id}`,'preview')
 const called:number[][]=[]
 t.mock.method(globalThis,'fetch',async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  const request=JSON.parse(String(init?.body)),slides=JSON.parse(request.messages[1].content[0].text).slides.map((s:{slide:number})=>s.slide)
  called.push(slides)
  return new Response(JSON.stringify({choices:[{finish_reason:slides.length>1?'length':'stop',message:{content:JSON.stringify({slides:slides.map((slide:number)=>({slide,blocks:[],objectRoles:{background:[],decoration:[],context:[`s0${slide}-object1`],unresolved:[]},note:'Нет самостоятельных конструкций'}))})}}]}),{status:200})
 })
 const result=await buildEditableSystem(bucket,'split',{apiKey:'test',baseUrl:'https://example.test/v1',model:'test'})
 assert.deepEqual(result.coverage.map(s=>s.slide),[1,2,3,4]);assert.equal(called.length,5)
 assert.equal(called.filter(s=>s.includes(4)).length,1)
 assert.ok([...data.keys()].some(k=>k.endsWith('/plans/slides-1.json')))
 assert.equal((await editableState(bucket,'split')).total,4)
})


test('editing merged table data never silently hides values or leaves orphan merges',()=>{
 const t=template('table',{columns:['A','B'],rows:[['Общий итог',''],['Север','4']]})
 t.tableStyles=[[{},{}],[{colSpan:2},{hidden:true}],[{background:'#eeeeee'},{}]];t.columnWidths=[30,70]
 assert.equal(editableTableLayout(t,t.data).styles[1][1].hidden,true)
 const changed={...t.data,rows:[['Общий итог','73'],['Север','4']]}
 assert.equal(editableTableLayout(t,changed).styles[1][1].hidden,false)
 assert.match(renderEditableHtml(t,changed),/>73<\/td>/)
 const removed={...t.data,rows:[['Север','4'],['Новая строка','']],rowKeys:[1,-1]}
 const layout=editableTableLayout(t,removed)
 assert.equal(layout.styles[1][0].background,'#eeeeee');assert.ok(layout.styles.every(row=>row.every(c=>!c.hidden)))
 assert.equal(layout.widths.reduce((n,w)=>n+w,0),100)
})
