import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryBucket } from './helpers/memory-bucket'
import { initializeCatalog } from '../lib/design-system/catalog'
import { reconstructionState } from '../lib/design-system/reconstruction'
import { EDITABLE_VERSION, EDITABLE_COMPILER_VERSION } from '../lib/design-system/editable-contract'
import { RECONSTRUCTION_VERSION } from '../lib/design-system/reconstruction-contract'
import type { SourceSnapshot } from '../lib/digital-designer/source-types'
import { nativeDiagramFixture } from './fixtures/native-diagram'

test('an unrelated editable catalog addition keeps completed graphics while changed source geometry requires a new check', async () => {
  const { bucket } = memoryBucket(), fill = { type: 'solid', color: { r: 0, g: .5, b: 1, a: 1 } }, base = { rotation: 0, opacity: 1, visible: true, zIndex: 0 }
  const snapshot: SourceSnapshot = { schemaVersion: 1, sourceId: 'source', name: 'Diagram', slideCount: 1, assets: [], colors: [], fonts: [], limitations: [], slides: [{ id: 's1', number: 1, width: 300, height: 100, part: 'slide1', text: '', warnings: [] }], elements: [
    { id: 'a', name: 'a', slide: 1, kind: 'rectangle', properties: { ...base, bounds: { x: 0, y: 0, width: 60, height: 50 }, fill } },
    { id: 'b', name: 'b', slide: 1, kind: 'rectangle', properties: { ...base, bounds: { x: 200, y: 0, width: 60, height: 50 }, fill } },
    { id: 'edge', name: 'edge', slide: 1, kind: 'path', properties: { ...base, bounds: { x: 65, y: 25, width: 130, height: 0 }, pathData: 'M0 0 L130 0', windingRule: 'NONZERO', stroke: { paint: fill, width: 1 } } },
  ] }
  await initializeCatalog(bucket, 'test', snapshot)
  await bucket.put('visual/test/manifest.json', JSON.stringify({ snapshot }))
  const editable = { version: EDITABLE_VERSION, compilerVersion: EDITABLE_COMPILER_VERSION, id: 'original', sourceRevision: 'source', families: [{ id: 'diagram', variants: [{ id: 'diagram', name: 'Diagram', kind: 'diagram', slide: 1, sourceIds: ['a', 'b', 'edge'] }] }] }
  await bucket.put(`editable-systems/test/${EDITABLE_VERSION}/current.json`, JSON.stringify({ key: 'editable-base' }))
  await bucket.put('editable-base', JSON.stringify(editable))
  const initial = await reconstructionState(bucket, 'test')
  assert.equal(initial.pending.length, 1)
  const result = { id: initial.pending[0].id, name: 'Diagram', candidate: initial.pending[0], status: 'ready', reason: 'Checked', description: '', diagram: initial.pending[0].graph }
  const root = `reconstructions/test/${RECONSTRUCTION_VERSION}`
  await bucket.put(`${root}/${initial.revision}/results/${result.id}.json`, JSON.stringify(result))
  const completed = await reconstructionState(bucket, 'test')
  assert.equal(completed.completed, 1)
  await bucket.put('editable-base', JSON.stringify({ ...editable, id: 'added-an-unrelated-card' }))
  const resumed = await reconstructionState(bucket, 'test')
  assert.equal(resumed.pending.length, 0, 'A different catalog ID must not hide identical checked source graphics')
  assert.deepEqual(resumed.results, completed.results)
  assert.equal(resumed.catalog?.editableCatalogId, 'added-an-unrelated-card')
  assert.deepEqual((await (await bucket.get(`${root}/${initial.revision}/results/${result.id}.json`))!.json()), result)
  snapshot.elements[0].properties.fill = { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } }
  await bucket.put('visual/test/manifest.json', JSON.stringify({ snapshot }))
  assert.equal((await reconstructionState(bucket, 'test')).pending.length, 1, 'A changed diagram must not borrow a stale qualification')
})

test('an attached recovered diagram never becomes a second input candidate on the next read', async () => {
  const { bucket } = memoryBucket(), snapshot = nativeDiagramFixture()
  await initializeCatalog(bucket, 'test', snapshot)
  await bucket.put('visual/test/manifest.json', JSON.stringify({ snapshot }))
  await bucket.put(`editable-systems/test/${EDITABLE_VERSION}/current.json`, JSON.stringify({ key: 'editable-base' }))
  await bucket.put('editable-base', JSON.stringify({ version: EDITABLE_VERSION, compilerVersion: EDITABLE_COMPILER_VERSION, id: 'cards', sourceRevision: 'source', families: [] }))
  const initial = await reconstructionState(bucket, 'test')
  assert.equal(initial.pending.length, 1)
  const candidate = initial.pending[0]
  const result = { id: candidate.id, candidate, status: 'ready', diagram: candidate.graph, name: 'Scheme', description: '', reason: '' }
  await bucket.put(`reconstructions/test/${RECONSTRUCTION_VERSION}/${initial.revision}/results/${candidate.id}.json`, JSON.stringify(result))
  const completed = await reconstructionState(bucket, 'test'), next = await reconstructionState(bucket, 'test')
  assert.equal(next.pending.length, 0); assert.equal(next.total, 1)
  assert.equal(next.revision, completed.revision)
})
