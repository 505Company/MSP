import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {validateSemanticContent} from '../lib/presentations/studio/semantic-content'
import type {StudioRun} from '../lib/presentations/studio/contract'

// Evaluation of the exact three user slides. Never changes the model answer,
// source, project, templates, or rendered output; never calls an external API.
const dir=process.argv[2];if(!dir)throw Error('Provide the saved pilot directory')
const source=await readFile(dir+'/input.md','utf8'),run=JSON.parse(await readFile(dir+'/run.json','utf8')) as StudioRun
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
assert.equal(hash(source),'5a21eda5a294fe4912fb8f923de55ace98acdc487f9286abce800defbedc65c6')
assert.equal(run.semantic?.source,source);assert.equal(run.status,'complete');assert.equal(run.modelRequests,1);assert.equal(run.slides.length,3)
const saved=JSON.parse(await readFile(`${dir}/model-${run.modelRunIds[0]}.json`,'utf8'))
const validated=validateSemanticContent(JSON.parse(saved.response.content),source)
assert.deepEqual(validated.slides,run.slides.map(s=>s.content));assert.deepEqual(validated.proof,run.semantic!.proof)
assert.equal(saved.metadata.provenance.routingReceipt.providerName,'akashml');assert.equal(saved.metadata.provenance.endpoint.declaredQuantization,'fp8')
assert.equal(JSON.parse(saved.inputs.task.messages[1].content).rawText,source)
assert.equal(saved.inputs.task.reasoningEffort,'medium')
const [reviews,limits,comparison]=run.slides.map(s=>s.content)
assert.deepEqual(reviews.blocks.filter(b=>b.kind==='metric').map(b=>b.fields.value),['4,2 млн','8 140','43%'])
assert.equal(reviews.blocks.filter(b=>b.kind==='list').length,2)
assert.equal(reviews.blocks.filter(b=>b.role==='footer').length,1)
const steps=limits.blocks.filter(b=>b.role==='body')
assert.equal(steps.length,4)
for(const [i,[heading,metric]] of [['КАДРЫ','−18%'],['ТРАНСПОРТ','2,3×'],['ИНФРАСТРУКТУРА','+31%'],['СЕЗОННОСТЬ','57%']].entries()){
  assert.equal(steps[i].kind,'step');assert.equal(steps[i].fields.marker,`0${i+1}`);assert.equal(steps[i].fields.heading,heading);assert.ok(steps[i].fields.body.includes(metric))
}
assert.deepEqual(comparison.blocks.filter(b=>b.kind==='list').map(b=>[b.fields.heading,b.fields.body.split('\n').length]),[['БЫЛО',4],['СТАНОВИТСЯ',4]])
const metric=comparison.blocks.find(b=>b.kind==='metric')!;assert.equal(metric.fields.value,'68%');assert.equal(metric.role,'body');assert.equal(metric.placement,'bottom');assert.equal(metric.emphasis,'primary')
for(const slide of run.slides){const receipt=run.results[slide.content.id];assert.ok(receipt.passed);assert.deepEqual(receipt.issues,[])
  for(const b of slide.content.blocks)for(const [field,value] of Object.entries(b.fields))assert.ok(receipt.text.some(t=>t.blockId===b.id&&t.field===field&&t.value===value))
  for(const c of receipt.components)assert.ok(run.library.prepared[c.componentId]||run.library.editable.some(t=>t.id===c.componentId))
}
const before=JSON.parse(await readFile('outputs/diagnostics/studio-semantic-pilot/templates-before.json','utf8'))
for(const [path,digest] of Object.entries(before))assert.equal(hash(await readFile(path,'utf8')),digest)
const audit={checkedAt:new Date().toISOString(),sourceUnchanged:true,modelAnswerUnchanged:true,semanticAssociationsPassed:true,allSourceFieldsRendered:true,templatesUnchanged:true,slides:run.slides.length,nativeComponents:Object.values(run.results).reduce((n,r)=>n+r.components.length,0),visualAcceptance:'not established; observed weaknesses recorded in the report'}
await writeFile(dir+'/audit.json',JSON.stringify(audit,null,2));console.log(JSON.stringify(audit,null,2))
