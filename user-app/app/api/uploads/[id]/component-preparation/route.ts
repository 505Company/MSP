import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import { workerIsAvailable } from '@/lib/uploads/processing-jobs'
import { readEditableCatalog } from '@/lib/design-system/editable-analysis'
import { PREPARATION_VERSION, commandPreparation, enqueuePreparation, finishPreparation, ownedPreparation, publicPreparationJob, readPreparationJobs, readPreparedComponent } from '@/lib/component-lab/preparation-jobs'

export const dynamic = 'force-dynamic'
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ensure') }).strict(),
  z.object({ action: z.enum(['cancel', 'retry']), jobId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('work'), jobId: z.string().uuid(), token: z.string().uuid(), report: z.unknown().optional() }).strict(),
])
const failure = (e: unknown) => uploadCancellationResponse(e) ?? Response.json({ error: e instanceof z.ZodError ? 'Неполные данные проверки компонента.' : e instanceof Error ? e.message : 'Подготовка прервалась.' }, { status: 409 })
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = z.string().uuid().parse((await context.params).id), bucket = objectBucket(), catalog = await readEditableCatalog(bucket, id)
    const component = new URL(request.url).searchParams.get('component')
    if (component) return Response.json({ prepared: await readPreparedComponent(bucket, id, z.string().max(160).parse(component)) }, { headers: { 'Cache-Control': 'no-store' } })
    const jobs = (await readPreparationJobs(bucket, id)).filter(j => j.catalogId === catalog?.id && j.version === PREPARATION_VERSION)
    return Response.json({ jobs: jobs.map(publicPreparationJob), background: await workerIsAvailable(bucket, Date.now(), 'components') }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return failure(e) }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: 'Недопустимый источник' }, { status: 403 })
  try {
    const id = z.string().uuid().parse((await context.params).id), text = await request.text()
    if (text.length > 1_500_000) return Response.json({ error: 'Слишком большой отчёт' }, { status: 413 })
    const body = command.parse(JSON.parse(text)), bucket = objectBucket()
    if (body.action === 'ensure') return Response.json({ jobs: (await enqueuePreparation(bucket, id)).map(publicPreparationJob) })
    if (body.action !== 'work') return Response.json({ jobs: (await commandPreparation(bucket, id, body.jobId, body.action)).map(publicPreparationJob) })
    const job = await ownedPreparation(bucket, id, body.jobId, body.token)
    if (body.report) { await finishPreparation(bucket, id, body.jobId, body.token, body.report); return Response.json({ done: true }) }
    return Response.json(job.result ? { done: true } : { input: job.input })
  } catch (e) { return failure(e) }
}
