import test from 'node:test'
import assert from 'node:assert/strict'
import type { SourceSnapshot } from '../lib/digital-designer/source-types'
import { buildSourceSystem } from '../lib/design-system/source-system'
import { planSemanticScan } from '../lib/design-system/semantic-scan-plan'
import { validateScanReply, startSemanticScan, readScanRun, type SemanticSystem } from '../lib/design-system/semantic-scan'
import { compileSemanticLibrary } from '../lib/design-system/semantic-library'
import { validateSourceRules } from '../lib/design-system/semantic-rules'
import { contentHash, initializeCatalog, installSemanticCatalog, getCatalogComponent } from '../lib/design-system/catalog'
import { memoryBucket } from './helpers/memory-bucket'
import { removeBankStyle } from '../lib/workspace/storage'
import { QwenAnalysisError } from '../lib/uploads/qwen-analysis'

function snapshot(count=1):SourceSnapshot {
  return {schemaVersion:1,sourceId:'a'.repeat(64),name:'Контроль',slideCount:count,assets:[],colors:[],fonts:[],limitations:[],
    slides:Array.from({length:count},(_,i)=>({id:`s0${i+1}`,number:i+1,width:960,height:540,part:'source',text:'',warnings:[]})),
    elements:Array.from({length:count},(_,i)=>({id:`text-${i+1}`,name:'Текст',kind:'text',slide:i+1,properties:{bounds:{x:40,y:30,width:400,height:70},rotation:0,opacity:1,visible:true,zIndex:1,text:`Контрольный текст ${i+1}`,fontFamily:'Arial',fontSize:24}}))}
}
const config={apiKey:'test-only-key',model:'test-model',baseUrl:'https://provider.invalid/v1'}
const reply=(raw:unknown)=>new Response(JSON.stringify({id:'request-test',model:'test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]}),{headers:{'content-type':'application/json'}})
const empty=()=>({styles:[],atoms:[],molecules:[],rules:[],content:[],pending:[]})

test('a provider outage defers untouched packets after repeated failures, then resumes from exact successful caches',async t=>{
  const {bucket}=memoryBucket(),s=snapshot(16),visual={renderer:'test',previewKind:'reconstruction' as const,snapshot:s,assets:[],previews:s.slides.map(slide=>({id:slide.id,mime:'image/png'})),sheets:[]}
  for(const slide of s.slides)await bucket.put(`visual/job/preview-${slide.id}`,'synthetic-image')
  let outage=true,calls=0,published=0
  const successes=new Set<string>()
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
    calls++;const request=JSON.parse(init!.body as string)
    if(request.response_format.json_schema.name==='source_text_rules'){
      const data=JSON.parse(request.messages[1].content)
      return reply({rules:[],nonRuleIds:data.texts.map((x:{id:string})=>x.id),unresolved:[]})
    }
    const data=JSON.parse(request.messages[1].content[0].text),first=data.requiredNodeIds[0]
    if(outage&&first!=='text-1')throw new QwenAnalysisError('QWEN_TIMEOUT','Модель не завершила анализ вовремя.')
    assert.ok(!successes.has(first),'successful model inputs must be reused without a new request')
    successes.add(first)
    return reply({...empty(),content:data.nodes.map((n:{id:string})=>({elementId:n.id,role:'body'}))})
  })
  const publish=async()=>{published++;return 'catalog'}
  const first=await startSemanticScan(bucket,'job',visual,config,publish)
  await assert.rejects(first.execute(),(e:unknown)=>e instanceof QwenAnalysisError&&e.code==='SEMANTIC_SERVICE_UNAVAILABLE')
  assert.equal(published,0)
  assert.ok(calls<=4,`expected one success and at most three in-flight failures, got ${calls}`)
  assert.ok(first.run.parts.some(p=>p.status==='waiting'))
  const saved=await readScanRun(bucket,'job')
  assert.equal(saved?.errorCode,'SEMANTIC_SERVICE_UNAVAILABLE')
  assert.equal(saved?.parts.filter(p=>p.status==='complete').length,1)
  assert.ok(saved?.parts.filter(p=>p.status==='failed').every(p=>p.errorCode==='QWEN_TIMEOUT'))
  const before=JSON.stringify(saved)
  outage=false
  const second=await startSemanticScan(bucket,'job',visual,config,publish);await second.execute()
  assert.equal(published,1);assert.equal(second.run.status,'complete');assert.equal(second.run.cacheHits,1)
  assert.equal(await(await bucket.get(`semantic-scans/job/runs/${first.run.id}.json`))!.text(),before)
})

test('service access errors keep their actionable code and stop scheduling other source packets',async t=>{
  const {bucket}=memoryBucket(),s=snapshot(16),visual={renderer:'test',previewKind:'reconstruction' as const,snapshot:s,assets:[],previews:s.slides.map(slide=>({id:slide.id,mime:'image/png'})),sheets:[]}
  for(const slide of s.slides)await bucket.put(`visual/job/preview-${slide.id}`,'synthetic-image')
  let calls=0
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('',{status:401})})
  const scan=await startSemanticScan(bucket,'job',visual,config,async()=>{throw Error('Must not publish an incomplete scan')})
  await assert.rejects(scan.execute(),(e:unknown)=>e instanceof QwenAnalysisError&&e.code==='QWEN_HTTP_401')
  assert.equal((await readScanRun(bucket,'job'))?.errorCode,'QWEN_HTTP_401')
  assert.ok(calls<=2);assert.ok(scan.run.parts.some(p=>p.status==='waiting'))
})

