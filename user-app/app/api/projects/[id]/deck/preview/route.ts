import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { deckContext, readDeck } from '@/lib/presentations/deck'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const bucket = objectBucket(), scope = await deckContext(bucket, (await context.params).id, modelConfig()), params = new URL(request.url).searchParams
    if (params.get('inputId') !== scope.inputId) return new Response(null, { status: 409 })
    const state = await readDeck(bucket, scope), slide = state?.slides.find(s => s.id === params.get('slideId'))
    const attempt = slide?.attempts.find(a => a.number === slide.fittedAttempt)
    if (params.has('sceneHash') && params.get('sceneHash') !== attempt?.sceneHash) return new Response(null, { status: 409 })
    const key = attempt?.preview, file = key && await bucket.get(key)
    return file ? new Response(file.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }) : new Response(null, { status: 404 })
  } catch { return new Response(null, { status: 404 }) }
}
