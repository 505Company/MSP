import {test} from 'node:test'
import assert from 'node:assert/strict'
import {normalizeText} from '../lib/presentations/studio/material'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {oneDayText} from './fixtures/studio-one-day'
import {measuredStudioFixture,studioFixture} from './fixtures/studio'
import {memoryBucket} from './helpers/memory-bucket'
import {commitStudioOptions,chooseStudioOption,studioKey,applyStudioOption,validateReceipt} from '../lib/presentations/studio/storage'
import {offeredOptions} from '../lib/presentations/studio/options'
import {readStudioHistory} from '../lib/presentations/studio/history'
import {designTask} from '../lib/presentations/studio/task'

test('one unchanged brief has at least three different spatial compositions, not different IDs for the same geometry',()=>{
  const slide=normalizeText(oneDayText)[0]
  const signatures=candidatesFor(slide).map(c=>JSON.stringify(c.slots.map(s=>({blocks:[...s.blocks].sort(),box:[s.rect.x,s.rect.y,s.rect.w,s.rect.h].map(n=>Math.round(n/64)),direction:s.direction,columns:s.columns})).sort((a,b)=>a.blocks[0].localeCompare(b.blocks[0]))))
  assert.ok(new Set(signatures).size>=3,`Only ${new Set(signatures).size} distinct spatial compositions`)
})

test('selection history rotates real designs, persists manual selection, and does not grow on a retry',async()=>{
  const fixture=measuredStudioFixture('fast'),{bucket}=memoryBucket(),seen:string[]=[]
  const content=fixture.slides[0]
  for(let i=0;i<3;i++){
    const run=structuredClone(fixture);run.revision=crypto.randomUUID();run.slides=[run.slides[0]]
    const history=await readStudioHistory(bucket,run.projectId)
    run.slides[0].history=history.entries.map(e=>e.signature);delete run.slides[0].options
    await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify({id:run.projectId,revision:run.revision,uploadId:run.library.uploadId}))
    await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
    const payload={slideId:content.content.id,options:content.options!.map(o=>({id:o.id,receipt:o.receipt}))}
    const done=await commitStudioOptions(bucket,run.projectId,run.revision,payload)
    seen.push(done.slides[0].plan!.optionId!)
    assert.equal(done.status,'complete');assert.equal(done.modelRequests,0)
    assert.deepEqual(done.results[content.content.id],content.options!.find(o=>o.id===seen.at(-1))!.receipt)
    await commitStudioOptions(bucket,run.projectId,run.revision,payload)
    assert.equal((await readStudioHistory(bucket,run.projectId)).entries.length,i+1)
    if(i===2){const other=done.slides[0].options!.find(o=>o.id!==seen.at(-1))!
      const chosen=await chooseStudioOption(bucket,run.projectId,run.revision,content.content.id,other.id)
      assert.equal(chosen.results[content.content.id].preview,other.receipt!.preview)
      assert.equal((await readStudioHistory(bucket,run.projectId)).entries.at(-1)!.optionId,other.id)
    }
  }
  assert.equal(new Set(seen).size,3)
})

test('Qwen cannot start without measured previews or repeat the preceding option when alternatives exist',()=>{
  assert.throws(()=>designTask(studioFixture('smart')),/проверить варианты/)
  const run=measuredStudioFixture('smart'),s=run.slides[0],previous=s.options![0]
  s.history=[previous.signature]
  assert.ok(offeredOptions(s).every(o=>o.id!==previous.id))
  const {task,validate}=designTask(run),properties=(task.schema as {properties:Record<string,{enum:string[]}>}).properties
  const result=Object.fromEntries(Object.entries(properties).map(([key,p])=>[key,p.enum[0]]))
  assert.notEqual(validate(result)[s.content.id].optionId,previous.id)
  const pictures=task.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(c=>c.type==='image_url').map(c=>c.type==='image_url'?c.image_url.url:''):[])
  assert.ok(!pictures.includes(previous.receipt!.preview))
  assert.throws(()=>validate({...result,s1_choice:'unrendered'}))
})

test('parallel generations refresh signature history when their measured options arrive',async()=>{
  const fixture=measuredStudioFixture('fast'),{bucket}=memoryBucket(),source=fixture.slides[0],choices:string[]=[]
  // All three jobs started from the same snapshot before any one completed.
  const runs=Array.from({length:3},()=>({...structuredClone(fixture),revision:crypto.randomUUID(),slides:[structuredClone(source)]}))
  for(const run of runs){
    delete run.slides[0].options;run.slides[0].history=[]
    await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify({id:run.projectId,revision:run.revision,uploadId:run.library.uploadId}))
    await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
  }
  for(const run of runs){
    const saved=await commitStudioOptions(bucket,run.projectId,run.revision,{slideId:source.content.id,options:source.options!.map(o=>({id:o.id,receipt:o.receipt}))})
    choices.push(saved.slides[0].plan!.optionId!)
    assert.equal(saved.slides[0].history!.length,choices.length-1)
  }
  assert.equal(new Set(choices).size,3)
})

test('a selected option cannot be silently replaced by a new render',()=>{
  const run=measuredStudioFixture(),s=run.slides[0],o=s.options![0]
  applyStudioOption(run,s.content.id,o.id)
  assert.deepEqual(validateReceipt(run,o.receipt),o.receipt)
  assert.throws(()=>validateReceipt(run,{...o.receipt,html:'<main>A different design</main>'}),/повторная вёрстка/)
})