test('streaming scan replies get a longer bounded deadline and explicit deadlines are respected',async t=>{
  const s=snapshot(),visual={renderer:'test',previewKind:'reconstruction' as const,snapshot:s,assets:[],previews:[{id:'s01',mime:'image/png'}],sheets:[]}
  const deadlines: { milliseconds:number; controller:AbortController }[] = []
  t.mock.method(AbortSignal,'timeout',(milliseconds:number)=>{
    const controller=new AbortController();deadlines.push({milliseconds,controller});return controller.signal
  })
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
    const deadline=deadlines.shift()!,request=JSON.parse(init!.body as string)
    if(deadline.milliseconds<240_000){
      let chunks=0
      return new Response(new ReadableStream({pull(controller){
        if(chunks++===0)controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{"}}]}\n\n'))
        else {deadline.controller.abort();controller.error(new Error('Synthetic stream deadline'))}
      }}),{headers:{'content-type':'text/event-stream'}})
    }
    if(request.response_format.json_schema.name==='source_text_rules'){
      const data=JSON.parse(request.messages[1].content)
      return reply({rules:[],nonRuleIds:data.texts.map((x:{id:string})=>x.id),unresolved:[]})
    }
    const data=JSON.parse(request.messages[1].content[0].text)
    return reply({...empty(),content:data.nodes.map((n:{id:string})=>({elementId:n.id,role:'body'}))})
  })
  const {bucket}=memoryBucket();await bucket.put('visual/job/preview-s01','synthetic-image')
  const scan=await startSemanticScan(bucket,'job',visual,config,async()=>'catalog');await scan.execute()
  assert.equal(scan.run.status,'complete')
  const isolated=memoryBucket().bucket;await isolated.put('visual/job/preview-s01','synthetic-image')
  const limited=await startSemanticScan(isolated,'job',visual,{...config,timeoutMs:1000},async()=>{throw Error('Must not publish a partial JSON')})
  await assert.rejects(limited.execute(),(e:unknown)=>e instanceof QwenAnalysisError&&e.code==='SEMANTIC_PARTS_FAILED')
  assert.ok(limited.run.parts.every(p=>p.errorCode==='QWEN_TIMEOUT'))
})

