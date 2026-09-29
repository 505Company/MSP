import knowledge from './knowledge.json'
import { designContext, type ModelMessage, type PreviewImage } from './design-context'
import { designAnalysisSchema, validateCandidateSubset } from './design-analysis'
import { completionText, QwenAnalysisError, type QwenConfig, type QwenStyleAnalysis } from '../uploads/qwen-analysis'
import { CHECKPOINT, type CheckpointResult } from './pipeline'
import type { VisualManifest } from './visual-package'

export const VISUAL_PIPELINE='digital-designer-checkpoint-2026-09-24-visual-v2'
export async function prepareVisualInput(bucket:R2Bucket,jobId:string,visual:VisualManifest){
  // Check the complete evidence set before loading or base64-encoding any images.
  // Keep the original resources and library usable if a model request is too large.
  let evidenceBytes=0
  for(const key of [...visual.previews.map(p=>`preview-${p.id}`),...visual.sheets.map(s=>s.id)]){
    const object=await bucket.head(`visual/${jobId}/${key}`)
    evidenceBytes+=object?.size??0
    if(evidenceBytes>8*1024*1024)throw new QwenAnalysisError('VISUAL_CONTEXT_TOO_LARGE','Структура и ресурсы сохранены. Полный визуальный контекст превышает лимит одного запроса модели; требуется анализ по частям.')
  }
  const images:PreviewImage[]=[]
  for(const p of visual.previews){const obj=await bucket.get(`visual/${jobId}/preview-${p.id}`);if(obj)images.push({id:p.id,kind:'slide',mime:p.mime,bytes:new Uint8Array(await obj.arrayBuffer())})}
  const task=designContext(visual.snapshot,knowledge,images)
  const content=task.messages[1].content
  if(typeof content==='string')throw new Error('Invalid visual context')
  for(const sheet of visual.sheets){
    const obj=await bucket.get(`visual/${jobId}/${sheet.id}`);if(!obj)continue
    for(const id of sheet.ids)task.refs.visualAssetIds.add(id)
    content.push({type:'text',text:`Лист исходных ресурсов. imageNN соответствует previewLabel в assets. Только эти assetIds показаны на листе: ${sheet.ids.join(', ')}.`},{type:'image_url',image_url:{url:`data:${sheet.mime};base64,${Buffer.from(await obj.arrayBuffer()).toString('base64')}`}})
  }
  task.context.source.selection.visualAssetIds = [...task.refs.visualAssetIds]
  const contextBlock = content[0]
  if (contextBlock.type === 'text') contextBlock.text = JSON.stringify(task.context)
  return task
}
export async function analyzeVisual(task:Awaited<ReturnType<typeof prepareVisualInput>>,config:QwenConfig,signal?:AbortSignal,onResponse?:(text:string)=>Promise<void>){
  if(!config.apiKey)return {status:'not_configured' as const}
  const deadline=AbortSignal.timeout(config.timeoutMs??600000),combined=signal?AbortSignal.any([deadline,signal]):deadline
  const model=config.model??'qwen3.8-27b'
  // Avoid palette-only replies on rich decks; the original evidence validator
  // still checks every candidate. Tiny sources retain the checkpoint minimum.
  const source=task.context.source
  const rich=source.slides.length>=3&&source.elements.length>=30&&source.assets.length>=3&&source.fonts.length>0
  const schema={...designAnalysisSchema,properties:{...designAnalysisSchema.properties,findings:{...designAnalysisSchema.properties!.findings,minItems:rich?8:1}}}
  try{
    const response=await fetch(`${(config.baseUrl??'https://rus.aiapi.intelion.cloud/v1').replace(/\/$/,'')}/chat/completions`,{method:'POST',signal:combined,headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,temperature:0.1,max_tokens:10500,stream:true,chat_template_kwargs:{enable_thinking:false},messages:task.messages satisfies ModelMessage[],response_format:{type:'json_schema',json_schema:{name:'design_analysis',strict:true,schema}}})})
    if(!response.ok){const diagnostic=(await response.text()).slice(0,1500).replaceAll(config.apiKey,'[REDACTED]'); console.error('Visual model rejection',response.status,diagnostic);throw new QwenAnalysisError(`QWEN_HTTP_${response.status}`,`Сервис анализа вернул HTTP ${response.status}. Ресурсы и структура сохранены.`)}
    const responseText=await completionText(response);await onResponse?.(responseText)
    const raw=JSON.parse(responseText.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))
    const checked=validateCandidateSubset(raw,task.refs)
    const checkpoint:CheckpointResult={...checked,checkpoint:CHECKPOINT,pipelineVersion:VISUAL_PIPELINE,visualAnalysis:true,sourceMap:Object.fromEntries([...task.refs.elementIds].map(id=>[id,id]))}
    const analysis:QwenStyleAnalysis={familySuggestion:'Стиль презентации',variantSuggestion:'Исходный',purposeSuggestion:'Презентации',summary:checked.result.summary,confidence:Math.min(...checked.result.findings.map(f=>f.confidence)),foundations:{paletteRoles:[],typographyRoles:[],grid:'См. правила композиции',backgroundStrategy:'См. визуальные правила'},compositionClusters:[],warnings:checked.result.uncertainties.map(message=>({section:'other',severity:'warning',message}))}
    return {status:'analyzed' as const,format:'json_schema' as const,model,analysis,checkpoint}
  }catch(e){
    if(signal?.aborted)throw signal.reason
    if(deadline.aborted)throw new QwenAnalysisError('QWEN_TIMEOUT','Визуальный анализ не завершился вовремя. Извлечённая дизайн-система сохранена.')
    if(e instanceof QwenAnalysisError)throw e
    throw new QwenAnalysisError('VISUAL_ANALYSIS_INVALID','Ответ модели не прошёл проверку. Извлечённая дизайн-система сохранена.',e)
  }
}
