import {parseModelJson} from '../../uploads/qwen-structured'
import {creativeRecipeChoices} from './creative-choices'
import {componentFlexTask} from './component-flex'
import type {StudioRun} from './contract'

/** Explicit retry can revalidate immutable provider replies after an adapter
 * fix. Never fabricate a plan or replay a different slide/library/revision. */
export async function revalidateComponentResponses(bucket:R2Bucket,run:StudioRun){
 const recovered:(ReturnType<ReturnType<typeof componentFlexTask>['validate']>&{response:string})[]=[]
 if(run.semantic?.strategy!=='components')return recovered
 for(const unit of run.semantic.units??[]){
  if(run.results[unit.id]?.passed||unit.status==='running')continue
  const spec=componentFlexTask(unit.packet,run.library),prefix=`presentation-studio/${run.projectId}/${run.revision}/semantic/${unit.id}/responses/`
  const files:R2Object[]=[];let cursor:string|undefined
  do{const page=await bucket.list({prefix,cursor});files.push(...page.objects);cursor=page.truncated?page.cursor:undefined}while(cursor)
  files.sort((a,b)=>Number(b.uploaded??0)-Number(a.uploaded??0)||b.key.localeCompare(a.key))
  for(const file of files){
   const reply=await(await bucket.get(file.key))?.json<{content:string;finishReason?:string}>()
   if(!reply?.content||reply.finishReason==='length')continue
   try{const result=spec.validate(parseModelJson(reply.content));recovered.push({...result,work:{...creativeRecipeChoices(result.work,run.library),variation:run.variation,chrome:{title:run.presentationTitle??run.slides[0]?.content.title??'Презентация',number:unit.packet.index+1}},response:file.key});break}catch{/* The exact source and component contracts still apply. */}
  }
 }
 return recovered
}
