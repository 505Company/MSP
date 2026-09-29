import test from 'node:test'
import assert from 'node:assert/strict'
import { refinementFixture, refinementConfig, passingReport } from './fixtures/refinement'
import { regionSources } from '../lib/design-system/refinement-coverage'
import { advanceRefinement, requestRefinement, refinementCandidate, reportRefinement, completeRefinement, refinementState } from '../lib/design-system/refinement'
import { rasterRegionSource, validateRasterReply, type RasterReply } from '../lib/design-system/refinement-raster'
import { readRefinementJob } from '../lib/design-system/refinement-storage'
import { contentHash } from '../lib/design-system/catalog'
import { EDITABLE_VERSION } from '../lib/design-system/editable-contract'

async function fixture(target: 'graphic' | 'component' = 'component') {
  const f=await refinementFixture(),s=f.visual.snapshot
  s.slides[0].width=1000;s.slides[0].height=600;s.fonts=[{family:'Arial',sizes:[20],occurrences:1}]
  s.elements=[{id:'raster',slide:1,kind:'raster',name:'Фон с карточками',properties:{id:'raster',kind:'raster',name:'Фон с карточками',bounds:{x:0,y:0,width:1000,height:600},rotation:0,opacity:1,visible:true,zIndex:0,assetId:'asset-image',reason:'Source raster'}}]
  s.assets=[{id:'asset-image',mime:'image/png',byteLength:10,origins:['ppt/media/image.png']}]
  f.base.families=[];f.base.qualification=passingReport(f.base);f.base.sourceRevision=await contentHash({version:EDITABLE_VERSION,snapshot:s,catalogId:f.base.catalogId})
  await f.bucket.put(f.baseKey,JSON.stringify(f.base));await f.bucket.put(`visual/${f.id}/manifest.json`,JSON.stringify(f.visual))
  const region={x:.4,y:.3,width:.5,height:.4},job=await requestRefinement(f.bucket,f.id,{id:crypto.randomUUID(),mode:'region',catalogId:f.base.id,slide:1,region,target,note:target==='graphic'?'Фон':'Карточка'})
  const image={width:500,height:240,dataUrl:'data:image/png;base64,iVBORw=='},reply:RasterReply={kind:'component',note:'Карточка',blocks:[{name:'Карточка с подписью',description:'Заголовок и пояснение',bounds:{x:0,y:0,width:500,height:240},background:'#ffffff',shapes:[],texts:[{bounds:{x:20,y:20,width:400,height:60},text:'Точный исходный текст',font:'Arial',fontSize:20,color:'#111111',weight:400,align:'LEFT'}]}]}
  return {...f,region,job,image,reply}
}
test('selecting a small card inside a full-slide raster preserves image evidence instead of reporting no objects',async()=>{
  const f=await fixture();assert.deepEqual(regionSources(f.visual.snapshot,1,f.region),['raster'])
  const source=rasterRegionSource(f.visual,f.job)!
  assert.equal(source.assetId,'preview-s01');assert.deepEqual(source.region,f.region)
  assert.equal(source.representation,'reconstructed')
})
test('an explicitly selected background is stored as original graphic with zero model calls and a visible receipt',async t=>{
  const f=await fixture('graphic');t.mock.method(globalThis,'fetch',async()=>{throw Error('must not call model')})
  await advanceRefinement(f.bucket,f.id,f.job.id,{...refinementConfig,apiKey:''},undefined,f.image)
  const candidate=(await refinementCandidate(f.bucket,f.id,f.job.id))!
  const template=candidate.catalog.families[0].variants[0];assert.equal(template.kind,'graphic');assert.equal(template.sourceRegion!.assetId,'asset-image')
  assert.match(template.sourceLayout!.graphic,/overflow="hidden"/)
  await reportRefinement(f.bucket,f.id,f.job.id,passingReport(candidate.catalog))
  const done=await completeRefinement(f.bucket,f.id,f.job.id);assert.equal(done.budget.used,0);assert.equal(done.result!.items![0].kind,'graphic')
})
test('raster text must be source-checked before publication; receipts identify the exact new item',async t=>{
  const f=await fixture();let calls=0
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(f.reply)}}]}))})
  await advanceRefinement(f.bucket,f.id,f.job.id,refinementConfig,undefined,f.image)
  const candidate=(await refinementCandidate(f.bucket,f.id,f.job.id))!,report=passingReport(candidate.catalog)
  assert.equal(candidate.catalog.families[0].variants[0].data.items![0].text,'Точный исходный текст')
  await assert.rejects(()=>reportRefinement(f.bucket,f.id,f.job.id,report),/сравнения/)
  report.checks[0].visual={pixelError:.01,foregroundRecall:.99,textRecall:.4}
  await assert.rejects(()=>reportRefinement(f.bucket,f.id,f.job.id,report),/сравнения/)
  report.checks[0].visual.textRecall=.99
  await reportRefinement(f.bucket,f.id,f.job.id,report);const done=await completeRefinement(f.bucket,f.id,f.job.id)
  assert.equal(done.result!.items![0].name,'Карточка с подписью');assert.equal(calls,1)
  const before=await readRefinementJob(f.bucket,f.id,f.job.id)
  const state=await refinementState(f.bucket,f.id);assert.equal(state.jobs[0].result!.items![0].slide,1)
  assert.deepEqual(await readRefinementJob(f.bucket,f.id,f.job.id),before)
})
test('raster recovery rejects invented fonts and geometry outside the selected crop',async()=>{
  const f=await fixture(),source=rasterRegionSource(f.visual,f.job)!
  const reply=structuredClone(f.reply);reply.blocks[0].texts[0].font='Invented';reply.blocks[0].bounds.width=900
  assert.throws(()=>validateRasterReply(reply,source,f.image,'component'),/проверку объектов/)
  assert.throws(()=>validateRasterReply({kind:'graphic',blocks:[],note:''},source,f.image,'component'),/проверку объектов/)
})
test('a recovered card keeps the text and shapes of a nested metric in the same component',async t=>{
  const f=await fixture()
  f.reply.blocks.push({name:'Показатель',description:'Показатель внутри карточки',bounds:{x:300,y:120,width:150,height:70},background:'#eeeeee',shapes:[],texts:[{bounds:{x:10,y:10,width:130,height:50},text:'42%',font:'Arial',fontSize:28,color:'#111111',weight:700,align:'CENTER'}]})
  const before=structuredClone(f.reply)
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(f.reply)}}]})))
  await advanceRefinement(f.bucket,f.id,f.job.id,refinementConfig,undefined,f.image)
  const candidate=(await refinementCandidate(f.bucket,f.id,f.job.id))!,templates=candidate.catalog.families.flatMap(f=>f.variants)
  assert.equal(templates.length,1,'A nested metric must not disappear from the parent card')
  assert.deepEqual(templates[0].data.items!.map(i=>i.text),['Точный исходный текст','42%'])
  const metric=templates[0].sourceRegion!.elements!.find(e=>e.kind==='text'&&e.text==='42%')!
  assert.equal(metric.bounds.x,310);assert.equal(metric.bounds.y,130)
  assert.deepEqual(f.reply,before,'Model evidence remains unchanged')
})
test('an unsupported graphics selection never falls through to model recognition',async t=>{
  const f=await refinementFixture(),job=await requestRefinement(f.bucket,f.id,{id:crypto.randomUUID(),mode:'region',catalogId:f.base.id,slide:1,region:{x:0,y:0,width:1,height:1},target:'graphic',note:''})
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected model call')})
  await assert.rejects(()=>advanceRefinement(f.bucket,f.id,job.id,refinementConfig),/внутри исходной картинки/)
  assert.equal(calls,0);assert.equal((await readRefinementJob(f.bucket,f.id,job.id))!.budget.used,0)
})
