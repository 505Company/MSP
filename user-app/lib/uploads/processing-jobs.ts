import {assertUploadActive,uploadIsCancelled} from './cancellation-server'
import type {DesignProgressUpdate} from './design-progress'
import {EDITABLE_COMPILER_VERSION} from '../design-system/editable-contract'
import {HTML_QUALIFICATION_VERSION} from '../design-system/editable-qualification'
import {RECONSTRUCTION_VERSION} from '../design-system/reconstruction-contract'
import {GRAPHIC_COMPONENTS_VERSION} from '../design-system/graphic-components'

export const PROCESSING_REVISION = ['background-1','family-conflicts-2',EDITABLE_COMPILER_VERSION,HTML_QUALIFICATION_VERSION,RECONSTRUCTION_VERSION,GRAPHIC_COMPONENTS_VERSION].join(':')
export const PROCESSING_LEASE_MS=45_000
export const WORKER_HEALTH_MS=25_000
const retryDelays=[15_000,45_000,120_000]
const prefix='processing-jobs/',key=(id:string)=>prefix+id+'.json'
const json={httpMetadata:{contentType:'application/json'}}
export type ProcessingJob={
 id:string;label:string;revision:string;status:'queued'|'running'|'retrying'|'blocked'|'complete'|'cancelled'
 progress:DesignProgressUpdate;createdAt:number;updatedAt:number;heartbeatAt?:number
 attempts:number;retryAt?:number;error?:string;owner?:string;leaseToken?:string;leaseUntil?:number;recoveryRequestedAt?:number
 work?:'refinement'|'audit';followUpRefinement?:boolean;followUpAudit?:boolean
}
export type ProcessingJobUpdate={progress?:DesignProgressUpdate;complete?:boolean;error?:string;retryable?:boolean}
export type PublicProcessingJob=ReturnType<typeof publicProcessingJob>
export function publicProcessingJob(job:ProcessingJob){
 const {owner,leaseToken,leaseUntil,...publicJob}=job
 void owner;void leaseToken;void leaseUntil
 return publicJob
}
export async function readProcessingJob(bucket:R2Bucket,id:string):Promise<ProcessingJob|null>{
 const file=await bucket.get(key(id));if(!file)return null
 const job=await file.json<ProcessingJob>()
 return await uploadIsCancelled(bucket,id)?{...job,status:'cancelled'}:job
}
export async function listProcessingJobs(bucket:R2Bucket){
 const jobs:ProcessingJob[]=[];let cursor:string|undefined
 do{
  const page=await bucket.list({prefix,...(cursor?{cursor}:{})})
  for(const entry of page.objects){const file=await bucket.get(entry.key);if(file){const job=await file.json<ProcessingJob>();jobs.push(await uploadIsCancelled(bucket,job.id)?{...job,status:'cancelled'}:job)}}
  cursor=page.truncated?page.cursor:undefined
 }while(cursor)
 return jobs.sort((a,b)=>a.createdAt-b.createdAt)
}
async function mutate(bucket:R2Bucket,id:string,change:(previous:ProcessingJob|null)=>ProcessingJob){
 for(let i=0;i<6;i++){
  await assertUploadActive(bucket,id)
  const file=await bucket.get(key(id)),previous=file?await file.json<ProcessingJob>():null
  const result=change(previous)
  const stored=await bucket.put(key(id),JSON.stringify(result),{...json,onlyIf:file?{etagMatches:file.etag}:{etagDoesNotMatch:'*'}})
  if(stored){await assertUploadActive(bucket,id);return result}
 }
 throw new Error('Состояние обработки изменилось; повторите запрос')
}
export async function enqueueProcessingJob(bucket:R2Bucket,id:string,label:string,restart=false,now=Date.now()){
 return mutate(bucket,id,previous=>{
  if(previous?.status==='running'&&(previous.leaseUntil??0)>now)return previous
  if(previous&&!restart&&['blocked','cancelled'].includes(previous.status))return previous
  if(previous?.revision===PROCESSING_REVISION&&!restart)return previous
  return {id,label,revision:PROCESSING_REVISION,status:'queued',attempts:0,createdAt:previous?.createdAt??now,updatedAt:now,
   recoveryRequestedAt:restart?now:previous?.recoveryRequestedAt,
   progress:{step:'analysis',scope:'resume',detail:previous?'Продолжаем с сохранённого этапа':'Файл сохранён. Ожидаем начало анализа'}}
 })
}
/** A requested refinement uses the same sequential worker, without replaying
 * unrelated import stages or resetting their recovery/billing state. */
