import {test} from 'node:test'
import assert from 'node:assert/strict'
import {semanticSource,semanticContentTask,validateSemanticContent,type SemanticReply} from '../lib/presentations/studio/semantic-content'
import {structureStudioRun} from '../lib/presentations/studio/semantic-task'
import {designStudioBatch} from '../lib/presentations/studio/task'
import {studioFixture,measuredStudioFixture} from './fixtures/studio'
import {memoryBucket} from './helpers/memory-bucket'
import {studioKey,readStudioRun,commitStudioOptions} from '../lib/presentations/studio/storage'
import {SemanticValidationError} from '../lib/design-system/semantic-contract'

// Contract fixture only: the live pilot never uses this reply or these groups.
const source=`# Два ограничения
01
СКЛАД
Не хватает места.
−12%
свободной площади
02
ДОСТАВКА
Нет вечерних рейсов.
3 часа
ожидания
---
# Выбор 📦
Более свободный двухколоночный слайд.
БЫЛО
«Что купить?»
«Где забрать?»
→
СТАЛО
«Что подойдет мне?»
«Когда доставят?»
Внизу крупная цифра:
62% выбирают доставку`
function reply():SemanticReply{
  const lines=semanticSource(source)
  const ref=(quote:string)=>({line:lines.find(l=>l.text.includes(quote))!.id,quote})
  const block=(kind:SemanticReply['slides'][number]['blocks'][number]['kind'],role:'title'|'body',values:Record<string,string[]>,bottom=false)=>({kind,role,emphasis:bottom?'primary' as const:'normal' as const,placement:bottom?'bottom' as const:'auto' as const,fields:Object.entries(values).map(([name,quotes])=>({name:name as 'text',refs:quotes.map(ref)}))})
  return {slides:[{blocks:[block('text','title',{text:['Два ограничения']}),block('step','body',{marker:['01'],heading:['СКЛАД'],body:['Не хватает места.','−12%','свободной площади']}),block('step','body',{marker:['02'],heading:['ДОСТАВКА'],body:['Нет вечерних рейсов.','3 часа','ожидания']})]},
    {blocks:[block('text','title',{text:['Выбор 📦']}),block('feature','body',{heading:['БЫЛО'],body:['«Что купить?»','«Где забрать?»']}),block('feature','body',{heading:['СТАЛО'],body:['«Что подойдет мне?»','«Когда доставят?»']}),block('metric','body',{value:['62%'],caption:['выбирают доставку']},true)]}],directions:lines.filter(l=>l.instruction).map(l=>l.id)}
}
test('semantic task sees unchanged prose before recipes and checks exact source coverage',()=>{
  const {task,validate}=semanticContentTask(source),user=JSON.parse(task.messages[1].content as string)
  assert.equal(user.rawText,source);assert.equal(task.reasoningEffort,'medium');assert.equal(task.thinking,true)
  assert.ok(!('candidates' in user));assert.ok(!('blocks' in user))
  const result=validate(reply());assert.equal(result.slides.length,2)
  assert.deepEqual(result.slides[0].blocks.slice(1).map(b=>b.fields.body),['Не хватает места.\n−12%\nсвободной площади','Нет вечерних рейсов.\n3 часа\nожидания'])
  assert.equal(result.slides[1].blocks[2].fields.body,'«Что подойдет мне?»\n«Когда доставят?»')
  assert.equal(result.slides[1].blocks[3].placement,'bottom');assert.equal(result.slides[1].blocks[3].role,'body')
  assert.equal(result.proof.contentLines,semanticSource(source).filter(l=>!l.instruction).length)
})
test('dropped, duplicated, invented and cross-slide content cannot reach rendering',()=>{
  const variants:[string,(r:SemanticReply)=>void][]=[
    ['source-not-fully-covered',r=>{r.slides[0].blocks[1].fields[2].refs.pop()}],
    ['duplicate-source-character',r=>{r.slides[0].blocks[1].fields[2].refs.push(r.slides[0].blocks[1].fields[2].refs[0])}],
    ['quote-not-exact',r=>{r.slides[0].blocks[1].fields[2].refs[1].quote='−99%'}],
    ['reference-crosses-slide',r=>{r.slides[0].blocks[1].fields[2].refs[0]=r.slides[1].blocks[1].fields[1].refs[0]}],
    ['content-cannot-be-discarded',r=>{r.directions.push('l1')}],
    ['explicit-slide-boundaries-changed',r=>{r.slides.pop()}],
  ]
  for(const [message,mutate] of variants){const r=reply();mutate(r);assert.throws(()=>validateSemanticContent(r,source),(e:unknown)=>e instanceof SemanticValidationError&&e.issues.some(i=>i.includes(message)))}
})
async function savedRun(){
  const run=studioFixture('smart'),{bucket}=memoryBucket();run.semantic={source,status:'pending'};run.slides=[];run.status='preparing'
  const project={schemaVersion:1,id:run.projectId,revision:run.revision,name:'Тест',text:source,uploadId:run.library.uploadId,styleName:run.library.name,createdAt:run.createdAt,updatedAt:run.createdAt,generationMode:'smart'}
  await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify(project));await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
  return {run,bucket}
}
test('one model call builds service candidates from checked groups and resumes without paying again',async()=>{
  const {run,bucket}=await savedRun(),old=globalThis.fetch;let calls=0
  globalThis.fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(JSON.parse(body.messages[1].content).rawText,source)
    return Response.json({id:'semantic-test',model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(reply())}}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})}
  try{
    await structureStudioRun(bucket,run,{apiKey:'test-only',baseUrl:'https://provider.invalid/v1',model:'fixture'},new AbortController().signal)
    const done=(await readStudioRun(bucket,run.projectId,run.revision))!
    assert.equal(done.semantic?.status,'complete');assert.equal(done.slides.length,2);assert.equal(done.modelRequests,1)
    assert.ok(done.slides[1].candidates.some(c=>c.id==='composition/comparison'))
    assert.equal(done.slides[0].content.blocks[1].kind,'step')
    await structureStudioRun(bucket,done,{apiKey:'test-only'},new AbortController().signal);assert.equal(calls,1)
    await assert.rejects(designStudioBatch(bucket,done,{apiKey:'test-only'},new AbortController().signal),/исполнитель/);assert.equal(calls,1)
  }finally{globalThis.fetch=old}
})
test('invalid model structure remains blocked with original response retained and no heuristic fallback',async()=>{
  const {run,bucket}=await savedRun(),old=globalThis.fetch;let calls=0
  globalThis.fetch=async()=>{calls++;const bad=reply();bad.slides[0].blocks[1].fields[2].refs.pop();return Response.json({id:'invalid',model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(bad)}}]})}
  try{
    await assert.rejects(structureStudioRun(bucket,run,{apiKey:'test-only',baseUrl:'https://provider.invalid/v1',model:'fixture'},new AbortController().signal))
    const done=(await readStudioRun(bucket,run.projectId,run.revision))!
    assert.equal(done.status,'blocked');assert.equal(done.slides.length,0);assert.equal(done.modelRequests,1);assert.equal(calls,1)
    assert.ok(await bucket.get(`presentation-studio/${run.projectId}/${run.revision}/semantic/responses/${done.modelRunIds[0]}.json`))
  }finally{globalThis.fetch=old}
})
test('semantic smart run selects a measured option locally without a second Qwen',async()=>{
  const {bucket,run:pending}=await savedRun(),run=measuredStudioFixture('smart');run.semantic={source,status:'complete',proof:validateSemanticContent(reply(),source).proof}
  const payloads=run.slides.map(s=>({slideId:s.content.id,options:s.options!.map(o=>({id:o.id,receipt:o.receipt}))}))
  run.slides.forEach(s=>{delete s.options;delete s.plan});await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
  const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No second model')}
  try{let saved=run;for(const p of payloads)saved=await commitStudioOptions(bucket,pending.projectId,pending.revision,p)
    assert.equal(saved.status,'complete');assert.equal(saved.modelRequests,0);assert.ok(saved.slides.every(s=>s.plan?.rationale.includes('Qwen сгруппировал')))
  }finally{globalThis.fetch=old}
})
