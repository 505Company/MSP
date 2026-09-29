import { NextResponse } from 'next/server'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { workerIsAvailable } from '@/lib/uploads/processing-jobs'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { layoutContext } from '@/lib/presentations/layout-context'
import { enqueueLayoutJob, publicLayoutJob, readLayoutJob } from '@/lib/presentations/layout-jobs'
import { activeRecipe } from '@/lib/presentations/active-recipe'
import { z } from 'zod'
import { limitLayoutRequests } from '@/lib/presentations/layout-budget'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const generationRequest = z.object({ inputId: z.string().min(1).max(150), retry: z.boolean().optional(), requestLimit: z.number().int().min(1).max(120).optional() }).strict()
export async function GET(_request: Request, context: Context) {
  const bucket = objectBucket(), { id } = await context.params
  return NextResponse.json({ available: await workerIsAvailable(bucket), job: publicLayoutJob(await readLayoutJob(bucket, id)) }, { headers: { 'Cache-Control': 'no-store' } })
}
export async function POST(request: Request, context: Context) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Недопустимый источник запроса.' }, { status: 403 })
  if (activeRecipe() !== 'layout-engine-v1') return NextResponse.json({ error: 'Экспериментальный рецепт выключен.' }, { status: 409 })
  try {
    const text = await request.text()
    if (text.length > 1000) throw Error('Слишком большой запрос.')
    const body = generationRequest.parse(JSON.parse(text)), bucket = objectBucket()
    const scope = await layoutContext(bucket, (await context.params).id, modelConfig())
    if (body.inputId !== scope.inputId) throw Error('Проект изменился; обновите состояние генерации.')
    if (body.requestLimit !== undefined) await limitLayoutRequests(bucket, scope, body.requestLimit)
    return NextResponse.json({ job: publicLayoutJob(await enqueueLayoutJob(bucket, scope, body.retry)) })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось запустить генерацию.' }, { status: 409 }) }
}
