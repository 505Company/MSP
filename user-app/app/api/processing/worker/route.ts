import {env} from 'cloudflare:workers'
import {z} from 'zod'
import {objectBucket} from '@/lib/uploads/cloudflare-repository'
import {claimProcessingJob,updateProcessingJob,workerHeartbeat} from '@/lib/uploads/processing-jobs'
import {uploadCancellationResponse} from '@/lib/uploads/cancellation-server'
import {claimLayoutJob,updateLayoutJob} from '@/lib/presentations/layout-jobs'
import {claimDiscoveryJob,updateDiscoveryJob} from '@/lib/presentations/recipes/discovery-jobs'
import {claimPreparation,updatePreparation} from '@/lib/component-lab/preparation-jobs'
import {claimStudioJob,updateStudioJob} from '@/lib/presentations/studio/jobs'
export const dynamic='force-dynamic'
const progress=z.object({step:z.enum(['source','analysis','components','editable','graphics']),detail:z.string().max(700),scope:z.string().max(150).optional(),completed:z.number().nonnegative().optional(),total:z.number().nonnegative().optional(),unit:z.literal('percent').optional()}).strict()
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('claim'),workerId:z.string().uuid(),kinds:z.array(z.enum(['presentation','recipes','components','studio'])).max(4).optional()}).strict(),
 z.object({action:z.literal('update'),kind:z.enum(['presentation','recipes','components','studio']).optional(),workerId:z.string().uuid(),id:z.string().uuid(),token:z.string().uuid(),update:z.object({progress:progress.optional(),complete:z.boolean().optional(),error:z.string().max(700).optional(),errorCode:z.string().max(100).optional(),retryable:z.boolean().optional()}).strict()}).strict(),
 z.object({action:z.literal('heartbeat'),workerId:z.string().uuid()}).strict(),
])
export async function POST(request:Request){
 if(!env.MSP_WORKER_TOKEN||request.headers.get('authorization')!==`Bearer ${env.MSP_WORKER_TOKEN}`)return Response.json({error:'Нет доступа'},{status:403})
 try{
  const text=await request.text();if(text.length>10000)return Response.json({error:'Слишком большой запрос'},{status:413})
  const body=input.parse(JSON.parse(text)),bucket=objectBucket()
  await workerHeartbeat(bucket,body.workerId,Date.now(),body.action==='claim'?body.kinds:undefined)
  if(body.action==='heartbeat')return Response.json({ok:true})
  if(body.action==='claim'){
   const studio=body.kinds?.includes('studio')?await claimStudioJob(bucket,body.workerId):null
   if(studio)return Response.json({job:{...studio,kind:'studio'}})
   const imported=body.kinds?.length===1&&body.kinds[0]==='studio'?null:await claimProcessingJob(bucket,body.workerId)
   if(imported)return Response.json({job:imported})
   const presentation=body.kinds?.includes('presentation')?await claimLayoutJob(bucket,body.workerId):null
   if(presentation)return Response.json({job:{...presentation,kind:'presentation'}})
   const recipes=body.kinds?.includes('recipes')?await claimDiscoveryJob(bucket,body.workerId):null
   if(recipes)return Response.json({job:{...recipes,id:recipes.uploadId,jobId:recipes.id,kind:'recipes'}})
   const component=body.kinds?.includes('components')?await claimPreparation(bucket,body.workerId):null
   return Response.json({job:component?{...component,id:component.uploadId,jobId:component.id,kind:'components'}:null})
  }
  return Response.json({job:body.kind==='studio'?await updateStudioJob(bucket,body.id,body.token,body.update):body.kind==='components'?await updatePreparation(bucket,body.id,body.token,body.update):body.kind==='recipes'?await updateDiscoveryJob(bucket,body.id,body.token,body.update):body.kind==='presentation'?await updateLayoutJob(bucket,body.id,body.token,body.update):await updateProcessingJob(bucket,body.id,body.token,body.update)})
 }catch(error){return uploadCancellationResponse(error)??Response.json({error:error instanceof Error?error.message:'Ошибка фоновой задачи'},{status:409})}
}
