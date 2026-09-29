import { NextResponse } from 'next/server'
import { createCloudflareUploadRepository, ensureUploadSchema, objectBucket } from '@/lib/uploads/cloudflare-repository'
import type { VisualManifest } from '@/lib/digital-designer/visual-package'
import type { CheckpointResult } from '@/lib/digital-designer/pipeline'
import { compileLibrary } from '@/lib/design-system/compiler'
import { initializeLibrary, loadLibrary, LibraryConflict } from '@/lib/design-system/storage'

export const dynamic='force-dynamic'
type Context={params:Promise<{id:string}>}
async function handle(request:Request,context:Context){
  try{
    const {id}=await context.params
    if(!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:'Файл не найден'},{status:404})
    await ensureUploadSchema()
    const upload=await createCloudflareUploadRepository().get(id)
    if(!upload)return NextResponse.json({error:'Файл не найден'},{status:404})
    const bucket=objectBucket()
    let saved=await loadLibrary(bucket,id)
    if(!saved&&request.method==='POST'){
      const file=await bucket.get(`visual/${id}/manifest.json`)
      if(!file)return NextResponse.json({error:'Сначала завершите визуальный импорт PPTX'},{status:409})
      const visual=await file.json<VisualManifest>()
      const analysisFile=upload.analysisObjectKey&&upload.qwenStatus==='analyzed'?await bucket.get(upload.analysisObjectKey):null
      const analysis=analysisFile?await analysisFile.json<{checkpoint?:CheckpointResult}>():null
      saved=await initializeLibrary(bucket,id,compileLibrary(visual.snapshot,analysis?.checkpoint?.result))
    }
    if(!saved)return NextResponse.json({error:'Библиотека ещё не создана'},{status:404})
    const download=new URL(request.url).searchParams.has('download')
    return NextResponse.json(saved,{headers:{'Cache-Control':'no-store',...(download?{'Content-Disposition':`attachment; filename="components-${id}.json"`}:{})}})
  }catch(error){
    return NextResponse.json({error:error instanceof LibraryConflict?error.message:'Не удалось открыть библиотеку компонентов.'},{status:error instanceof LibraryConflict?409:500})
  }
}
export const GET=handle
export const POST=handle
