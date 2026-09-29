import {beginModelRun} from '../../uploads/model-run'
import type {QwenConfig} from '../../uploads/qwen-analysis'
import {assertStudioProject,mutateStudioRun} from './storage'
import {studioSlides} from './context'
import {semanticContentTask,SEMANTIC_CONTENT_VERSION} from './semantic-content'
import type {StudioRun} from './contract'
import {structureCompactSlide} from './compact-task'

/** Model decides associations from raw prose; source references are checked
 * before any recipe binding. Rendering never invokes a second model. */
export async function structureStudioRun(bucket:R2Bucket,run:StudioRun,config:QwenConfig,signal:AbortSignal,slideId?:string){
  await assertStudioProject(bucket,run)
  if(run.mode!=='smart'||!run.semantic)throw Error('Смысловой разбор доступен для текста в умном режиме.')
  if(run.semantic.units){if(!slideId)throw Error('Укажите слайд для независимого разбора.');return structureCompactSlide(bucket,run,config,signal,slideId)}
  if(run.semantic.status==='complete')return
  const {task,validate}=semanticContentTask(run.semantic.source)
  const job=await beginModelRun({bucket,prefix:`presentation-studio/${run.projectId}/${run.revision}/semantic`,task,config,version:SEMANTIC_CONTENT_VERSION,scope:{runId:run.id},validate,beforeRequest:()=>assertStudioProject(bucket,run)})
  const account=(next:StudioRun)=>{if(!next.modelRunIds.includes(job.run.id)){next.modelRunIds.push(job.run.id);next.modelRequests+=job.run.liveRequests}}
  try{
    await mutateStudioRun(bucket,run.projectId,run.revision,next=>{if(next.semantic?.status==='pending'){next.status='planning';delete next.error}})
    await job.execute?.(signal)
    if(!job.run.result)throw Error('Модель не вернула проверенную структуру содержания.')
    const {slides,proof}=job.run.result,work=await studioSlides(bucket,run.projectId,run.library,slides,run.recipeScope,run.variation,run.presentationTitle)
    await mutateStudioRun(bucket,run.projectId,run.revision,next=>{
      if(next.semantic?.status!=='complete'){
        next.semantic={...next.semantic!,status:'complete',proof};next.slides=work;next.status='preparing'
      }
      account(next);delete next.error
    })
  }catch(error){
    await mutateStudioRun(bucket,run.projectId,run.revision,next=>{next.status='blocked';next.error='Разбор содержания: '+(error instanceof Error?error.message:'не завершён.');account(next)})
    throw error
  }
}
