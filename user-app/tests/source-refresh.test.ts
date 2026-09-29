import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryBucket} from './helpers/memory-bucket'
import {nativeLayoutFixture} from './fixtures/native-layout'
import {validateSourceRefresh,prepareSourceRefresh,publishSourceRefresh} from '../lib/uploads/source-refresh'
import {contentHash,initializeCatalog,catalogLibrary} from '../lib/design-system/catalog'
import {EDITABLE_VERSION} from '../lib/design-system/editable-contract'
import {refinementFixture} from './fixtures/refinement'
import {repairSourcePages,readSourceRepairStatus} from '../lib/uploads/source-repair'
import {SOURCE_REPAIR_VERSION} from '../lib/uploads/source-repair-contract'
import {refinementRoot} from '../lib/design-system/refinement-storage'
import {controlImage} from './fixtures/control-pptx'
import {preserveSourceCalibration,publishSourceCalibration} from '../lib/uploads/source-refresh-calibration'
import {CALIBRATION_VERSION,QUALIFICATION_VERSION,FUNCTIONAL_SELECTION_VERSION,type CalibratedCatalog} from '../lib/design-system/calibration-contract'
import {readCalibratedCatalog} from '../lib/design-system/calibration'

async function refreshFixture(){
 const f=await refinementFixture(),root=`editable-systems/${f.id}/${EDITABLE_VERSION}`
 f.visual.snapshot.name='Refresh.pptx'
 for(const e of f.visual.snapshot.elements)e.id='s01-'+e.id
 f.first.sourceIds=f.first.sourceIds.map(id=>'s01-'+id)
 await f.bucket.put(`visual/${f.id}/manifest.json`,JSON.stringify(f.visual))
 const system={sourceRevision:await contentHash(f.visual.snapshot),sourceId:f.visual.snapshot.sourceId,batches:[],rules:[],sourcePending:[],rulePending:[],retainedTableIds:[],omittedContainerIds:[]}
 await f.bucket.put(`semantic-scans/${f.id}/current.json`,JSON.stringify({runId:'saved'}))
 await f.bucket.put(`semantic-scans/${f.id}/runs/saved.json`,JSON.stringify({status:'complete',resultKey:'saved-model.json'}))
 await f.bucket.put('saved-model.json',JSON.stringify(system))
 await f.bucket.put(`${root}/${f.base.sourceRevision}/parts/slides-1.json`,JSON.stringify({id:'slides-1',slides:[1],reply:{slides:[{slide:1,blocks:[f.first],note:''}]}}))
 const snapshot=structuredClone(f.visual.snapshot);snapshot.elements[0].properties.rotation=1
 const patch={version:SOURCE_REPAIR_VERSION,refresh:true,revision:await contentHash(f.visual.snapshot),snapshot,assets:[],previews:[{id:'s01',dataUrl:`data:image/png;base64,${controlImage().toString('base64')}`}]}
 return {...f,patch}
}

test('source refresh refuses lost objects, changed text and reassigned identities',()=>{
 const {snapshot}=nativeLayoutFixture('diagram'),after=structuredClone(snapshot)
 assert.doesNotThrow(()=>validateSourceRefresh(snapshot,after))
 for(const change of ['removed','text','identity'] as const){const next=structuredClone(after)
  if(change==='removed')next.elements.pop()
  if(change==='text')next.elements[1].properties.text='Invented'
  if(change==='identity')next.elements[0].properties.sourceRef={part:'different',shapeId:'1'}
  assert.throws(()=>validateSourceRefresh(snapshot,next))
 }
})

test('local source refresh replays saved evidence without modifying model results or keeping stale checks',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('Local replay cannot request a model')})
 const {snapshot,proposal}=nativeLayoutFixture('diagram'),{bucket,data}=memoryBucket(),root=`editable-systems/test/${EDITABLE_VERSION}`,oldRevision=await contentHash(snapshot)
 const model={version:'semantic',sourceRevision:oldRevision,sourceId:snapshot.sourceId,batches:[],rules:[],sourcePending:[],rulePending:[],retainedTableIds:[],omittedContainerIds:[]}
 await bucket.put('semantic-scans/test/current.json',JSON.stringify({runId:'run'}));await bucket.put('semantic-scans/test/runs/run.json',JSON.stringify({status:'complete',resultKey:'models/original.json'}));await bucket.put('models/original.json',JSON.stringify(model))
 await bucket.put(`${root}/current.json`,JSON.stringify({key:`${root}/old.json`}));await bucket.put(`${root}/old.json`,JSON.stringify({version:EDITABLE_VERSION,id:'old',sourceRevision:oldRevision,catalogId:'old',qualification:{checks:[{passed:true}]},modelRunIds:['saved-run'],liveRequests:1}))
 const partKey=`${root}/${oldRevision}/parts/slides-1.json`,part={id:'slides-1',slides:[1],runId:'saved-run',liveRequests:1,reply:{slides:[{slide:1,blocks:[proposal],note:''}]}}
 await bucket.put(partKey,JSON.stringify(part));const before=new Map([...data].map(([k,v])=>[k,v.value]))
 const plan=await prepareSourceRefresh(bucket,'test',snapshot,structuredClone(snapshot)),published=await publishSourceRefresh(bucket,'test',snapshot,plan)
 assert.equal(published.modelRequests,0);assert.equal(published.variants,1)
 for(const [key,value] of before)if(!key.endsWith('/current.json'))assert.equal(data.get(key)?.value,value,key)
 const pointer=await(await bucket.get(`${root}/current.json`))!.json<{key:string}>(),catalog=await(await bucket.get(pointer.key))!.json<{qualification?:unknown;modelRunIds:string[]}>()
 assert.equal(catalog.qualification,undefined);assert.deepEqual(catalog.modelRunIds,['saved-run'])
})

