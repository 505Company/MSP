import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { refinementFixture, refinementConfig, passingReport } from './fixtures/refinement'
import { sourceText } from './fixtures/native-layout'
import { auditSourceIntegrity } from '../lib/design-system/source-integrity'
import { validateQualityReply, validateStyleAudit, MAX_AUDIT_REPAIRS, type AuditResult, type SourceIntegrity } from '../lib/design-system/quality-audit-contract'
import { qualityAuditState, startQualityAudit, advanceQualityAudit, qualityAuditPacket, prepareAuditRepairs, queueAuditRepair, settleAuditRepair, planAuditRepairs, recheckQualityAudit, retryInterruptedQualityAudit } from '../lib/design-system/quality-audit'
import { auditRoot, enableQualityAudit, readQualityAudit, readAuditResults, mutateQualityAudit } from '../lib/design-system/quality-audit-storage'
import { validateAuditEvidence, type AuditInput } from '../lib/design-system/quality-audit-task'
import { advanceRefinement, refinementCandidate, reportRefinement, completeRefinement, validateRefinementReply } from '../lib/design-system/refinement'
import { readRefinementRegistry } from '../lib/design-system/refinement-storage'
import { readEditableCatalog } from '../lib/design-system/editable-analysis'
const modelResponse=(raw:unknown)=>new Response(JSON.stringify({id:'audit-test',model:'test',choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]}),{headers:{'content-type':'application/json'}})

const integrity:SourceIntegrity={status:'checked',resources:0,missing:[],incompleteSlides:[]}
const evidence={boards:[{ids:['original'],image:'data:image/jpeg;base64,YQ=='}],failed:[]}
function reply(f:Awaited<ReturnType<typeof refinementFixture>>) {
  return {slides:[{slide:1,units:[{id:'whole-card',name:'Показатель с объяснением',purpose:'Объясняет число через подпись',level:'component' as const,sourceIds:f.second.sourceIds,textIds:['value-second','caption-second'],keepTogether:true,preserve:['Подпись и число принадлежат одной подложке']}],relations:[],techniques:[{name:'Плашка с текстом',purpose:'Группирует значение и пояснение',sourceIds:f.second.sourceIds,preserve:['Число и подпись остаются вместе']}],findings:[{id:'missing',kind:'missing-unit' as const,unitId:'whole-card',sourceIds:f.second.sourceIds,componentIds:[],reason:'В каталоге отсутствует второй целый блок',repair:'component' as const}],note:''}]}
}
const style=(sourceIds:string[])=>({summary:'Показатели сгруппированы с пояснениями',patterns:[{name:'Плашки с подписью',purpose:'Объяснять данные',application:'Для значений с пояснением',scope:'observed' as const,preserve:['Связь числа с подписью'],evidence:[{slide:1,sourceIds}]}],limitations:[]})

test('one invalid finding does not erase valid meaning and independent findings on its slide',async()=>{
 const f=await refinementFixture(),raw=reply(f)
 raw.slides[0].findings.push({...raw.slides[0].findings[0],id:'wrong-unit',sourceIds:f.first.sourceIds})
 const result=validateQualityReply(raw,f.visual.snapshot,f.base,[1])
 assert.equal(result.slides.length,1);assert.equal(result.slides[0].units.length,1)
 assert.deepEqual(result.slides[0].findings.map(f=>f.id),['missing'])
 assert.match(result.rejected[0].reason,/wrong-unit.*не относится/)
})

test('explicit interrupted-packet retry is bounded, preserves the failed response and accounts for both requests',async t=>{
 const f=await refinementFixture(),job=(await startQualityAudit(f.bucket,f.id,integrity,true))!
 const prefix=`${auditRoot(f.id)}/${job.id}/models/${job.batches[0].id}`
 // A transport interruption can leave the packet acknowledgment pending.
 const run={id:'interrupted',status:'failed',liveRequests:1,error:{code:'QWEN_CANCELLED',message:'Interrupted'}}
 await f.bucket.put(`${prefix}/current.json`,JSON.stringify({runId:run.id}))
 await f.bucket.put(`${prefix}/runs/${run.id}.json`,JSON.stringify(run))
 await f.bucket.put(`${prefix}/responses/${run.id}.json`,JSON.stringify({content:'{"unfinished":'}))
 const original=f.data.get(`${prefix}/responses/${run.id}.json`)!.value
 const retried=await retryInterruptedQualityAudit(f.bucket,f.id,job.id)
 assert.equal(retried.batches[0].attempt,1);assert.equal(retried.modelRequests,1)
 await retryInterruptedQualityAudit(f.bucket,f.id,job.id)
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return modelResponse(reply(f))})
 await advanceQualityAudit(f.bucket,f.id,job.id,refinementConfig,evidence)
 const state=await qualityAuditState(f.bucket,f.id)
 assert.equal(calls,1);assert.equal(state.job!.modelRequests,2);assert.equal(state.job!.batches[0].status,'complete')
 await retryInterruptedQualityAudit(f.bucket,f.id,job.id)
 assert.equal((await readQualityAudit(f.bucket,f.id))!.batches[0].attempt,1)
 assert.equal(f.data.get(`${prefix}/responses/${run.id}.json`)!.value,original)
 assert.deepEqual(await (await f.bucket.get(`${prefix}/runs/${run.id}.json`))!.json(),run)
})

