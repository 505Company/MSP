import test from 'node:test'
import assert from 'node:assert/strict'
import {beginModelRun} from '../lib/uploads/model-run'
import {routeraiConfig} from '../lib/uploads/routerai'
import {SemanticValidationError} from '../lib/design-system/semantic-contract'
import {memoryBucket} from './helpers/memory-bucket'

const primary=routeraiConfig({ROUTERAI_API_KEY:'router-key'})
const config={...primary,fallbacks:[{...primary,routerai:{providerTag:'akashml',quantization:'fp8' as const}},{apiKey:'intelion-key'}]}
const task={schemaName:'failover',schema:{type:'object'},maxTokens:30,messages:[{role:'user' as const,content:'synthetic'}]}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})
const catalog=(statuses=[-2,0])=>json({data:{id:primary.model,endpoints:['deepinfra','akashml'].map((tag,i)=>({tag,provider_name:tag,quantization:i?'fp8':'bf16',status:statuses[i],max_completion_tokens:5000,context_length:10000,supported_parameters:['temperature','reasoning','max_tokens','response_format','structured_outputs']}))}})
const reply=()=>json({id:'gen',model:primary.model,choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}]})

test('unavailable BF16 skips paid work, Akash succeeds and its exact cache is reusable under the priority policy',async t=>{
 const {bucket}=memoryBucket();let paid=0,reserved=0
 t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
  if(String(url).endsWith('/endpoints'))return catalog()
  if(String(url).includes('/generation?'))return json({data:{provider:'akashml',model:primary.model}})
  paid++;assert.equal(JSON.parse(String(init?.body)).provider.only[0],'akashml');return reply()
 })
 const options={bucket,prefix:'auto',config,task,version:'test',scope:{},validate:(raw:unknown)=>raw,beforeRequest:async()=>{reserved++}}
 const job=await beginModelRun(options);await job.execute!()
 assert.equal(job.run.liveRequests,1);assert.equal(paid,1);assert.equal(reserved,1)
 assert.equal(job.run.provenance?.identity.routing?.only[0],'akashml')
 const cached=await beginModelRun(options);assert.equal(cached.execute,null);assert.equal(cached.run.cacheHit,true);assert.equal(paid,1)
})

test('503 and 429 advance once to Intelion and account every actual request',async t=>{
 const {bucket,data}=memoryBucket(),calls:string[]=[]
 t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
  if(String(url).endsWith('/endpoints'))return catalog([0,0])
  const body=JSON.parse(String(init?.body)),provider=body.provider?.only[0]??'intelion';calls.push(provider)
  assert.equal((init?.headers as Record<string,string>).Authorization,provider==='intelion'?'Bearer intelion-key':'Bearer router-key')
  return provider==='intelion'?reply():json({error:'temporary'},provider==='deepinfra'?503:429)
 })
 const job=await beginModelRun({bucket,prefix:'third',config,task,version:'test',scope:{},validate:r=>r});await job.execute!()
 assert.deepEqual(calls,['deepinfra','akashml','intelion']);assert.equal(job.run.liveRequests,3)
 assert.equal(job.run.provenance?.identity.provider,'intelion')
 assert.equal([...data.keys()].filter(k=>k.includes('/provider-attempts/')&&k.endsWith('/failure.json')).length,2)
})

test('semantic validation and caller cancellation never trigger provider failover',async t=>{
 const {bucket}=memoryBucket();let paid=0
 t.mock.method(globalThis,'fetch',async(url:unknown)=>{
  if(String(url).endsWith('/endpoints'))return catalog([0,0])
  if(String(url).includes('/generation?'))return json({data:{provider:'deepinfra',model:primary.model}})
  paid++;return reply()
 })
 const job=await beginModelRun({bucket,prefix:'semantic',config,task,version:'test',scope:{},validate:()=>{throw new SemanticValidationError(['missing-fragment'])}})
 await assert.rejects(job.execute!(),SemanticValidationError);assert.equal(paid,1)
 const aborted=await beginModelRun({bucket,prefix:'abort',config,task,version:'test',scope:{},validate:r=>r}),controller=new AbortController();controller.abort()
 await assert.rejects(aborted.execute!(controller.signal));assert.equal(paid,1)
})
