import {getProject} from '../../workspace/storage'
import {listStudioGenerations,type GenerationSummary} from './generations'
import {studioKey,studioCancellationKey} from './storage'
import {removeStudioHistory} from './history'

async function keysUnder(bucket:R2Bucket,prefix:string){
  const keys:string[]=[];let cursor:string|undefined
  do{const page=await bucket.list({prefix,cursor});keys.push(...page.objects.map(o=>o.key));cursor=page.truncated?page.cursor:undefined}while(cursor)
  return keys
}

/** Explicit history cleanup. A fixed inventory protects generations created
 * during cleanup. Source uploads and the editable project draft are untouched.
 * Backups live outside the active namespace; cancellation tombstones prevent
 * stale tabs/workers from recreating deleted runs. */
export async function pruneStudioGenerations(bucket:R2Bucket,projectId:string){
  const project=await getProject(bucket,projectId)
  if(!project||project.archivedAt)throw Error('Проект не найден.')
  const generations=await listStudioGenerations(bucket,projectId),latest=new Map<GenerationSummary['mode'],GenerationSummary>()
  for(const run of generations)latest.set(run.mode,run)
  const kept=[...latest.values()].map(run=>run.revision),removed:string[]=[]
  for(const run of generations.filter(run=>!kept.includes(run.revision))){
    const prefix=studioKey(projectId,run.revision).replace('run.json',''),marker=studioCancellationKey(projectId,run.revision)
    await bucket.put(marker,JSON.stringify({cancelledAt:new Date().toISOString(),reason:'history-pruned'}),{httpMetadata:{contentType:'application/json'}})
    const keys=(await keysUnder(bucket,prefix)).filter(key=>key!==marker),job=`studio-jobs/${run.revision}.json`
    if(await bucket.head(job))keys.push(job)
    // Copy every object before deleting any, so a failed backup is harmless.
    for(const key of keys){
      const file=await bucket.get(key)
      if(file){
        const backup=`deleted-presentations/${projectId}/${run.revision}/${key===job?'job.json':key.slice(prefix.length)}`
        if(!await bucket.put(backup,new Uint8Array(await file.arrayBuffer()),{httpMetadata:file.httpMetadata,onlyIf:{etagDoesNotMatch:'*'}})&&!await bucket.head(backup))throw Error('Не удалось сохранить резервную копию истории.')
      }
    }
    await removeStudioHistory(bucket,projectId,[run.revision])
    for(const key of keys)await bucket.delete(key)
    removed.push(run.revision)
  }
  return {kept,removed}
}
