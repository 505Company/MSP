import assert from 'node:assert/strict'
import test from 'node:test'
import { validateImportDescriptor,readLimitedBody,type ImportDescriptor } from '../lib/uploads/binary-contract'
import { createBinarySession,uploadSourcePart,uploadVisualObject,completeBinarySession,digest } from '../lib/uploads/binary-session'
import type { UploadJob,UploadRepository } from '../lib/uploads/domain'
import { TRANSFER_LIMITS } from '../lib/uploads/transfer-limits'

const source=new Uint8Array([80,75,3,4,0,1,2,3]),image=new Uint8Array([137,80,78,71,13,10,26,10])
function descriptor():ImportDescriptor{
  const assetId=`asset-${digest(image).slice(0,24)}`
  return {fileName:'control.pptx',sizeBytes:source.length,sourceHash:digest(source),objects:[{key:assetId,mime:'image/png',sizeBytes:image.length,sha256:digest(image)}],
    visual:{renderer:'msp-web-2026-09-25',previewKind:'reconstruction',previews:[],sheets:[],assets:[{id:assetId,mime:'image/png',extension:'png',origins:['ppt/media/image.png']}],
      snapshot:{schemaVersion:1,sourceId:digest(source),name:'control.pptx',slideCount:1,slides:[{id:'s01',number:1,width:960,height:540,part:'ppt/slides/slide1.xml',text:'',warnings:[]}],elements:[],
        assets:[{id:assetId,mime:'image/png',byteLength:image.length,origins:['ppt/media/image.png']}],colors:[],fonts:[],limitations:[]}}}
}
const body=(bytes:Uint8Array)=>new Request('https://local.test',{method:'PUT',body:bytes as Uint8Array<ArrayBuffer>})

function storage(){
  type Entry={key:string;bytes:Uint8Array;size:number;etag:string;customMetadata?:Record<string,string>}
  const data=new Map<string,Entry>(),multiparts=new Map<string,Map<number,Uint8Array>>(),jobs=new Map<string,UploadJob>();let gen=0
  const multipart=(key:string,id:string)=>({key,uploadId:id,
    async uploadPart(n:number,bytes:Uint8Array){multiparts.get(id)!.set(n,bytes);return {partNumber:n,etag:`part-${n}-${digest(bytes)}`}},
    async complete(parts:R2UploadedPart[]){const chunks=parts.map(p=>multiparts.get(id)!.get(p.partNumber)!);const bytes=new Uint8Array(chunks.reduce((s,c)=>s+c.length,0));let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length}await raw.put(key,bytes);multiparts.delete(id);return data.get(key)},
    async abort(){multiparts.delete(id)}
  })
  const raw={
    async createMultipartUpload(key:string){const id=String(++gen);multiparts.set(id,new Map());return multipart(key,id)},
    resumeMultipartUpload:multipart,
    async head(key:string){return data.get(key)??null},
    async get(key:string){const item=data.get(key);if(!item)return null;return {...item,
      json:async()=>JSON.parse(new TextDecoder().decode(item.bytes)),
      arrayBuffer:async()=>{throw new Error('Whole-source buffering is forbidden')},
      body:new ReadableStream<Uint8Array>({start(c){for(let i=0;i<item.bytes.length;i+=3)c.enqueue(item.bytes.slice(i,i+3));c.close()}})}},
    async put(key:string,input:string|Uint8Array,options?:R2PutOptions){
      if((options?.onlyIf as R2Conditional)?.etagDoesNotMatch==='*'&&data.has(key))return null
      const bytes=typeof input==='string'?new TextEncoder().encode(input):input,entry={key,bytes,size:bytes.length,etag:String(++gen),customMetadata:options?.customMetadata};data.set(key,entry);return entry
    },
    async list(options:R2ListOptions){return {objects:[...data.values()].filter(e=>e.key.startsWith(options.prefix??'')),truncated:false}},
  }
  const repository={
    async create(input:Partial<UploadJob>){const job={...input,status:'queued',sourceObjectKey:null} as UploadJob;jobs.set(job.id,job);return job},
    async get(id:string){return jobs.get(id)??null},
    async update(id:string,patch:Partial<UploadJob>){const job={...jobs.get(id)!,...patch};jobs.set(id,job);return job},
  } as UploadRepository
  return {bucket:raw as unknown as R2Bucket,repository,data,multiparts,jobs}
}

