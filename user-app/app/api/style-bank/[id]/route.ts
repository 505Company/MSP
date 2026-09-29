import { NextResponse } from 'next/server'
import { objectBucket, createCloudflareUploadRepository, ensureUploadSchema } from '@/lib/uploads/cloudflare-repository'
import { cancellationPatch } from '@/lib/uploads/cancellation'
import { removeBankStyle, workspaceId } from '@/lib/workspace/storage'
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin')
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  const { id } = await context.params
  if (!workspaceId.safeParse(id).success) return NextResponse.json({ error: 'Дизайн-система не найдена' }, { status: 404 })
  try {
    await removeBankStyle(objectBucket(), id)
    await ensureUploadSchema()
    const repo = createCloudflareUploadRepository()
    if (await repo.get(id)) await repo.update(id, cancellationPatch)
    return NextResponse.json({ removed: true })
  } catch {
    return NextResponse.json({ error: 'Не удалось удалить дизайн-систему. Попробуйте ещё раз.' }, { status: 500 })
  }
}
