import test from 'node:test'
import assert from 'node:assert/strict'
import { initializeCatalog, installSemanticCatalog, listCatalog, getCatalogComponent } from '../lib/design-system/catalog'
import { CALIBRATION_VERSION, QUALIFICATION_VERSION, FUNCTIONAL_SELECTION_VERSION } from '../lib/design-system/calibration-contract'
import { backgroundFixture } from './fixtures/backgrounds'
import { compileLibrary } from '../lib/design-system/compiler'
import { initializeLibrary, loadLibrary } from '../lib/design-system/storage'
import { memoryBucket } from './helpers/memory-bucket'
import type { SourceSnapshot } from '../lib/digital-designer/source-types'

const snapshot=():SourceSnapshot=>({schemaVersion:1,sourceId:'a'.repeat(64),name:'Catalog test',slideCount:1,assets:[],colors:[],fonts:[],limitations:[],slides:[{id:'s01',number:1,width:960,height:540,part:'ppt/slides/slide1.xml',text:'',warnings:[]}],elements:Array.from({length:181},(_,i)=>({id:`object-${i}`,name:`Candidate ${i}`,slide:1,kind:'text',properties:{bounds:{x:i,y:0,width:200,height:60},rotation:0,opacity:1,visible:true,zIndex:1,text:i===180?'Последний кандидат':'Повтор',fontFamily:'Arial',fontSize:20+i/100}}))})

test('raster charts rejected for data reuse remain visible as source graphics without bypassing calibration', async () => {
  const { bucket, data } = memoryBucket(), { library, snapshot: source } = backgroundFixture(), c = library.components[0]
  await bucket.put('visual/job/manifest.json', JSON.stringify({ snapshot: source }))
  c.name = 'График'; c.semantics[0].role = 'chart'
  library.components.push({ ...structuredClone(c), id: 'repeat', source: { ...c.source, slide: 2 } })
  library.components.push({ ...structuredClone(c), id: 'broken', issues: [{ code: 'unsupported-element', message: 'Invalid source', severity: 'blocking' }] })
  const catalogId = await installSemanticCatalog(bucket, 'job', library, { version: 'fixture', sourceRevision: 'source', coverage: { records: 3, processed: 3, unresolved: 0, rulesUnresolved: 0, complete: true }, decisions: [], styleRoles: [], rules: [] })
  const root = `component-calibration/job/${catalogId}/${CALIBRATION_VERSION}`
  const calibrated = { version: CALIBRATION_VERSION, qualificationVersion: QUALIFICATION_VERSION, functionalVersion: FUNCTIONAL_SELECTION_VERSION, id: 'fixture', catalogId, families: [], excluded: [{ id: c.id, reason: 'Values embedded in image' }], qualifiedCount: 1 }
  await bucket.put(`${root}/current.json`, JSON.stringify({ id: 'fixture' }))
  await bucket.put(`${root}/catalogs/fixture.json`, JSON.stringify(calibrated))
  const graphics = (await listCatalog(bucket, 'job', new URLSearchParams('section=graphics')))!
  assert.equal(graphics.total, 1)
  assert.deepEqual(graphics.items[0].occurrenceIds, ['c', 'repeat'])
  assert.equal(graphics.items[0].sourceOnly, true)
  assert.ok(graphics.items[0].usage?.tags.includes('chart'))
  assert.equal(graphics.items[0].usage?.previewOnDark, true, 'The source dark surface is preview context, not baked into the image')
  assert.equal((await listCatalog(bucket, 'job', new URLSearchParams('section=components')))!.total, 0)
  assert.equal((await listCatalog(bucket, 'job', new URLSearchParams()))!.total, 0)
  assert.deepEqual((await getCatalogComponent(bucket, 'job', c.id)).component, c)
  assert.equal(data.get(`${root}/catalogs/fixture.json`)!.value, JSON.stringify(calibrated))
})