test('an unreadable slide is reported without blocking healthy slides or sending partial objects to the model',async t=>{
  const {bucket}=memoryBucket(),s=snapshot(3),before=JSON.stringify(s)
  s.slides[1].warnings=['normalized-page-unavailable (page-image-byte-limit): incomplete']
  const original=JSON.stringify(s),visual={renderer:'test',previewKind:'reconstruction' as const,snapshot:s,assets:[],previews:[s.slides[0],s.slides[2]].map(slide=>({id:slide.id,mime:'image/png'})),sheets:[]}
  for(const p of visual.previews)await bucket.put(`visual/job/preview-${p.id}`,'synthetic-image')
  const supplied:string[]=[],published:SemanticSystem[]=[]
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
    const request=JSON.parse(init!.body as string)
    if(request.response_format.json_schema.name==='source_text_rules'){
      const data=JSON.parse(request.messages[1].content)
      assert.ok(data.texts.every((x:{text:string})=>x.text!==String(s.elements[1].properties.text)))
      return reply({rules:[],nonRuleIds:data.texts.map((x:{id:string})=>x.id),unresolved:[]})
    }
    const data=JSON.parse(request.messages[1].content[0].text)
    supplied.push(...data.requiredNodeIds)
    assert.ok(data.nodes.every((n:{slide:number})=>n.slide!==2))
    return reply({...empty(),content:data.nodes.map((n:{id:string})=>({elementId:n.id,role:'body'}))})
  })
  const scan=await startSemanticScan(bucket,'job',visual,config,async value=>{published.push(value);return 'catalog'})
  await scan.execute()
  assert.equal(scan.run.status,'complete');assert.equal(published.length,1)
  assert.deepEqual(supplied.sort(),['text-1','text-3'])
  assert.ok(scan.run.omissions?.some(o=>o.slides.includes(2)&&o.reason.includes('page-image-byte-limit')))
  assert.ok(published[0].sourcePending.some(p=>p.elementId==='text-2'))
  assert.equal((await compileSemanticLibrary(s,published[0])).metadata.coverage.complete,false)
  assert.equal(JSON.stringify(s),original);assert.notEqual(original,before)
})

test('a completely unreadable presentation cannot be marked complete or trigger model requests',async t=>{
  const {bucket}=memoryBucket(),s=snapshot();s.slides[0].warnings=['normalized-page-unavailable (invalid-file)'];s.elements=[]
  t.mock.method(globalThis,'fetch',async()=>{throw Error('Incomplete source cannot call the model')})
  await assert.rejects(startSemanticScan(bucket,'job',{renderer:'test',previewKind:'reconstruction',snapshot:s,assets:[],previews:[],sheets:[]},config,async()=>{throw Error('Incomplete source cannot publish')}),/ни одного слайда/)
})

test('deleting a style fences an already running scan and prevents its next model packet or publication',async t=>{
  const id=crypto.randomUUID(),{bucket}=memoryBucket(),s=snapshot(4)
  const visual={renderer:'test',previewKind:'reconstruction' as const,snapshot:s,assets:[],previews:s.slides.map(slide=>({id:slide.id,mime:'image/png'})),sheets:[]}
  for(const slide of s.slides)await bucket.put(`visual/${id}/preview-${slide.id}`,'synthetic-image')
  let release!:()=>void,started!:()=>void,calls=0,published=0
  const gate=new Promise<void>(r=>{release=r}),running=new Promise<void>(r=>{started=r})
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
    calls++;if(calls===2)started();await gate
    const request=JSON.parse(init!.body as string)
    if(request.response_format.json_schema.name==='source_text_rules'){
      const data=JSON.parse(request.messages[1].content)
      return reply({rules:[],nonRuleIds:data.texts.map((x:{id:string})=>x.id),unresolved:[]})
    }
    const data=JSON.parse(request.messages[1].content[0].text)
    return reply({...empty(),content:data.nodes.map((n:{id:string})=>({elementId:n.id,role:'body'}))})
  })
  const scan=await startSemanticScan(bucket,id,visual,config,async()=>{published++;return 'catalog'})
  const work=scan.execute();void work.catch(()=>undefined)
  await running;await removeBankStyle(bucket,id);release()
  await assert.rejects(work)
  assert.equal(calls,2);assert.equal(published,0)
  await assert.rejects(startSemanticScan(bucket,id,visual,config,async()=>''),/удалена/)
})

