import { NextResponse } from 'next/server'
import { createCloudflareUploadRepository, ensureUploadSchema, objectBucket } from '@/lib/uploads/cloudflare-repository'
import type { VisualManifest } from '@/lib/digital-designer/visual-package'
import type { CheckpointResult } from '@/lib/digital-designer/pipeline'
import { sourceSystem } from '@/lib/design-system/source-system-storage'
import { initializeCatalog } from '@/lib/design-system/catalog'

export const dynamic='force-dynamic'
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const {id}=await context.params
    if(!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:'Файл не найден'},{status:404})
    await ensureUploadSchema()
    const upload=await createCloudflareUploadRepository().get(id),bucket=objectBucket()
    if(!upload)return NextResponse.json({error:'Файл не найден'},{status:404})
    const file=await bucket.get(`visual/${id}/manifest.json`)
    if(!file)return NextResponse.json({error:'Сначала завершите визуальный импорт PPTX'},{status:409})
    const visual=await file.json<VisualManifest>()
    const analysisFile=upload.analysisObjectKey&&upload.qwenStatus==='analyzed'?await bucket.get(upload.analysisObjectKey):null
    const analysis=analysisFile?await analysisFile.json<{checkpoint?:CheckpointResult}>():null
    // Both panels load concurrently. Freeze/read the same catalog before the
    // inventory resolves links, including any prior accepted definitions.
    await initializeCatalog(bucket,id,visual.snapshot,analysis?.checkpoint?.result)
    const result=await sourceSystem(bucket,id,visual.snapshot,analysis?.checkpoint?.result)
    return NextResponse.json(result,{headers:{'Cache-Control':'no-store',...(new URL(request.url).searchParams.get('download')==='1'?{'Content-Disposition':`attachment; filename="source-design-system-${id}.json"`}:{})}})
  }catch{
    return NextResponse.json({error:'Не удалось собрать состав дизайн-системы. Исходный импорт сохранён.'},{status:500})
  }
}
