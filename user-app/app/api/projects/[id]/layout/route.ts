import { waitUntil } from 'cloudflare:workers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { processingResponse } from '@/lib/uploads/processing-response'
import { activeRecipe } from '@/lib/presentations/active-recipe'
import { layoutContext } from '@/lib/presentations/layout-context'
import { layoutView, startLayoutAction, type LayoutAction } from '@/lib/presentations/layout-workflow'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const base = { inputId: z.string().regex(/^[a-f0-9]{64}$/), slideId: z.string().regex(/^[\w-]{1,120}$/), round: z.number().int().min(0).max(1) }
const schema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('plan'), evidence: z.object({ fontTokens: z.array(z.string()).min(1).max(200) }).strict(), retry: z.boolean().optional() }).strict(),
  z.object({ ...base, action: z.literal('review'), retry: z.boolean().optional() }).strict(),
  z.object({ ...base, action: z.literal('report'), fit: z.unknown(), preview: z.string().max(4_000_000).optional() }).strict(),
])
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof QwenAnalysisError ? error.message : 'Не удалось подготовить слайды. Содержание сохранено.', code: error instanceof QwenAnalysisError ? error.code : 'LAYOUT_REQUEST_FAILED' }, { status: error instanceof QwenAnalysisError ? 409 : 400 })
}
export async function GET(_request: Request, context: Context) {
  try { const bucket = objectBucket(), config = modelConfig(), scope = await layoutContext(bucket, (await context.params).id, config)
    return NextResponse.json({ ...await layoutView(bucket, scope), configured: !!config.apiKey?.trim() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request, context: Context) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  if (activeRecipe() !== 'layout-engine-v1') return NextResponse.json({ error: 'Экспериментальный рецепт выключен.' }, { status: 409 })
  try {
    const action = schema.parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 4_500_000)))) as LayoutAction
    const bucket = objectBucket(), config = modelConfig(), scope = await layoutContext(bucket, (await context.params).id, config)
    const job = await startLayoutAction(bucket, scope, action, config)
    if (!job.execute) return NextResponse.json({ state: job.state })
    const { response, completion } = processingResponse({ inputId: scope.inputId }, job.execute)
    waitUntil(completion); return response
  } catch (error) { return failure(error) }
}
