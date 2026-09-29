import {NextResponse} from 'next/server'
import {objectBucket} from '@/lib/uploads/cloudflare-repository'
import {googleFont,googleFontQuery} from '@/lib/fonts/google'
export async function GET(request:Request){
 const params=new URL(request.url).searchParams,parsed=googleFontQuery.safeParse({family:params.get('family'),style:params.get('style')??'Regular'})
 if(!parsed.success)return NextResponse.json({error:'Некорректное название шрифта'},{status:400})
 try{
  const bucket=objectBucket(),font=await googleFont(bucket,parsed.data),asset=params.get('asset')
  if(asset!==null){
   const f=/^\d{1,2}$/.test(asset)?font.files[Number(asset)]:null,file=f&&await bucket.get(f.key)
   if(!f||!file)return new Response(null,{status:404})
   return new Response(file.body,{headers:{'Content-Type':f.mime,'Cache-Control':'public, max-age=2592000','X-Content-Type-Options':'nosniff'}})
  }
  const query=new URLSearchParams(parsed.data)
  return NextResponse.json({family:font.family,style:font.style,files:font.files.map((f,i)=>({url:`/api/fonts/google?${query}&asset=${i}`,...(f.unicodeRange?{unicodeRange:f.unicodeRange}:{})}))},{headers:{'Cache-Control':'public, max-age=3600'}})
 }catch(error){console.warn('[font-provider]',error instanceof Error?error.message:'unavailable');return NextResponse.json({error:'Не удалось загрузить Google Fonts. Доступные шрифты исходника сохранены.'},{status:503})}
}
