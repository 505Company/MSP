import { catalogLibrary, contentHash } from '../../lib/design-system/catalog'
import { componentUsage } from '../../lib/design-system/component-curation'
import { CALIBRATION_VERSION, QUALIFICATION_VERSION, FUNCTIONAL_SELECTION_VERSION, type CalibratedCatalog } from '../../lib/design-system/calibration-contract'
/** Isolated fixture for Q3/Q4 tests. This does not run or claim browser qualification. */
export async function seedQualifiedCatalogFixture(bucket: R2Bucket, uploadId: string) {
  const source = (await catalogLibrary(bucket, uploadId))!
  const id = await contentHash({ fixture: true, catalogId: source.catalogId })
  const catalog: CalibratedCatalog = { id, version: CALIBRATION_VERSION, qualificationVersion: QUALIFICATION_VERSION, functionalVersion: FUNCTIONAL_SELECTION_VERSION, catalogId: source.catalogId, createdAt: '2026-09-25T00:00:00Z',
    sourceCount: source.library.components.length, qualifiedCount: source.library.components.length, excluded: [], modelRunIds: [], liveRequests: 0, cacheHits: 0,
    families: source.library.components.map(c => ({ id: 'test-family-' + c.id, kind: c.kind, name: c.name, ...componentUsage(c), parameters: c.slots.map(s => s.label), memberIds: [c.id], representativeId: c.id,
      variants: [{ id: c.id, label: 'Fixture variant', memberIds: [c.id], fields: [] }], occurrenceIds: [c.id], slides: [c.source.slide] })) }
  const prefix = `component-calibration/${uploadId}/${source.catalogId}/${CALIBRATION_VERSION}`
  await bucket.put(`${prefix}/catalogs/${id}.json`, JSON.stringify(catalog))
  await bucket.put(`${prefix}/current.json`, JSON.stringify({ id }))
}
