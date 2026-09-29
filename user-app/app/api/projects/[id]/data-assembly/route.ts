import {NextResponse} from 'next/server'
import {objectBucket} from '@/lib/uploads/cloudflare-repository'
import {assembleProjectData} from '@/lib/presentations/data-assembly'
export const dynamic='force-dynamic'
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
 try{const {id}=await context.params;if(!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:'Проект не найден'},{status:404})
  return NextResponse.json(await assembleProjectData(objectBucket(),id),{headers:{'Cache-Control':'no-store'}})
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Не удалось оформить данные'},{status:409})}
}