test('compact transfer accepts aggregate evidence above the old 40 MB JSON limit',()=>{
  const d=descriptor();d.visual.assets=[];d.visual.snapshot.assets=[];d.objects=[]
  for(let i=0;i<6;i++){
    const hash=String(i).repeat(64),id=`asset-${hash.slice(0,24)}`,size=8*1024*1024
    d.visual.assets.push({id,mime:'application/octet-stream',extension:'bin',origins:[]})
    d.visual.snapshot.assets.push({id,mime:'application/octet-stream',byteLength:size,origins:[]})
    d.objects.push({key:id,mime:'application/octet-stream',sizeBytes:size,sha256:hash})
  }
  assert.ok(d.objects.reduce((s,o)=>s+o.sizeBytes,0)>40_000_000)
  assert.ok(JSON.stringify(d).length<10_000)
  assert.equal(validateImportDescriptor(d).objects.length,6)
})
test('transfer cannot drop resources, forge source identity or replace expected hashes',()=>{
  const d=descriptor();assert.deepEqual(validateImportDescriptor(d),d)
  const missing=structuredClone(d);missing.objects=[];assert.throws(()=>validateImportDescriptor(missing),/manifest/)
  const wrong=structuredClone(d);wrong.sourceHash='f'.repeat(64);assert.throws(()=>validateImportDescriptor(wrong),/source/)
  const hash=structuredClone(d);hash.objects[0].sha256='a'.repeat(64);assert.throws(()=>validateImportDescriptor(hash),/identity/)
  const orphan=structuredClone(d);orphan.visual.snapshot.assets=[];assert.throws(()=>validateImportDescriptor(orphan),/manifest/)
})
test('bounded body reader checks actual chunks even without Content-Length',async()=>{
  const request=new Request('https://local.test',{method:'PUT',body:new ReadableStream({start(c){c.enqueue(new Uint8Array(3));c.enqueue(new Uint8Array(4));c.close()}}),duplex:'half'} as RequestInit)
  await assert.rejects(readLimitedBody(request,6),/размер/)
  assert.equal((await readLimitedBody(body(source),source.length)).length,source.length)
})
test('incomplete or corrupt uploads never publish a visual manifest; replayed completion is idempotent',async()=>{
  const {bucket,repository,data}=storage(),d=descriptor(),{id}=await createBinarySession(bucket,repository,d)
  await assert.rejects(completeBinarySession(bucket,repository,id),/ресурсы/)
  await assert.rejects(uploadVisualObject(bucket,id,d.objects[0].key,body(new Uint8Array(image.length))),/повреждён/)
  assert.equal(data.has(`visual/${id}/${d.objects[0].key}`),false)
  await uploadVisualObject(bucket,id,d.objects[0].key,body(image))
  await assert.rejects(completeBinarySession(bucket,repository,id),/части/)
  await assert.rejects(uploadSourcePart(bucket,id,1,body(source.slice(0,4))),/полностью/)
  await assert.rejects(uploadSourcePart(bucket,id,2,body(source)),/номер/)
  assert.equal(data.has(`visual/${id}/manifest.json`),false)
  await uploadSourcePart(bucket,id,1,body(source))
  await uploadSourcePart(bucket,id,1,body(source)) // Network retry of a completed part.
  const first=await completeBinarySession(bucket,repository,id)
  assert.equal(first.created,true);assert.ok(data.has(`visual/${id}/manifest.json`))
  await repository.update(id,{status:'ready_for_review'})
  const replay=await completeBinarySession(bucket,repository,id)
  assert.equal(replay.created,false);assert.equal(replay.job?.status,'ready_for_review')
  await assert.rejects(uploadVisualObject(bucket,id,d.objects[0].key,body(image)),/уже завершена/)
})
test('full-source hash mismatch prevents publication even when every part arrived',async()=>{
  const {bucket,repository,data}=storage(),d=descriptor(),{id}=await createBinarySession(bucket,repository,d)
  await uploadVisualObject(bucket,id,d.objects[0].key,body(image))
  const modified=source.slice();modified[7]=99
  await uploadSourcePart(bucket,id,1,body(modified))
  await assert.rejects(completeBinarySession(bucket,repository,id),/повреждён/)
  assert.equal(data.has(`visual/${id}/manifest.json`),false)
  assert.equal((await repository.get(id))?.sourceObjectKey,null)
})
test('source budget above 100 MiB is shared with the browser, with a finite upper bound',()=>{
  const d=descriptor();d.sizeBytes=101*1024*1024;assert.equal(validateImportDescriptor(d).sizeBytes,d.sizeBytes)
  d.sizeBytes=TRANSFER_LIMITS.sourceBytes+1;assert.throws(()=>validateImportDescriptor(d))
})
