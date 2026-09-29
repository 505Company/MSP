import type {StudioRun} from '../lib/presentations/studio/contract'
import {renderStudioOptions} from './studio-generation'
import {renderStudioFallback} from './studio-fallback'

/** A server-owned renderer keeps progressing with every project tab closed.
 * Semantic requests overlap; DOM fitting is serialized within each page. */
export async function executeStudioGeneration(projectId:string,revision:string,leaseToken:string,signal:AbortSignal,onProgress:(done:number,total:number)=>void){
 const url=`/api/projects/${projectId}/compose`,query=new URLSearchParams({revision,view:'worker'})
 let library:StudioRun['library']|undefined
 const read=async(slideId?:string)=>{
  const q=new URLSearchParams(query);if(slideId)q.set('slide',slideId);if(library)q.set('library','0')
  const response=await fetch(`${url}?${q}`,{signal,cache:'no-store'}),data=await response.json() as {run?:StudioRun;error?:string}
  if(!response.ok||!data.run)throw Error(data.error??'Генерация не найдена.')
  if(data.run.status==='cancelled')throw Error('Генерация остановлена.')
  library??=data.run.library;data.run.library=library
  return data.run
 }
 const post=async(action:string,slideId?:string,receipt?:unknown)=>{
  const response=await fetch(url,{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({action,revision,leaseToken,compact:true,...slideId?{slideId}:{},...receipt?{receipt}:{}})})
  if(!response.ok){const value=await response.json() as {error?:string};throw Error(value.error??'Не удалось сохранить слайд.')}
  // Structure uses a durable streamed response; finishing it is the checkpoint.
  await response.text()
 }
 const first=await read(),ids=(first.semantic?.units?.map(u=>u.id)??first.slides.map(s=>s.content.id)).filter(id=>!first.deletedSlideIds?.includes(id)&&!first.results[id]?.passed)
 const total=first.semantic?.units?.length??first.slides.length,done=new Set(Object.keys(first.results))
 onProgress(done.size,total)
 let rendering:Promise<unknown>=Promise.resolve()
 const fit=<T>(work:()=>Promise<T>)=>{const result=rendering.then(work,work);rendering=result.catch(()=>{});return result}
 const worker=async()=>{
  while(ids.length){
   signal.throwIfAborted();const id=ids.shift()!
   let current=await read(id),unit=current.semantic?.units?.find(u=>u.id===id)
   if(current.results[id]?.passed){done.add(id);onProgress(done.size,total);continue}
   for(let attempt=0;unit&&unit.status!=='complete'&&unit.attempts<2&&attempt<2;attempt++){
    await post('structure',id);current=await read(id);unit=current.semantic?.units?.find(u=>u.id===id)
   }
   await fit(async()=>{
    signal.throwIfAborted()
    // Another resumed worker may have finished this slide before the lease changed.
    current=await read(id);const work=current.slides.find(s=>s.content.id===id)
    if(current.results[id]?.passed)return
    if(work?.candidates.length&&(!unit||unit.status==='complete')){
     let options:Awaited<ReturnType<typeof renderStudioOptions>>|undefined
     try{
      options=await renderStudioOptions(library!,work,signal)
     }catch{signal.throwIfAborted()}
     // A transport failure must retry this measured result, never replace it
     // with a fallback intended only for genuinely unsuitable geometry.
     if(options){await post('options',id,{slideId:id,options:options.map(o=>({id:o.id,receipt:o.receipt}))});return}
    }
    const receipt=await renderStudioFallback(current,id,signal)
    await post('fallback',id,receipt)
   })
   done.add(id);onProgress(done.size,total)
  }
 }
 await Promise.all(Array.from({length:Math.min(3,ids.length)},()=>worker()))
 const final=await read()
 if(final.status!=='complete')throw Error(final.error??'Не все слайды завершены. Продолжим с сохранённого этапа.')
 return final
}
