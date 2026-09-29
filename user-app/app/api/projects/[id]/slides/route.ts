import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readProjectPresentation } from '@/lib/workspace/project-summary'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return Response.json({ presentation: await readProjectPresentation(objectBucket(), (await context.params).id) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ error: 'Не удалось открыть сохранённые слайды.' }, { status: 500 }) }
}
