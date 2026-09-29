import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { getProject } from '@/lib/workspace/storage'
import { isVisibleGeneration, listStudioGenerations } from '@/lib/presentations/studio/generations'
import {cancelProjectStudioGenerations,cancelStudioGeneration,setStudioSlidesDeleted} from '@/lib/presentations/studio/lifecycle'
import {cancelLayoutJob,readLayoutJob} from '@/lib/presentations/layout-jobs'
import {readLimitedBody} from '@/lib/uploads/binary-contract'
import {z} from 'zod'
import {pruneStudioGenerations} from '@/lib/presentations/studio/prune'

export const dynamic = 'force-dynamic'
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const bucket = objectBucket(), project = await getProject(bucket, (await context.params).id)
    if (!project || project.archivedAt) return Response.json({ error: 'Проект не найден.' }, { status: 404 })
    return Response.json({ generations: (await listStudioGenerations(bucket, project.id)).filter(isVisibleGeneration) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ error: 'Не удалось открыть историю генераций.' }, { status: 409 }) }
}

const edit=z.discriminatedUnion('action',[
  z.object({action:z.literal('prune')}).strict(),
  z.object({action:z.literal('cancel'),revisions:z.array(z.string().uuid()).min(1).max(200).optional()}).strict(),
  z.object({action:z.enum(['delete','restore']),slides:z.array(z.object({revision:z.string().uuid(),slideId:z.string().min(1).max(500)}).strict()).min(1).max(500)}).strict(),
])
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const origin=request.headers.get('origin')
  if(origin&&origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Недопустимый источник запроса.'},{status:403})
  try{
    const bucket=objectBucket(),project=await getProject(bucket,(await context.params).id)
    if(!project||project.archivedAt)return Response.json({error:'Проект не найден.'},{status:404})
    const body=edit.parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request,128*1024))))
    if(body.action==='prune')return Response.json(await pruneStudioGenerations(bucket,project.id))
    if(body.action==='cancel'){
      const before=await readLayoutJob(bucket,project.id),job=await cancelLayoutJob(bucket,project.id)
      let cancelled=0
      if(body.revisions){for(const revision of new Set(body.revisions))if(await cancelStudioGeneration(bucket,project.id,revision))cancelled++}
      else cancelled=await cancelProjectStudioGenerations(bucket,project.id)
      return Response.json({cancelled,layoutCancelled:!!before&&before.status!=='cancelled'&&job?.status==='cancelled'})
    }
    return Response.json({changes:await setStudioSlidesDeleted(bucket,project.id,body.slides,body.action==='delete')})
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Не удалось изменить слайды.'},{status:409})}
}
