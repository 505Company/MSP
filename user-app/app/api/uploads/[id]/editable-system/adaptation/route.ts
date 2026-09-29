import { NextResponse } from 'next/server'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { assertUploadActive,uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import { readEditableCatalog } from '@/lib/design-system/editable-analysis'
import { readComponentAdaptation,saveComponentAdaptation } from '@/lib/design-system/component-adaptation-storage'
export async function GET(_:Request,context:{params:Promise<{id:string}>}) {
 try{const {id}=await context.params,bucket=objectBucket();await assertUploadActive(bucket,id);const catalog=await readEditableCatalog(bucket,id)
  if(!catalog?.qualification)throw Error('Сначала требуется проверка исходных компонентов')
  const report=await readComponentAdaptation(bucket,id,catalog.id)
  return NextResponse.json({catalogId:catalog.id,report:report??null,...(!report?{catalog}:{})})
 }catch(e){return uploadCancellationResponse(e)??NextResponse.json({error:e instanceof Error?e.message:'Не удалось прочитать проверку'},{status:409})}
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Недопустимый источник'},{status:403})
 try{const {id}=await context.params,bucket=objectBucket();await assertUploadActive(bucket,id);const body=await request.text();if(body.length>3000000)throw Error('Слишком большой отчёт')
  const catalog=await readEditableCatalog(bucket,id);if(!catalog?.qualification)throw Error('Каталог ещё не готов')
  return NextResponse.json({report:await saveComponentAdaptation(bucket,id,catalog,JSON.parse(body))})
 }catch(e){return uploadCancellationResponse(e)??NextResponse.json({error:e instanceof Error?e.message:'Не удалось сохранить проверку'},{status:409})}
}
