import {readStudioHistory} from './history'
import {contentHash} from '../../design-system/catalog'
import {beginModelRun} from '../../uploads/model-run'
import type {QwenConfig} from '../../uploads/qwen-analysis'
import {assertStudioProject,mutateStudioRun} from './storage'
import {studioSlides} from './context'
import {bindCompactData,compactContentTask,COMPACT_CONTENT_VERSION} from './compact-content'
import type {StudioRun} from './contract'
import {componentFlexTask,COMPONENT_FLEX_VERSION} from './component-flex'
import {creativeRecipeChoices} from './creative-choices'

export function refreshStudioStatus(run:StudioRun){
  if(run.status==='cancelled')return
  const units=run.semantic?.units;if(!units){
    const errors=run.slides.filter(s=>s.error&&!run.results[s.content.id]?.passed)
    run.status=run.slides.every(s=>run.results[s.content.id]?.passed)?'complete':run.slides.every(s=>run.results[s.content.id]?.passed||s.error)?'blocked':'preparing'
    if(errors.length)run.error=errors.map(s=>s.error).join('\n');else delete run.error
    return
  }
  run.semantic!.status=units.every(u=>u.status==='complete')?'complete':'pending'
  const errors=[...units.flatMap(u=>u.error?[`${u.packet.index+1}: ${u.error}`]:[]),...run.slides.flatMap(s=>s.error?[`${s.content.id}: ${s.error}`]:[])]
  if(units.some(u=>u.status==='running'||u.status==='pending'))run.status='planning'
  else if(errors.length&&units.every(u=>u.status==='failed'||run.results[u.id]?.passed||run.slides.find(s=>s.content.id===u.id)?.error))run.status='blocked'
  else if(units.every(u=>run.results[u.id]?.passed))run.status='complete'
  else run.status='preparing'
  if(errors.length)run.error=errors.join('\n');else delete run.error
}

