import { assertUploadActive, uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import { waitUntil } from 'cloudflare:workers'
import { NextResponse } from 'next/server'
import { createCloudflareUploadRepository, ensureUploadSchema, objectBucket } from '@/lib/uploads/cloudflare-repository'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { readModelRun } from '@/lib/uploads/model-run'
import { processingResponse } from '@/lib/uploads/processing-response'
import { semanticPrefix, startSemanticPilot } from '@/lib/design-system/semantic-pilot'
import type { VisualManifest } from '@/lib/digital-designer/visual-package'

export const dynamic = 'force-dynamic'
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id)

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params, runId = new URL(request.url).searchParams.get('run') ?? undefined
  if (!validId(id) || runId && !validId(runId)) return NextResponse.json({ error: 'Запуск не найден' }, { status: 404 })
  return NextResponse.json({ run: await readModelRun(objectBucket(), semanticPrefix(id), runId) }, { headers: { 'Cache-Control': 'no-store' } })
}

// Internal integration endpoint: no manual review step or diagnostics in the UI.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  try {
    const { id } = await context.params
    if (!validId(id)) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
    await assertUploadActive(objectBucket(),id)
    const body = await request.text()
    if (body.length > 1000) return NextResponse.json({ error: 'Слишком большой запрос' }, { status: 400 })
    let batchId: string | undefined
    if (body.trim()) {
      const parsed = JSON.parse(body)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some(k => k !== 'batchId') || parsed.batchId !== undefined && !/^batch-[1-9][0-9]{0,3}$/.test(parsed.batchId)) return NextResponse.json({ error: 'Некорректный пакет' }, { status: 400 })
      batchId = parsed.batchId
    }
    await ensureUploadSchema()
    const upload = await createCloudflareUploadRepository().get(id), bucket = objectBucket()
    if (!upload) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
    const manifest = await bucket.get(`visual/${id}/manifest.json`)
    if (!manifest) return NextResponse.json({ error: 'Сначала завершите импорт PPTX' }, { status: 409 })
    const started = await startSemanticPilot(bucket, id, await manifest.json<VisualManifest>(), modelConfig(), batchId)
    if (!started.execute) return NextResponse.json({ run: started.run }, { headers: { 'Cache-Control': 'no-store' } })
    const { response, completion } = processingResponse({ run: started.run }, started.execute)
    waitUntil(completion)
    return response
  } catch (error) {
    const cancelled=uploadCancellationResponse(error);if(cancelled)return cancelled
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
    const known = error instanceof QwenAnalysisError
    return NextResponse.json({ error: known ? error.message : 'Не удалось начать анализ. Исходная дизайн-система сохранена.', code: known ? error.code : 'SEMANTIC_START_FAILED' }, { status: known ? 409 : 500 })
  }
}