test('catalog pages retain distinct typography and lazily materialize a late definition',async()=>{
  const {bucket,data}=memoryBucket();await initializeCatalog(bucket,'job',snapshot())
  const page=await listCatalog(bucket,'job',new URLSearchParams())
  assert.equal(page!.total,181);assert.equal(page!.items.length,24);assert.equal(page!.pages,8)
  assert.equal(page!.items[0].repeatCount,1)
  assert.ok(![...data.keys()].some(k=>k.includes('/definitions/')))
  const last=await listCatalog(bucket,'job',new URLSearchParams({q:'Последний'}))
  assert.equal(last!.filtered,1);assert.equal(last!.items[0].id,'cmp-object-180')
  const definition=await getCatalogComponent(bucket,'job','cmp-object-180')
  assert.equal(definition.component.slots[0].defaultText,'Последний кандидат')
  assert.equal([...data.keys()].filter(k=>k.includes('/definitions/')).length,1)
  const ids=[]
  for(let n=1;n<=8;n++)ids.push(...(await listCatalog(bucket,'job',new URLSearchParams({page:String(n)})))!.items.map(c=>c.id))
  assert.equal(new Set(ids).size,181)
  const focused=await listCatalog(bucket,'job',new URLSearchParams({component:'cmp-object-180'}))
  assert.equal(focused!.page,8);assert.equal(focused!.filtered,181)
  assert.ok(focused!.items.some(item=>item.id==='cmp-object-180'))
  const previous=await listCatalog(bucket,'job',new URLSearchParams({component:'cmp-object-180',page:'7'}))
  assert.equal(previous!.page,7);assert.equal(previous!.items.length,24)

})
test('curated catalog merges renamed repeats, resolves old links and retains every source definition',async()=>{
  const {bucket}=memoryBucket(),source=snapshot()
  for(const e of source.elements)e.properties.fontSize=20
  await initializeCatalog(bucket,'job',source)
  const late=await getCatalogComponent(bucket,'job','cmp-object-180')
  const page=await listCatalog(bucket,'job',new URLSearchParams({component:'cmp-object-180'}))
  assert.equal(page!.total,1);assert.equal(page!.focusedId,'cmp-object-0')
  assert.equal(page!.items[0].repeatCount,181)
  assert.ok(page!.items[0].usage?.tags.includes('text'))
  assert.equal((await listCatalog(bucket,'job',new URLSearchParams({q:'Последний кандидат'})))!.items[0].id,'cmp-object-0')
  assert.deepEqual(await getCatalogComponent(bucket,'job','cmp-object-180'),late)
  assert.equal(late.component.slots[0].defaultText,'Последний кандидат')
})
test('catalog preserves legacy definitions and history without using historical approval or test text',async()=>{
  const {bucket}=memoryBucket(),source=snapshot(),library=compileLibrary(source)
  library.components[0].name='Previously saved definition'
  const old=await initializeLibrary(bucket,'job',library),component=old.library.components[0]
  old.revision.decisions[component.id]={status:'rejected',values:{[component.slots[0].id]:'Historical test text'}}
  await bucket.put(`component-libraries/job/revisions/${old.revision.id}.json`,JSON.stringify(old.revision))
  await initializeCatalog(bucket,'job',source)
  const preserved=await getCatalogComponent(bucket,'job',component.id)
  assert.deepEqual(preserved.component,component)
  assert.ok(!('revision' in preserved))
  assert.equal(preserved.component.slots[0].defaultText,component.slots[0].defaultText)
  const page=await listCatalog(bucket,'job',new URLSearchParams())
  assert.ok(page!.items.every(item=>!('status' in item)))
  assert.ok(page!.items.find(item=>item.id===component.id)?.available)
  assert.deepEqual(await loadLibrary(bucket,'job'),old)
})
test('archived per-component reviews cannot alter automatic catalog definitions or defaults',async()=>{
  const {bucket,data}=memoryBucket();await initializeCatalog(bucket,'job',snapshot())
  const initial=await getCatalogComponent(bucket,'job','cmp-object-180'),slot=initial.component.slots[0].id
  const key=`component-catalogs/job/${initial.catalogId}/reviews/${initial.component.id}/current.json`
  const review={id:crypto.randomUUID(),decision:{status:'rejected',values:{[slot]:'Old preview'}}}
  await bucket.put(key,JSON.stringify(review))
  // Definitions cached by older versions can also contain a decision.
  const definitionKey=`component-catalogs/job/${initial.catalogId}/definitions/${initial.component.id}.json`
  await bucket.put(definitionKey,JSON.stringify({...initial,revision:review}))
  assert.deepEqual(await getCatalogComponent(bucket,'job',initial.component.id),initial)
  const page=await listCatalog(bucket,'job',new URLSearchParams({q:initial.component.id}))
  assert.equal(page!.items[0].available,true)
  assert.ok(!('status' in page!.items[0]))
  assert.deepEqual(page!.counts,{atoms:181,molecules:0})
  assert.equal(data.get(key)!.value,JSON.stringify(review))
})
