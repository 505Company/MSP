import {parseModelJson} from '../../uploads/qwen-structured'
import {validateCompact,bindCompactData} from './compact-content'
import type {StudioRun} from './contract'

/** Only an explicit retry reinterprets an immutable response with the updated
 * adapter. Ready slides and running requests retain their frozen state. */
export async function revalidateCompactResponses(bucket:R2Bucket,run:StudioRun){
 const recovered:{content:ReturnType<typeof bindCompactData>;proof:ReturnType<typeof validateCompact>['proof'];response:string}[]=[]
 if(run.semantic?.strategy==='components')return recovered
 for(const unit of run.semantic?.units??[]){
  if(run.results[unit.id]?.passed||unit.status==='running')continue
  const prefix=`presentation-studio/${run.projectId}/${run.revision}/semantic/${unit.id}/responses/`,files:R2Object[]=[]
  let cursor:string|undefined
  do{const page=await bucket.list({prefix,cursor});files.push(...page.objects);cursor=page.truncated?page.cursor:undefined}while(cursor)
  files.sort((a,b)=>Number(b.uploaded??0)-Number(a.uploaded??0)||b.key.localeCompare(a.key))
  for(const file of files){
   const reply=await(await bucket.get(file.key))?.json<{content:string;finishReason?:string}>()
   if(!reply?.content||reply.finishReason!=='stop')continue
   try{const result=validateCompact(parseModelJson(reply.content),unit.packet);recovered.push({content:bindCompactData(result,run.library),proof:result.proof,response:file.key});break}catch{/* Invalid content remains invalid; do not fabricate replacement fields. */}
  }
 }
 return recovered
}
