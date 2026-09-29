import assert from 'node:assert/strict'
import test from 'node:test'
import { validateVisualPackage, storeVisualPackage } from '../lib/digital-designer/visual-package'
import { designContext } from '../lib/digital-designer/design-context'
import knowledge from '../lib/digital-designer/knowledge.json'
import { sha256 } from '../lib/uploads/pptx-profiler'

async function fixture(){
 const bytes=Uint8Array.from([137,80,78,71,13,10,26,10]),id='asset-'+(await sha256(bytes)).slice(0,24),sourceId='a'.repeat(64)
 return {renderer:'drag-checkpoint-2026-09-24',previewKind:'reconstruction',snapshot:{schemaVersion:1,sourceId,name:'test.pptx',slideCount:1,slides:[{id:'s01',number:1,width:960,height:540,part:'ppt/slides/slide1.xml',text:'Правило источника: оранжевый для акцентов.',warnings:[]}],elements:[{id:'s01-picture-0-1',slide:1,kind:'source-picture',name:'picture',properties:{assetId:id}}],assets:[{id,mime:'image/png',byteLength:bytes.length,origins:['ppt/media/image1.png']}],colors:[{hex:'#FF800A',occurrences:1}],fonts:[{family:'Example Sans',sizes:[32],occurrences:1}],limitations:[]},assets:[{id,mime:'image/png',extension:'png',origins:['ppt/media/image1.png'],base64:Buffer.from(bytes).toString('base64')}],previews:[{id:'s01',dataUrl:'data:image/png;base64,'+Buffer.from(bytes).toString('base64')}],sheets:[{ids:[id],dataUrl:'data:image/png;base64,'+Buffer.from(bytes).toString('base64')}]}
}
test('visual package validates actual bytes and binds its source',async()=>{
 const value=await fixture();const checked=await validateVisualPackage(value,value.snapshot.sourceId)
 assert.equal(checked.assets.length,1)
 await assert.rejects(()=>validateVisualPackage(value,'b'.repeat(64)),/source mismatch/)
 value.assets[0].base64=Buffer.from([137,80,1]).toString('base64')
 await assert.rejects(()=>validateVisualPackage(value,value.snapshot.sourceId),/hash mismatch/)
})
test('unknown previews, missing assets and ancestry cycles are rejected',async()=>{
 const value=await fixture();value.previews[0].id='s02'
 await assert.rejects(()=>validateVisualPackage(value,value.snapshot.sourceId),/preview reference/)
 const v=await fixture();v.snapshot.elements[0].properties.assetId='asset-'+'b'.repeat(24)
 await assert.rejects(()=>validateVisualPackage(v,v.snapshot.sourceId),/Missing resource/)
 const cycle=await fixture();Object.assign(cycle.snapshot.elements[0],{parentId:cycle.snapshot.elements[0].id})
 await assert.rejects(()=>validateVisualPackage(cycle,cycle.snapshot.sourceId),/Cyclic/)
})
test('storage keeps original media separately and commits manifest last',async()=>{
 const raw=await fixture(),v=await validateVisualPackage(raw,raw.snapshot.sourceId),keys:string[]=[]
 const bucket={head:async()=>null,put:async(key:string)=>{keys.push(key)}} as unknown as R2Bucket
 const manifest=await storeVisualPackage(bucket,'job',v)
 assert.equal(keys.at(-1),'visual/job/manifest.json')
 assert.equal(manifest.previews.length,1)
 assert.ok(keys.includes('visual/job/'+v.assets[0].id))
})
test('colleague context includes source rules, measurements, MIME and grounded resource references',async()=>{
 const raw=await fixture(),v=await validateVisualPackage(raw,raw.snapshot.sourceId)
 const task=designContext(v.snapshot,knowledge,[{id:'s01',kind:'slide',mime:'image/png',bytes:Uint8Array.from([137,80])}])
 assert.ok(JSON.stringify(task.context).includes('оранжевый для акцентов'))
 assert.ok(task.refs.elementAssetIds?.has('s01-picture-0-1'))
 assert.ok(task.refs.visualSlideIds.has('s01'))
 assert.match(JSON.stringify(task.messages),/data:image\/png;base64/)
 assert.match(String(task.messages[0].content),/не независимый PowerPoint/)
 assert.equal(task.refs.visualAssetIds.size,0)
})

