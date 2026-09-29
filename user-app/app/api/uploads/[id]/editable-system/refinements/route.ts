import { env, waitUntil } from 'cloudflare:workers'
import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { assertUploadActive, uploadCancellationResponse, withUploadCancellation } from '@/lib/uploads/cancellation-server'
import { processingResponse } from '@/lib/uploads/processing-response'
import { enqueueRefinementProcessing } from '@/lib/uploads/processing-jobs'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { advanceRefinement, cancelRefinement, completeRefinement, ensureAutomaticRefinement, refinementCandidate, refinementState, reportRefinement, requestRefinement, retryRefinement, undoRefinement } from '@/lib/design-system/refinement'
import { readRefinementJob } from '@/lib/design-system/refinement-storage'
import { refinementRegionSource, refreshRefinement } from '@/lib/design-system/refinement'
import { rasterImageSchema } from '@/lib/design-system/refinement-raster'
import { enqueuePreparation } from '@/lib/component-lab/preparation-jobs'
import { recheckPublishedRefinements } from '@/lib/design-system/refinement-recheck'
export const dynamic = 'force-dynamic'
const jobCommand = z.object({ action: z.enum(['advance','report','complete','retry','cancel','refresh']), requestId: z.string().uuid(), report: z.unknown().optional(), image:rasterImageSchema.optional() }).strict()
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    if (!/^[a-f0-9-]{36}$/.test(id)) return Response.json({ error: 'Не найдено' }, { status: 404 })
    const candidate = new URL(request.url).searchParams.get('candidate')
    const regionSource = new URL(request.url).searchParams.get('regionSource')
    if (regionSource) {if(!z.string().uuid().safeParse(regionSource).success)throw Error('Неверный запрос');return Response.json({source:await refinementRegionSource(objectBucket(),id,regionSource)},{headers:{'Cache-Control':'no-store'}})}
    if (candidate && !z.string().uuid().safeParse(candidate).success) throw Error('Неверный запрос')
    const value = candidate ? { candidate: await refinementCandidate(objectBucket(), id, candidate) } : { ...await refinementState(objectBucket(), id), configured: !!modelConfig().apiKey?.trim(), background: !!env.MSP_WORKER_TOKEN }
    return Response.json(value, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Не удалось прочитать дополнения' }, { status: 409 }) }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: 'Недопустимый источник' }, { status: 403 })
  try {
    const { id } = await context.params, bucket = objectBucket()
    if (!/^[a-f0-9-]{36}$/.test(id)) return Response.json({ error: 'Не найдено' }, { status: 404 })
    await assertUploadActive(bucket, id)
    const text = await request.text(); if (text.length > 6000000) throw Error('Слишком большой запрос')
    const body = JSON.parse(text), config = modelConfig()
    const enqueue = async () => { if (env.MSP_WORKER_TOKEN) await enqueueRefinementProcessing(bucket, id, 'Дополнение дизайн-системы') }
    const prepareComponents = () => waitUntil(enqueuePreparation(bucket, id).catch(() => { console.warn('[component-preparation] admission deferred after refinement for ' + id) }))
    if (body.action === 'recheck') {
      const input = z.object({ action: z.literal('recheck'), report: z.unknown().optional() }).strict().parse(body)
      const result = await recheckPublishedRefinements(bucket, id, input.report)
      if (result.complete) prepareComponents()
      return Response.json(result)
    }
    if (body.action === 'request' || body.action === 'automatic') {
      const originalGraphic=body.action==='request'&&(body.request?.mode==='region'&&body.request?.target==='graphic'||body.request?.mode==='scan'&&body.request?.nativeOnly===true)
      if (!originalGraphic&&!config.apiKey?.trim()) throw new QwenAnalysisError('QWEN_NOT_CONFIGURED', 'Для дополнения требуется подключение модели.')
      const job = body.action === 'automatic' ? await ensureAutomaticRefinement(bucket, id) : await requestRefinement(bucket, id, body.request)
      if (job && !['complete', 'cancelled'].includes(job.status) && body.action !== 'automatic') await enqueue()
      return Response.json({ job, background: !!env.MSP_WORKER_TOKEN }, { status: 202 })
    }
    if (body.action === 'undo') { const parsed = z.object({ action: z.literal('undo'), catalogId: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(body); await undoRefinement(bucket, id, parsed.catalogId); prepareComponents(); return Response.json({ complete: true }) }
    const command = jobCommand.parse(body)
    if (command.action === 'refresh') { await refreshRefinement(bucket, id, command.requestId); return Response.json({ complete: true }) }
    if (command.action === 'advance') {
      const { response, completion } = processingResponse({ started: true }, signal => withUploadCancellation(bucket, id, signal, async active => {
        const controller = new AbortController(), abort = () => controller.abort(active.reason)
        active.addEventListener('abort', abort, { once: true })
        const timer = setInterval(() => void readRefinementJob(bucket, id, command.requestId).then(job => { if (job?.status === 'cancelled') controller.abort(new Error('Дополнение остановлено')) }).catch(() => {}), 1200)
        try { if (active.aborted) abort(); await advanceRefinement(bucket, id, command.requestId, config, controller.signal, command.image) }
        finally { clearInterval(timer); active.removeEventListener('abort', abort) }
      }))
      waitUntil(completion); return response
    }
    if (command.action === 'report') await reportRefinement(bucket, id, command.requestId, command.report)
    if (command.action === 'complete') { await completeRefinement(bucket, id, command.requestId); prepareComponents() }
    if (command.action === 'cancel') { await cancelRefinement(bucket, id, command.requestId); if((await refinementState(bucket,id)).pending)await enqueue() }
    if (command.action === 'retry') { await retryRefinement(bucket, id, command.requestId); await enqueue() }
    return Response.json({ complete: true, background: !!env.MSP_WORKER_TOKEN })
  } catch (error) {
    return uploadCancellationResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : 'Не удалось дополнить дизайн-систему', code: error instanceof QwenAnalysisError ? error.code : undefined }, { status: 409 })
  }
}
