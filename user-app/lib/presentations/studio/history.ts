import type {StudioRun} from './contract'
type Entry={contentKey:string;signature:string;revision:string;optionId:string;diversityKey?:string;design?:import('./variation').PreviousDesign}
type History={entries:Entry[]}
const key=(project:string)=>`presentation-studio/${project}/history.json`
const compact=(history:History):History=>({entries:history.entries.filter((e,i,entries)=>entries.findLastIndex(p=>p.revision===e.revision&&p.contentKey===e.contentKey)===i).slice(-300)})
export async function readStudioHistory(bucket:R2Bucket,project:string){
  return compact(await (await bucket.get(key(project)))?.json<History>()??{entries:[]})
}
export async function removeStudioHistory(bucket:R2Bucket,project:string,revisions:string[]){
  if(!revisions.length)return
  for(let attempt=0;attempt<8;attempt++){
    const file=await bucket.get(key(project));if(!file)return
    const history=await file.json<History>();history.entries=history.entries.filter(e=>!revisions.includes(e.revision))
    if(await bucket.put(key(project),JSON.stringify(history),{httpMetadata:{contentType:'application/json'},onlyIf:{etagMatches:file.etag}}))return
  }
  throw Error('История обновилась. Повторите очистку.')
}
export async function recordStudioHistory(bucket:R2Bucket,run:StudioRun){
  const selected=run.slides.flatMap(s=>{
    const option=s.options?.find(o=>o.id===s.plan?.optionId)
    const candidate=s.candidates.find(c=>c.id===option?.plan.candidateId)
    return s.contentKey&&option&&run.results[s.content.id]?.passed?[{contentKey:s.contentKey,signature:option.signature,revision:run.revision,optionId:option.id,diversityKey:s.diversityKey,...candidate?{design:{signature:option.signature,recipe:candidate.recipeId,label:candidate.label,background:candidate.backgroundId,components:Object.values(option.plan.components),regions:candidate.slots.map(s=>s.rect)}}:{}}]:[]
  })
  if(!selected.length)return
  for(let attempt=0;attempt<4;attempt++){
    const file=await bucket.get(key(run.projectId)),history=compact(file?await file.json<History>():{entries:[]})
    for(const entry of selected){const last=history.entries.find(e=>e.contentKey===entry.contentKey&&e.revision===entry.revision)
      if(last?.optionId!==entry.optionId){history.entries=history.entries.filter(e=>e!==last);history.entries.push(entry)}
    }
    history.entries=history.entries.slice(-300)
    if(await bucket.put(key(run.projectId),JSON.stringify(history),{httpMetadata:{contentType:'application/json'},onlyIf:file?{etagMatches:file.etag}:{etagDoesNotMatch:'*'}}))return
  }
  throw Error('Не удалось сохранить историю оформления. Результат сохранён; продолжите создание.')
}
