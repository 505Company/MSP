import { assertUploadActive, uploadCancellationResponse, withUploadCancellation } from '@/lib/uploads/cancellation-server'
import {NextResponse} from 'next/server'
import {waitUntil} from 'cloudflare:workers'
import {z} from 'zod'
import {objectBucket} from '@/lib/uploads/cloudflare-repository'
import {modelConfig} from '@/lib/uploads/qwen-client'
import {processingResponse} from '@/lib/uploads/processing-response'
import {reconstructionState,reconstructCandidate,qualifyReconstruction,qualifyGraphicComponents} from '@/lib/design-system/reconstruction'
import {reconstructionInputSchema,RECONSTRUCTION_VERSION} from '@/lib/design-system/reconstruction-contract'
const report=z.object({revision:z.string().regex(/^[a-f0-9]{64}$/),candidateId:z.string().regex(/^[\w-]{1,140}$/),textCalibration:z.array(z.object({nodeId:z.string().max(140),sourceTextId:z.string().max(140),elements:z.array(z.unknown()).max(16)}).strict()).max(64).optional(),qualification:z.object({version:z.literal(RECONSTRUCTION_VERSION),passed:z.boolean(),changed:z.boolean(),issues:z.array(z.string().max(300)).max(30),pixelError:z.number().min(0).max(1),foregroundRecall:z.number().min(0).max(1)}).strict()}).strict()
const partsReport=z.object({revision:z.string().regex(/^[a-f0-9]{64}$/),candidateId:z.string().regex(/^[\w-]{1,140}$/),partsQualification:z.object({version:z.string().max(60),checks:z.array(z.object({id:z.string().max(280),passed:z.boolean(),changed:z.boolean(),issues:z.array(z.string().max(300)).max(30)}).strict()).max(192)}).strict()}).strict()
export const dynamic='force-dynamic'
export async function GET(_r:Request,ctx:{params:Promise<{id:string}>}){try{const {id}=await ctx.params;if(!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:'Не найдено'},{status:404});return NextResponse.json(await reconstructionState(objectBucket(),id),{headers:{'Cache-Control':'no-store'}})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Не удалось прочитать восстановление'},{status:409})}}
export async function POST(r:Request,ctx:{params:Promise<{id:string}>}){
 const origin=r.headers.get('origin');if(origin&&origin!==new URL(r.url).origin||r.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Недопустимый источник'},{status:403})
 try{const {id}=await ctx.params;if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Не найдено');await assertUploadActive(objectBucket(),id);const text=await r.text();if(text.length>3300000)throw Error('Изображение слишком велико');const raw=JSON.parse(text)
  if(raw.partsQualification){const d=partsReport.parse(raw);return NextResponse.json(await qualifyGraphicComponents(objectBucket(),id,d.revision,d.candidateId,d.partsQualification))}
  if(raw.qualification){const d=report.parse(raw);return NextResponse.json(await qualifyReconstruction(objectBucket(),id,d.revision,d.candidateId,d.qualification,d.textCalibration as import('@/lib/design-system/reconstruction-contract').TextCalibration[]|undefined))}
  const d=reconstructionInputSchema.parse(raw),{response,completion}=processingResponse({started:true},signal=>withUploadCancellation(objectBucket(),id,signal,active=>reconstructCandidate(objectBucket(),id,d,modelConfig(),active)));waitUntil(completion);return response
 }catch(e){return uploadCancellationResponse(e) ?? NextResponse.json({error:e instanceof z.ZodError?'Некорректные данные восстановления':e instanceof Error?e.message:'Не удалось восстановить графику'},{status:409})}
}