test('explicit recovery never duplicates a running request or retries semantic rejection',async()=>{
 for(const run of [{id:'active',status:'running',liveRequests:1},{id:'rejected',status:'failed',liveRequests:1,error:{code:'SEMANTIC_VALIDATION'}}]){
  const f=await refinementFixture(),job=(await startQualityAudit(f.bucket,f.id,integrity,true))!
  const prefix=`${auditRoot(f.id)}/${job.id}/models/${job.batches[0].id}`
  await f.bucket.put(`${prefix}/current.json`,JSON.stringify({runId:run.id}))
  await f.bucket.put(`${prefix}/runs/${run.id}.json`,JSON.stringify(run))
  const state=await retryInterruptedQualityAudit(f.bucket,f.id,job.id)
  assert.equal(state.batches[0].attempt,undefined);assert.equal(state.modelRequests,0)
 }
})

test('source integrity finds image-filled shapes and inherited images missing from the imported inventory',async()=>{
  const f=await refinementFixture(),zip=new JSZip(),s=structuredClone(f.visual.snapshot);s.name='Test.pptx'
  zip.file('ppt/slides/slide1.xml','<p:sld><p:sp><a:blipFill><a:blip r:embed="formula"/></a:blipFill></p:sp></p:sld>')
  zip.file('ppt/slides/_rels/slide1.xml.rels','<Relationships><Relationship Id="formula" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/equation.png"/><Relationship Id="layout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/layout1.xml"/><Relationship Id="unused" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/unused.png"/></Relationships>')
  zip.file('ppt/slideLayouts/layout1.xml','<p:sldLayout><a:blip r:embed="bg"/></p:sldLayout>')
  zip.file('ppt/slideLayouts/_rels/layout1.xml.rels','<Relationships><Relationship Id="bg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/background.png"/></Relationships>')
  const result=await auditSourceIntegrity(await zip.generateAsync({type:'uint8array'}),s)
  assert.equal(result.resources,2);assert.deepEqual(result.missing.map(m=>m.path).sort(),['ppt/media/background.png','ppt/media/equation.png'])
  s.assets.push({id:'asset-known',mime:'image/png',byteLength:1,origins:['ppt/media/equation.png']})
  assert.equal((await auditSourceIntegrity(await zip.generateAsync({type:'uint8array'}),s)).missing.length,1)
})

test('semantic units keep an external explanatory paragraph; invented links and lost text are isolated',async()=>{
  const f=await refinementFixture(),snapshot=structuredClone(f.visual.snapshot),raw=reply(f)
  snapshot.elements.push(sourceText('explanation','Пояснение под всей конструкцией',950,510,620,60,24))
  raw.slides[0].units[0].sourceIds=[...f.second.sourceIds,'explanation'];raw.slides[0].units[0].textIds.push('explanation');raw.slides[0].findings[0].sourceIds=[...raw.slides[0].units[0].sourceIds]
  assert.equal(validateQualityReply(raw,snapshot,f.base,[1]).slides.length,1)
  raw.slides[0].units[0].textIds.pop()
  assert.match(validateQualityReply(raw,snapshot,f.base,[1]).rejected[0].reason,/теряет текст/)
  raw.slides[0].units[0].textIds.push('explanation');raw.slides[0].findings[0].sourceIds=[...f.second.sourceIds]
  const checked=validateQualityReply(raw,snapshot,f.base,[1])
  assert.equal(checked.rejected.length,0)
  const plan=planAuditRepairs({visual:{...f.visual,snapshot},catalog:f.base,graphics:[]},[checked])
  assert.ok(plan[0].sourceIds.includes('explanation'),'repair includes the whole unit despite narrower defect evidence')
  raw.slides[0].findings[0].sourceIds=[...f.first.sourceIds]
  assert.match(validateQualityReply(raw,snapshot,f.base,[1]).rejected[0].reason,/не относится/)
  const mixed={slides:[...reply(f).slides,{slide:2,units:[{id:'invented'}]}]}
  const result=validateQualityReply(mixed,snapshot,f.base,[1,2]);assert.equal(result.slides.length,1);assert.equal(result.rejected[0].slide,2)
})

