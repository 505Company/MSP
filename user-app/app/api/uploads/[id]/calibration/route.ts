import { waitUntil } from 'cloudflare:workers'
import { NextResponse } from 'next/server'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { calibrationState, saveQualifications, startCalibrationJob } from '@/lib/design-system/calibration'
import type { ComponentQualification } from '@/lib/design-system/calibration-contract'
import { processingResponse } from '@/lib/uploads/processing-response'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { assertUploadActive, uploadCancellationResponse, withUploadCancellation } from '@/lib/uploads/cancellation-server'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    if (!/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
    return NextResponse.json(await calibrationState(objectBucket(), id, new URL(request.url).searchParams.get('inputs') === '1'), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: e instanceof QwenAnalysisError ? e.message : 'Не удалось открыть калибровку.' }, { status: 409 }) }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  try {
    const { id } = await context.params
    if (!/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
    const body = await request.json() as { action: string; catalogId: string; records: ComponentQualification[]; inputHash: string; jobId: string; sheets: { ids: string[]; dataUrl: string }[] }, bucket = objectBucket()
    await assertUploadActive(bucket,id)
    if (body.action === 'qualify') {
      await saveQualifications(bucket, id, body.catalogId, body.records)
      return NextResponse.json({ saved: body.records.length })
    }
    if (body.action !== 'model') return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
    const started = await startCalibrationJob(bucket, id, body, modelConfig())
    const { response, completion } = processingResponse({ run: started.run }, signal=>withUploadCancellation(bucket,id,signal,started.execute))
    waitUntil(completion); return response
  } catch (e) { return uploadCancellationResponse(e) ?? NextResponse.json({ error: e instanceof QwenAnalysisError ? e.message : e instanceof Error ? e.message : 'Калибровка не завершена.' }, { status: 409 }) }
}
