import { env, waitUntil } from 'cloudflare:workers'
import { z } from 'zod'
import { objectBucket, createCloudflareUploadRepository, ensureUploadSchema } from '@/lib/uploads/cloudflare-repository'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { assertUploadActive, uploadCancellationResponse, withUploadCancellation } from '@/lib/uploads/cancellation-server'
import { processingResponse } from '@/lib/uploads/processing-response'
import { enqueueAuditProcessing } from '@/lib/uploads/processing-jobs'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { auditSourceIntegrity } from '@/lib/design-system/source-integrity'
import { sourceSlidePreviewOnDark } from '@/lib/design-system/component-curation'
import { qualityAuditState, startQualityAudit, qualityAuditPacket, advanceQualityAudit, prepareAuditRepairs, queueAuditRepair, admitAuditRepair, settleAuditRepair, retryInterruptedQualityAudit } from '@/lib/design-system/quality-audit'
import { auditEvidenceSchema } from '@/lib/design-system/quality-audit-task'
import type { VisualManifest } from '@/lib/digital-designer/visual-package'
import type { SourceIntegrity } from '@/lib/design-system/quality-audit-contract'
export const dynamic = 'force-dynamic'
const revision = z.string().regex(/^[a-f0-9]{64}$/)
const command = z.discriminatedUnion('action',[
  z.object({action:z.literal('start'),explicit:z.boolean().optional(),retryInterrupted:z.boolean().optional()}).strict(),
  z.object({action:z.literal('advance'),revision,evidence:auditEvidenceSchema.optional()}).strict(),
  z.object({action:z.literal('plan'),revision}).strict(),
  z.object({action:z.literal('repair'),revision}).strict(),
  z.object({action:z.literal('settle'),revision,findingId:z.string().min(1).max(170),failure:z.string().max(500).optional()}).strict(),
])
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    const {id}=await context.params; if(!z.string().uuid().safeParse(id).success)return Response.json({error:'Не найдено'},{status:404})
    const bucket=objectBucket(), packetId=new URL(request.url).searchParams.get('packet')
    if(packetId){
      const packet=await qualityAuditPacket(bucket,id,revision.parse(packetId)),file=await bucket.get(`visual/${id}/manifest.json`)
      const visual=file?await file.json<VisualManifest>():null
      return Response.json({packet:packet&&{...packet,darkSlides:visual?packet.batch.slides.filter(n=>sourceSlidePreviewOnDark(visual.snapshot,n)):[]}},{headers:{'Cache-Control':'no-store'}})
    }
    return Response.json(await qualityAuditState(bucket,id),{headers:{'Cache-Control':'no-store'}})
  } catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось открыть аудит'},{status:409})}
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  const origin=request.headers.get('origin')
  if(origin&&origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Недопустимый источник'},{status:403})
  try {
    const {id}=await context.params;if(!z.string().uuid().safeParse(id).success)return Response.json({error:'Не найдено'},{status:404})
    const bucket=objectBucket();await assertUploadActive(bucket,id)
    const text=await request.text();if(text.length>16_000_000)throw Error('Превью аудита слишком велики')
    const d=command.parse(JSON.parse(text))
    if(d.action==='start'){
      if(d.retryInterrupted&&!d.explicit)throw Error('Повтор прерванного запроса требует явного запуска')
      const state=await qualityAuditState(bucket,id)
      if(!d.explicit&&!state.enabled)return Response.json({job:null,background:false})
      if(state.job&&!state.stale){
        const job=d.retryInterrupted?await retryInterruptedQualityAudit(bucket,id,state.job.id):state.job
        if(d.explicit&&state.job.status!=='complete'&&env.MSP_WORKER_TOKEN)await enqueueAuditProcessing(bucket,id,'Аудит дизайн-системы')
        return Response.json({job,background:!!env.MSP_WORKER_TOKEN})
      }
      if(!modelConfig().apiKey?.trim())throw new QwenAnalysisError('QWEN_NOT_CONFIGURED','Для смыслового аудита требуется подключение Qwen')
      const file=await bucket.get(`visual/${id}/manifest.json`);if(!file)throw Error('Исходник не найден')
      const visual=await file.json<VisualManifest>()
      let integrity:SourceIntegrity={status:'unavailable',resources:0,missing:[],incompleteSlides:[],reason:'Оригинал недоступен для независимой проверки ресурсов'}
      await ensureUploadSchema();const upload=await createCloudflareUploadRepository().get(id),source=upload?.sourceObjectKey?await bucket.get(upload.sourceObjectKey):null
      if(source&&source.size<=48*1024*1024){try{integrity=await auditSourceIntegrity(new Uint8Array(await source.arrayBuffer()),visual.snapshot)}catch(e){integrity.reason=e instanceof Error?e.message:'Ресурсы исходника не проверены'}}
      else if(source)integrity.reason='Большой оригинал требует отдельной проверки ресурсов; смысловой аудит продолжится'
      const job=await startQualityAudit(bucket,id,integrity,!!d.explicit)
      if(d.explicit&&job&&env.MSP_WORKER_TOKEN)await enqueueAuditProcessing(bucket,id,'Аудит дизайн-системы')
      return Response.json({job,background:!!env.MSP_WORKER_TOKEN})
    }
    if(d.action==='advance'){
      const {response,completion}=processingResponse({started:true},signal=>withUploadCancellation(bucket,id,signal,active=>advanceQualityAudit(bucket,id,d.revision,modelConfig(),d.evidence,active)))
      waitUntil(completion);return response
    }
    if(d.action==='plan')return Response.json({job:await prepareAuditRepairs(bucket,id,d.revision)})
    if(d.action==='repair'){
      let repair=await queueAuditRepair(bucket,id,d.revision)
      if(repair?.requestId)repair=await admitAuditRepair(bucket,id,d.revision,repair.id)
      return Response.json({repair})
    }
    return Response.json({job:await settleAuditRepair(bucket,id,d.revision,d.findingId,d.failure)})
  }catch(e){return uploadCancellationResponse(e)??Response.json({error:e instanceof z.ZodError?'Некорректный запрос аудита':e instanceof Error?e.message:'Аудит не завершён',code:e instanceof QwenAnalysisError?e.code:undefined},{status:409})}
}
