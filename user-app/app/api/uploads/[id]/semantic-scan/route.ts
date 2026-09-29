import { waitUntil } from 'cloudflare:workers'
import { NextResponse } from 'next/server'
import { createCloudflareUploadRepository, ensureUploadSchema, objectBucket } from '@/lib/uploads/cloudflare-repository'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { processingResponse } from '@/lib/uploads/processing-response'
import { readScanRun, startSemanticScan } from '@/lib/design-system/semantic-scan'
import { compileSemanticLibrary } from '@/lib/design-system/semantic-library'
import {buildEditableSystem} from '@/lib/design-system/editable-analysis'
import { installSemanticCatalog } from '@/lib/design-system/catalog'
import type { VisualManifest } from '@/lib/digital-designer/visual-package'
import { assertUploadActive, uploadCancellationResponse, withUploadCancellation } from '@/lib/uploads/cancellation-server'

export const dynamic='force-dynamic'
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
  const {id}=await context.params
  if(!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:'Файл не найден'},{status:404})
  try { await assertUploadActive(objectBucket(),id) } catch(error) { return uploadCancellationResponse(error) ?? NextResponse.json({error:'Не удалось прочитать состояние'},{status:503}) }
  return NextResponse.json({run:await readScanRun(objectBucket(),id)},{headers:{'Cache-Control':'no-store'}})
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  const origin=request.headers.get('origin')
  if(origin&&origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Недопустимый источник запроса'},{status:403})
  try{
    const {id}=await context.params
    if(!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:'Файл не найден'},{status:404})
    await ensureUploadSchema()
    const repo=createCloudflareUploadRepository(),upload=await repo.get(id),bucket=objectBucket()
    if(!upload)return NextResponse.json({error:'Файл не найден'},{status:404})
    await assertUploadActive(bucket,id)
    const file=await bucket.get(`visual/${id}/manifest.json`)
    if(!file)return NextResponse.json({error:'Сначала завершите импорт PPTX'},{status:409})
    const visual=await file.json<VisualManifest>()
    const started=await startSemanticScan(bucket,id,visual,modelConfig(),async semantic=>{
      const {library,metadata}=await compileSemanticLibrary(visual.snapshot,semantic)
      return installSemanticCatalog(bucket,id,library,metadata)
    },async(completed,total)=>{
      await repo.update(id,{stage:`Анализируем оформление: ${completed} из ${total}`,progress:68+Math.round(29*completed/Math.max(1,total))})
    })
    const execute=async(signal?:AbortSignal)=>{
      try{
        await repo.update(id,{status:'processing',qwenStatus:'processing',stage:'Определяем компоненты и правила оформления',progress:68,errorCode:null,errorMessage:null})
        await started.execute(signal)
        await buildEditableSystem(bucket,id,modelConfig(),async(done,total)=>{await repo.update(id,{stage:`Собираем конструкции: ${done} из ${total}`,progress:97})},signal)
        await repo.update(id,{status:'ready_for_review',qwenStatus:'analyzed',stage:'Дизайн-система собрана',progress:100,analysisObjectKey:null})
        await repo.audit({actorId:'system',action:'upload.analyzed',entityType:'upload_job',entityId:id,details:{method:started.run.version,runId:started.run.id,catalogId:started.run.catalogId,liveRequests:started.run.liveRequests,cacheHits:started.run.cacheHits}})
      }catch(error){
        await repo.update(id,{status:'needs_attention',qwenStatus:'failed',stage:'Анализ остановился',errorCode:error instanceof QwenAnalysisError?error.code:'PROCESSING_INTERRUPTED',errorMessage:error instanceof QwenAnalysisError?error.message:'Анализ прерван. Готовые части и исходник сохранены.'})
        throw error
      }
    }
    const {response,completion}=processingResponse({run:started.run},signal=>withUploadCancellation(bucket,id,signal,execute))
    waitUntil(completion)
    return response
  }catch(error){
    const cancelled=uploadCancellationResponse(error);if(cancelled)return cancelled
    return NextResponse.json({error:error instanceof QwenAnalysisError?error.message:'Не удалось начать анализ. Исходные данные сохранены.',code:error instanceof QwenAnalysisError?error.code:'PROCESSING_FAILED'},{status:error instanceof QwenAnalysisError?409:500})
  }
}
