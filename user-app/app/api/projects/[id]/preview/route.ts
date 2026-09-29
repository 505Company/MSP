import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readProjectPreview } from '@/lib/workspace/project-summary'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const params = new URL(request.url).searchParams
    const preview = await readProjectPreview(objectBucket(), (await context.params).id, {
      inputId: params.get('inputId') ?? '', slideId: params.get('slideId') ?? '', round: Number(params.get('round')), render: params.get('render') ?? '',
    })
    if (!preview) return new Response(null, { status: 404 })
    const bytes = Uint8Array.from(atob(preview.slice(preview.indexOf(',') + 1)), c => c.charCodeAt(0))
    return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } })
  } catch { return new Response(null, { status: 404 }) }
}
