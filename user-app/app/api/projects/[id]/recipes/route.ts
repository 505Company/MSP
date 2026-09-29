import { waitUntil } from 'cloudflare:workers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { QwenAnalysisError } from '@/lib/uploads/qwen-analysis'
import { processingResponse } from '@/lib/uploads/processing-response'
import { recipeContext, readRecipePlan, startRecipePlan } from '@/lib/presentations/recipe-plan'
import { activeRecipe } from '@/lib/presentations/active-recipe'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
function failure(error: unknown) {
  const known = error instanceof QwenAnalysisError
  return NextResponse.json({ error: known ? error.message : 'Не удалось подобрать оформление. Содержание сохранено.', code: known ? error.code : 'RECIPE_REQUEST_FAILED' },
    { status: known && error.code === 'PROJECT_NOT_FOUND' ? 404 : known ? 409 : 400 })
}
export async function GET(_request: Request, context: Context) {
  try {
    const bucket = objectBucket(), config = modelConfig(), scope = await recipeContext(bucket, (await context.params).id, config)
    return NextResponse.json({ configured: Boolean(config.apiKey?.trim()), inputId: scope.inputId, materialId: scope.structure.material.id,
      uploadId: scope.brand.uploadId, plan: await readRecipePlan(bucket, scope) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request, context: Context) {
  if (activeRecipe() !== 'accepted-10-v1') return NextResponse.json({ code: 'RECIPE_ARCHIVED', error: 'Прежние рецепты временно в архиве. Активен новый рецепт.' }, { status: 409 })
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  try {
    const hash = z.string().regex(/^[a-f0-9]{64}$/)
    const input = z.object({ inputId: hash, materialId: hash, uploadId: z.string().uuid() }).strict().parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 2048))))
    const bucket = objectBucket(), config = modelConfig(), scope = await recipeContext(bucket, (await context.params).id, config)
    const job = await startRecipePlan(bucket, scope, input, config)
    if (!job.execute) return NextResponse.json({ plan: job.state, reused: true })
    const { response, completion } = processingResponse({ inputId: scope.inputId, plan: job.state }, job.execute)
    waitUntil(completion)
    return response
  } catch (error) { return failure(error) }
}
