import { NextResponse } from 'next/server'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { archiveProject, getProject, updateProject, workspaceId } from '@/lib/workspace/storage'
import { LibraryConflict } from '@/lib/design-system/storage'
import {cancelProjectStudioGenerations} from '@/lib/presentations/studio/lifecycle'
import {cancelLayoutJob} from '@/lib/presentations/layout-jobs'
export const dynamic = 'force-dynamic'
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    if (!workspaceId.safeParse(id).success) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
    const bucket = objectBucket()
    if (!await getProject(bucket, id)) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
    if (request.method === 'DELETE') {
      const raw = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 4096)))
      await archiveProject(bucket, id, raw.baseRevision)
      await cancelLayoutJob(bucket,id)
      await cancelProjectStudioGenerations(bucket,id)
      return NextResponse.json({ archived: true })
    }
    const project = request.method === 'PUT' ? await updateProject(bucket, id, JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 512 * 1024)))) : await getProject(bucket, id)
    return NextResponse.json({ project }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: error instanceof LibraryConflict ? error.message : 'Не удалось сохранить содержание. Проверьте текст и попробуйте ещё раз.' }, { status: error instanceof LibraryConflict ? 409 : 400 }) }
}
export const GET = handle
export const PUT = handle
export const DELETE = handle
