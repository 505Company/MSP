import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { modelConfig } from '@/lib/uploads/qwen-client'
import { layoutContext } from '@/lib/presentations/layout-context'
import { readLayoutPreview } from '@/lib/presentations/layout-workflow'
import { LAYOUT_RENDER_VERSION } from '@/lib/presentations/layout-contract'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const bucket = objectBucket(), scope = await layoutContext(bucket, (await context.params).id, modelConfig()), params = new URL(request.url).searchParams
    if (params.get('inputId') !== scope.inputId) return new Response(null, { status: 404 })
    if (params.has('render') && params.get('render') !== LAYOUT_RENDER_VERSION) return new Response(null, { status: 404 })
    const file = await readLayoutPreview(bucket, scope, params.get('slideId') ?? '', Number(params.get('round')))
    if (!file) return new Response(null, { status: 404 })
    const bytes = Uint8Array.from(atob(file.slice(file.indexOf(',') + 1)), c => c.charCodeAt(0))
    return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': params.has('render') ? 'private, max-age=3600' : 'no-store' } })
  } catch { return new Response(null, { status: 404 }) }
}
