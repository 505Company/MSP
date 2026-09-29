import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { assertUploadActive, uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import { readSourceRepairStatus, repairSourcePages } from '@/lib/uploads/source-repair'
import { readLimitedBody } from '@/lib/uploads/binary-contract'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    if (!/^[a-f0-9-]{36}$/.test(id)) return Response.json({ error: 'Файл не найден' }, { status: 404 })
    const bucket = objectBucket(); await assertUploadActive(bucket,id)
    return Response.json(await readSourceRepairStatus(bucket,id,new URL(request.url).searchParams.get('refresh')==='appearance'),{headers:{'Cache-Control':'no-store'}})
  } catch (error) { return uploadCancellationResponse(error) ?? Response.json({error:'Не удалось проверить исходные слайды'},{status:503}) }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({error:'Недопустимый источник запроса'},{status:403})
  try {
    const { id } = await context.params
    if (!/^[a-f0-9-]{36}$/.test(id)) return Response.json({error:'Файл не найден'},{status:404})
    const bytes = await readLimitedBody(request,40_000_000)
    const receipt = await repairSourcePages(objectBucket(),id,JSON.parse(new TextDecoder().decode(bytes)))
    // Source recovery is local. This endpoint never queues or calls a model.
    return Response.json(receipt)
  } catch (error) { return uploadCancellationResponse(error) ?? Response.json({error:error instanceof Error?error.message:'Не удалось восстановить исходные слайды'},{status:409}) }
}