test('an expired scan lease exposes a resumable interruption without changing saved evidence',async()=>{
  const {bucket}=memoryBucket(),prefix='semantic-scans/job'
  const run={id:'interrupted',status:'running',parts:[{id:'scan-1',status:'complete'}]}
  await bucket.put(`${prefix}/current.json`,JSON.stringify({runId:run.id}))
  await bucket.put(`${prefix}/runs/${run.id}.json`,JSON.stringify(run))
  await bucket.put(`${prefix}/claim.json`,JSON.stringify({runId:run.id,expiresAt:Date.now()+60000}))
  assert.equal((await readScanRun(bucket,'job'))!.status,'running')
  await bucket.put(`${prefix}/claim.json`,JSON.stringify({runId:run.id,expiresAt:Date.now()-1}))
  const recovered=await readScanRun(bucket,'job')
  assert.equal(recovered!.status,'failed');assert.match(recovered!.error!,/прерван/)
  assert.equal(recovered!.parts[0].status,'complete')
  assert.deepEqual(await(await bucket.get(`${prefix}/runs/${run.id}.json`))!.json(),run)
})

test('full scan keeps bounded whole slides and accounts for oversized text explicitly',()=>{
  const s=snapshot(5),system=buildSourceSystem(s),plan=planSemanticScan(s,system)
  assert.equal(plan.suppliedIds.length,5);assert.equal(plan.batches.length,2)
  assert.deepEqual(plan.batches[0].nodes.map(n=>n.slide),[1,2,3])
  s.elements[0].properties.text='а'.repeat(40000)
  const large=planSemanticScan(s,buildSourceSystem(s))
  assert.equal(large.pending[0].elementId,'text-1');assert.equal(large.suppliedIds.length,4)
  assert.equal(String(s.elements[0].properties.text).length,40000)
})

test('source rule classifier covers all texts once and retains exact permission wording',()=>{
  const s=snapshot();s.elements[0].properties.text='Иконки можно перекрашивать только на этом слайде.'
  const texts=buildSourceSystem(s).texts
  const result=validateSourceRules({rules:[{textId:texts[0].id,title:'Иконки',interpretation:'На этом слайде можно менять цвет иконок.'}],nonRuleIds:[],unresolved:[]},texts)
  assert.equal(result.rules[0].sourceText,s.elements[0].properties.text)
  assert.throws(()=>validateSourceRules({rules:[],nonRuleIds:[],unresolved:[]},texts))
  assert.throws(()=>validateSourceRules({rules:[],nonRuleIds:[texts[0].id,texts[0].id],unresolved:[]},texts))
})

test('semantic compiler only exposes model-selected slots and retains source geometry',async()=>{
  const s=snapshot(),system=buildSourceSystem(s),batch=planSemanticScan(s,system).batches[0]
  const raw={...empty(),content:[{elementId:'text-1',role:'title'}]}
  const result=validateScanReply(raw,{snapshot:s,batch,styles:system.styles,fixedMarkerIds:[]})
  const semantic:SemanticSystem={version:'test',sourceId:s.sourceId,sourceRevision:await contentHash(s),batches:[{id:'scan-1',runId:'test',result}],rules:[],rulePending:[],sourcePending:[],retainedTableIds:[],omittedContainerIds:[]}
  const before=JSON.stringify(s),{library,metadata}=await compileSemanticLibrary(s,semantic)
  assert.equal(library.components[0].name,'Заголовок');assert.equal(library.components[0].slots[0].label,'Заголовок')
  assert.equal(library.components[0].scene.width,400);assert.equal(metadata.coverage.unresolved,0);assert.equal(JSON.stringify(s),before)
  const {bucket,data}=memoryBucket();const old=await initializeCatalog(bucket,'job',s)
  const catalogId=await installSemanticCatalog(bucket,'job',library,metadata)
  assert.notEqual(old,catalogId);assert.ok(data.has(`component-catalogs/job/${old}/source.json`))
  assert.equal((await getCatalogComponent(bucket,'job',library.components[0].id)).component.slots[0].defaultText,'Контрольный текст 1')
  assert.equal(await installSemanticCatalog(bucket,'job',library,metadata),catalogId)
})

