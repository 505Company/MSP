import { createHash } from 'node:crypto'
import { validateImageSignature } from '../digital-designer/visual-package'
import { readLimitedBody, TransferError, type ImportDescriptor } from './binary-contract'
import { TRANSFER_LIMITS } from './transfer-limits'
import { enableAutomaticRefinement } from '../design-system/refinement-storage'
import type { UploadRepository } from './domain'

type Session={id:string;sourceKey:string;multipartId:string;expiresAt:number;descriptor:ImportDescriptor}
const prefix=(id:string)=>`upload-sessions/${id}`
const manifestKey=(id:string)=>`visual/${id}/manifest.json`
export const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')

export async function createBinarySession(bucket:R2Bucket,repository:UploadRepository,descriptor:ImportDescriptor){
  const id=crypto.randomUUID(),batchId=`batch-${Date.now()}-${id.slice(0,8)}`,pdf=/\.pdf$/i.test(descriptor.fileName),sourceKey=`sources/${batchId}/${id}.${pdf?'pdf':'pptx'}`
  const multipart=await bucket.createMultipartUpload(sourceKey,{httpMetadata:{contentType:pdf?'application/pdf':'application/vnd.openxmlformats-officedocument.presentationml.presentation'}})
  try{
    const session:Session={id,sourceKey,multipartId:multipart.uploadId,expiresAt:Date.now()+24*60*60_000,descriptor}
    await bucket.put(`${prefix(id)}/session.json`,JSON.stringify(session),{httpMetadata:{contentType:'application/json'}})
    const job=await repository.create({id,batchId,fileName:descriptor.fileName,sizeBytes:descriptor.sizeBytes,sourceObjectKey:null})
    return {id,partBytes:TRANSFER_LIMITS.partBytes,job}
  }catch(error){await multipart.abort();throw error}
}

async function sessionFor(bucket:R2Bucket,id:string):Promise<Session>{
  if(!/^[a-f0-9-]{36}$/.test(id))throw new TransferError('Загрузка не найдена',404)
  const object=await bucket.get(`${prefix(id)}/session.json`)
  if(!object)throw new TransferError('Загрузка не найдена',404)
  const session=await object.json<Session>()
  if(session.expiresAt<Date.now())throw new TransferError('Срок загрузки истёк. Выберите PPTX ещё раз.',410)
  return session
}

export async function uploadSourcePart(bucket:R2Bucket,id:string,partNumber:number,request:Request){
  const session=await sessionFor(bucket,id),total=session.descriptor.sizeBytes
  if(!Number.isInteger(partNumber)||partNumber<1||partNumber>Math.ceil(total/TRANSFER_LIMITS.partBytes))throw new TransferError('Неверный номер части')
  if(await bucket.head(manifestKey(id)))throw new TransferError('Загрузка уже завершена',409)
  const expected=Math.min(TRANSFER_LIMITS.partBytes,total-(partNumber-1)*TRANSFER_LIMITS.partBytes)
  const bytes=await readLimitedBody(request,expected)
  if(bytes.length!==expected)throw new TransferError('Часть PPTX передана не полностью')
  if(partNumber===1&&(bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4))throw new TransferError('Файл не является PPTX')
  const uploaded=await bucket.resumeMultipartUpload(session.sourceKey,session.multipartId).uploadPart(partNumber,bytes)
  // Receipts are written by the server; completion never trusts client-provided ETags.
  await bucket.put(`${prefix(id)}/parts/${partNumber}`,new Uint8Array(),{customMetadata:{partNumber:String(partNumber),etag:uploaded.etag}})
  return {partNumber}
}

