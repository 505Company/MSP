import {NextResponse} from 'next/server'
import {createCloudflareUploadRepository,ensureUploadSchema,objectBucket} from '@/lib/uploads/cloudflare-repository'
import {sourceFonts} from '@/lib/uploads/source-fonts'
import {workspaceId} from '@/lib/workspace/storage'
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  const {id}=await context.params
  if(!workspaceId.safeParse(id).success)return NextResponse.json({error:'Источник не найден'},{status:404})
  try{
    await ensureUploadSchema();const upload=await createCloudflareUploadRepository().get(id)
    if(!upload)return NextResponse.json({error:'Источник не найден'},{status:404})
    const bucket=objectBucket(),manifest=await sourceFonts(bucket,upload),fontId=new URL(request.url).searchParams.get('font')
    if(!fontId)return NextResponse.json({requested:manifest.requested,fonts:manifest.fonts.map(({id:fontId,family,style})=>({family,style,url:`/api/uploads/${id}/fonts?font=${fontId}`}))},{headers:{'Cache-Control':'private, no-cache'}})
    const font=manifest.fonts.find(f=>f.id===fontId),file=font&&await bucket.get(font.key)
    if(!font||!file)return NextResponse.json({error:'Шрифт не найден'},{status:404})
    return new Response(file.body,{headers:{'Content-Type':font.mime,'Cache-Control':'private, max-age=31536000, immutable'}})
  }catch{return NextResponse.json({error:'Не удалось прочитать встроенные шрифты'},{status:500})}
}
