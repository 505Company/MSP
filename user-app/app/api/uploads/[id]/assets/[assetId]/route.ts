import { NextResponse } from 'next/server'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
export async function GET(request:Request,context:{params:Promise<{id:string;assetId:string}>}){
  const {id,assetId}=await context.params
  if(!/^[a-f0-9-]{36}$/.test(id)||! /^(asset-[a-f0-9]{24}|preview-s\d{2,3}|sheet-\d+)$/.test(assetId))return NextResponse.json({error:'Не найдено'},{status:404})
  const item=await objectBucket().get(`visual/${id}/${assetId}`)
  if(!item)return NextResponse.json({error:'Не найдено'},{status:404})
  const mime=item.httpMetadata?.contentType??'application/octet-stream'
  const safe=['image/png','image/jpeg','image/webp'].includes(mime),download=new URL(request.url).searchParams.has('download')
  return new Response(item.body,{headers:{'Content-Type':mime,'Content-Disposition':`${safe&&!download?'inline':'attachment'}; filename="${assetId}.${mime==='image/png'?'png':mime==='image/jpeg'?'jpg':mime==='image/webp'?'webp':mime==='image/svg+xml'?'svg':'bin'}"`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cache-Control':'private, max-age=3600'}})
}
