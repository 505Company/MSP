import { NextResponse } from 'next/server'
import { createCloudflareUploadRepository, ensureUploadSchema, objectBucket } from '@/lib/uploads/cloudflare-repository'
export async function GET(_request:Request, context:{params:Promise<{id:string}>}){
  await ensureUploadSchema();const {id}=await context.params,job=await createCloudflareUploadRepository().get(id)
  const source=job?.sourceObjectKey?await objectBucket().get(job.sourceObjectKey):null
  if(!source)return NextResponse.json({error:'Исходник не найден'},{status:404})
  const pdf=/\.pdf$/i.test(job!.fileName)
  return new Response(source.body,{headers:{'Content-Type':pdf?'application/pdf':'application/vnd.openxmlformats-officedocument.presentationml.presentation','Content-Disposition':`attachment; filename="source.${pdf?'pdf':'pptx'}"`,'Cache-Control':'private, no-store'}})
}
