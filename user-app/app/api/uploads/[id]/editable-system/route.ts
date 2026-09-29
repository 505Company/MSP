import { waitUntil } from 'cloudflare:workers'
import { NextResponse } from 'next/server'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { editableState, buildEditableSystem } from '@/lib/design-system/editable-analysis'
import { processingResponse } from '@/lib/uploads/processing-response'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { assertUploadActive, uploadCancellationResponse, withUploadCancellation } from '@/lib/uploads/cancellation-server'
export const dynamic='force-dynamic'
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  try{const {id}=await context.params;if(!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:"Не найдено"},{status:404});return NextResponse.json(await editableState(objectBucket(),id),{headers:{'Cache-Control':'no-store'}})}
  catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Не удалось открыть конструкции'},{status:409})}
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Недопустимый источник'},{status:403})
  try{
    const {id}=await context.params;if(!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:'Не найдено'},{status:404})
    await assertUploadActive(objectBucket(),id)
    await editableState(objectBucket(),id)
    const {response,completion}=processingResponse({started:true},signal=>withUploadCancellation(objectBucket(),id,signal,active=>buildEditableSystem(objectBucket(),id,modelConfig(),undefined,active)))
    waitUntil(completion);return response
  }catch(e){return uploadCancellationResponse(e) ?? NextResponse.json({error:e instanceof QwenAnalysisError?e.message:'Не удалось продолжить сборку'},{status:409})}
}
