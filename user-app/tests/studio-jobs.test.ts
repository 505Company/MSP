import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryBucket} from './helpers/memory-bucket'
import {studioFixture} from './fixtures/studio'
import {studioKey,studioCancellationKey} from '../lib/presentations/studio/storage'
import {enqueueStudioJob,claimStudioJob,updateStudioJob,publicStudioJob} from '../lib/presentations/studio/jobs'
import {workerHeartbeat,workerIsAvailable} from '../lib/uploads/processing-jobs'

async function setup(){
 const {bucket}=memoryBucket(),source=studioFixture(),runs=Array.from({length:3},()=>({...source,revision:crypto.randomUUID()}))
 await bucket.put(`workspace/projects/${source.projectId}.json`,JSON.stringify({id:source.projectId,revision:crypto.randomUUID()}))
 for(const run of runs){await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run));await enqueueStudioJob(bucket,run.projectId,run.revision,false,1000)}
 return {bucket,runs}
}
test('three generations of one project run independently after its current revision changes',async()=>{
 const {bucket,runs}=await setup()
 const jobs=await Promise.all(Array.from({length:3},(_,i)=>claimStudioJob(bucket,`worker-${i}`,2000)))
 assert.equal(new Set(jobs.map(j=>j?.id)).size,3);assert.ok(jobs.every(Boolean))
 assert.equal(await claimStudioJob(bucket,'extra',2001),null)
 for(const job of jobs){assert.equal('leaseToken' in publicStudioJob(job)!,false);assert.equal((await enqueueStudioJob(bucket,runs[0].projectId,job!.id,false,2100))!.leaseToken,job!.leaseToken);await updateStudioJob(bucket,job!.id,job!.leaseToken!,{complete:true},2200)}
 assert.equal(await claimStudioJob(bucket,'extra',3000),null)
})
test('expired owners and cancelled projects cannot write or resurrect queued work',async()=>{
 const {bucket,runs}=await setup(),old=(await claimStudioJob(bucket,'old',2000))!
 const replacement=(await claimStudioJob(bucket,'new',old.leaseUntil!+1))!
 assert.equal(replacement.id,old.id);assert.notEqual(replacement.leaseToken,old.leaseToken)
 await assert.rejects(updateStudioJob(bucket,old.id,old.leaseToken!,{complete:true},old.leaseUntil!+2),/владение/)
 await bucket.put(studioCancellationKey(runs[0].projectId,old.id),'{}')
 await assert.rejects(updateStudioJob(bucket,replacement.id,replacement.leaseToken!,{complete:true},old.leaseUntil!+3),/остановлена/)
 await assert.rejects(enqueueStudioJob(bucket,runs[0].projectId,old.id,true),/остановлена/)
 const other=(await claimStudioJob(bucket,'other',old.leaseUntil!+4))!
 assert.notEqual(other.id,old.id)
})
test('import and studio workers advertise their independent fresh capabilities',async()=>{
 const {bucket}=memoryBucket()
 await workerHeartbeat(bucket,'studio',1000,['studio'])
 await workerHeartbeat(bucket,'import',1100,['presentation','components'])
 assert.equal(await workerIsAvailable(bucket,1200,'studio'),true)
 assert.equal(await workerIsAvailable(bucket,1200,'components'),true)
 await workerHeartbeat(bucket,'studio',1300)
 assert.equal(await workerIsAvailable(bucket,1400,'studio'),true)
 assert.equal(await workerIsAvailable(bucket,100000,'studio'),false)
})
