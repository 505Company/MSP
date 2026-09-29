import test from 'node:test'
import assert from 'node:assert/strict'
import { readSourceRepairStatus, repairSourcePages, sourceRecoveryView } from '../lib/uploads/source-repair'
import type { PublicProcessingJob } from '../lib/uploads/processing-jobs'
import { SOURCE_REPAIR_VERSION, type SourceRepairPatch } from '../lib/uploads/source-repair-contract'
import { memoryBucket } from './helpers/memory-bucket'
import { controlImage } from './fixtures/control-pptx'
import { sha256 } from '../lib/uploads/pptx-profiler'
import type { VisualManifest } from '../lib/digital-designer/visual-package'
import { removeBankStyle } from '../lib/workspace/storage'

async function fixture() {
  const {bucket,data}=memoryBucket(), image=controlImage(), assetId=`asset-${(await sha256(image)).slice(0,24)}`
  const manifest:VisualManifest={renderer:'msp-web-2026-09-25',previewKind:'reconstruction',assets:[],previews:[{id:'s01',mime:'image/png'}],sheets:[],snapshot:{schemaVersion:1,sourceId:'a'.repeat(64),name:'Collage.pptx',slideCount:2,assets:[],fonts:[],colors:[],limitations:[],
    slides:[1,2].map(number=>({id:`s0${number}`,number,width:960,height:540,part:`ppt/slides/slide${number}.xml`,text:`Текст ${number}`,warnings:number===2?['normalized-page-unavailable (page-image-byte-limit)']:[]})),
    elements:[{id:'s01-title',slide:1,name:'Title',kind:'text',properties:{text:'Текст 1',fontFamily:'Arial',fontSize:24,bounds:{x:10,y:10,width:400,height:60},opacity:1,visible:true,rotation:0,zIndex:1}}]}}
  await bucket.put('visual/test/manifest.json',JSON.stringify(manifest));await bucket.put('model/saved-answer.json','{"original":true}')
  const status=(await readSourceRepairStatus(bucket,'test'))!
  const patch:SourceRepairPatch={version:SOURCE_REPAIR_VERSION,revision:status.revision,snapshot:{...manifest.snapshot,slides:[{...manifest.snapshot.slides[1],warnings:[]}],elements:[{id:'s02-image',slide:2,kind:'raster',name:'Source crop',properties:{assetId,bounds:{x:0,y:0,width:400,height:200},opacity:1,visible:true,rotation:0,zIndex:1}}],assets:[{id:assetId,mime:'image/png',byteLength:image.length,origins:['source']}],colors:[],fonts:[]},assets:[{id:assetId,base64:image.toString('base64')}],previews:[{id:'s02',dataUrl:`data:image/png;base64,${image.toString('base64')}`}]}
  return {bucket,data,manifest,status,patch}
}

test('source reread repairs only missing pages, preserves history and is idempotent without a model',async t=>{
  const {bucket,data,manifest,status,patch}=await fixture()
  t.mock.method(globalThis,'fetch',async()=>{throw Error('Source repair cannot call a model')})
  assert.equal(status.needed,true);assert.deepEqual(status.slides,[2])
  const result=await repairSourcePages(bucket,'test',patch)
  assert.deepEqual(result.repaired,[2]);assert.deepEqual(result.remaining,[])
  const updated=await(await bucket.get('visual/test/manifest.json'))!.json<VisualManifest>()
  assert.deepEqual(updated.snapshot.slides[0],manifest.snapshot.slides[0]);assert.deepEqual(updated.snapshot.elements[0],manifest.snapshot.elements[0])
  assert.equal(updated.previews.length,2);assert.equal(updated.snapshot.assets.length,1)
  assert.equal(data.get('model/saved-answer.json')!.value,'{"original":true}')
  assert.deepEqual(await(await bucket.get(`source-repairs/test/${SOURCE_REPAIR_VERSION}/${status.revision}/before.json`))!.json(),manifest)
  const count=data.size;assert.deepEqual(await repairSourcePages(bucket,'test',patch),result);assert.equal(data.size,count)
  assert.equal((await readSourceRepairStatus(bucket,'test'))!.needed,false)
})

test('an unrepaired page remains an explicit omission and is attempted once per reader revision',async()=>{
  const {bucket,manifest,patch}=await fixture();patch.snapshot.slides[0].warnings=manifest.snapshot.slides[1].warnings;patch.previews=[]
  const result=await repairSourcePages(bucket,'test',patch)
  assert.deepEqual(result.repaired,[]);assert.deepEqual(result.remaining,[2])
  assert.deepEqual(await(await bucket.get('visual/test/manifest.json'))!.json(),manifest)
  const state=(await readSourceRepairStatus(bucket,'test'))!;assert.equal(state.needed,false);assert.deepEqual(state.slides,[2])
})

test('reread rejects stale or foreign source, edited text, healthy pages and corrupted assets before publication',async()=>{
  for(const kind of ['revision','source','text','healthy','bytes','ancestry','missing-preview'] as const){
    const {bucket,data,manifest,patch}=await fixture()
    if(kind==='revision')patch.revision='b'.repeat(64)
    if(kind==='source')patch.snapshot.sourceId='b'.repeat(64)
    if(kind==='text')patch.snapshot.slides[0].text='Rewritten text'
    if(kind==='healthy')patch.snapshot.slides.push(manifest.snapshot.slides[0])
    if(kind==='bytes')patch.assets[0].base64='Yg=='
    if(kind==='ancestry')patch.snapshot.elements[0].parentId='s01-title'
    if(kind==='missing-preview')patch.previews.push(patch.previews[0])
    const size=data.size;await assert.rejects(repairSourcePages(bucket,'test',patch),kind)
    assert.equal(data.size,size);assert.deepEqual(await(await bucket.get('visual/test/manifest.json'))!.json(),manifest)
  }
})

test('deleted styles cannot have their sources republished',async()=>{
  const {bucket,patch}=await fixture(),id=crypto.randomUUID();await removeBankStyle(bucket,id)
  await assert.rejects(repairSourcePages(bucket,id,patch),/удалена/)
})

test('progress explains a recovered source while retaining the paused job and the original error',async()=>{
  const {bucket,patch}=await fixture()
  const job:PublicProcessingJob={id:'test',label:'Collage',revision:'test',status:'blocked',attempts:1,createdAt:1,updatedAt:2,progress:{step:'analysis',detail:'Old state'},error:'Сначала требуется завершить чтение исходных слайдов.'}
  const old=JSON.stringify(job);assert.deepEqual(await sourceRecoveryView(bucket,job),job)
  await repairSourcePages(bucket,'test',patch)
  const view=await sourceRecoveryView(bucket,job)
  assert.equal(view.status,'blocked');assert.equal(view.attempts,1);assert.match(view.error!,/восстановлены/)
  assert.equal(JSON.stringify(job),old)
  assert.equal((await sourceRecoveryView(bucket,{...job,error:'Другая ошибка'})).error,'Другая ошибка')
})
