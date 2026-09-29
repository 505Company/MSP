import {test} from 'node:test'
import assert from 'node:assert/strict'
import {measuredStudioFixture} from './fixtures/studio'
import {memoryBucket} from './helpers/memory-bucket'
import {studioKey,applyStudioOption} from '../lib/presentations/studio/storage'
import {refineStudioRun} from '../lib/presentations/studio/refine'
import {STUDIO_VERSION} from '../lib/presentations/studio/contract'

test('a layout-only refinement preserves the saved generation and resumes without duplicate jobs',async()=>{
 const source=measuredStudioFixture('fast'),{bucket}=memoryBucket();source.status='complete';source.modelRequests=7
 source.variation={seed:source.revision,mode:'fast',sourceKey:'same-source'}
 delete source.slides[0].contentKey;delete source.slides[0].diversityKey
 const frozen=JSON.stringify(source)
 await bucket.put(`workspace/projects/${source.projectId}.json`,JSON.stringify({id:source.projectId,revision:source.revision,uploadId:source.library.uploadId}))
 await bucket.put(studioKey(source.projectId,source.revision),frozen)
 const next=await refineStudioRun(bucket,source.projectId,source.revision)
 assert.notEqual(next.revision,source.revision);assert.equal(next.derivedFrom,source.revision);assert.equal(next.version,STUDIO_VERSION)
 assert.equal(next.modelRequests,0);assert.deepEqual(next.modelRunIds,[]);assert.deepEqual(next.results,{})
 assert.deepEqual(next.slides.map(s=>s.content),source.slides.map(s=>s.content));assert.deepEqual(next.library,source.library)
 assert.ok(next.slides.every(s=>s.candidates.length>0&&!s.options))
 assert.ok(next.slides[0].contentKey);assert.ok(next.slides[0].diversityKey)
 assert.equal(JSON.stringify(await (await bucket.get(studioKey(source.projectId,source.revision)))!.json()),frozen)
 assert.equal((await refineStudioRun(bucket,source.projectId,source.revision)).revision,next.revision)
})

test('refinement cannot revive cancelled runs or race unfinished model work',async()=>{
 for(const status of ['cancelled','planning'] as const){
  const source=measuredStudioFixture(),{bucket}=memoryBucket();source.status=status
  await bucket.put(`workspace/projects/${source.projectId}.json`,JSON.stringify({id:source.projectId,revision:source.revision}))
  await bucket.put(studioKey(source.projectId,source.revision),JSON.stringify(source))
  await assert.rejects(refineStudioRun(bucket,source.projectId,source.revision),/завершите/)
 }
})

test('a targeted refinement preserves every ready neighbour and queues only the requested slide',async()=>{
 const source=measuredStudioFixture('fast'),{bucket}=memoryBucket()
 for(const s of source.slides)applyStudioOption(source,s.content.id,s.options![0].id)
 source.status='complete'
 await bucket.put(`workspace/projects/${source.projectId}.json`,JSON.stringify({id:source.projectId,revision:source.revision}))
 await bucket.put(studioKey(source.projectId,source.revision),JSON.stringify(source))
 const id=source.slides[0].content.id,next=await refineStudioRun(bucket,source.projectId,source.revision,id)
 assert.equal(next.results[id],undefined);assert.equal(next.slides[0].options,undefined)
 for(const s of source.slides.slice(1)){assert.deepEqual(next.results[s.content.id],source.results[s.content.id]);assert.deepEqual(next.slides.find(n=>n.content.id===s.content.id),JSON.parse(JSON.stringify(s)))}
 await assert.rejects(refineStudioRun(bucket,source.projectId,source.revision,'missing'),/не найден/)
})