export async function enqueueRefinementProcessing(bucket:R2Bucket,id:string,label:string,now=Date.now()){
 return mutate(bucket,id,previous=>{
  if(previous?.status==='running'&&(previous.leaseUntil??0)>now)return {...previous,followUpRefinement:true}
  if(previous&&['queued','retrying'].includes(previous.status))return previous
  return {id,label,revision:PROCESSING_REVISION,status:'queued',work:'refinement',attempts:0,createdAt:previous?.createdAt??now,updatedAt:now,
   progress:{step:'editable',scope:'refinement',detail:'Ищем пропуски и проверяем дополнения'}}
 })
}
/** An explicit audit is isolated from the import's model stages. */
export async function enqueueAuditProcessing(bucket:R2Bucket,id:string,label:string,now=Date.now()){
 return mutate(bucket,id,previous=>{
  if(previous&&['running','queued','retrying'].includes(previous.status))return {...previous,followUpAudit:true}
  return {id,label,revision:PROCESSING_REVISION,status:'queued',work:'audit',attempts:0,createdAt:previous?.createdAt??now,updatedAt:now,
   progress:{step:'graphics',scope:'quality-audit',detail:'Проверяем смысловые блоки и приёмы шаблона'}}
 })
}
/** A renewable CAS lease fences duplicate workers and survives browser/process loss. */
export async function claimProcessingJob(bucket:R2Bucket,owner:string,now=Date.now()){
 for(const candidate of await listProcessingJobs(bucket)){
  if(!['queued','retrying','running'].includes(candidate.status)||(candidate.retryAt??0)>now)continue
  if(candidate.status==='running'&&(candidate.leaseUntil??0)>now)continue
  const leaseToken=crypto.randomUUID()
  try{
   const result=await mutate(bucket,candidate.id,previous=>{
    if(!previous||!['queued','retrying','running'].includes(previous.status)||(previous.retryAt??0)>now||previous.status==='running'&&(previous.leaseUntil??0)>now)return previous!
    const attempts=previous.attempts+Number(previous.status==='running')
    if(attempts>retryDelays.length)return {...previous,status:'blocked',error:'Фоновый обработчик несколько раз прервался. Готовые этапы сохранены.',updatedAt:now}
    return {...previous,status:'running',attempts,owner,leaseToken,leaseUntil:now+PROCESSING_LEASE_MS,heartbeatAt:now,retryAt:undefined,error:undefined}
   })
   if(result.leaseToken===leaseToken)return result
  }catch(error){if(await uploadIsCancelled(bucket,candidate.id))continue;throw error}
 }
 return null
}
export async function updateProcessingJob(bucket:R2Bucket,id:string,token:string,update:ProcessingJobUpdate,now=Date.now()){
 return mutate(bucket,id,previous=>{
  if(!previous||previous.status!=='running'||previous.leaseToken!==token||(previous.leaseUntil??0)<=now)throw new Error('Утрачено владение фоновой задачей')
  const changed=update.progress&&JSON.stringify(update.progress)!==JSON.stringify(previous.progress)
  const next:ProcessingJob={...previous,progress:update.progress??previous.progress,heartbeatAt:now,leaseUntil:now+PROCESSING_LEASE_MS,updatedAt:changed?now:previous.updatedAt}
  if(update.complete){
   next.status=previous.followUpRefinement||previous.followUpAudit?'queued':'complete';next.updatedAt=now;next.error=undefined
   if(previous.followUpRefinement){next.work='refinement';delete next.followUpRefinement;next.progress={step:'editable',scope:'refinement',detail:'Проверяем запрошенное дополнение'}}
   else if(previous.followUpAudit){next.work='audit';delete next.followUpAudit;next.progress={step:'graphics',scope:'quality-audit',detail:'Проверяем смысловые блоки и приёмы шаблона'}}
   else next.progress={step:'graphics',scope:'complete',detail:'Дизайн-система готова. Компоненты и графика проверены.'}
  }
  if(update.error){
   next.attempts++;next.error=update.error.slice(0,700);next.updatedAt=now
   next.status=update.retryable!==false&&next.attempts<=retryDelays.length?'retrying':'blocked'
   next.retryAt=next.status==='retrying'?now+retryDelays[next.attempts-1]:undefined
  }
  if(next.status!=='running'){delete next.owner;delete next.leaseToken;delete next.leaseUntil}
  return next
 })
}
export async function workerHeartbeat(bucket:R2Bucket,workerId:string,now=Date.now(),kinds?:string[]){
 const workerKey=`processing-worker/heartbeats/${workerId}.json`
 const previous=await(await bucket.get(workerKey))?.json<{workerId:string;kinds?:string[]}>()
 const supported=kinds?[...new Set([...previous?.workerId===workerId?previous.kinds??[]:[],...kinds])]:(previous?.workerId===workerId?previous.kinds:undefined)
 const value=JSON.stringify({workerId,at:now,...(supported?{kinds:supported}:{})})
 await bucket.put(workerKey,value,json)
 await bucket.put('processing-worker/heartbeat.json',value,json)
}
export async function workerIsAvailable(bucket:R2Bucket,now=Date.now(),kind?:string){
 const file=await bucket.get('processing-worker/heartbeat.json')
 const usable=(h:{at:number;kinds?:string[]})=>now-h.at<WORKER_HEALTH_MS&&(!kind||!!h.kinds?.includes(kind))
 if(file&&usable(await file.json<{at:number;kinds?:string[]}>()))return true
 let cursor:string|undefined
 do{const page=await bucket.list({prefix:'processing-worker/heartbeats/',...cursor?{cursor}:{}})
  for(const entry of page.objects){const h=await(await bucket.get(entry.key))?.json<{at:number;kinds?:string[]}>();if(h&&usable(h))return true}
  cursor=page.truncated?page.cursor:undefined
 }while(cursor)
 return false
}