test('validator replay recovers exact saved evidence without changing responses or paying again',async t=>{
 const f=await refinementFixture();await enableQualityAudit(f.bucket,f.id,f.visual.snapshot.sourceId)
 const job=(await startQualityAudit(f.bucket,f.id,integrity))!;let calls=0
 const raw=reply(f);raw.slides[0].findings[0].sourceIds=['value-second']
 t.mock.method(globalThis,'fetch',async()=>{calls++;return modelResponse(raw)})
 await advanceQualityAudit(f.bucket,f.id,job.id,refinementConfig,evidence)
 const prefix=`${auditRoot(f.id)}/${job.id}`,originalKey=`${prefix}/results/${job.batches[0].id}.json`
 // Simulate the earlier validator's result while retaining the provider reply.
 const previous={slides:[],rejected:[{slide:1,reason:'Область исправления обрезает смысловой блок'}]}
 await f.bucket.put(originalKey,JSON.stringify(previous))
 await mutateQualityAudit(f.bucket,f.id,job.id,j=>({...j,batches:j.batches.map(b=>({...b,status:'partial'}))}))
 const unchanged=[...f.data.entries()].filter(([key])=>key.includes('/responses/')||key.includes('/runs/')).map(([key,value])=>[key,value.value])
 await recheckQualityAudit(f.bucket,f.id,job.id)
 const state=await qualityAuditState(f.bucket,f.id)
 assert.equal(state.job!.batches[0].status,'complete');assert.equal(state.job!.modelRequests,1);assert.equal(calls,1)
 assert.equal(state.results[0].slides[0].units[0].purpose,raw.slides[0].units[0].purpose)
 assert.deepEqual(await (await f.bucket.get(originalKey))!.json(),previous)
 for(const [key,value]of unchanged)assert.equal(f.data.get(key)!.value,value)
})

test('a style rule needs grounded evidence and two slides before it becomes a recurring pattern',async()=>{
  const f=await refinementFixture(),results=[validateQualityReply(reply(f),f.visual.snapshot,f.base,[1])],s=style(f.second.sourceIds)
  assert.doesNotThrow(()=>validateStyleAudit(s,f.visual.snapshot,results))
  assert.throws(()=>validateStyleAudit({...s,patterns:s.patterns.map(p=>({...p,scope:'recurring'}))},f.visual.snapshot,results),/проверку объектов/)
  assert.throws(()=>validateStyleAudit({...s,patterns:s.patterns.map(p=>({...p,evidence:[{slide:1,sourceIds:['invented']}]}))},f.visual.snapshot,results),/проверку объектов/)
})

test('old libraries do not start a paid audit on read; evidence includes every variant',async()=>{
  const f=await refinementFixture(),input:AuditInput={visual:f.visual,catalog:f.base,graphics:[]}
  assert.equal((await qualityAuditState(f.bucket,f.id)).enabled,false)
  assert.equal(await startQualityAudit(f.bucket,f.id,integrity),null)
  await enableQualityAudit(f.bucket,f.id,f.visual.snapshot.sourceId)
  const job=(await startQualityAudit(f.bucket,f.id,integrity))!
  assert.equal((await startQualityAudit(f.bucket,f.id,integrity))!.id,job.id)
  assert.throws(()=>validateAuditEvidence({boards:[],failed:[]},input,job.batches[0]),/каждого компонента/)
  assert.doesNotThrow(()=>validateAuditEvidence(evidence,input,job.batches[0]))
  assert.throws(()=>validateAuditEvidence({boards:[...evidence.boards,...evidence.boards],failed:[]},input,job.batches[0]),/каждого компонента/)
})

