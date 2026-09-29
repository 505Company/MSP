import { waitUntil } from 'cloudflare:workers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { processingResponse } from '@/lib/uploads/processing-response'
import { deckContext, deckView, readDeck, startDeckAction, type DeckAction } from '@/lib/presentations/deck'
import { activeRecipe } from '@/lib/presentations/active-recipe'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('advance'), inputId: hash, reference: z.string().max(2_800_000).optional(), evidence: z.unknown().optional(), retry: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('catalog'), inputId: hash, pageId: z.string().regex(/^page-\d+$/), evidence: z.unknown() }).strict(),
  z.object({ action: z.literal('evidence'), inputId: hash, slideId: z.string().regex(/^[\w-]{1,160}$/), evidence: z.unknown() }).strict(),
  z.object({ action: z.literal('report'), inputId: hash, slideId: z.string().regex(/^[\w-]{1,160}$/), report: z.unknown(), preview: z.string().max(2_800_000) }).strict(),
])
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof QwenAnalysisError ? error.message : 'Не удалось подготовить слайды. Исходное содержание сохранено.',
    code: error instanceof QwenAnalysisError ? error.code : 'DECK_REQUEST_FAILED' }, { status: error instanceof QwenAnalysisError ? 409 : 400 })
}
export async function GET(_request: Request, context: Context) {
  try { const bucket = objectBucket(), scope = await deckContext(bucket, (await context.params).id, modelConfig())
    return NextResponse.json(deckView(scope, await readDeck(bucket, scope)), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request, context: Context) {
  if (activeRecipe() !== 'accepted-10-v1') return NextResponse.json({ code: 'RECIPE_ARCHIVED', error: 'Прежние рецепты временно в архиве. Активен новый рецепт.' }, { status: 409 })
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  try {
    const input = actionSchema.parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 6_000_000))))
    const action = input as DeckAction
    const bucket = objectBucket(), config = modelConfig(), scope = await deckContext(bucket, (await context.params).id, config)
    const job = await startDeckAction(bucket, scope, action, config)
    if (!job.execute) return NextResponse.json({ state: job.state, reused: true })
    const { response, completion } = processingResponse({ inputId: scope.inputId, state: job.state }, job.execute)
    waitUntil(completion); return response
  } catch (error) { return failure(error) }
}
