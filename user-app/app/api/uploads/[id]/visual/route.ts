import {enqueueBackgroundUpload} from '@/lib/uploads/enqueue-background'
import { assertUploadActive, uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import { NextResponse } from 'next/server'
import { waitUntil } from 'cloudflare:workers'
import { createCloudflareUploadRepository, ensureUploadSchema, objectBucket } from '@/lib/uploads/cloudflare-repository'
import { sha256 } from '@/lib/uploads/pptx-profiler'
import { validateVisualPackage, storeVisualPackage } from '@/lib/digital-designer/visual-package'
import { processingResponse } from '@/lib/uploads/processing-response'
import { processUploadJob } from '@/lib/uploads/process-upload'
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  await ensureUploadSchema();const {id}=await context.params,repo=createCloudflareUploadRepository(),job=await repo.get(id),bucket=objectBucket()
  if(!job?.sourceObjectKey)return NextResponse.json({error:'Исходник не найден'},{status:404})
  await assertUploadActive(bucket,id)
  if(['processing','queued'].includes(job.status))return NextResponse.json({error:'Разбор уже идёт'},{status:409})
  const source=await bucket.get(job.sourceObjectKey)
  if(!source)return NextResponse.json({error:'Исходник не найден'},{status:404})
  const body=await request.text();if(body.length>40_000_000)return NextResponse.json({error:'Слишком большой разбор'},{status:413})
  const visual=await validateVisualPackage(JSON.parse(body),await sha256(new Uint8Array(await source.arrayBuffer())))
  await storeVisualPackage(bucket,id,visual)
  const upload=await repo.update(id,{status:'queued',stage:'Визуальный анализ',progress:65,errorCode:null,errorMessage:null,qwenStatus:'pending'})
  if(await enqueueBackgroundUpload(upload))return Response.json({upload,background:true},{status:202})
  const {response,completion}=processingResponse({upload},signal=>processUploadJob(id,signal));waitUntil(completion);return response
 }catch(e){return uploadCancellationResponse(e) ?? NextResponse.json({error:'Не удалось сохранить визуальный разбор. Проверьте файл и повторите.'},{status:400})}
}