/** One durable lease/cache per slide. Failure never clears another slide. */
export async function structureCompactSlide(bucket:R2Bucket,run:StudioRun,config:QwenConfig,signal:AbortSignal,slideId:string){
  await assertStudioProject(bucket,run)
  const unit=run.semantic?.units?.find(u=>u.id===slideId)
  if(!unit)throw Error('Неизвестный слайд для разбора.')
  // Jobs freeze their input when the run starts. An interpreter update must
  // not silently change boundaries/fragment IDs in a saved unfinished run.
  const packet=unit.packet
  const work=run.slides.find(s=>s.content.id===slideId)
  if(run.semantic?.strategy==='components'){
    if(unit.status==='complete'&&!work?.error)return
    const feedback=work?.error?{attempt:unit.attempts,errors:work.error,lastValidationError:unit.error,previous:work.flexNodes,allocated:work.candidates[0]?.slots.map(s=>({blocks:s.blocks,width:Math.round(s.rect.w),height:Math.round(s.rect.h)})),blocks:work.semanticBlocks,components:work.plan?.components}:unit.error
    const diversityKey=run.variation?await contentHash([run.library.uploadId,run.variation.sourceKey,slideId]):undefined
    const previousDesigns=diversityKey?(await readStudioHistory(bucket,run.projectId)).entries.filter(e=>e.diversityKey===diversityKey).flatMap(e=>e.design?[e.design]:[]).slice(-3):[]
    const spec=componentFlexTask(packet,run.library,feedback,{variation:run.variation,previousDesigns})
    const job=await beginModelRun({bucket,prefix:`presentation-studio/${run.projectId}/${run.revision}/semantic/${unit.id}`,task:spec.task,config,version:COMPONENT_FLEX_VERSION,scope:{runId:run.id,slideId,strategy:'components'},validate:spec.validate,beforeRequest:()=>assertStudioProject(bucket,run)})
    const account=(next:StudioRun)=>{if(!next.modelRunIds.includes(job.run.id)){next.modelRunIds.push(job.run.id);next.modelRequests+=job.run.liveRequests;next.semantic!.units!.find(u=>u.id===slideId)!.attempts+=job.run.liveRequests}}
    try{
      await mutateStudioRun(bucket,run.projectId,run.revision,next=>{const u=next.semantic!.units!.find(u=>u.id===slideId)!;u.status='running';u.packet=packet;delete u.error;refreshStudioStatus(next)})
      await job.execute?.(signal);if(!job.run.result)throw Error('Модель не вернула проверенную сетку компонентов.')
      await mutateStudioRun(bucket,run.projectId,run.revision,next=>{if(!next.results[slideId]?.passed){const u=next.semantic!.units!.find(u=>u.id===slideId)!;u.status='complete';u.proof=job.run.result!.proof;delete u.error;next.slides=next.slides.filter(s=>s.content.id!==slideId).concat({...creativeRecipeChoices(job.run.result!.work,next.library),chrome:{title:run.presentationTitle??run.semantic!.units![0].packet.atoms[0]?.text??'Презентация',number:packet.index+1},variation:run.variation,diversityKey,contentKey:diversityKey,previousDesigns,history:previousDesigns.map(d=>d.signature)}).sort((a,b)=>Number(a.content.id.split('-')[1])-Number(b.content.id.split('-')[1]))}account(next);refreshStudioStatus(next)})
    }catch(error){await mutateStudioRun(bucket,run.projectId,run.revision,next=>{if(!next.results[slideId]?.passed){const u=next.semantic!.units!.find(u=>u.id===slideId)!;u.status='failed';u.error=(error instanceof Error?error.message:'Сетка компонентов не завершена.')+(job.run.error?.issues?.length?' '+job.run.error.issues.slice(0,8).join('; '):'')}account(next);refreshStudioStatus(next)})}
    return
  }
  if(unit.status==='complete'&&packet.tables.every(t=>!t.requestedChart||work?.content.blocks.some(b=>b.data?.sourceId===t.id&&b.data.template.kind==='chart'&&b.data.template.config.chartType===t.requestedChart)))return
  const {task,validate}=compactContentTask(packet)
  const job=await beginModelRun({bucket,prefix:`presentation-studio/${run.projectId}/${run.revision}/semantic/${unit.id}`,task,config,version:COMPACT_CONTENT_VERSION,scope:{runId:run.id,slideId},validate,beforeRequest:()=>assertStudioProject(bucket,run)})
  const account=(next:StudioRun)=>{if(!next.modelRunIds.includes(job.run.id)){next.modelRunIds.push(job.run.id);next.modelRequests+=job.run.liveRequests;next.semantic!.units!.find(u=>u.id===slideId)!.attempts+=job.run.liveRequests}}
  try{
    await mutateStudioRun(bucket,run.projectId,run.revision,next=>{const u=next.semantic!.units!.find(u=>u.id===slideId)!;u.status='running';u.packet=packet;delete u.error;refreshStudioStatus(next)})
    await job.execute?.(signal)
    if(!job.run.result)throw Error('Модель не вернула проверенную структуру слайда.')
    const content=bindCompactData(job.run.result,run.library),[work]=await studioSlides(bucket,run.projectId,run.library,[content],run.recipeScope,run.variation,run.presentationTitle)
    await mutateStudioRun(bucket,run.projectId,run.revision,next=>{
      const u=next.semantic!.units!.find(u=>u.id===slideId)!
      if(u.status!=='complete'){u.status='complete';u.proof=job.run.result!.proof;delete u.error;next.slides=next.slides.filter(s=>s.content.id!==slideId).concat(work).sort((a,b)=>Number(a.content.id.split('-')[1])-Number(b.content.id.split('-')[1]))}
      account(next);refreshStudioStatus(next)
    })
  }catch(error){
    await mutateStudioRun(bucket,run.projectId,run.revision,next=>{const u=next.semantic!.units!.find(u=>u.id===slideId)!;u.status='failed';u.error=(error instanceof Error?error.message:'Разбор не завершён.')+(job.run.error?.issues?.length?' '+job.run.error.issues.slice(0,3).join('; '):'');account(next);refreshStudioStatus(next)})
  }
}
