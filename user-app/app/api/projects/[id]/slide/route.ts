import { NextResponse } from 'next/server'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { getProject, workspaceId } from '@/lib/workspace/storage'
import { loadSlide, saveSlide } from '@/lib/slides/storage'
import { LibraryConflict } from '@/lib/design-system/storage'
export const dynamic = 'force-dynamic'
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    if (!workspaceId.safeParse(id).success) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
    const bucket = objectBucket(), project = await getProject(bucket, id)
    if (!project) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
    const slide = request.method === 'PUT' ? await saveSlide(bucket, project.uploadId, JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 512 * 1024))), project.id) : await loadSlide(bucket, project.id, 'project')
    return NextResponse.json({ slide }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось сохранить слайд' }, { status: error instanceof LibraryConflict ? 409 : 400 }) }
}
export const GET = handle
export const PUT = handle