test('source refresh resumes publication after the source commit without another model call or replacing the original backup',async t=>{
 const f=await refreshFixture(),put=f.bucket.put.bind(f.bucket),original=f.data.get('saved-model.json')!.value
 let failed=false
 t.mock.method(f.bucket,'put',async(...args:Parameters<typeof put>)=>{
  if(args[0]===`component-catalogs/${f.id}/current.json`&&!failed){failed=true;throw Error('Simulated interruption')}
  return put(...args)
 })
 t.mock.method(globalThis,'fetch',async()=>{throw Error('No model allowed')})
 await assert.rejects(repairSourcePages(f.bucket,f.id,f.patch),/Simulated interruption/)
 const state=await readSourceRepairStatus(f.bucket,f.id,true);assert.equal(state?.needed,true);assert.equal(state?.revision,f.patch.revision)
 const result=await repairSourcePages(f.bucket,f.id,f.patch);assert.equal(result.catalogs?.modelRequests,0)
 assert.deepEqual(await repairSourcePages(f.bucket,f.id,f.patch),result)
 const prefix=`source-repairs/${f.id}/${SOURCE_REPAIR_VERSION}/${f.patch.revision}`
 assert.deepEqual(await(await f.bucket.get(`${prefix}/before.json`))!.json(),f.visual)
 assert.equal(f.data.get('saved-model.json')!.value,original)
})

test('source refresh refuses active work, published refinements and a concurrently replaced catalog',async()=>{
 const f=await refreshFixture()
 await f.bucket.put(`processing-jobs/${f.id}.json`,JSON.stringify({status:'running'}))
 await assert.rejects(prepareSourceRefresh(f.bucket,f.id,f.visual.snapshot,f.patch.snapshot),/текущей обработки/)
 await f.bucket.delete(`processing-jobs/${f.id}.json`)
 await f.bucket.put(`${refinementRoot(f.id)}/state.json`,JSON.stringify({pending:null,jobs:[],history:[{requestId:'other',key:'other',previous:null}]}))
 await assert.rejects(prepareSourceRefresh(f.bucket,f.id,f.visual.snapshot,f.patch.snapshot),/опубликованные дополнения/)
 await f.bucket.delete(`${refinementRoot(f.id)}/state.json`)
 const plan=await prepareSourceRefresh(f.bucket,f.id,f.visual.snapshot,f.patch.snapshot)
 await f.bucket.put(`editable-systems/${f.id}/${EDITABLE_VERSION}/current.json`,JSON.stringify({key:'concurrent'}))
 await assert.rejects(publishSourceRefresh(f.bucket,f.id,f.patch.snapshot,plan),/Каталог изменился/)
})

test('a reader update preserves identical calibrated families but cannot borrow admission for changed geometry',async()=>{
 const {bucket}=memoryBucket(),{snapshot}=nativeLayoutFixture('metric'),id='test'
 const sourceId=await initializeCatalog(bucket,id,snapshot),source=(await catalogLibrary(bucket,id))!,components=source.library.components.slice(0,2)
 assert.equal(components.length,2)
 const catalog:CalibratedCatalog={version:CALIBRATION_VERSION,qualificationVersion:QUALIFICATION_VERSION,functionalVersion:FUNCTIONAL_SELECTION_VERSION,id:'old-calibration',catalogId:sourceId,createdAt:'',sourceCount:components.length,qualifiedCount:2,modelRunIds:['saved-model'],liveRequests:1,cacheHits:0,excluded:[],families:components.map(c=>({id:c.id,name:c.name,description:'Saved meaning',tags:['card'],parameters:[],kind:c.kind,memberIds:[c.id],representativeId:c.id,occurrenceIds:[c.id],slides:[1],previewOnDark:false,variants:[{id:c.id,label:'Original',memberIds:[c.id],fields:[]}]}))}
 const root=`component-calibration/${id}/${sourceId}/${CALIBRATION_VERSION}`
 await bucket.put(`${root}/current.json`,JSON.stringify({id:catalog.id}));await bucket.put(`${root}/catalogs/${catalog.id}.json`,JSON.stringify(catalog))
 for(const c of components)await bucket.put(`${root}/${QUALIFICATION_VERSION}/${c.id}.json`,JSON.stringify({ready:true,definitionHash:await contentHash(c)}))
 const next=structuredClone(source.library);next.components.find(c=>c.id===components[1].id)!.scene.width+=10
 const plan=await preserveSourceCalibration(bucket,id,next)
 assert.deepEqual(plan?.families.map(f=>f.id),[components[0].id])
 assert.ok(plan?.excluded.some(e=>e.id===components[1].id&&e.reason.includes('новая проверка')))
 await publishSourceCalibration(bucket,id,'new-source',next.components.length,plan)
 const saved=(await readCalibratedCatalog(bucket,id,'new-source'))!
 assert.deepEqual(saved.modelRunIds,['saved-model']);assert.equal(saved.replayedFrom?.id,catalog.id);assert.equal(saved.qualifiedCount,1)
 assert.deepEqual(await(await bucket.get(`${root}/catalogs/${catalog.id}.json`))!.json(),catalog)
})
