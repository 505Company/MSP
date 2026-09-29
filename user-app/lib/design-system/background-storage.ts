import { catalogLibrary } from './catalog'
import { readReconstructionCatalog } from './reconstruction'
import { buildBackgroundCatalog } from './backgrounds'
import { readEditableCatalog } from './editable-analysis'
import type { VisualManifest } from '../digital-designer/visual-package'

export async function readBackgroundCatalog(bucket: R2Bucket, uploadId: string) {
  const [file, catalog] = await Promise.all([bucket.get(`visual/${uploadId}/manifest.json`), catalogLibrary(bucket, uploadId)])
  if (!file || !catalog) throw Error('Сначала завершите импорт дизайн-системы')
  const visual = await file.json<VisualManifest>(), reconstruction = await readReconstructionCatalog(bucket, uploadId, catalog.catalogId),editable=await readEditableCatalog(bucket,uploadId,catalog.catalogId)
  return buildBackgroundCatalog(visual.snapshot, catalog.library, catalog.catalogId, reconstruction?.results,editable?.families.flatMap(f=>f.variants.flatMap(t=>t.sourceIds)))
}
