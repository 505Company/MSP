import { NextResponse } from 'next/server'
import { objectBucket } from '@/lib/uploads/cloudflare-repository'
import { assertUploadActive, uploadCancellationResponse } from '@/lib/uploads/cancellation-server'
import { readScanRun } from '@/lib/design-system/semantic-scan'
import { readEditableCatalog } from '@/lib/design-system/editable-analysis'
import { readCalibrationOmissions } from '@/lib/design-system/calibration'
import { importIssueView, reconstructionOmissions } from '@/lib/design-system/import-issues'
import { readReconstructionCatalog } from '@/lib/design-system/reconstruction'
import { sourceReadOmissions } from '@/lib/design-system/source-availability'
import type { VisualManifest } from '@/lib/digital-designer/visual-package'

export const dynamic = 'force-dynamic'
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  try {
    const bucket = objectBucket(); await assertUploadActive(bucket, id)
    const [scan, editable, calibration, graphics] = await Promise.all([readScanRun(bucket, id), readEditableCatalog(bucket, id), readCalibrationOmissions(bucket, id), readReconstructionCatalog(bucket, id)])
    const source = await bucket.get(`visual/${id}/manifest.json`)
    const sourceIssues = source ? sourceReadOmissions((await source.json<VisualManifest>()).snapshot) : []
    return NextResponse.json(importIssueView([...sourceIssues, ...scan?.omissions ?? [], ...editable?.omissions ?? [], ...calibration, ...reconstructionOmissions(graphics)], editable), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return uploadCancellationResponse(error) ?? NextResponse.json({ error: 'Не удалось прочитать список пропущенных элементов' }, { status: 503 })
  }
}
