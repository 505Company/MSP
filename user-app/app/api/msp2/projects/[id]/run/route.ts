import { env, waitUntil } from 'cloudflare:workers'
import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { processingResponse } from '@/lib/uploads/processing-response'
import { presentationModelConfig, providerChain } from '@/lib/uploads/provider-failover'
import { readRun, readProject, startRun, planSlide, saveResult, changeRun } from '@/lib/msp2/storage'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const config = () => presentationModelConfig(env as unknown as Record<string, string | undefined>)
export async function GET(request: Request, context: Context) {
  try {
    const id = (await context.params).id, project = await readProject(objectBucket(), id)
    if (!project) return Response.json({ error: 'Проект не найден.' }, { status: 404 })
    const revision = z.string().uuid().parse(new URL(request.url).searchParams.get('revision') ?? project.revision)
    return Response.json({ run: await readRun(objectBucket(), id, revision), configured: providerChain(config()).some(c => !!c.apiKey) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ error: 'Не удалось открыть сборку MSP 2.' }, { status: 409 }) }
}
const bodySchema = z.object({ action: z.enum(['start', 'plan', 'result', 'fail']), revision: z.string().uuid(), slideId: z.string().regex(/^slide-\d+$/).optional(), result: z.unknown().optional(), error: z.string().max(4000).optional() }).strict()
export async function POST(request: Request, context: Context) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: 'Недопустимый источник.' }, { status: 403 })
  try {
    const body = bodySchema.parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 24 * 1024 * 1024)))), bucket = objectBucket(), id = (await context.params).id
    if (body.action === 'start') return Response.json({ run: await startRun(bucket, id, body.revision) })
    if (body.action === 'result') return Response.json({ run: await saveResult(bucket, id, body.revision, body.result) })
    if (!body.slideId) throw Error('Не выбран слайд.')
    if (body.action === 'fail') return Response.json({ run: await changeRun(bucket, id, body.revision, next => { if (!next.packets.some(p => p.id === body.slideId)) throw Error('Слайд не найден.'); if (!next.results[body.slideId!]) next.errors[body.slideId!] = body.error ?? 'Не удалось собрать слайд.' }) })
    const { response, completion } = processingResponse({ status: 'planning' }, signal => planSlide(bucket, id, body.revision, body.slideId!, config(), signal).then(() => undefined))
    waitUntil(completion); return response
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Не удалось выполнить сборку.' }, { status: 409 }) }
}
