import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { XMLValidator } from 'fast-xml-parser'
import { blankSlide, composeSlide } from '../lib/slides/document'
import { saveSlide, loadSlide } from '../lib/slides/storage'
import { initializeCatalog, getCatalogComponent } from '../lib/design-system/catalog'
import { LibraryConflict } from '../lib/design-system/storage'
import { flatten } from '../lib/design-system/compiler'
import { writeEditablePptx, pptxExportIssues } from '../lib/slides/pptx'
import type { SourceSnapshot } from '../lib/digital-designer/source-types'
import { memoryBucket } from './helpers/memory-bucket'

async function setup(){
  const {bucket,data}=memoryBucket(),source:SourceSnapshot={schemaVersion:1,sourceId:'b'.repeat(64),name:'Slide source',slideCount:1,assets:[],colors:[],fonts:[],limitations:[],slides:[{id:'s01',number:1,width:960,height:540,part:'ppt/slides/slide1.xml',text:'Original',warnings:[]}],elements:[{id:'text',name:'Heading',kind:'text',slide:1,properties:{bounds:{x:50,y:40,width:300,height:60},rotation:0,visible:true,opacity:1,zIndex:1,text:'Original',fontFamily:'Arial',fontSize:24}}]}
  await initializeCatalog(bucket,'job',source)
  const record=await getCatalogComponent(bucket,'job','cmp-text'),doc=blankSlide()
  doc.items.push({id:crypto.randomUUID(),componentId:record.component.id,definitionId:record.definitionId,x:40,y:50,scale:.5,values:{text:'Full <edited> & text'}})
  return {bucket,data,record,doc,definitions:{[record.definitionId]:record}}
}
test('two instances preserve frozen definitions, unique IDs, full text and scale',async()=>{
  const {record,doc,definitions}=await setup(),before=JSON.stringify(record)
  doc.items.push({...doc.items[0],id:crypto.randomUUID(),x:300,values:{text:'Second instance'}})
  const scene=composeSlide(doc,definitions),elements=flatten(scene.scene.elements),texts=elements.filter(e=>e.kind==='text')
  assert.deepEqual(texts.map(e=>e.text),['Full <edited> & text','Second instance'])
  assert.deepEqual(texts.map(e=>e.fontSize),[12,12]);assert.equal(new Set(elements.map(e=>e.id)).size,elements.length)
  assert.equal(JSON.stringify(record),before)
  doc.items[1].x=1000
  assert.ok(composeSlide(doc,definitions).issues.some(i=>i.code==='outside-slide'))
})
test('slide revisions are immutable, restored exactly and protected from concurrent edits',async()=>{
  const {bucket,data,doc}=await setup()
  const results=await Promise.allSettled(['First','Second'].map(name=>saveSlide(bucket,'job',{baseRevision:null,document:{...doc,name}})))
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  assert.ok(results.some(r=>r.status==='rejected'&&r.reason instanceof LibraryConflict))
  const saved=await loadSlide(bucket,'job');assert.ok(saved)
  const next=await saveSlide(bucket,'job',{baseRevision:saved.id,document:{...saved.document,name:'Updated'}})
  assert.equal(next.parentId,saved.id);assert.ok(data.has(`web-slides/job/${saved.id}.json`))
  assert.deepEqual(await loadSlide(bucket,'job'),next)
})
test('a saved presentation can still be edited after the style catalog changes',async()=>{
  const {bucket,doc,record}=await setup()
  const first=await saveSlide(bucket,'job',{baseRevision:null,document:doc})
  await bucket.put('component-catalogs/job/current.json',JSON.stringify({catalogId:'new-semantic-catalog'}))
  const changed=structuredClone(doc);changed.items[0].values.text='Сохранённое редактирование'
  const next=await saveSlide(bucket,'job',{baseRevision:first.id,document:changed})
  assert.deepEqual(next.definitions[record.definitionId],record)
  assert.ok(flatten(composeSlide(next.document,next.definitions).scene.elements).some(e=>e.kind==='text'&&e.text==='Сохранённое редактирование'))
})
test('native export escapes text, serializes cubic geometry and blocks unsupported effects',async()=>{
  const {doc,definitions}=await setup(),scene=composeSlide(doc,definitions)
  scene.scene.elements.push({id:'curve',name:'Circular corner',kind:'path',bounds:{x:300,y:200,width:100,height:100},rotation:0,visible:true,opacity:1,zIndex:2,pathData:'M 0 50 C 0 22 22 0 50 0 Q 100 0 100 50 L 0 50 Z',fill:{type:'solid',color:{r:0,g:.5,b:1,a:1}}})
  const zip=await JSZip.loadAsync(await writeEditablePptx(scene,[])),xml=await zip.file('ppt/slides/slide1.xml')!.async('string')
  assert.equal(XMLValidator.validate(xml),true)
  assert.ok(xml.includes('Full &lt;edited&gt; &amp; text'))
  assert.ok(xml.includes('<a:cubicBezTo>'));assert.ok(xml.includes('<a:quadBezTo>'))
  assert.ok(!xml.includes('<p:pic>'))
  scene.scene.elements[1].blur=5
  assert.ok(pptxExportIssues(scene).some(i=>i.message.includes('размытие')))
  await assert.rejects(()=>writeEditablePptx(scene,[]),/размытие/)
})
