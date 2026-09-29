import { waitUntil } from 'cloudflare:workers'
import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { processingResponse } from '@/lib/uploads/processing-response'
import { workerIsAvailable } from '@/lib/uploads/processing-jobs'
import { commandDiscoveryJob, discoveryRequestSchema, enqueueDiscoveryJob, publicDiscoveryJob, readDiscoveryJobs } from '@/lib/presentations/recipes/discovery-jobs'
import { advanceDiscovery, readDiscoveryEvidence } from '@/lib/presentations/recipes/discovery-workflow'

export const dynamic = 'force-dynamic'
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), request: discoveryRequestSchema }).strict(),
  z.object({ action: z.enum(['resume', 'cancel']), jobId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('advance'), jobId: z.string().uuid(), token: z.string().uuid(), report: z.object({ stepId: z.string().max(600), value: z.unknown() }).strict().optional() }).strict(),
])
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = z.string().uuid().parse((await context.params).id), bucket = objectBucket()
    const jobs = await readDiscoveryJobs(bucket, id), requested = new URL(request.url).searchParams.get('jobId')
    const job = requested ? jobs.find(j => j.id === requested) : null
    if (requested && !job) return Response.json({ error: 'Задание не найдено' }, { status: 404 })
    return Response.json({ jobs: jobs.map(publicDiscoveryJob), configured: !!modelConfig().apiKey, background: await workerIsAvailable(bucket, Date.now(), 'recipes'),
      ...(job ? { evidence: await readDiscoveryEvidence(bucket, job) } : {}) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  try {
    const id = z.string().uuid().parse((await context.params).id), text = await request.text()
    if (text.length > 4_500_000) return Response.json({ error: 'Слишком большой запрос' }, { status: 413 })
    const body = command.parse(JSON.parse(text)), bucket = objectBucket()
    if (body.action === 'start') {
      if (!modelConfig().apiKey) throw new QwenAnalysisError('QWEN_NOT_CONFIGURED', 'Модель не подключена.')
      return Response.json({ job: publicDiscoveryJob(await enqueueDiscoveryJob(bucket, id, body.request)) })
    }
    if (body.action !== 'advance') return Response.json({ job: publicDiscoveryJob(await commandDiscoveryJob(bucket, id, body.jobId, body.action)) })
    const started = await advanceDiscovery(bucket, id, body.jobId, body.token, modelConfig(), body.report ? { stepId: body.report.stepId, value: body.report.value } : undefined)
    if (!started.execute) return Response.json(started.value)
    const { response, completion } = processingResponse(started.value, started.execute)
    waitUntil(completion)
    return response
  } catch (error) { return failure(error) }
}
function failure(error: unknown) {
  const cancelled = uploadCancellationResponse(error)
  if (cancelled) return cancelled
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: 'Некорректный запрос пополнения рецептов' }, { status: 400 })
  const known = error instanceof QwenAnalysisError
  return Response.json({ error: known ? error.message : 'Пополнение не завершено. Исходные материалы сохранены.', code: known ? error.code : 'RECIPE_JOB_FAILED' }, { status: known ? 409 : 500 })
}
