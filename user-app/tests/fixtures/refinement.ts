import { nativeLayoutFixture } from './native-layout'
import { compileEditableSlides } from '../../lib/design-system/editable-analysis'
import { EDITABLE_VERSION, EDITABLE_COMPILER_VERSION, type EditableCatalog, type EditableReply } from '../../lib/design-system/editable-contract'
import { HTML_QUALIFICATION_VERSION, type HtmlQualification } from '../../lib/design-system/editable-qualification'
import type { VisualManifest } from '../../lib/digital-designer/visual-package'
import { memoryBucket } from '../helpers/memory-bucket'
import { contentHash } from '../../lib/design-system/catalog'

export const refinementConfig = { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', timeoutMs: 3000 }
export function passingReport(catalog: EditableCatalog): HtmlQualification {
  return { version: HTML_QUALIFICATION_VERSION, catalogId: catalog.id, checks: catalog.families.flatMap(f => f.variants).map(t => ({ id: t.id, passed: true, source: true, changed: true, issues: [] })) }
}
export async function refinementFixture() {
  const { bucket, data } = memoryBucket(), { snapshot, proposal } = nativeLayoutFixture('metric'), id = 'refinement-test'
  snapshot.slides[0].width = 2000
  snapshot.elements.push(...snapshot.elements.map(e => ({ ...structuredClone(e), id: e.id + '-second', properties: { ...e.properties, bounds: { ...(e.properties.bounds as object), x: Number((e.properties.bounds as { x: number }).x) + 950 } } })))
  const first = { ...proposal, id: 'original' }, second = { ...proposal, id: 'missing', sourceIds: proposal.sourceIds.map(id => id + '-second') }
  const visual: VisualManifest = { renderer: 'msp-web-2026-09-25', previewKind: 'reconstruction', snapshot, assets: [], sheets: [], previews: [{ id: 's01', mime: 'image/png' }] }
  const compiled = await compileEditableSlides(snapshot, [{ slide: 1, blocks: [first], note: '' }], id)
  const base: EditableCatalog = { ...compiled, version: EDITABLE_VERSION, compilerVersion: EDITABLE_COMPILER_VERSION, id: 'b'.repeat(64), catalogId: 'c'.repeat(64), sourceRevision: await contentHash({ version: EDITABLE_VERSION, snapshot, catalogId: 'c'.repeat(64) }), createdAt: new Date().toISOString(), modelRunIds: ['original-model-run'], liveRequests: 1 }
  base.qualification = passingReport(base)
  const baseKey = `editable-systems/${id}/${EDITABLE_VERSION}/base.json`
  await bucket.put(baseKey, JSON.stringify(base)); await bucket.put(`editable-systems/${id}/${EDITABLE_VERSION}/current.json`, JSON.stringify({ key: baseKey }))
  await bucket.put(`visual/${id}/manifest.json`, JSON.stringify(visual)); await bucket.put(`visual/${id}/preview-s01`, new Uint8Array([137,80,78,71]))
  const reply: EditableReply = { slides: [{ slide: 1, blocks: [second], note: 'Пропущенный показатель' }] }
  return { bucket, data, id, base, baseKey, visual, first, second, reply }
}