test('visual model receives real evidence and quarantines invented references',async()=>{
 const {analyzeVisual}=await import('../lib/digital-designer/visual-analysis')
 const raw=await fixture(),v=await validateVisualPackage(raw,raw.snapshot.sourceId)
 const task=designContext(v.snapshot,knowledge,[{id:'s01',kind:'slide',mime:'image/jpeg',bytes:Uint8Array.from([255,216])}])
 const candidate={id:'rule',categoryId:knowledge.catalogue[0].id,name:'Акцент',kind:'rule',value:'Оранжевый выделяет ключевые блоки.',role:'Акцент',confidence:.9,reviewStatus:'candidate',evidence:{basis:'visual_observation',slideIds:['s01'],elementIds:['s01-picture-0-1'],assetIds:[]},transforms:{allowed:[],forbidden:[],unknown:[]}}
 const reply={schemaVersion:1,sourceId:v.snapshot.sourceId,summary:'Визуальный разбор',findings:[candidate,{...candidate,id:'invented',evidence:{...candidate.evidence,elementIds:['s01-missing']}}],photoStyle:{status:'insufficient_evidence',variants:[],limitations:['Недостаточно фото']},coverage:knowledge.catalogue.map(c=>({categoryId:c.id,status:'not_assessed',note:'Тест'})),uncertainties:['Реконструкция']}
 const original=globalThis.fetch;let saved=''
 globalThis.fetch=async(_url,options)=>{
   const body=JSON.parse(String(options?.body));assert.equal(body.response_format.json_schema.name,'design_analysis');assert.equal(body.chat_template_kwargs.enable_thinking,false)
   assert.ok(JSON.stringify(body.messages).includes('data:image/jpeg;base64,'))
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reply)}}]})
 }
 try{
   const result=await analyzeVisual(task,{apiKey:'test-only'},undefined,async text=>{saved=text})
   assert.equal(saved,JSON.stringify(reply));assert.equal(result.status,'analyzed')
   if(result.status==='analyzed'){assert.equal(result.checkpoint.visualAnalysis,true);assert.equal(result.checkpoint.result.findings.length,1);assert.equal(result.checkpoint.rejected.length,1)}
 }finally{globalThis.fetch=original}
})

test('multimodal completion tolerates SSE metadata overhead without removing content limits',async()=>{
 const {completionText}=await import('../lib/uploads/qwen-analysis')
 const data=Array.from({length:4000},()=>`data: ${JSON.stringify({id:'provider-request-id',object:'chat.completion.chunk',model:'qwen3.8-27b',metadata:'x'.repeat(220),choices:[{delta:{content:'a'},finish_reason:null}]})}\n\n`).join('')+`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`
 assert.ok(data.length>1_000_000)
 assert.equal((await completionText(new Response(data,{headers:{'Content-Type':'text/event-stream'}}))).length,4000)
 const oversized=`data: ${JSON.stringify({choices:[{delta:{content:'a'.repeat(1_000_001)},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`
 await assert.rejects(()=>completionText(new Response(oversized,{headers:{'Content-Type':'text/event-stream'}})),/content exceeds/)
})

test('oversized model evidence is detected before images are buffered',async()=>{
 const {prepareVisualInput}=await import('../lib/digital-designer/visual-analysis')
 const {QwenAnalysisError}=await import('../lib/uploads/qwen-analysis')
 const raw=await fixture(),value=await validateVisualPackage(raw,raw.snapshot.sourceId)
 const manifest=await storeVisualPackage({head:async()=>null,put:async()=>{}} as unknown as R2Bucket,'job',value)
 let reads=0
 const bucket={head:async()=>({size:5*1024*1024}),get:async()=>{reads++;throw new Error('Must check the total before loading images')}} as unknown as R2Bucket
 await assert.rejects(prepareVisualInput(bucket,'job',manifest),e=>e instanceof QwenAnalysisError&&e.code==='VISUAL_CONTEXT_TOO_LARGE')
 assert.equal(reads,0)
})
