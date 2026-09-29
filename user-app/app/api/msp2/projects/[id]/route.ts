import { z } from 'zod'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { readProject, saveProject } from '@/lib/msp2/storage'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
export async function GET(_request: Request, context: Context) {
  try { const project = await readProject(objectBucket(), (await context.params).id); return Response.json({ project }, { status: project ? 200 : 404, headers: { 'Cache-Control': 'no-store' } }) }
  catch { return Response.json({ error: 'Проект не найден.' }, { status: 404 }) }
}
export async function PUT(request: Request, context: Context) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: 'Недопустимый источник.' }, { status: 403 })
  try {
    const { baseRevision, ...raw } = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 512 * 1024)))
    return Response.json({ project: await saveProject(objectBucket(), { ...raw, id: (await context.params).id }, z.string().uuid().parse(baseRevision)) })
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Не удалось сохранить проект.' }, { status: 409 }) }
}
