import { NextResponse } from 'next/server'
import { createCloudflareUploadRepository, ensureUploadSchema, objectBucket } from '../uploads/cloudflare-repository'
import type { VisualManifest } from '../digital-designer/visual-package'
import type { CheckpointResult } from '../digital-designer/pipeline'
import { getCatalogComponent, initializeCatalog, listCatalog } from './catalog'

export async function catalogRequest(request:Request,context:{params:Promise<{id:string;componentId?:string}>}){
  try{
    const {id,componentId}=await context.params
    if(!/^[a-f0-9-]{36}$/.test(id)||componentId&&!/^[\w-]{1,160}$/.test(componentId))return NextResponse.json({error:'Не найдено'},{status:404})
    await ensureUploadSchema()
    const upload=await createCloudflareUploadRepository().get(id)
    if(!upload)return NextResponse.json({error:'Файл не найден'},{status:404})
    const bucket=objectBucket(),headers={'Cache-Control':'no-store'}
    if(componentId){
      return NextResponse.json(await getCatalogComponent(bucket,id,componentId),{headers})
    }
    const query=new URL(request.url).searchParams
    let page=await listCatalog(bucket,id,query)
    if(!page&&request.method==='POST'){
      const file=await bucket.get(`visual/${id}/manifest.json`)
      if(!file)return NextResponse.json({error:'Сначала завершите импорт PPTX'},{status:409})
      const visual=await file.json<VisualManifest>()
      const analysisFile=upload.analysisObjectKey&&upload.qwenStatus==='analyzed'?await bucket.get(upload.analysisObjectKey):null
      const analysis=analysisFile?await analysisFile.json<{checkpoint?:CheckpointResult}>():null
      await initializeCatalog(bucket,id,visual.snapshot,analysis?.checkpoint?.result)
      page=await listCatalog(bucket,id,query)
    }
    return page?NextResponse.json(page,{headers}):NextResponse.json({error:'Каталог ещё не создан'},{status:404})
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Не удалось открыть каталог'},{status:400})
  }
}
