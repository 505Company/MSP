import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readRun } from '@/lib/msp2/storage'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const q = new URL(request.url).searchParams, run = await readRun(objectBucket(), (await context.params).id, q.get('revision') ?? '')
    const result = run?.results[q.get('slide') ?? '']
    if (!result) return new Response('Превью не найдено', { status: 404 })
    return new Response(Uint8Array.from(atob(result.preview.split(',')[1]), c => c.charCodeAt(0)), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private,max-age=3600' } })
  } catch { return new Response('Превью не найдено', { status: 404 }) }
}