test('the independent model audit persists meaning, verifies a targeted repair, and reuses completed packets after a restart',async t=>{
  const f=await refinementFixture(),original=f.data.get(f.baseKey)!.value
  await enableQualityAudit(f.bucket,f.id,f.visual.snapshot.sourceId)
  const job=(await startQualityAudit(f.bucket,f.id,integrity))!,requests:string[]=[]
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
    const task=JSON.parse(init!.body as string),name=task.response_format.json_schema.name;requests.push(name)
    if(name==='design_quality_audit'){
      const context=JSON.parse(task.messages[1].content[0].text);assert.ok(context.slides[0].components[0].sourceIds);assert.match(task.messages[0].content,/поясняющим абзацем/)
      return modelResponse(reply(f))
    }
    if(name==='template_design_intent')return modelResponse(style(f.second.sourceIds))
    assert.match(JSON.stringify(task.messages.at(-1)),/whole-card/)
    return modelResponse(f.reply)
  })
  await advanceQualityAudit(f.bucket,f.id,job.id,refinementConfig,evidence)
  const results=await readAuditResults(f.bucket,f.id,(await readQualityAudit(f.bucket,f.id))!);assert.equal(results[0].slides[0].units[0].purpose,'Объясняет число через подпись')
  // Model result committed, job acknowledgement lost: recover without a call.
  await mutateQualityAudit(f.bucket,f.id,job.id,j=>({...j,modelRequests:0,batches:j.batches.map(b=>({...b,status:'pending'}))}))
  await advanceQualityAudit(f.bucket,f.id,job.id,refinementConfig)
  assert.equal(requests.length,1)
  await advanceQualityAudit(f.bucket,f.id,job.id,refinementConfig)
  await prepareAuditRepairs(f.bucket,f.id,job.id)
  const repair=(await queueAuditRepair(f.bucket,f.id,job.id))!
  assert.ok(repair.requestId);assert.equal((await queueAuditRepair(f.bucket,f.id,job.id))!.requestId,repair.requestId)
  await advanceRefinement(f.bucket,f.id,repair.requestId!,refinementConfig)
  const candidate=(await refinementCandidate(f.bucket,f.id,repair.requestId!))!
  assert.ok(candidate.catalog.families.length)
  await reportRefinement(f.bucket,f.id,repair.requestId!,passingReport(candidate.catalog));await completeRefinement(f.bucket,f.id,repair.requestId!)
  const completed=await settleAuditRepair(f.bucket,f.id,job.id,repair.id)
  assert.equal(completed.status,'complete');assert.equal(completed.repairs[0].status,'accepted')
  assert.deepEqual(requests,['design_quality_audit','template_design_intent','editable_constructions'])
  assert.equal(f.data.get(f.baseKey)!.value,original,'existing source catalog stays immutable')
  const catalog=await readEditableCatalog(f.bucket,f.id)
  assert.equal(catalog!.designIntent!.style!.patterns.length,1)
  assert.equal(catalog!.designIntent!.slides[0].units[0].id,'whole-card')
})

test('a failed audit packet never retries a billable request or prevents the remaining audit phases',async t=>{
  const f=await refinementFixture();await enableQualityAudit(f.bucket,f.id,f.visual.snapshot.sourceId)
  const job=(await startQualityAudit(f.bucket,f.id,integrity))!
  let calls=0
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('Unavailable',{status:503})})
  await advanceQualityAudit(f.bucket,f.id,job.id,refinementConfig,evidence)
  assert.equal((await readQualityAudit(f.bucket,f.id))!.batches[0].status,'skipped')
  await advanceQualityAudit(f.bucket,f.id,job.id,refinementConfig)
  assert.equal((await readQualityAudit(f.bucket,f.id))!.overview.status,'skipped')
  await advanceQualityAudit(f.bucket,f.id,job.id,refinementConfig)
  assert.equal(calls,2)
  assert.equal((await prepareAuditRepairs(f.bucket,f.id,job.id)).status,'complete')
  assert.equal((await qualityAuditState(f.bucket,f.id)).results.length,0,'no false quality certificate')
})

test('audit repairs are bounded and a rejected whole-block repair releases the queue',async()=>{
  const f=await refinementFixture(),r=validateQualityReply(reply(f),f.visual.snapshot,f.base,[1]),input:AuditInput={visual:f.visual,catalog:f.base,graphics:[]}
  const duplicated:AuditResult={slides:Array.from({length:10},()=>structuredClone(r.slides[0])),rejected:[]}
  const plan=planAuditRepairs(input,[duplicated])
  assert.equal(plan.length,1);assert.ok(plan.filter(p=>p.status==='pending').length<=MAX_AUDIT_REPAIRS)
  await enableQualityAudit(f.bucket,f.id,f.visual.snapshot.sourceId);const job=(await startQualityAudit(f.bucket,f.id,integrity))!
  await f.bucket.put(`${auditRoot(f.id)}/${job.id}/results/${job.batches[0].id}.json`,JSON.stringify(r))
  await mutateQualityAudit(f.bucket,f.id,job.id,j=>({...j,batches:j.batches.map(b=>({...b,status:'complete'})),overview:{...j.overview,status:'skipped'}}))
  await prepareAuditRepairs(f.bucket,f.id,job.id);const repair=(await queueAuditRepair(f.bucket,f.id,job.id))!
  const stopped=await settleAuditRepair(f.bucket,f.id,job.id,repair.id,'Проверка не прошла')
  assert.equal(stopped.repairs[0].status,'unresolved');assert.equal((await readRefinementRegistry(f.bucket,f.id)).pending,null)
  assert.equal((await qualityAuditPacket(f.bucket,f.id,job.id)),null)
})

