import type { ElementIR } from '../../vendor/drag/src/core/model'
import type { SourceSnapshot } from '../../lib/digital-designer/source-types'
import type { ComponentDefinition, ComponentLibrary } from '../../lib/design-system/types'

const base = { rotation: 0, visible: true, opacity: 1, zIndex: 0 }
export function backgroundFixture() {
  const fill: ElementIR = { ...base, id: 'bg', name: 'Slide background', kind: 'rectangle', bounds: { x: 0, y: 0, width: 800, height: 450 }, fill: { type: 'solid', color: { r: 0, g: .2, b: .8, a: 1 } } }
  const art: ElementIR = { ...base, id: 'mask', name: 'Pattern', kind: 'group', zIndex: 2, bounds: { x: 600, y: 0, width: 200, height: 450 }, clipsContent: true, children: [{ ...base, id: 'raster', name: 'Picture', kind: 'raster', bounds: { x: -20, y: -10, width: 240, height: 480 }, assetId: 'image', reason: 'source' }] }
  const snapshot: SourceSnapshot = { schemaVersion: 1, sourceId: 'source', name: 'Backgrounds', slideCount: 1, slides: [{ id: 's1', number: 1, width: 800, height: 450, part: '', text: '', warnings: [] }], elements: [
    { id: fill.id, name: fill.name, kind: fill.kind, slide: 1, properties: fill as unknown as Record<string, unknown> },
    { id: art.id, name: art.name, kind: art.kind, slide: 1, properties: { ...art, children: undefined } },
    { id: 'raster', name: 'Picture', kind: 'raster', slide: 1, parentId: 'mask', properties: art.children[0] as unknown as Record<string, unknown> },
  ], assets: [{ id: 'image', mime: 'image/png', byteLength: 1, origins: [] }], colors: [], fonts: [], limitations: [] }
  const component: ComponentDefinition = { id: 'c', name: 'Pattern', kind: 'compound', scene: { width: 200, height: 450, elements: [{ ...structuredClone(art), bounds: { ...art.bounds, x: 0, y: 0 } }] }, source: { slide: 1, rootId: 'mask', elementIds: ['mask', 'raster'], ancestorIds: [], assetIds: ['image'] }, slots: [], fixedTextIds: [], issues: [], semantics: [{ findingId: 'f', name: 'Pattern', role: 'decoration', basis: 'observed' }] }
  const library: ComponentLibrary = { schemaVersion: 1, compilerVersion: 'test', sourceId: 'source', name: 'Test', tokens: { colors: [], fonts: [] }, components: [component], excluded: [], notes: [] }
  return { snapshot, library, fill, art }
}
