import { waitUntil } from 'cloudflare:workers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { assertUploadActive, uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { processingResponse } from '@/lib/uploads/processing-response'
import { authorizeComparisonCheck, readTemplatePilot, startTemplatePilot } from '@/lib/presentations/recipes/template-pilot'

export const dynamic = 'force-dynamic'
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id)
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!validId(id)) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  try {
    const round = z.enum(['pilot-1', 'structural-1', 'family-2', 'comparison-1']).parse(new URL(request.url).searchParams.get('round') ?? 'pilot-1')
    return NextResponse.json(await readTemplatePilot(objectBucket(), id, round), { headers: { 'Cache-Control': 'no-store' } })
  }
  catch (error) { return failure(error) }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  try {
    const { id } = await context.params
    if (!validId(id)) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
    const text = await request.text()
    if (text.length > 4_500_000) return NextResponse.json({ error: 'Слишком большой запрос' }, { status: 413 })
    const body = z.union([z.object({ action: z.literal('authorize-comparison-check'), reason: z.string().trim().min(1).max(1000) }).strict(),
      z.object({ action: z.enum(['extract', 'adapt', 'plan', 'review', 'reflow', 'compare', 'compare-refine']), caseId: z.enum(['short', 'medium', 'long', 'reconstruction']).optional(), report: z.unknown().optional(), round: z.enum(['pilot-1', 'structural-1', 'family-2', 'comparison-1']).default('pilot-1') }).strict()]).parse(JSON.parse(text))
    const bucket = objectBucket()
    await assertUploadActive(bucket, id)
    if (body.action === 'authorize-comparison-check') return NextResponse.json({ budget: await authorizeComparisonCheck(bucket, id, body.reason) })
    const started = await startTemplatePilot(bucket, id, modelConfig(), body.action, body.caseId, body.report, body.round)
    if (!started.execute) return NextResponse.json({ run: started.run }, { headers: { 'Cache-Control': 'no-store' } })
    const { response, completion } = processingResponse({ run: started.run }, started.execute)
    waitUntil(completion)
    return response
  } catch (error) { return failure(error) }
}
function failure(error: unknown) {
  const cancelled = uploadCancellationResponse(error)
  if (cancelled) return cancelled
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Некорректный запрос пилота' }, { status: 400 })
  const known = error instanceof QwenAnalysisError
  return NextResponse.json({ error: known ? error.message : 'Пилот не завершён; исходник и презентации сохранены.', code: known ? error.code : 'RECIPE_PILOT_FAILED',
    ...('issues' in Object(error) ? { issues: (error as { issues: unknown }).issues } : {}),
  }, { status: known ? 409 : 500 })
}
