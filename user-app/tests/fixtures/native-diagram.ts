import type { ElementIR } from '../../vendor/drag/src/core/model'
import type { SourceSnapshot } from '../../lib/digital-designer/source-types'
const base = { rotation: 0, opacity: 1, visible: true, zIndex: 1 }, paint = { type: 'solid' as const, color: { r: 0, g: .5, b: 1, a: 1 } }
export function nativeDiagramFixture(): SourceSnapshot {
  const roots: ElementIR[] = [
    { ...base, id: 'a', name: 'Block A', kind: 'rectangle', bounds: { x: 0, y: 0, width: 60, height: 50 }, fill: paint },
    { ...base, id: 'b', name: 'Block B', kind: 'rectangle', bounds: { x: 200, y: 0, width: 60, height: 50 }, fill: paint },
    { ...base, id: 'edge', name: 'Connector', kind: 'group', bounds: { x: 65, y: 25, width: 130, height: .01 }, children: [
      { ...base, id: 'line', name: 'Line', kind: 'path', bounds: { x: 0, y: 0, width: 130, height: .01 }, pathData: 'M0 0 L130 0', windingRule: 'NONZERO', stroke: { paint, width: 1 } },
      { ...base, id: 'head', name: 'Arrowhead', kind: 'path', bounds: { x: 126, y: -3, width: 6, height: 6 }, pathData: 'M0 0 L6 3 L0 6 Z', windingRule: 'NONZERO', fill: paint },
    ] },
  ]
  const snapshot: SourceSnapshot = { schemaVersion: 1, sourceId: 'source', name: 'Diagram', slideCount: 1, assets: [], colors: [], fonts: [], limitations: [], slides: [{ id: 's1', number: 1, width: 300, height: 100, part: 'slide1', text: '', warnings: [] }], elements: [] }
  const add = (element: ElementIR, parentId?: string) => { snapshot.elements.push({ id: element.id, name: element.name, kind: element.kind, slide: 1, parentId, properties: { ...element, ...('children' in element ? { children: undefined } : {}) } }); if ('children' in element) element.children.forEach(e => add(e, element.id)) }
  roots.forEach(e => add(e)); return snapshot
}
