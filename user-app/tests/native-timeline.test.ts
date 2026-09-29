import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeTimelineFixture } from './fixtures/native-timeline'
import { memoryBucket } from './helpers/memory-bucket'
import { initializeCatalog } from '../lib/design-system/catalog'
import { reconstructionState } from '../lib/design-system/reconstruction'
import { EDITABLE_VERSION, EDITABLE_COMPILER_VERSION } from '../lib/design-system/editable-contract'
import { graphElements } from '../lib/design-system/diagram-graph'
import { flatten } from '../lib/design-system/compiler'
import type { SourceSnapshot } from '../lib/digital-designer/source-types'
import { attachReconstructedDiagrams } from '../lib/design-system/reconstruction-resources'
import { renderEditableHtml } from '../lib/design-system/editable-render'
import { labCatalog } from '../component-lab/fixtures'
import type { ReconstructionCatalog } from '../lib/design-system/reconstruction-contract'
import { nativeTimelineGraph } from '../lib/design-system/timeline-native'
import { readSourceScene } from '../lib/design-system/source-scene'
async function discover(snapshot: SourceSnapshot) {
 const { bucket } = memoryBucket()
 await initializeCatalog(bucket, 'test', snapshot)
 await bucket.put('visual/test/manifest.json', JSON.stringify({ snapshot }))
 await bucket.put(`editable-systems/test/${EDITABLE_VERSION}/current.json`, JSON.stringify({ key: 'editable' }))
 await bucket.put('editable', JSON.stringify({ version: EDITABLE_VERSION, compilerVersion: EDITABLE_COMPILER_VERSION, id: 'catalog', sourceRevision: 'source', families: [{ id: 'timeline', variants: [{ id: 'timeline', name: 'Timeline', kind: 'timeline', slide: 1, sourceIds: snapshot.elements.map(e => e.id) }] }] }))
 return (await reconstructionState(bucket, 'test')).pending.filter(c => c.graph)
}
for (const mode of ['arrows', 'spine'] as const) test(`native ${mode} timeline reaches graph qualification and keeps all source content`, async () => {
 const snapshot = nativeTimelineFixture(mode), found = await discover(snapshot)
 assert.equal(found.length, 1)
 const graph = found[0].graph!
 assert.equal(graph.nodes.filter(n => n.kind === 'block').length, 3)
 assert.equal(graph.edges.length, mode === 'arrows' ? 2 : 4)
 assert.deepEqual(graphElements(graph), graph.sourceElements)
 const node = graph.nodes.find(n => n.kind === 'block')!
 const moved = graphElements(graph, { nodes: { [node.id]: { x: node.bounds.x + 5 } } })
 assert.deepEqual(flatten(moved).filter(e => e.kind === 'text').map(e => e.text).sort(), snapshot.elements.filter(e => e.kind === 'text').map(e => e.properties.text).sort())
 assert.ok(graph.edges.every(e => e.arrow === (mode === 'arrows' ? 'end' : 'none')))
})
test('a row of labels, a decorative line, missing arrow or ambiguous marker does not invent a timeline', async () => {
 for (const mode of ['arrows', 'spine'] as const) {
  const source = nativeTimelineFixture(mode)
  source.elements = source.elements.filter(e => mode === 'arrows' ? !['edge-1','line-1','head-1'].includes(e.id) : !e.id.startsWith('dot-'))
  assert.equal((await discover(source)).length, 0)
 }
 const source = nativeTimelineFixture('spine'); source.elements.find(e => e.id === 'dot-1')!.properties.bounds = { x: 105, y: 98, width: 10, height: 10 }
 assert.equal((await discover(source)).length, 0)
})
test('attaching a recovered graph binds new data to exact native text IDs, including repeated labels', async () => {
 const [candidate] = await discover(nativeTimelineFixture('spine')), catalog = labCatalog(), t = catalog.families[0].variants[0]
 t.id = 'timeline'; t.kind = 'timeline'; delete t.sourceLayout
 t.data = { items: [{ title: 'Phase 1', text: 'Details' }, { title: 'Phase 2', text: 'Details' }, { title: 'Phase 3', text: 'Details' }] }
 const recovery = { editableCatalogId: catalog.id, results: [{ id: candidate.id, status: 'ready', candidate, diagram: candidate.graph }] } as ReconstructionCatalog
 attachReconstructedDiagrams(catalog, recovery, 'test')
 assert.equal(t.data.items?.length, 6)
 assert.equal(new Set(t.data.items!.map(i => i.id)).size, 6)
 const data = { items: t.data.items!.map((i, n) => ({ ...i, text: `New ${n}` })) }
 const html = renderEditableHtml(t, data).replace(/<[^>]*>/g, '')
 for (const i of data.items) assert.ok(html.includes(i.text))
 assert.doesNotMatch(html, /Details|Phase/)
 assert.equal(t.width, candidate.graph!.width)
})
test('a dark source surface informs the preview without baking a rectangle into the reusable graph', () => {
 const snapshot = nativeTimelineFixture('spine'), sourceIds = snapshot.elements.map(e => e.id)
 snapshot.elements.push({ id: 'background', name: 'Slide background', kind: 'rectangle', slide: 1, properties: { bounds: { x: 0, y: 0, width: 700, height: 250 }, visible: true, rotation: 0, opacity: 1, zIndex: 0, fill: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } } } })
 const graph = nativeTimelineGraph(readSourceScene(snapshot), sourceIds)!
 assert.equal(graph.sourceSurface, '#000000')
 assert.ok(!flatten(graphElements(graph)).some(e => e.id === 'background'))
})