test('full scan preserves successful packages across failure, resumes exactly, and prevents concurrent scans',async t=>{
  const {bucket}=memoryBucket(),s=snapshot(4),visual={renderer:'test',previewKind:'reconstruction' as const,snapshot:s,assets:[],previews:s.slides.map(slide=>({id:slide.id,mime:'image/png'})),sheets:[]}
  for(const slide of s.slides)await bucket.put(`visual/job/preview-${slide.id}`,'synthetic-image')
  let fail=true,calls=0,published=0
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
    calls++;const request=JSON.parse(init!.body as string)
    if(request.response_format.json_schema.name==='source_text_rules'){
      const data=JSON.parse(request.messages[1].content)
      return reply({rules:[],nonRuleIds:data.texts.map((x:{id:string})=>x.id),unresolved:[]})
    }
    const data=JSON.parse(request.messages[1].content[0].text)
    if(fail&&data.nodes.some((n:{id:string})=>n.id==='text-4'))return new Response('',{status:503})
    return reply({...empty(),content:data.nodes.map((n:{id:string})=>({elementId:n.id,role:'body'}))})
  })
  const publish=async()=>{published++;return 'new-catalog'}
  const first=await startSemanticScan(bucket,'job',visual,config,publish)
  await assert.rejects(startSemanticScan(bucket,'job',visual,config,publish),/уже/)
  await assert.rejects(first.execute());assert.equal(published,0);assert.equal(calls,3)
  fail=false
  const second=await startSemanticScan(bucket,'job',visual,config,publish);await second.execute()
  assert.equal(published,1);assert.equal(calls,4);assert.equal(second.run.cacheHits,2);assert.equal(second.run.liveRequests,1)
  assert.equal((await readScanRun(bucket,'job'))!.status,'complete')
  const repeated=await startSemanticScan(bucket,'job',visual,config,publish);await repeated.execute()
  assert.equal(repeated.run.liveRequests,0);assert.equal(repeated.run.cacheHits,3);assert.equal(calls,4)
})

test('contradictory pending remains unavailable, while a single clipped raster keeps its original viewport',async()=>{
  const s=snapshot(),base={rotation:0,opacity:1,visible:true,zIndex:0}
  s.assets=[{id:'picture',mime:'image/png',byteLength:1,origins:['ppt/media/image1.png']}]
  s.elements.push({id:'mask',name:'Фото',kind:'group',slide:1,properties:{...base,bounds:{x:500,y:40,width:100,height:100},clipsContent:true}},
    {id:'raster',parentId:'mask',name:'Изображение',kind:'raster',slide:1,properties:{...base,bounds:{x:-50,y:0,width:200,height:100},assetId:'picture',reason:'Source image'}})
  const system=buildSourceSystem(s),batch=planSemanticScan(s,system).batches[0]
  const result=validateScanReply({...empty(),atoms:[{elementId:'mask',name:'Фото',category:'photo'}],content:[{elementId:'text-1',role:'title'}],pending:[{elementId:'text-1',reason:'Роль не определена'},{elementId:'raster',reason:'Внутри маски'}]},
    {snapshot:s,batch,styles:system.styles,fixedMarkerIds:[]})
  assert.equal(result.coverage.unresolved,1)
  assert.equal(result.ledger.find(d=>d.elementId==='raster')!.representedBy,'mask')
  const {library}=await compileSemanticLibrary(s,{version:'test',sourceId:s.sourceId,sourceRevision:await contentHash(s),batches:[{id:'scan-1',runId:'test',result}],rules:[],sourcePending:[],rulePending:[],retainedTableIds:[],omittedContainerIds:[]})
  assert.equal(library.components.length,1);assert.equal(library.components[0].scene.width,100)
  assert.equal(library.components[0].scene.height,100);assert.deepEqual(library.components[0].source.assetIds,['picture'])
})

test('native fields are completed only inside selected blocks; non-text content remains uncertain',()=>{
  const s=snapshot(),base={rotation:0,opacity:1,visible:true,zIndex:0,bounds:{x:30,y:20,width:430,height:100}}
  s.elements.push({id:'box',name:'Плашка',kind:'rectangle',slide:1,properties:base})
  const system=buildSourceSystem(s),batch=planSemanticScan(s,system).batches[0]
  const context={snapshot:s,batch,styles:system.styles,fixedMarkerIds:[]}
  const raw={...empty(),molecules:[{name:'Карточка',elementIds:['box','text-1'],textSlots:[]}]}
  assert.equal(validateScanReply(raw,context).reply.molecules[0].textSlots[0].elementId,'text-1')
  const bad=validateScanReply({...empty(),content:[{elementId:'box',role:'body'},{elementId:'text-1',role:'title'}]},context)
  assert.equal(bad.ledger.find(d=>d.elementId==='box')!.role,'unresolved')
  assert.equal(bad.reply.content.length,1)
})

