import { waitUntil } from 'cloudflare:workers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { processingResponse } from '@/lib/uploads/processing-response'
import { readStructure, startStructure, structureContext } from '@/lib/presentations/structure'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
function failure(error: unknown) {
  const known = error instanceof QwenAnalysisError
  return NextResponse.json({ error: known ? error.message : 'Не удалось подготовить содержание. Исходный текст сохранён.', code: known ? error.code : 'CONTENT_REQUEST_FAILED' },
    { status: known && error.code === 'PROJECT_NOT_FOUND' ? 404 : known ? 409 : 400 })
}
export async function GET(_request: Request, context: Context) {
  try {
    const bucket = objectBucket(), config = modelConfig(), scope = await structureContext(bucket, (await context.params).id, config)
    return NextResponse.json({ configured: Boolean(config.apiKey?.trim()), materialId: scope.material.id,
      projectRevision: scope.sourceRevision, structure: await readStructure(bucket, scope) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request, context: Context) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  try {
    const input = z.object({ materialId: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 2048))))
    const bucket = objectBucket(), config = modelConfig(), scope = await structureContext(bucket, (await context.params).id, config)
    const job = await startStructure(bucket, scope, input.materialId, config)
    if (!job.execute) return NextResponse.json({ structure: job.state, reused: true })
    const { response, completion } = processingResponse({ materialId: scope.material.id, structure: job.state }, job.execute)
    waitUntil(completion)
    return response
  } catch (error) { return failure(error) }
}
