import {env} from 'cloudflare:workers'
import {objectBucket,createCloudflareUploadRepository,ensureUploadSchema} from '@/lib/uploads/cloudflare-repository'
import {enqueueProcessingJob,publicProcessingJob,readProcessingJob,workerIsAvailable} from '@/lib/uploads/processing-jobs'
import {assertUploadActive,uploadCancellationResponse} from '@/lib/uploads/cancellation-server'
import {sourceRecoveryView} from '@/lib/uploads/source-repair'
export const dynamic='force-dynamic'
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params
 if(!/^[a-f0-9-]{36}$/.test(id))return Response.json({error:'Файл не найден'},{status:404})
 const bucket=objectBucket(),job=await readProcessingJob(bucket,id)
 const view=job?await sourceRecoveryView(bucket,publicProcessingJob(job)):null
 return Response.json({configured:!!env.MSP_WORKER_TOKEN,available:!!env.MSP_WORKER_TOKEN&&await workerIsAvailable(bucket),job:view},{headers:{'Cache-Control':'no-store'}})
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const origin=request.headers.get('origin')
 if(origin&&origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Недопустимый источник запроса'},{status:403})
 try{
  const {id}=await context.params
  if(!/^[a-f0-9-]{36}$/.test(id))return Response.json({error:'Файл не найден'},{status:404})
  await ensureUploadSchema()
  const bucket=objectBucket(),upload=await createCloudflareUploadRepository().get(id)
  if(!upload?.sourceObjectKey)return Response.json({error:'Исходный файл не найден'},{status:404})
  await assertUploadActive(bucket,id)
  if(!env.MSP_WORKER_TOKEN)return Response.json({configured:false})
  if(!await bucket.head(`visual/${id}/manifest.json`))return Response.json({error:'Сначала завершите загрузку слайдов'},{status:409})
  const body=await request.json().catch(()=>({})) as {restart?:boolean}
  const job=await enqueueProcessingJob(bucket,id,upload.fileName,body.restart===true)
  return Response.json({configured:true,available:await workerIsAvailable(bucket),job:publicProcessingJob(job)},{status:202})
 }catch(error){return uploadCancellationResponse(error)??Response.json({error:error instanceof Error?error.message:'Не удалось продолжить сборку'},{status:409})}
}
