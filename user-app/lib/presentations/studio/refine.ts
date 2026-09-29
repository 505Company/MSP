import {artDirectedCandidates} from './art-direction'
import {contentHash} from '../../design-system/catalog'
import {getProject} from '../../workspace/storage'
import {componentBindings} from './bindings'
import {STUDIO_VERSION,type SlideWork,type StudioRun,type StudioLibrary} from './contract'
import {creativeRecipeChoices} from './creative-choices'
import {candidatesFor} from './recipes'
import {libraryCoverCandidates} from './visual-design'
import {readStudioRun,studioKey} from './storage'
import {hydrateFallbackSources} from './fallback-storage'
import {readStudioHistory} from './history'

/** Re-evaluate layout without asking the model to rewrite already proven
 * content. The original generation and every existing selection stay intact. */
export function refinedStudioWork(old:SlideWork,library:StudioLibrary):SlideWork{
 const content=old.fallback?.source??old.content
 let work:SlideWork={...old,content,candidates:[...libraryCoverCandidates(content,library),...candidatesFor(content)],bindings:Object.fromEntries(content.blocks.map(b=>[b.id,componentBindings(b,library)]))}
 if(old.strictComponents)work=creativeRecipeChoices(old,library)
 else {const proposal=old.candidates.find(c=>c.fixedComponents);if(proposal){work.candidates.unshift(proposal);for(const b of content.blocks)work.bindings[b.id]=[...new Map([...old.bindings[b.id]??[],...work.bindings[b.id]].map(v=>[v.id,v])).values()]}}
 work.candidates=artDirectedCandidates(content,work.candidates,library)
 delete work.options;delete work.error;delete work.fallback
 if(!work.candidates.some(c=>c.id===work.plan?.candidateId))delete work.plan
 return work
}
export async function refineStudioRun(bucket:R2Bucket,projectId:string,sourceRevision:string,slideId?:string){
 const project=await getProject(bucket,projectId),source=await readStudioRun(bucket,projectId,sourceRevision)
 if(!project||project.archivedAt||!source)throw Error('Генерация не найдена.')
 if(source.status!=='complete')throw Error('Сначала завершите текущую генерацию.')
 if(slideId&&!source.slides.some(s=>s.content.id===slideId&&!source.deletedSlideIds?.includes(slideId)))throw Error('Слайд не найден.')
 // Repeated requests resume the same derived generation, including after a
 // network interruption. New explicit generations still use fresh seeds.
 const hash=await contentHash([STUDIO_VERSION,sourceRevision,'refine',...slideId?[slideId]:[]]),revision=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`
 const existing=await readStudioRun(bucket,projectId,revision);if(existing)return existing
  await hydrateFallbackSources(bucket,source)
 const history=await readStudioHistory(bucket,projectId)
 const slides=await Promise.all(source.slides.filter(s=>!source.deletedSlideIds?.includes(s.content.id)).map(async s=>{
  if(slideId&&s.content.id!==slideId)return structuredClone(s)
  const work=refinedStudioWork(s,source.library)
  work.contentKey=await contentHash([STUDIO_VERSION,source.library.uploadId,work.content])
  work.diversityKey??=source.variation?await contentHash([source.library.uploadId,source.variation.sourceKey,work.content.id]):undefined
  const previous=history.entries.filter(e=>e.contentKey===work.contentKey||!!work.diversityKey&&e.diversityKey===work.diversityKey)
  work.previousDesigns=previous.flatMap(e=>e.design?[e.design]:[]).slice(-6)
  work.history=previous.map(e=>e.signature)
  return work
 }))
 const results=slideId?Object.fromEntries(Object.entries(source.results).filter(([id])=>id!==slideId&&!source.deletedSlideIds?.includes(id))):{}
 const run:StudioRun={...source,version:STUDIO_VERSION,revision,id:hash,createdAt:new Date().toISOString(),derivedFrom:sourceRevision,slides,results,status:'preparing',modelRequests:0,modelRunIds:[]}
 delete run.error;delete run.deletedSlideIds;delete run.previewOnly
 if(run.semantic?.units){run.semantic=structuredClone(run.semantic);run.semantic.units=run.semantic.units!.filter(u=>run.slides.some(s=>s.content.id===u.id));for(const u of run.semantic.units){u.status='complete';delete u.error}}
 await bucket.put(studioKey(projectId,revision),JSON.stringify(run),{httpMetadata:{contentType:'application/json'},onlyIf:{etagDoesNotMatch:'*'}})
 return (await readStudioRun(bucket,projectId,revision))!
}
