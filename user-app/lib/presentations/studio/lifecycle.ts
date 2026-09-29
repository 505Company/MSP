import {getProject,workspaceId} from '../../workspace/storage'
import {studioKey,studioCancellationKey,readStudioRun} from './storage'
import {listStudioGenerations} from './generations'
import type {StudioRun} from './contract'

const json={httpMetadata:{contentType:'application/json'}}
export type SlideSelection={revision:string;slideId:string}[]

/** Metadata changes also work on older, immutable render snapshots. CAS keeps
 * concurrent selections, completed receipts and cancellation flags intact. */
async function updateMetadata(bucket:R2Bucket,project:string,revision:string,update:(run:StudioRun)=>void){
  const key=studioKey(project,revision)
  for(let attempt=0;attempt<12;attempt++){
    const file=await bucket.get(key);if(!file)throw Error('Генерация не найдена.')
    const run=await file.json<StudioRun>();if(run.projectId!==project||run.revision!==revision)throw Error('Неверная генерация.')
    update(run)
    if(await bucket.put(key,JSON.stringify(run),{...json,onlyIf:{etagMatches:file.etag}}))return run
  }
  throw Error('Список изменился в другой вкладке. Повторите действие.')
}

export async function setStudioSlidesDeleted(bucket:R2Bucket,project:string,selection:SlideSelection,deleted:boolean){
  const p=await getProject(bucket,project);if(!p||p.archivedAt)throw Error('Проект не найден.')
  const groups=new Map<string,Set<string>>()
  for(const {revision,slideId} of selection){workspaceId.parse(revision);if(!groups.has(revision))groups.set(revision,new Set());groups.get(revision)!.add(slideId)}
  // Validate every target before touching any generation.
  for(const [revision,ids] of groups){const run=await readStudioRun(bucket,project,revision);if(!run||[...ids].some(id=>!run.slides.some(s=>s.content.id===id)))throw Error('Выбранный слайд не найден.')}
  const changes=[]
  for(const [revision,ids] of groups){
    const run=await updateMetadata(bucket,project,revision,run=>{const next=new Set(run.deletedSlideIds);for(const id of ids){if(deleted)next.add(id);else next.delete(id)}run.deletedSlideIds=[...next]})
    changes.push({revision,deletedSlideIds:run.deletedSlideIds!})
  }
  return changes
}

export async function cancelStudioGeneration(bucket:R2Bucket,project:string,revision:string){
  const run=await readStudioRun(bucket,project,revision)
  if(!run||run.status==='complete'||run.status==='cancelled')return false
  const cancelledAt=new Date().toISOString()
  // A lightweight marker stops even stale in-flight writers and provider retries.
  await bucket.put(studioCancellationKey(project,revision),JSON.stringify({cancelledAt}),json)
  await updateMetadata(bucket,project,revision,run=>{run.status='cancelled';run.cancelledAt=cancelledAt;delete run.error})
  return true
}
export async function cancelProjectStudioGenerations(bucket:R2Bucket,project:string){
  let cancelled=0
  for(const run of await listStudioGenerations(bucket,project))if(run.status!=='complete'&&run.status!=='cancelled'&&await cancelStudioGeneration(bucket,project,run.revision))cancelled++
  return cancelled
}

/** Explicit stop also aborts a currently running provider call, not just its
 * eventual write. A read error fails closed instead of permitting more work. */
export async function withStudioCancellation<T>(bucket:R2Bucket,run:StudioRun,signal:AbortSignal,work:(signal:AbortSignal)=>Promise<T>){
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason)
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
  let checking=false
  const check=async()=>{if(checking)return;checking=true;try{if(await bucket.head(studioCancellationKey(run.projectId,run.revision)))controller.abort(Error('Генерация остановлена.'))}catch(error){controller.abort(error)}finally{checking=false}}
  const timer=setInterval(()=>void check(),1000)
  try{await check();controller.signal.throwIfAborted();return await work(controller.signal)}finally{clearInterval(timer);signal.removeEventListener('abort',abort)}
}
