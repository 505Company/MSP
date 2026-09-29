import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { getProject } from '@/lib/workspace/storage'
import { readStudioRun } from '@/lib/presentations/studio/storage'
import {z} from 'zod'
export const dynamic='force-dynamic'
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  const bucket=objectBucket(),project=await getProject(bucket,(await context.params).id)
  if(!project||project.archivedAt)return new Response(null,{status:404})
  const query=new URL(request.url).searchParams,revision=z.string().uuid().safeParse(query.get('revision')??project.revision)
  if(!revision.success)return new Response(null,{status:404})
  const run=await readStudioRun(bucket,project.id,revision.data),id=query.get('slideId')??'',result=run?.results[id]
  if(!result?.passed||run?.deletedSlideIds?.includes(id))return new Response(null,{status:404})
  const bytes=Uint8Array.from(atob(result.preview.split(',')[1]),c=>c.charCodeAt(0))
  return new Response(bytes,{headers:{'Content-Type':'image/png','Cache-Control':'no-store'}})
}