test('an audit repair cannot close a finding by returning disconnected fragments',async()=>{
  const f=await refinementFixture(),job={id:'id',mode:'region',input:{audit:{revision:'a'.repeat(64),findingId:'finding'}},tasks:[{slide:1,selectedIds:[...f.first.sourceIds,...f.second.sourceIds]}]} as Parameters<typeof validateRefinementReply>[2]
  assert.throws(()=>validateRefinementReply({slides:[{slide:1,blocks:[f.first,f.second],note:''}]},f.visual,job,1),/проверку объектов/)
})

test('an already qualified whole composition is reviewed instead of paid duplication, while appearance can still be repaired',async()=>{
 const f=await refinementFixture(),r=reply(f),input:AuditInput={visual:f.visual,catalog:f.base,graphics:[]}
 r.slides[0].units[0].sourceIds=f.first.sourceIds
 r.slides[0].findings[0].sourceIds=f.first.sourceIds
 let plan=planAuditRepairs(input,[{...r,rejected:[]}])
 assert.equal(plan[0].status,'deferred');assert.match(plan[0].detail!,/Целая конструкция уже есть/)
 const finding={...r.slides[0].findings[0],kind:'appearance' as const}
 plan=planAuditRepairs(input,[{slides:[{...r.slides[0],findings:[finding]}],rejected:[]}])
 assert.equal(plan[0].status,'pending')
})

test('repairing a lost relationship includes both the explanation and the construction it explains',async()=>{
 const f=await refinementFixture(),raw=reply(f),paragraph=raw.slides[0].units[0]
 const related={...paragraph,id:'explained-construction',sourceIds:f.first.sourceIds,textIds:['value','caption']}
 const slide={...raw.slides[0],units:[paragraph,related],relations:[{from:paragraph.id,to:related.id,kind:'explains' as const,reason:'Пояснение относится к конструкции'}],findings:[{...raw.slides[0].findings[0],kind:'lost-relationship' as const}]}
 const input:AuditInput={visual:f.visual,catalog:f.base,graphics:[]}
 const checked=validateQualityReply({slides:[slide]},f.visual.snapshot,f.base,[1])
 assert.equal(checked.rejected.length,0)
 const plan=planAuditRepairs(input,[checked])
 assert.equal(plan.length,1)
 for(const id of [...f.first.sourceIds,...f.second.sourceIds])assert.ok(plan[0].sourceIds.includes(id),'repair keeps both endpoints: '+id)
 assert.ok(plan[0].region.width>.5,'the region includes both connected blocks')
})

test('repair planning limits work per slide and per import while retaining every excess finding',async()=>{
 const f=await refinementFixture(),snapshot=structuredClone(f.visual.snapshot);snapshot.elements=[];snapshot.slides=[];snapshot.slideCount=5
 const result:AuditResult={slides:[],rejected:[]}
 for(let slide=1;slide<=5;slide++){
  snapshot.slides.push({...f.visual.snapshot.slides[0],id:`s${slide}`,number:slide})
  const item={...reply(f).slides[0],slide,units:[],findings:[]} as AuditResult['slides'][number]
  for(let block=0;block<4;block++){
   const id=`s${slide}-field-${block}`,e=sourceText(id,'Meaning',30,block*100,300,60,24);e.slide=slide;snapshot.elements.push(e)
   item.units.push({id,name:'Meaning',purpose:'Keep explanation',level:'component',sourceIds:[id],textIds:[id],keepTogether:true,preserve:['Text']})
   item.findings.push({id,unitId:id,kind:'missing-unit',sourceIds:[id],componentIds:[],reason:'Missing block',repair:'component'})
  }
  result.slides.push(item)
 }
 const plan=planAuditRepairs({visual:{...f.visual,snapshot},catalog:f.base,graphics:[]},[result])
 assert.equal(plan.length,20);assert.equal(plan.filter(r=>r.status==='pending').length,MAX_AUDIT_REPAIRS)
 for(let slide=1;slide<=5;slide++)assert.ok(plan.filter(r=>r.slide===slide&&r.status==='pending').length<=2)
 assert.ok(plan.filter(r=>r.status==='deferred').every(r=>r.detail?.includes('лимит')))
})
