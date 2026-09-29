import { env, waitUntil } from 'cloudflare:workers'
import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { presentationModelConfig,providerChain } from '@/lib/uploads/provider-failover'
import { processingResponse } from '@/lib/uploads/processing-response'
import { getProject } from '@/lib/workspace/storage'
import { readStudioRun, startStudioRun, commitStudioRender,commitStudioOptions,chooseStudioOption,mutateStudioRun,reflowStudioRun,refreshStudioColors,readStudioAppearanceSources } from '@/lib/presentations/studio/storage'
import { designStudioBatch } from '@/lib/presentations/studio/task'
import { structureStudioRun } from '@/lib/presentations/studio/semantic-task'
import {refreshStudioStatus} from '@/lib/presentations/studio/compact-task'
import {generationPreview,generationWorkView} from '@/lib/presentations/studio/generations'
import {enqueueStudioJob,readStudioJob,publicStudioJob,assertStudioJob} from '@/lib/presentations/studio/jobs'
import {workerIsAvailable} from '@/lib/uploads/processing-jobs'
import {STUDIO_VERSION,type StudioRun} from '@/lib/presentations/studio/contract'
import {commitStudioFallback,hydrateFallbackSources} from '@/lib/presentations/studio/fallback-storage'
import {refineStudioRun} from '@/lib/presentations/studio/refine'
import {withStudioCancellation} from '@/lib/presentations/studio/lifecycle'

export const dynamic='force-dynamic'
type Context={params:Promise<{id:string}>}
const config=()=>presentationModelConfig(env as unknown as Record<string,string|undefined>)
export async function GET(request:Request,context:Context){
  try{const bucket=objectBucket(),project=await getProject(bucket,(await context.params).id)
    if(!project||project.archivedAt)return Response.json({error:'Проект не найден.'},{status:404})
    const revision=z.string().uuid().parse(new URL(request.url).searchParams.get('revision')??project.revision)
    if(new URL(request.url).searchParams.get('appearanceSource')==='1')return Response.json({sources:await readStudioAppearanceSources(bucket,project.id,revision)},{headers:{'Cache-Control':'no-store'}})
    const run=await readStudioRun(bucket,project.id,revision)
    if(run)await hydrateFallbackSources(bucket,run)
    const query=new URL(request.url).searchParams,job=await readStudioJob(bucket,revision)
    return Response.json({run:run&&(query.get('view')==='worker'?generationWorkView(run,query.get('slide')??undefined,query.get('library')!=='0'):query.get('preview')==='1'?generationPreview(run):run),background:job?{...publicStudioJob(job),available:await workerIsAvailable(bucket,Date.now(),'studio')}:null,configured:providerChain(config()).some(c=>!!c.apiKey)},{headers:{'Cache-Control':'no-store'}})
  }catch{return Response.json({error:'Не удалось открыть генерацию.'},{status:409})}
}
const requestSchema=z.object({action:z.enum(['start','resume','structure','design','render','options','choose','fail','reflow','colors','fallback','refine']),revision:z.string().uuid(),receipt:z.unknown().optional(),slideId:z.string().max(500).optional(),optionId:z.string().max(500).optional(),experimentalRoute:z.literal('akashml-fp8').optional(),compact:z.boolean().optional(),leaseToken:z.string().uuid().optional()}).strict()
export async function POST(request:Request,context:Context){
  const origin=request.headers.get('origin')
  if(origin&&origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Недопустимый источник запроса.'},{status:403})
  try{
    const body=requestSchema.parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request,26*1024*1024)))),bucket=objectBucket(),id=(await context.params).id
    if(body.leaseToken){const job=await assertStudioJob(bucket,body.revision,body.leaseToken);if(job.projectId!==id)throw Error('Неверный проект фоновой задачи.')}
    const reply=(run:StudioRun)=>Response.json({run:body.compact?generationWorkView(run,body.slideId,false):run})
    if(body.action==='refine')return reply(await refineStudioRun(bucket,id,body.revision,body.slideId))
    if(body.action==='start'||body.action==='resume'){
      let run=body.action==='start'?await startStudioRun(bucket,id,body.revision):await readStudioRun(bucket,id,body.revision)
      if(!run||run.status==='cancelled')throw Error('Генерация остановлена или не найдена.')
      if(body.action==='resume'&&run.status!=='complete'&&(run.version!==STUDIO_VERSION||run.status==='blocked'))run=await reflowStudioRun(bucket,id,body.revision)
      if(await workerIsAvailable(bucket,Date.now(),'studio'))await enqueueStudioJob(bucket,id,run.revision,body.action==='resume')
      return reply(run)
    }
    if(body.action==='fallback'){
      if(!body.slideId)throw Error('Не выбран слайд.')
      return reply(await commitStudioFallback(bucket,id,body.revision,body.slideId,body.receipt))
    }
    if(body.action==='colors')return Response.json({run:await refreshStudioColors(bucket,id,body.revision,body.receipt)})
    if(body.action==='reflow')return Response.json({run:await reflowStudioRun(bucket,id,body.revision)})
    if(body.action==='render')return Response.json({run:await commitStudioRender(bucket,id,body.revision,body.receipt)})
    if(body.action==='options')return reply(await commitStudioOptions(bucket,id,body.revision,body.receipt))
    if(body.action==='fail'){
      const {error,slideId}=z.object({error:z.string().min(1).max(4000),slideId:z.string().max(500).optional()}).strict().parse(body.receipt)
      return reply(await mutateStudioRun(bucket,id,body.revision,run=>{if(run.status!=='complete'){if(slideId){const slide=run.slides.find(s=>s.content.id===slideId);if(!slide)throw Error('Неизвестный слайд.');slide.error=error;refreshStudioStatus(run)}else{run.status='blocked';run.error=error}}}))
    }
    if(body.action==='choose'){
      if(!body.slideId||!body.optionId)throw Error('Не выбран вариант слайда.')
      return Response.json({run:await chooseStudioOption(bucket,id,body.revision,body.slideId,body.optionId)})
    }
    let run=await readStudioRun(bucket,id,body.revision);if(!run)throw Error('Сначала начните генерацию.')
    if(body.experimentalRoute){
      if(body.action!=='structure'||!run.semantic)throw Error('Тестовый провайдер доступен только для смыслового разбора.')
      if(run.semantic.experimentalRoute!==body.experimentalRoute){
        if(run.modelRequests||run.semantic.status==='complete')throw Error('Нельзя менять провайдера посреди запуска.')
        run=await mutateStudioRun(bucket,id,body.revision,next=>{next.semantic!.experimentalRoute=body.experimentalRoute})
      }
    }
    const connection=config();if(!providerChain(connection).some(c=>!!c.apiKey))throw Error('Для умного режима нужен ключ модели на сервере. Быстрый режим доступен без модели.')
    const {response,completion}=processingResponse({status:'planning'},signal=>withStudioCancellation(bucket,run,signal,activeSignal=>body.action==='structure'?structureStudioRun(bucket,run,connection,activeSignal,body.slideId):designStudioBatch(bucket,run,connection,activeSignal)));waitUntil(completion);return response
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Не удалось выполнить генерацию.'},{status:409})}
}