test('an explicitly selected text slot inside its card remains a member even when omitted from elementIds',()=>{
  const s=snapshot(),base={rotation:0,opacity:1,visible:true,zIndex:0}
  s.elements.push({id:'card',name:'Карточка',kind:'rectangle',slide:1,properties:{...base,bounds:{x:20,y:20,width:450,height:240}}},
    {id:'body',name:'Описание',kind:'text',slide:1,properties:{...s.elements[0].properties,text:'Описание',bounds:{x:40,y:120,width:400,height:70}}})
  const system=buildSourceSystem(s),batch=planSemanticScan(s,system).batches[0],context={snapshot:s,batch,styles:system.styles,fixedMarkerIds:[]}
  const raw={...empty(),molecules:[{name:'Карточка',elementIds:['card','text-1'],textSlots:[{elementId:'text-1',label:'Заголовок'},{elementId:'body',label:'Описание'}]}]},before=JSON.stringify(raw)
  const result=validateScanReply(raw,context)
  assert.deepEqual(result.reply.molecules[0].elementIds,['card','text-1','body'])
  assert.equal(result.coverage.unresolved,0);assert.equal(JSON.stringify(raw),before)
  assert.ok(result.normalizations.some(n=>n.from==='body'))
  const omitted=structuredClone(raw);omitted.molecules[0].textSlots.pop()
  assert.throws(()=>validateScanReply(omitted,context),e=>Array.isArray((e as {issues?:string[]}).issues)&&(e as {issues:string[]}).issues.includes('missing-decision:body'))
  s.elements.find(e=>e.id==='body')!.properties.bounds={x:650,y:350,width:200,height:70}
  const otherSystem=buildSourceSystem(s),otherBatch=planSemanticScan(s,otherSystem).batches[0]
  assert.throws(()=>validateScanReply(raw,{...context,batch:otherBatch,styles:otherSystem.styles}))
  assert.throws(()=>validateScanReply(raw,{...context,snapshot:structuredClone(context.snapshot),fixedMarkerIds:['body']}))
})

test('a one-text container and its selected field compile once with the original ancestor transform',async()=>{
  const s=snapshot(),base={rotation:0,opacity:1,visible:true,zIndex:0}
  s.elements[0].parentId='wrapper';s.elements[0].properties.bounds={x:0,y:0,width:400,height:70}
  s.elements.push({id:'wrapper',name:'Оболочка текста',kind:'group',slide:1,properties:{...base,rotation:7,bounds:{x:40,y:30,width:400,height:70}}},
    {id:'card',name:'Карточка',kind:'rectangle',slide:1,properties:{...base,bounds:{x:20,y:20,width:450,height:240}}})
  const system=buildSourceSystem(s),batch=planSemanticScan(s,system).batches[0],context={snapshot:s,batch,styles:system.styles,fixedMarkerIds:[]}
  assert.ok(batch.nodes.some(n=>n.id==='wrapper'))
  const raw={...empty(),molecules:[{name:'Карточка',elementIds:['card','wrapper','text-1'],textSlots:[{elementId:'text-1',label:'Заголовок'}]}]},before=JSON.stringify(s)
  const result=validateScanReply(raw,context)
  assert.deepEqual(result.reply.molecules[0].elementIds,['card','text-1'])
  assert.equal(result.ledger.find(d=>d.elementId==='wrapper')!.representedBy,'molecule-1')
  assert.equal(result.coverage.accounted,batch.nodes.length);assert.equal(result.coverage.unresolved,0)
  const {library}=await compileSemanticLibrary(s,{version:'test',sourceId:s.sourceId,sourceRevision:await contentHash(s),batches:[{id:'scan-1',runId:'test',result}],rules:[],sourcePending:[],rulePending:[],retainedTableIds:[],omittedContainerIds:[]})
  assert.equal(library.components.length,1);assert.equal(library.components[0].slots.length,1)
  const {flatten}=await import('../lib/design-system/compiler')
  const compiled=flatten(library.components[0].scene.elements)
  assert.equal(compiled.find(e=>e.id==='wrapper')!.rotation,7)
  assert.equal(compiled.filter(e=>e.id==='text-1').length,1);assert.equal(JSON.stringify(s),before)
  s.elements.push({id:'extra',parentId:'wrapper',name:'Неопределённая графика',kind:'rectangle',slide:1,properties:{...base,bounds:{x:0,y:0,width:20,height:20}}})
  const changed=buildSourceSystem(s)
  assert.throws(()=>validateScanReply(raw,{...context,batch:planSemanticScan(s,changed).batches[0],styles:changed.styles}))
})

