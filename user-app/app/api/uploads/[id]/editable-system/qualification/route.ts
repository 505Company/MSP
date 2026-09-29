import { assertUploadActive, uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import {waitUntil} from 'cloudflare:workers'
import {enqueuePreparation} from '@/lib/component-lab/preparation-jobs'
import {NextResponse} from 'next/server'
import {objectBucket} from '@/lib/uploads/cloudflare-repository'
import {readEditableCatalog,saveHtmlQualification} from '@/lib/design-system/editable-analysis'
import {htmlQualificationSchema} from '@/lib/design-system/editable-qualification'
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Недопустимый источник'},{status:403})
 try{
  const {id}=await context.params;if(!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:'Не найдено'},{status:404})
  await assertUploadActive(objectBucket(),id)
  const bucket=objectBucket(),body=await request.text();if(body.length>1000000)throw Error('Слишком большой отчёт')
  const report=htmlQualificationSchema.parse(JSON.parse(body)),catalog=await readEditableCatalog(bucket,id)
  if(!catalog||catalog.id!==report.catalogId)throw Error('Версия каталога изменилась')
  const ids=catalog.families.flatMap(f=>f.variants.map(t=>t.id))
  if(report.checks.length!==ids.length||new Set(report.checks.map(c=>c.id)).size!==ids.length||report.checks.some(c=>!ids.includes(c.id)||c.passed!==(c.source&&c.changed)))throw Error('Неполный отчёт проверки')
  await saveHtmlQualification(bucket,id,report)
  waitUntil(enqueuePreparation(bucket,id).catch(()=>{console.warn('[component-preparation] admission deferred for '+id)}))
  return NextResponse.json({complete:true})
 }catch(e){return uploadCancellationResponse(e) ?? NextResponse.json({error:e instanceof Error?e.message:'Не удалось сохранить проверку'},{status:409})}
}
