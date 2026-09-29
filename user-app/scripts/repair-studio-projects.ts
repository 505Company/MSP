import {mkdir,readFile,writeFile} from 'node:fs/promises'
import type {StudioRun} from '../lib/presentations/studio/contract'
import type {PresentationProject} from '../lib/workspace/types'
const origin='http://127.0.0.1:5184',out='outputs/diagnostics/studio-design-system-usage/live'
await mkdir(out,{recursive:true})
async function api(path:string,body?:unknown){const response=await fetch(origin+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});if(!response.ok)throw Error(path+': '+(await response.text()).slice(0,500));return response}
const jobs:{mode:string;project:string;revision:string}[]=[]
for(const [project,mode,expected] of [['9b5a393d-aca4-407d-8585-f50d6cf81016','fast','13f468ff-c16c-4392-905d-235bdb8b2f1f'],['9b5a393d-aca4-407d-8585-f50d6cf81016','balanced',''],['241766d0-1b67-47f3-96ca-7b0d166de816','creative','d38bc9c2-3ee6-401d-8c9e-7ce6a5b245ea']]){
 const p=(await(await api(`/api/projects/${project}`)).json() as {project:PresentationProject}).project
 if(expected&&p.revision!==expected)throw Error('Project changed since audit: '+project)
 const response=await fetch(`${origin}/api/projects/${project}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:p.revision,name:p.name,text:p.text,uploadId:p.uploadId,generationMode:mode==='fast'?'fast':'smart',compositionMode:mode==='creative'?'components':'recipes',modelRoute:p.modelRoute??'default',recipeScope:'all'})})
 if(!response.ok)throw Error('Save failed '+response.status)
 const next=(await response.json() as {project:PresentationProject}).project
 const run=(await(await api(`/api/projects/${project}/compose`,{action:'start',revision:next.revision})).json() as {run:StudioRun}).run
 jobs.push({mode,project,revision:run.revision});await writeFile(`${out}/jobs.json`,JSON.stringify(jobs,null,2));console.log('STARTED',mode,run.revision,run.version)
}
const tasks=jobs.flatMap(j=>j.mode==='fast'?[]:Array.from({length:j.mode==='creative'?5:6},(_,i)=>({...j,slideId:`slide-${i+1}`})))
await Promise.all([0,1].map(async()=>{for(let task=tasks.shift();task;task=tasks.shift()){
 const start=Date.now();console.log('STRUCTURE',task.mode,task.slideId)
 try{await(await api(`/api/projects/${task.project}/compose`,{action:'structure',revision:task.revision,slideId:task.slideId})).text()}catch(e){console.log('REQUEST_ERROR',task.mode,task.slideId,String(e))}
 const run=(await(await api(`/api/projects/${task.project}/compose?revision=${task.revision}`)).json() as {run:StudioRun}).run
 const u=run.semantic!.units!.find(u=>u.id===task!.slideId)!
 await writeFile(`${out}/${task.mode}-run.json`,JSON.stringify(run));console.log('STRUCTURED',task.mode,task.slideId,u.status,u.error??'',Math.round((Date.now()-start)/1000))
}}))
for(const j of jobs){const run=(await(await api(`/api/projects/${j.project}/compose?revision=${j.revision}`)).json() as {run:StudioRun}).run;await writeFile(`${out}/${j.mode}-run.json`,JSON.stringify(run))}
console.log('MODEL_STAGE_FINISHED',JSON.parse(await readFile(`${out}/jobs.json`,'utf8')))
