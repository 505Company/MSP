import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryBucket} from './helpers/memory-bucket'
import {cancelUpload} from '../lib/uploads/cancellation-server'
import {enqueueProcessingJob,enqueueRefinementProcessing,enqueueAuditProcessing,claimProcessingJob,updateProcessingJob,publicProcessingJob,readProcessingJob} from '../lib/uploads/processing-jobs'

test('upgrading the compiler cannot restart blocked or cancelled work just by opening its page', async () => {
 const {bucket}=memoryBucket()
 for(const status of ['blocked','cancelled'] as const){
  const job=await enqueueProcessingJob(bucket,status,'Deck',false,1000)
  await bucket.put(`processing-jobs/${status}.json`,JSON.stringify({...job,status,revision:'previous-compiler',attempts:4,error:'Saved failure'}))
  const read=await enqueueProcessingJob(bucket,status,'Deck',false,2000)
  assert.equal(read.status,status);assert.equal(read.error,'Saved failure');assert.equal(read.attempts,4)
  assert.equal((await enqueueProcessingJob(bucket,status,'Deck',true,3000)).status,'queued')
 }
})

test('a durable job has one owner, survives its tab, resumes an expired lease and fences the old owner',async()=>{
 const {bucket}=memoryBucket()
 await enqueueProcessingJob(bucket,'upload','Deck',false,1000)
 const [a,b]=await Promise.all([claimProcessingJob(bucket,'worker-a',2000),claimProcessingJob(bucket,'worker-b',2000)])
 assert.equal(Number(!!a)+Number(!!b),1)
 const first=a??b!
 assert.equal((await enqueueProcessingJob(bucket,'upload','Deck',false,3000)).leaseToken,first.leaseToken,'Opening another tab does not restart work')
 assert.equal(await claimProcessingJob(bucket,'worker-c',4000),null)
 const next=await claimProcessingJob(bucket,'worker-c',first.leaseUntil!+1)
 assert.ok(next);assert.notEqual(next.leaseToken,first.leaseToken)
 await assert.rejects(()=>updateProcessingJob(bucket,'upload',first.leaseToken!,{complete:true},first.leaseUntil!+2),/владение/)
 await updateProcessingJob(bucket,'upload',next.leaseToken!,{progress:{step:'components',scope:'comparison',detail:'Сравниваем',completed:2,total:5}},first.leaseUntil!+3)
 assert.equal((await readProcessingJob(bucket,'upload'))?.progress.completed,2)
 assert.equal('leaseToken' in publicProcessingJob(next),false)
})

test('automatic retries are bounded and terminal errors stay visible across reloads until a deliberate restart',async()=>{
 const {bucket}=memoryBucket();let now=1000
 await enqueueProcessingJob(bucket,'upload','Deck',false,now)
 for(let i=0;i<4;i++){
  const job=await claimProcessingJob(bucket,'worker',now);assert.ok(job)
  const failed=await updateProcessingJob(bucket,'upload',job.leaseToken!,{error:'Сбой сети',retryable:true},now+1)
  assert.equal(failed.status,i===3?'blocked':'retrying')
  now=(failed.retryAt??now)+1
 }
 assert.equal(await claimProcessingJob(bucket,'worker',now+1000000),null)
 assert.equal((await enqueueProcessingJob(bucket,'upload','Deck',false,now)).status,'blocked')
 await enqueueProcessingJob(bucket,'upload','Deck',true,now)
 const recovered=await claimProcessingJob(bucket,'worker',now);assert.ok(recovered)
 await updateProcessingJob(bucket,'upload',recovered.leaseToken!,{complete:true},now+1)
 assert.equal((await readProcessingJob(bucket,'upload'))?.status,'complete')
})

test('deleting a style cancels queued or running background work and a late completion cannot revive it',async()=>{
 const {bucket}=memoryBucket()
 await enqueueProcessingJob(bucket,'active','Deck');await enqueueProcessingJob(bucket,'queued','Deck')
 const active=await claimProcessingJob(bucket,'worker');assert.ok(active)
 await cancelUpload(bucket,active.id)
 await assert.rejects(()=>updateProcessingJob(bucket,active.id,active.leaseToken!,{complete:true}),/удален|удалён/i)
 assert.equal((await readProcessingJob(bucket,active.id))?.status,'cancelled')
 await assert.rejects(()=>enqueueProcessingJob(bucket,active.id,'Deck',true),/удален|удалён/i)
 assert.ok(await claimProcessingJob(bucket,'other'),'Other jobs are unaffected')
})

test('a refinement is durable behind an active import and later runs alone without replaying unrelated stages',async()=>{
 const {bucket}=memoryBucket()
 await enqueueProcessingJob(bucket,'upload','Deck',false,1000)
 const importJob=(await claimProcessingJob(bucket,'worker',2000))!
 await enqueueRefinementProcessing(bucket,'upload','Дополнение',3000)
 const queued=await updateProcessingJob(bucket,'upload',importJob.leaseToken!,{complete:true},4000)
 assert.equal(queued.status,'queued');assert.equal(queued.work,'refinement')
 assert.equal(queued.leaseToken,undefined)
 const refinement=(await claimProcessingJob(bucket,'worker',5000))!
 assert.equal(refinement.work,'refinement')
 await updateProcessingJob(bucket,'upload',refinement.leaseToken!,{complete:true},6000)
 const next=await enqueueRefinementProcessing(bucket,'upload','Ещё раз',7000)
 assert.equal(next.work,'refinement');assert.equal(next.status,'queued')
 assert.equal((await enqueueProcessingJob(bucket,'upload','Открыли страницу',false,8000)).work,'refinement')
})

test('an audit stays behind the active import and manual refinement without repeating either stage',async()=>{
 const {bucket}=memoryBucket();await enqueueProcessingJob(bucket,'upload','Deck',false,1000)
 const active=(await claimProcessingJob(bucket,'worker',2000))!
 await enqueueAuditProcessing(bucket,'upload','Audit',2100);await enqueueRefinementProcessing(bucket,'upload','Region',2200)
 const next=await updateProcessingJob(bucket,'upload',active.leaseToken!,{complete:true},3000)
 assert.equal(next.work,'refinement');assert.equal(next.followUpAudit,true)
 const region=(await claimProcessingJob(bucket,'worker',4000))!
 assert.equal((await updateProcessingJob(bucket,'upload',region.leaseToken!,{complete:true},5000)).work,'audit')
 const audit=(await claimProcessingJob(bucket,'worker',6000))!
 assert.equal((await updateProcessingJob(bucket,'upload',audit.leaseToken!,{complete:true},7000)).status,'complete')
})
