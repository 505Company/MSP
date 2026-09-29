import { NextResponse } from 'next/server'
import { ensureUploadSchema, createCloudflareUploadRepository, objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody, TransferError } from '@/lib/uploads/binary-contract'
import { LibraryConflict } from '@/lib/design-system/storage'
import { loadSlide, saveSlide } from '@/lib/slides/storage'
export const dynamic='force-dynamic'
async function handle(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const {id}=await context.params
    if(!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:'Файл не найден'},{status:404})
    await ensureUploadSchema()
    if(!await createCloudflareUploadRepository().get(id))return NextResponse.json({error:'Файл не найден'},{status:404})
    const bucket=objectBucket()
    const result=request.method==='PUT'?await saveSlide(bucket,id,JSON.parse(new TextDecoder().decode(await readLimitedBody(request,512*1024)))):await loadSlide(bucket,id)
    return NextResponse.json({slide:result},{headers:{'Cache-Control':'no-store'}})
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Не удалось сохранить слайд'},{status:e instanceof LibraryConflict?409:e instanceof TransferError?e.status:400})}
}
export const GET=handle
export const PUT=handle
