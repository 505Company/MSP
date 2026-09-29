import { assertUploadActive, uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createCloudflareUploadRepository, ensureUploadSchema, objectBucket } from '@/lib/uploads/cloudflare-repository'
import { readLimitedBody } from '@/lib/uploads/binary-contract'
import { addBankStyle, getBankStyle, listBank, workspaceId } from '@/lib/workspace/storage'
import { initializeCatalog } from '@/lib/design-system/catalog'
import { sourceSystem } from '@/lib/design-system/source-system-storage'
import type { VisualManifest } from '@/lib/digital-designer/visual-package'
import type { CheckpointResult } from '@/lib/digital-designer/pipeline'

export const dynamic = 'force-dynamic'
export async function GET() {
  try { return NextResponse.json({ styles: await listBank(objectBucket()) }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch { return NextResponse.json({ error: 'Не удалось открыть банк стилей. Попробуйте ещё раз.' }, { status: 500 }) }
}
export async function POST(request: Request) {
  try {
    const input = z.object({ uploadId: workspaceId, name: z.string().trim().min(1).max(120).optional() }).strict().parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 4096))))
    await assertUploadActive(objectBucket(),input.uploadId)
    const bucket = objectBucket(), existing = await getBankStyle(bucket, input.uploadId)
    if (existing) return NextResponse.json({ style: existing })
    await ensureUploadSchema()
    const upload = await createCloudflareUploadRepository().get(input.uploadId)
    if (!upload) return NextResponse.json({ error: 'Исходная презентация не найдена' }, { status: 404 })
    const file = await bucket.get(`visual/${upload.id}/manifest.json`)
    if (!file) return NextResponse.json({ error: 'Сначала завершите импорт дизайн-системы' }, { status: 409 })
    const visual = await file.json<VisualManifest>()
    const analyzed = upload.qwenStatus === 'analyzed' && upload.analysisObjectKey ? await bucket.get(upload.analysisObjectKey) : null
    const analysis = analyzed ? await analyzed.json<{ checkpoint?: CheckpointResult }>() : null
    await initializeCatalog(bucket, upload.id, visual.snapshot, analysis?.checkpoint?.result)
    const { system } = await sourceSystem(bucket, upload.id, visual.snapshot, analysis?.checkpoint?.result)
    const style = await addBankStyle(bucket, {
      id: upload.id, name: input.name ?? upload.fileName.replace(/\.pptx$/i, '').slice(0, 120), fileName: upload.fileName,
      sourceId: visual.snapshot.sourceId, createdAt: new Date().toISOString(), slideCount: visual.snapshot.slideCount,
      componentCount: system.summary.constructions, styleCount: system.summary.styles,
      previewId: visual.previews[0]?.id ?? null, colors: visual.snapshot.colors.slice(0, 6).map(c => c.hex), fonts: [...new Set(visual.snapshot.fonts.map(f => f.family))],
    })
    return NextResponse.json({ style }, { status: 201 })
  } catch (error) { return uploadCancellationResponse(error) ?? NextResponse.json({ error: 'Не удалось добавить дизайн-систему в банк. Импорт сохранён; попробуйте ещё раз.' }, { status: 400 }) }
}