test('unresolved batches receive one separate refinement and reuse both passes on replay',async t=>{
  const {bucket}=memoryBucket(),s=snapshot(),visual={renderer:'test',previewKind:'reconstruction' as const,snapshot:s,assets:[],previews:[{id:'s01',mime:'image/png'}],sheets:[]}
  await bucket.put('visual/job/preview-s01','synthetic-image')
  let calls=0
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
    calls++;const request=JSON.parse(init!.body as string)
    if(request.response_format.json_schema.name==='source_text_rules'){
      const data=JSON.parse(request.messages[1].content)
      return reply({rules:[],nonRuleIds:data.texts.map((x:{id:string})=>x.id),unresolved:[]})
    }
    if(request.messages.length===3)return reply({...empty(),content:[{elementId:'text-1',role:'title'}]})
    return reply({...empty(),pending:[{elementId:'text-1',reason:'Нужен адресный разбор'}]})
  })
  let published:SemanticSystem|undefined
  const publish=async(system:SemanticSystem)=>{published=system;return 'refined-catalog'}
  const first=await startSemanticScan(bucket,'job',visual,config,publish);await first.execute()
  assert.equal(calls,3);assert.equal(first.run.parts.length,3)
  assert.equal(published!.batches[0].result.coverage.unresolved,0)
  assert.ok(published!.batches[0].refinedFromRunId)
  const repeated=await startSemanticScan(bucket,'job',visual,config,publish);await repeated.execute()
  assert.equal(calls,3);assert.equal(repeated.run.liveRequests,0);assert.equal(repeated.run.cacheHits,3)
})

test('a rejected construction is isolated after clarification while valid components continue without repeat model calls',async t=>{
  const {bucket}=memoryBucket(),s=snapshot(),base={rotation:0,opacity:1,visible:true,zIndex:0}
  s.elements.push({id:'broken-card',name:'Проблемная карточка',kind:'rectangle',slide:1,properties:{...base,bounds:{x:20,y:160,width:300,height:140}}})
  const visual={renderer:'test',previewKind:'reconstruction' as const,snapshot:s,assets:[],previews:[{id:'s01',mime:'image/png'}],sheets:[]}
  await bucket.put('visual/job/preview-s01','synthetic-image')
  let calls=0,published:SemanticSystem|undefined
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
    calls++;const request=JSON.parse(init!.body as string)
    if(request.response_format.json_schema.name==='source_text_rules'){
      const data=JSON.parse(request.messages[1].content)
      return reply({rules:[],nonRuleIds:data.texts.map((x:{id:string})=>x.id),unresolved:[]})
    }
    return reply({...empty(),content:[{elementId:'text-1',role:'title'}],molecules:[{name:'Проблемная карточка',elementIds:['broken-card','foreign-id'],textSlots:[]}]})
  })
  const publish=async(system:SemanticSystem)=>{published=system;return 'partial-catalog'}
  const first=await startSemanticScan(bucket,'job',visual,config,publish);await first.execute()
  assert.equal(first.run.status,'complete');assert.equal(calls,3)
  assert.ok(first.run.omissions?.some(o=>o.elementIds.includes('broken-card')))
  assert.equal(published!.batches[0].result.ledger.find(d=>d.elementId==='broken-card')!.role,'unresolved')
  const compiled=await compileSemanticLibrary(s,published!)
  assert.equal(compiled.library.components.length,1);assert.equal(compiled.library.components[0].slots[0].defaultText,'Контрольный текст 1')
  assert.equal(compiled.metadata.coverage.unresolved,1)
  const repeated=await startSemanticScan(bucket,'job',visual,config,publish);await repeated.execute()
  assert.equal(calls,3);assert.equal(repeated.run.liveRequests,0);assert.equal(repeated.run.status,'complete')
})
