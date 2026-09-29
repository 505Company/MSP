import {test} from 'node:test'
import assert from 'node:assert/strict'
import { studioFixture,measuredStudioFixture } from './fixtures/studio'
import { studioRecipes,candidatesFor } from '../lib/presentations/studio/recipes'
import { normalizeText } from '../lib/presentations/studio/material'
import { validatePlan,componentBindings,editableValues } from '../lib/presentations/studio/bindings'
import { designTask,designStudioBatch } from '../lib/presentations/studio/task'
import { memoryBucket } from './helpers/memory-bucket'
import { readStudioRun,studioKey,validateReceipt,startStudioRun } from '../lib/presentations/studio/storage'
import { summarizeProject } from '../lib/workspace/project-summary'
import type { PresentationProject } from '../lib/workspace/types'

test('all three reviewed sections are namespaced and exposed; content is never lost across candidates',()=>{
  assert.equal(studioRecipes.length,33);assert.equal(new Set(studioRecipes.map(r=>r.id)).size,33)
  const slides=normalizeText('# Четыре этапа\n\n'+[1,2,3,4].map(n=>`0${n} — Этап ${n}\nОбъяснение ${n}`).join('\n\n'))
  assert.ok(candidatesFor(slides[0]).some(c=>c.recipeId==='33:223/four-steps-01'))
  for(const work of studioFixture().slides)for(const c of work.candidates)assert.deepEqual(c.slots.flatMap(s=>s.blocks).sort(),work.content.blocks.map(b=>b.id).sort())
})
test('markdown boundaries, metrics, fractions, footer and input words survive normalization',()=>{
  const s=normalizeText('1. **Аудитория**\n\n**38 млн**\nактивных пользователей\n\n**56 / 44**\nженщины / мужчины\n\nИсточник: исследование\n---\n2. **Итог**')
  assert.equal(s.length,2);assert.deepEqual(s[0].blocks.filter(b=>b.kind==='metric').map(b=>b.fields.value),['38 млн','56 / 44'])
  assert.equal(s[0].blocks.at(-1)?.role,'footer');assert.equal(s[1].blocks[0].fields.text,'Итог')
})
test('layout instructions do not become cards and list entries retain one level of hierarchy',()=>{
  const [s]=normalizeText('# Рынок\n\nРегионы роста\n\n- Алтай — +48%\n- Карелия — +37%\n\nМелкая подпись:\nПо данным сервиса, 2026 год.')
  assert.equal(s.blocks.length,3)
  assert.deepEqual(s.blocks[1].fields,{heading:'Регионы роста',body:'- Алтай — +48%\n- Карелия — +37%'})
  assert.equal(s.blocks[2].role,'footer');assert.deepEqual(s.directions,['Мелкая подпись:'])
})
test('native metric binds nested caption fields and removes the original sample values',()=>{
  const run=studioFixture(),block=normalizeText('# Рост\n\n76%\nСамостоятельные поездки')[0].blocks[1]
  const template={id:'nested',kind:'metric' as const,name:'Число с подписью',description:'',tags:[],slide:1,sourceIds:['source'],memberIds:[],width:400,height:300,style:{},config:{},graphicHtml:{},dataStatus:'native' as const,data:{value:'999%',items:[{id:'caption',text:'Чужая подпись'}]}}
  run.library.editable=[template]
  const [binding]=componentBindings(block,run.library)
  assert.ok(binding);assert.deepEqual(binding.fields,{value:'value','items.0.text':'caption'})
  assert.deepEqual(editableValues(binding,template,block),{value:'76%',items:[{id:'caption',text:'Самостоятельные поездки'}]})
  run.slides[0].bindings[block.id]=[binding]
  assert.equal(validatePlan({...run.slides[0].plan!,components:{[block.id]:'nested'}},run.slides[0]).components[block.id],'nested')
  assert.throws(()=>validatePlan({...run.slides[0].plan!,components:{[block.id]:'foreign'}},run.slides[0]))
})
test('designer cannot substitute a recipe, omit a slide or use a foreign component',()=>{
  const run=measuredStudioFixture('smart'),{validate}=designTask(run)
  assert.throws(()=>validate({slides:[]}))
  assert.throws(()=>validate({s1_recipe:'foreign',s1_focus:'none'}))
  const work=run.slides[0];assert.throws(()=>validatePlan({candidateId:'foreign',components:{},primary:[],rationale:''},work))
  work.bindings.b2=[{id:'allowed',fields:{value:'value',text:'caption'},kind:'editable'}]
  assert.throws(()=>validatePlan({candidateId:work.candidates[0].id,components:{},primary:[],rationale:''},work))
})
test('smart stage sees measured images, commits their exact receipts and resumes without another request',async()=>{
  const run=measuredStudioFixture('smart'),{bucket}=memoryBucket()
  const project:PresentationProject={schemaVersion:1,id:run.projectId,revision:run.revision,name:'Проверка',text:'Текст',uploadId:run.library.uploadId,styleName:run.library.name,createdAt:run.createdAt,updatedAt:run.createdAt,generationMode:'smart'}
  await bucket.put(`workspace/projects/${project.id}.json`,JSON.stringify(project));await bucket.put(studioKey(project.id,project.revision),JSON.stringify(run))
  const old=globalThis.fetch;let calls=0
  globalThis.fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(body.reasoning_effort,'low');assert.equal(body.chat_template_kwargs.enable_thinking,true)
    const schema=body.response_format.json_schema.schema
    assert.equal(Object.keys(schema.properties).length,run.slides.length*2)
    const images=body.messages.flatMap((m:{content:unknown})=>Array.isArray(m.content)?m.content.filter((c:{type:string})=>c.type==='image_url').map((c:{image_url:{url:string}})=>c.image_url.url):[])
    assert.deepEqual(images,run.slides.flatMap(s=>s.options!.map(o=>o.receipt!.preview)))
    const result=Object.fromEntries(Object.entries(schema.properties).map(([key,p])=>[key,(p as {enum:string[]}).enum[0]]))
    return Response.json({id:'test',model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:40,total_tokens:140}})}
  try{await designStudioBatch(bucket,run,{apiKey:'test-only',baseUrl:'https://provider.invalid/v1',model:'fixture'},new AbortController().signal)
    const done=(await readStudioRun(bucket,project.id,project.revision))!;assert.equal(done.status,'complete');assert.equal(done.modelRequests,1)
    for(const s of done.slides)assert.deepEqual(done.results[s.content.id],s.options![0].receipt)
    await designStudioBatch(bucket,done,{apiKey:'test-only'},new AbortController().signal);assert.equal(calls,1)
    assert.equal((await summarizeProject(bucket,project)).status,'ready')
  }finally{globalThis.fetch=old}
})
test('a ready receipt cannot drop content, forge a component or hide overflow',()=>{
  const run=studioFixture(),s=run.slides[0]
  const receipt={slideId:s.content.id,candidateId:s.candidates[0].id,passed:true,preview:'data:image/png;base64,eA==',html:'',blockIds:[],issues:[],warnings:[],elapsedMs:1,components:[],text:[]}
  assert.throws(()=>validateReceipt(run,receipt),/сохранность/)
  assert.throws(()=>validateReceipt(run,{...receipt,blockIds:s.content.blocks.map(b=>b.id)}),/Потеря/)
})
test('fast start pins the selected library without a model and stale project revisions are rejected',async()=>{
  const run=studioFixture(),{bucket}=memoryBucket(),p:PresentationProject={schemaVersion:1,id:run.projectId,revision:run.revision,name:'Проверка',text:'# Заголовок\n\nНовый материал',uploadId:run.library.uploadId,styleName:'Другой стиль',createdAt:run.createdAt,updatedAt:run.createdAt,generationMode:'fast'}
  await bucket.put(`workspace/projects/${p.id}.json`,JSON.stringify(p))
  const prefix=`component-catalogs/${p.uploadId}`
  await bucket.put(prefix+'/current.json',JSON.stringify({catalogId:run.library.id}))
  await bucket.put(`${prefix}/${run.library.id}/index.json`,JSON.stringify({id:run.library.id,version:'web-catalog-semantic-1',items:[]}))
  await bucket.put(`${prefix}/${run.library.id}/library.json`,JSON.stringify({library:{schemaVersion:1,compilerVersion:'test',sourceId:'fixture',name:'Другой стиль',tokens:run.library.tokens,components:[],excluded:[],notes:[]}}))
  await bucket.put(`visual/${p.uploadId}/manifest.json`,JSON.stringify({snapshot:{sourceId:'fixture',slides:[],elements:[],colors:[],fonts:[],assets:[]}}))
  const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Model must not be called')}
  try{const actual=await startStudioRun(bucket,p.id,p.revision);assert.equal(actual.mode,'fast');assert.equal(actual.modelRequests,0);assert.equal(actual.library.name,'Другой стиль');assert.equal(actual.slides.length,1)
    assert.equal((await startStudioRun(bucket,p.id,p.revision)).id,actual.id)
    const smart={...p,revision:crypto.randomUUID(),generationMode:'smart'}
    await bucket.put(`workspace/projects/${p.id}.json`,JSON.stringify(smart))
    const unparsed=await startStudioRun(bucket,p.id,smart.revision)
    assert.equal(unparsed.semantic?.source,p.text);assert.equal(unparsed.semantic?.status,'pending');assert.equal(unparsed.slides.length,0);assert.equal(unparsed.modelRequests,0)
    assert.equal(unparsed.semantic?.experimentalRoute,undefined)
    const experiment={...smart,revision:crypto.randomUUID(),compositionMode:'components',modelRoute:'akashml-fp8'}
    await bucket.put(`workspace/projects/${p.id}.json`,JSON.stringify(experiment))
    const routed=await startStudioRun(bucket,p.id,experiment.revision)
    assert.equal(routed.semantic?.experimentalRoute,'akashml-fp8');assert.equal(routed.semantic?.strategy,'components');assert.equal(routed.modelRequests,0)
    await assert.rejects(()=>startStudioRun(bucket,p.id,crypto.randomUUID()),/изменился/)
  }finally{globalThis.fetch=old}
})
