import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { projectList, saveProject } from '@/lib/msp2/storage'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return Response.json({ projects: await projectList(objectBucket()) }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch { return Response.json({ error: 'Не удалось прочитать проекты MSP 2.' }, { status: 500 }) }
}
export async function POST(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: 'Недопустимый источник.' }, { status: 403 })
  try { return Response.json({ project: await saveProject(objectBucket(), JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 512 * 1024)))) }, { status: 201 }) }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Не удалось сохранить проект.' }, { status: 409 }) }
}