export async function uploadVisualObject(bucket:R2Bucket,id:string,key:string,request:Request){
  const session=await sessionFor(bucket,id),object=session.descriptor.objects.find(o=>o.key===key)
  if(!object)throw new TransferError('Ресурс отсутствует в описании загрузки')
  if(await bucket.head(manifestKey(id)))throw new TransferError('Загрузка уже завершена',409)
  const bytes=await readLimitedBody(request,object.sizeBytes)
  if(bytes.length!==object.sizeBytes||digest(bytes)!==object.sha256)throw new TransferError('Ресурс повреждён при передаче. Повторите загрузку.',422)
  try{validateImageSignature(bytes,object.mime)}catch{throw new TransferError('Формат ресурса не соответствует его содержимому',422)}
  await bucket.put(`visual/${id}/${key}`,bytes,{httpMetadata:{contentType:object.mime},customMetadata:{sha256:object.sha256}})
}

async function listObjects(bucket:R2Bucket,keyPrefix:string){
  const objects:R2Object[]=[];let cursor:string|undefined
  do{
    // include is supported by R2; this app's pinned Workers types predate that option.
    const options:R2ListOptions & {include:Array<'customMetadata'>}={prefix:keyPrefix,limit:1000,cursor,include:['customMetadata']}
    const page=await bucket.list(options)
    objects.push(...page.objects);cursor=page.truncated?page.cursor:undefined
  }while(cursor)
  return objects
}

export async function completeBinarySession(bucket:R2Bucket,repository:UploadRepository,id:string){
  const session=await sessionFor(bucket,id),d=session.descriptor
  const existing=await bucket.head(manifestKey(id))
  if(existing)return {job:await repository.get(id),created:false}
  const stored=new Map((await listObjects(bucket,`visual/${id}/`)).map(o=>[o.key,o]))
  for(const object of d.objects){
    const actual=stored.get(`visual/${id}/${object.key}`)
    if(!actual||actual.size!==object.sizeBytes||actual.customMetadata?.sha256!==object.sha256)throw new TransferError('Загружены не все ресурсы шаблона',409)
  }
  let source=await bucket.head(session.sourceKey)
  if(!source){
    const receipts=await listObjects(bucket,`${prefix(id)}/parts/`)
    const parts=receipts.map(o=>({partNumber:Number(o.customMetadata?.partNumber),etag:o.customMetadata?.etag??''})).sort((a,b)=>a.partNumber-b.partNumber)
    if(parts.length!==Math.ceil(d.sizeBytes/TRANSFER_LIMITS.partBytes)||parts.some((p,i)=>p.partNumber!==i+1||!p.etag))throw new TransferError('Загружены не все части PPTX',409)
    try{source=await bucket.resumeMultipartUpload(session.sourceKey,session.multipartId).complete(parts)}
    catch(error){source=await bucket.head(session.sourceKey);if(!source)throw error}
  }
  if(source.size!==d.sizeBytes)throw new TransferError('Размер сохранённого PPTX не совпадает',422)
  const saved=await bucket.get(session.sourceKey)
  if(!saved)throw new TransferError('Исходный PPTX не найден',409)
  // Hash the complete original as a stream: no 400 MB ArrayBuffer inside a Worker.
  const hash=createHash('sha256'),reader=saved.body.getReader();let size=0
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;hash.update(chunk.value)}}finally{reader.releaseLock()}
  if(size!==d.sizeBytes||hash.digest('hex')!==d.sourceHash)throw new TransferError('PPTX повреждён при передаче. Выберите файл ещё раз.',422)
  // Attach the verified original before publication so interrupted completion remains recoverable.
  await repository.update(id,{sourceObjectKey:session.sourceKey})
  // Publication is last, after every resource and the source checksum have been verified.
  // CAS makes replayed completion idempotent and prevents a second model invocation.
  await enableAutomaticRefinement(bucket,id,d.visual.snapshot.sourceId)
  const published=await bucket.put(manifestKey(id),JSON.stringify(d.visual),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}})
  const job=published?await repository.update(id,{status:'processing',stage:'Шаблон сохранён',progress:24}):await repository.get(id)
  return {job,created:!!published}
}
