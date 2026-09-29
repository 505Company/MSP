import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryBucket } from './helpers/memory-bucket'
import { assertUploadActive, withUploadCancellation, uploadIsCancelled } from '../lib/uploads/cancellation-server'
import { addBankStyle, removeBankStyle } from '../lib/workspace/storage'
import { beginModelRun } from '../lib/uploads/model-run'
import { readProcessingResponse } from '../lib/uploads/read-processing-response'
import { cancelDesignSystem } from '../lib/uploads/cancellation-client'
import { processingCount } from '../lib/uploads/processing-activity'
import type { BankStyle } from '../lib/workspace/types'
import { qualifyGraphicParts } from '../lib/design-system/reconstruction-browser'
import type { ReconstructionResult } from '../lib/design-system/reconstruction-contract'
import { UploadCancelledError } from '../lib/uploads/cancellation'

test('cancellation stops graphic verification before another rendering operation',async()=>{
  const controller=new AbortController();controller.abort(new UploadCancelledError())
  await assert.rejects(qualifyGraphicParts({} as ReconstructionResult,'upload',controller.signal),/удалена/)
})

test('a saved project can still use a deleted source without becoming part of its import job',async t=>{
  const {bucket}=memoryBucket(),id=crypto.randomUUID();await removeBankStyle(bucket,id)
  let calls=0
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({model:'test',choices:[{finish_reason:'stop',message:{content:'{}'}}]}),{headers:{'content-type':'application/json'}})})
  const run=await beginModelRun({bucket,prefix:'project/model',scope:{uploadId:id,projectId:'saved-project'},config:{apiKey:'test',model:'test',baseUrl:'https://provider.invalid/v1'},version:'test',validate:raw=>raw,
    task:{messages:[{role:'user',content:'synthetic fixture'}],schema:{type:'object'},schemaName:'test',maxTokens:20}})
  await run.execute!();assert.equal(calls,1);assert.equal(run.run.status,'complete')
})

test('deletion aborts an in-flight model request, preserves source and fences new work',async t=>{
  const {bucket}=memoryBucket(),id=crypto.randomUUID()
  await bucket.put(`sources/${id}`,'original')
  let began!:()=>void,calls=0,aborted=false
  const running=new Promise<void>(r=>{began=r})
  t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
    calls++;began()
    return new Promise<Response>((_resolve,reject)=>{
      init!.signal!.addEventListener('abort',()=>{aborted=true;reject(init!.signal!.reason)},{once:true})
    })
  })
  const run=await beginModelRun({bucket,uploadId:id,prefix:`models/${id}`,scope:{uploadId:id},config:{apiKey:'test',model:'test',baseUrl:'https://provider.invalid/v1'},version:'test',validate:raw=>raw,
    task:{messages:[{role:'user',content:'synthetic fixture'}],schema:{type:'object'},schemaName:'test',maxTokens:20}})
  const work=run.execute!();void work.catch(()=>undefined)
  await running;await removeBankStyle(bucket,id)
  await assert.rejects(work,/удалена/)
  assert.equal(aborted,true);assert.equal(calls,1)
  assert.equal(await uploadIsCancelled(bucket,id),true)
  assert.equal(await(await bucket.get(`sources/${id}`))!.text(),'original')
  await assert.rejects(assertUploadActive(bucket,id),/удалена/)
  await assert.rejects(addBankStyle(bucket,{id} as BankStyle),/удалена/)
})

test('a different worker observes durable cancellation, while a second upload continues',async()=>{
  const {bucket}=memoryBucket(),id=crypto.randomUUID(),other=crypto.randomUUID()
  let began!:()=>void,finishOther!:()=>void
  const started=new Promise<void>(r=>{began=r})
  const work=withUploadCancellation(bucket,id,undefined,signal=>new Promise<void>((_resolve,reject)=>{began();signal.addEventListener('abort',()=>reject(signal.reason),{once:true})}))
  void work.catch(()=>undefined)
  const independent=withUploadCancellation(bucket,other,undefined,()=>new Promise<void>(r=>{finishOther=r}))
  await started
  // Write the durable marker directly to model deletion in another isolate,
  // where the in-memory registry is unavailable.
  await bucket.put(`upload-cancellations/${id}.json`,'{}')
  await assert.rejects(work,/удалена/)
  finishOther();await independent
  await assertUploadActive(bucket,other)
})

test('deleting one member of a batch does not cancel another member’s response stream',async()=>{
  const ids=[crypto.randomUUID(),crypto.randomUUID()];let cancelled=false
  const response=new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({accepted:ids.map(id=>({id}))})+'\n'))},cancel(){cancelled=true}}),{headers:{'content-type':'application/x-ndjson'}})
  await readProcessingResponse(response)
  assert.equal(processingCount(),1)
  cancelDesignSystem(ids[0]);assert.equal(cancelled,false);assert.equal(processingCount(),1)
  cancelDesignSystem(ids[1]);assert.equal(cancelled,true);assert.equal(processingCount(),0)
})
