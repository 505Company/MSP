import {getProject} from '../../workspace/storage'
import {readStudioRun,studioCancellationKey} from './storage'

const prefix='studio-jobs/',json={httpMetadata:{contentType:'application/json'}},leaseMs=60_000
export type StudioJob={id:string;projectId:string;status:'queued'|'running'|'retrying'|'complete'|'blocked'|'cancelled';createdAt:number;updatedAt:number;attempts:number;owner?:string;leaseToken?:string;leaseUntil?:number;retryAt?:number;error?:string;progress:{step:'analysis';detail:string;completed:number;total:number}}
export async function readStudioJob(bucket:R2Bucket,id:string){return (await bucket.get(`${prefix}${id}.json`))?.json<StudioJob>()??null}
export function publicStudioJob(job:StudioJob|null){if(!job)return null;const {owner,leaseToken,leaseUntil,...result}=job;void owner;void leaseToken;void leaseUntil;return result}
async function change(bucket:R2Bucket,id:string,update:(job:StudioJob|null)=>StudioJob|null){
 for(let i=0;i<8;i++){
  const key=`${prefix}${id}.json`,file=await bucket.get(key),previous=file?await file.json<StudioJob>():null,next=update(previous)
  if(!next)return null
  if(await bucket.put(key,JSON.stringify(next),{...json,onlyIf:file?{etagMatches:file.etag}:{etagDoesNotMatch:'*'}}))return next
 }
 throw Error('Очередь обновилась. Повторите запрос.')
}
/** One independent queue entry per immutable generation, including parallel modes. */
export async function enqueueStudioJob(bucket:R2Bucket,projectId:string,revision:string,retry=false,now=Date.now()){
 const run=await readStudioRun(bucket,projectId,revision)
 if(!run||run.status==='cancelled'||await bucket.head(studioCancellationKey(projectId,revision)))throw Error('Генерация остановлена или не найдена.')
 return change(bucket,revision,previous=>{
  if(previous&&['queued','running','retrying','complete'].includes(previous.status))return previous
  if(previous?.status==='blocked'&&!retry)return previous
  return {id:revision,projectId,status:run.status==='complete'?'complete':'queued',createdAt:previous?.createdAt??now,updatedAt:now,attempts:0,progress:{step:'analysis',detail:'Генерация выполняется в фоне.',completed:Object.keys(run.results).length,total:run.semantic?.units?.length??run.slides.length}}
 })
}
export async function claimStudioJob(bucket:R2Bucket,owner:string,now=Date.now()){
 let cursor:string|undefined
 do{
  const page=await bucket.list({prefix,...cursor?{cursor}:{}})
  for(const entry of page.objects){
   const candidate=await(await bucket.get(entry.key))?.json<StudioJob>()
   if(!candidate||!['queued','running','retrying'].includes(candidate.status)||(candidate.retryAt??0)>now||candidate.status==='running'&&(candidate.leaseUntil??0)>now)continue
   const project=await getProject(bucket,candidate.projectId),cancelled=!!await bucket.head(studioCancellationKey(candidate.projectId,candidate.id)),token=crypto.randomUUID()
   const next=await change(bucket,candidate.id,old=>{
    if(!old||!['queued','running','retrying'].includes(old.status)||(old.retryAt??0)>now||old.status==='running'&&(old.leaseUntil??0)>now)return old
    if(!project||project.archivedAt||cancelled)return {...old,status:'cancelled',updatedAt:now}
    const attempts=old.attempts+Number(old.status==='running')
    if(attempts>3)return {...old,status:'blocked',updatedAt:now,error:'Обработчик прерывался несколько раз. Готовые слайды сохранены.'}
    return {...old,status:'running',owner,leaseToken:token,leaseUntil:now+leaseMs,attempts,updatedAt:now,error:undefined,retryAt:undefined}
   })
   if(next?.leaseToken===token)return next
  }
  cursor=page.truncated?page.cursor:undefined
 }while(cursor)
 return null
}
export async function assertStudioJob(bucket:R2Bucket,id:string,token:string,now=Date.now()){
 const job=await readStudioJob(bucket,id)
 if(!job||job.status!=='running'||job.leaseToken!==token||(job.leaseUntil??0)<=now)throw Error('Утрачено владение генерацией.')
 const project=await getProject(bucket,job.projectId)
 if(!project||project.archivedAt||await bucket.head(studioCancellationKey(job.projectId,id)))throw Error('Генерация остановлена.')
 return job
}
export async function updateStudioJob(bucket:R2Bucket,id:string,token:string,update:{complete?:boolean;error?:string;retryable?:boolean;progress?:{detail:string;completed?:number;total?:number}},now=Date.now()){
 await assertStudioJob(bucket,id,token,now)
 return change(bucket,id,old=>{
  if(!old||old.status!=='running'||old.leaseToken!==token)throw Error('Утрачено владение генерацией.')
  const next:StudioJob={...old,updatedAt:now,leaseUntil:now+leaseMs,progress:update.progress?{...old.progress,...update.progress,completed:update.progress.completed??old.progress.completed,total:update.progress.total??old.progress.total}:old.progress}
  if(update.complete){next.status='complete';delete next.error}
  if(update.error){next.attempts++;next.error=update.error.slice(0,700);next.status=update.retryable!==false&&next.attempts<=3?'retrying':'blocked';next.retryAt=now+15_000}
  if(next.status!=='running'){delete next.owner;delete next.leaseToken;delete next.leaseUntil}
  return next
 })
}
