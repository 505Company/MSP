import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryBucket} from './helpers/memory-bucket'
import {measuredStudioFixture} from './fixtures/studio'
import {studioKey,readStudioRun,mutateStudioRun,assertStudioProject} from '../lib/presentations/studio/storage'
import {cancelProjectStudioGenerations,cancelStudioGeneration,setStudioSlidesDeleted,withStudioCancellation} from '../lib/presentations/studio/lifecycle'
import {studioSlideFeedback} from '../lib/presentations/studio/run-feedback'
import {generationSummary} from '../lib/presentations/studio/generations'
import {refreshStudioStatus} from '../lib/presentations/studio/compact-task'
import {cancelLayoutJob,readLayoutJob} from '../lib/presentations/layout-jobs'

async function setup(){
  const {bucket,data}=memoryBucket(),run=JSON.parse(JSON.stringify(measuredStudioFixture('fast'))) as ReturnType<typeof measuredStudioFixture>
  for(const slide of run.slides)run.results[slide.content.id]=slide.options![0].receipt!
  run.status='complete'
  await bucket.put(`workspace/projects/${run.projectId}.json`,JSON.stringify({id:run.projectId,revision:run.revision}))
  await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
  return {bucket,data,run}
}
test('deleting across generations is persistent, reversible and preserves content and measured exports',async()=>{
  const {bucket,run}=await setup(),other={...run,revision:crypto.randomUUID()}
  await bucket.put(studioKey(run.projectId,other.revision),JSON.stringify(other))
  const selection=[{revision:run.revision,slideId:'slide-1'},{revision:other.revision,slideId:'slide-2'}]
  await setStudioSlidesDeleted(bucket,run.projectId,selection,true)
  for(const {revision,slideId} of selection){const current=(await readStudioRun(bucket,run.projectId,revision))!;assert.equal(generationSummary(current).slides,1);assert.equal(studioSlideFeedback(current).some(s=>s.id===slideId),false);assert.deepEqual(current.results,run.results);assert.deepEqual(current.slides,run.slides)}
  await setStudioSlidesDeleted(bucket,run.projectId,selection,true)
  assert.deepEqual((await readStudioRun(bucket,run.projectId,run.revision))!.deletedSlideIds,['slide-1'])
  await setStudioSlidesDeleted(bucket,run.projectId,selection,false)
  assert.equal(studioSlideFeedback((await readStudioRun(bucket,run.projectId,run.revision))!).length,2)
  await assert.rejects(setStudioSlidesDeleted(bucket,run.projectId,[{revision:run.revision,slideId:'slide-1'},{revision:other.revision,slideId:'unknown'}],true))
  assert.deepEqual((await readStudioRun(bucket,run.projectId,run.revision))!.deletedSlideIds,[])
})
test('cancellation preserves ready slides and rejects stale writers, including provider retry callbacks',async()=>{
  const {bucket,run}=await setup();run.status='planning';delete run.results['slide-2']
  await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
  assert.equal(await cancelStudioGeneration(bucket,run.projectId,run.revision),true)
  const stopped=(await readStudioRun(bucket,run.projectId,run.revision))!;assert.equal(stopped.status,'cancelled');assert.deepEqual(stopped.results,run.results)
  await assert.rejects(assertStudioProject(bucket,run),/остановлена/)
  await assert.rejects(mutateStudioRun(bucket,run.projectId,run.revision,next=>{next.status='complete'}),/остановлена/)
  refreshStudioStatus(stopped);assert.equal(stopped.status,'cancelled')
  assert.equal(await cancelStudioGeneration(bucket,run.projectId,run.revision),false)
  let called=false
  await assert.rejects(withStudioCancellation(bucket,run,new AbortController().signal,async()=>{called=true}),/остановлена/);assert.equal(called,false)
})
test('cancel all leaves completed runs intact and removes leases from legacy jobs',async()=>{
  const {bucket,run}=await setup(),pending={...run,revision:crypto.randomUUID(),status:'blocked'}
  await bucket.put(studioKey(run.projectId,pending.revision),JSON.stringify(pending))
  assert.equal(await cancelProjectStudioGenerations(bucket,run.projectId),1)
  assert.deepEqual(await readStudioRun(bucket,run.projectId,run.revision),run)
  await bucket.put(`presentation-jobs/${run.projectId}.json`,JSON.stringify({id:run.projectId,status:'running',owner:'old',leaseToken:'old',leaseUntil:Date.now()+60000,progress:{step:'analysis',detail:'Old'}}))
  await cancelLayoutJob(bucket,run.projectId)
  const job=await readLayoutJob(bucket,run.projectId);assert.equal(job?.status,'cancelled');assert.equal(job?.leaseToken,undefined)
})
test('stopping a generation aborts an already running provider request',async()=>{
  const {bucket,run}=await setup();run.status='planning'
  await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
  let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve})
  const pending=withStudioCancellation(bucket,run,new AbortController().signal,signal=>new Promise<void>((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});started()}))
  const rejected=assert.rejects(pending,/остановлена/)
  await ready;await cancelStudioGeneration(bucket,run.projectId,run.revision);await rejected
})
