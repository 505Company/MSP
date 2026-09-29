import { z } from 'zod'
import type { StructuredRequest } from '../../uploads/qwen-structured'
import { beginModelRun } from '../../uploads/model-run'
import type { QwenConfig } from '../../uploads/qwen-analysis'
import { SemanticValidationError } from '../../design-system/semantic-contract'
import { studioTheme } from './theme'
import { mutateStudioRun, assertStudioProject, applyStudioOption } from './storage'
import { offeredOptions } from './options'
import { recordStudioHistory } from './history'
import { STUDIO_VERSION, type StudioRun, type SlidePlan } from './contract'

const reasons={hierarchy:'Самый ясный главный акцент и подчинённые пояснения.',readability:'Наиболее читаемые группы и переносы текста.',balance:'Наиболее уравновешенная композиция для этого содержания.',library:'Библиотечные компоненты лучше соответствуют содержанию.'}
export function designTask(run:StudioRun){
  if(run.slides.some(s=>!s.options?.length))throw Error('Сначала необходимо собрать и проверить варианты всех слайдов.')
  const slides=run.slides.filter(s=>!s.plan).slice(0,3)
  const choices=slides.map((slide,index)=>({slide,key:`s${index+1}`,options:offeredOptions(slide).map((option,i)=>({alias:`v${i+1}`,option}))}))
  const properties:Record<string,{type:'string';enum:string[]}>={}
  for(const c of choices){
    if(!c.options.length)throw Error('Нет проверенных композиций для выбора.')
    properties[`${c.key}_choice`]={type:'string',enum:c.options.map(o=>o.alias)}
    properties[`${c.key}_reason`]={type:'string',enum:Object.keys(reasons)}
  }
  const reply=z.object(Object.fromEntries(Object.entries(properties).map(([key,p])=>[key,z.enum(p.enum as [string,...string[]])]))).strict()
  const visualContent:Exclude<StructuredRequest['messages'][number]['content'],string>=[{type:'text',text:JSON.stringify({designSystem:{name:run.library.name,theme:studioTheme(run.library),rules:run.library.rules},slides:choices.map(c=>({key:c.key,content:c.slide.content.blocks.map(b=>({id:b.id,role:b.role,fields:b.fields,emphasis:b.emphasis})),directions:c.slide.content.directions}))})}]
  for(const c of choices)for(const {alias,option} of c.options){
    visualContent.push({type:'text',text:JSON.stringify({slide:c.key,option:alias,name:option.label,components:option.receipt!.components.map(v=>({block:v.blockId,name:run.library.prepared[v.componentId]?.profile.name??run.library.editable.find(t=>t.id===v.componentId)?.name}))})})
    visualContent.push({type:'image_url',image_url:{url:option.receipt!.preview}})
  }
  const task:StructuredRequest={schemaName:'msp_visual_design',maxTokens:3072,thinking:true,reasoningEffort:'low',sampling:{temperature:.7,topP:.95,topK:20},
    schema:{type:'object',additionalProperties:false,required:Object.keys(properties),properties},
    messages:[{role:'system',content:'Ты дизайнер презентаций MSP. Для каждого слайда сравни реальные изображения готовых композиций и выбери лучшее для данного содержания. Проверяй визуальную иерархию: указанный главный факт должен доминировать; равноправные пояснения должны иметь сопоставимый вес. Затем читаемость, группировку, отступы, переносы, соответствие активной дизайн-системе и разумное разнообразие в презентации. Не считай яркую подложку автоматическим признаком качества. При повторной генерации предыдущий вариант уже исключён, когда есть альтернативы. Все изображения уже измерены, исходный текст сохранён; выбранное изображение станет финальным слайдом без дальнейшей перевёрстки. Ты не пишешь CSS или координаты и не заменяешь компоненты. Ответ — плоский JSON: sN_choice = код варианта этого слайда, sN_reason = hierarchy/readability/balance/library по главной причине выбора.'},{role:'user',content:visualContent}]}
  const validate=(raw:unknown)=>{
    try{const r=reply.parse(raw)
      return Object.fromEntries(choices.map(c=>{const o=c.options.find(v=>v.alias===r[`${c.key}_choice`])!.option
        return [c.slide.content.id,{...o.plan,rationale:'Выбрано Qwen по превью: '+reasons[r[`${c.key}_reason`] as keyof typeof reasons]}]
      })) as Record<string,SlidePlan>
    }catch(e){throw new SemanticValidationError([e instanceof Error?e.message:'Недопустимый выбор'])}
  }
  return {task,validate,slides}
}
export async function designStudioBatch(bucket:R2Bucket,run:StudioRun,config:QwenConfig,signal:AbortSignal){
  if(run.mode!=='smart')throw Error('Qwen доступен только в умном режиме.')
  if(run.semantic)throw Error('В этом режиме Qwen разбирает содержание; композицию выбирает исполнитель после измерения.')
  await assertStudioProject(bucket,run)
  const {task,validate,slides}=designTask(run);if(!slides.length)return
  const batch=run.slides.indexOf(slides[0])
  const job=await beginModelRun({bucket,prefix:`presentation-studio/${run.projectId}/${run.revision}/design-${batch}`,task,config,version:STUDIO_VERSION,scope:{runId:run.id,batch},validate,
    beforeRequest:()=>assertStudioProject(bucket,run)})
  try{
    await mutateStudioRun(bucket,run.projectId,run.revision,next=>{next.status='planning';delete next.error})
    await job.execute?.(signal)
    const done=await mutateStudioRun(bucket,run.projectId,run.revision,next=>{
      for(const s of next.slides){const selected=job.run.result?.[s.content.id];if(selected&&!s.plan)applyStudioOption(next,s.content.id,selected.optionId!,selected.rationale)}
      if(!next.modelRunIds.includes(job.run.id)){next.modelRunIds.push(job.run.id);next.modelRequests+=job.run.liveRequests}
      delete next.error
    })
    await recordStudioHistory(bucket,done)
  }catch(e){await mutateStudioRun(bucket,run.projectId,run.revision,next=>{next.status='blocked';next.error=e instanceof Error?e.message:'Qwen не завершил выбор оформления.';if(!next.modelRunIds.includes(job.run.id)){next.modelRunIds.push(job.run.id);next.modelRequests+=job.run.liveRequests}});throw e}
}
