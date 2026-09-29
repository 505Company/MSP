import type { ElementIR } from '../../vendor/drag/src/core/model'
import { nativeDiagramFixture } from './native-diagram'
const base = { rotation: 0, opacity: 1, visible: true, zIndex: 1 }
const paint = { type: 'solid' as const, color: { r: .7, g: .2, b: .4, a: 1 } }
export function nativeTimelineFixture(mode: 'arrows' | 'spine') {
 const snapshot = nativeDiagramFixture(); snapshot.elements = []; snapshot.slides[0].width = 700; snapshot.slides[0].height = 250
 const roots: ElementIR[] = []
 const text = (id: string, x: number, y: number, value: string, width: number, size: number): ElementIR => ({ ...base, id, name: 'Label', kind: 'text', text: value, fontFamily: 'Play', fontSize: size, bounds: { x, y, width, height: size * 1.6 }, colorRuns: [{ start: 0, end: value.length, fill: paint }] })
 for (let i = 0; i < 3; i++) {
  const x = 30 + i * 220
  roots.push(text(`label-${i}`, x, 30, `Phase ${i + 1}`, 160, 24), text(`body-${i}`, x, 140, 'Details', 180, 16))
  if (mode === 'spine') roots.push({ ...base, id: `dot-${i}`, name: 'Milestone', kind: 'ellipse', bounds: { x: x + 75, y: 98, width: 10, height: 10 }, fill: paint })
  if (mode === 'arrows' && i < 2) roots.push({ ...base, id: `edge-${i}`, name: 'Connection', kind: 'group', bounds: { x: x + 160, y: 48, width: 55, height: .01 }, children: [
   { ...base, id: `line-${i}`, name: 'Line', kind: 'path', bounds: { x: 0, y: 0, width: 55, height: 0 }, pathData: 'M 0 0 L 55 0', windingRule: 'NONZERO', stroke: { paint, width: 1.5 } },
   { ...base, id: `head-${i}`, name: 'Arrowhead', kind: 'path', bounds: { x: 51, y: -3, width: 4, height: 6 }, pathData: 'M 0 0 L 4 3 L 0 6 Z', windingRule: 'NONZERO', fill: paint },
  ] })
 }
 if (mode === 'spine') roots.push({ ...base, id: 'spine', name: 'Axis', kind: 'path', bounds: { x: 0, y: 103, width: 700, height: 0 }, pathData: 'M 0 0 L 700 0', windingRule: 'NONZERO', stroke: { paint, width: 1 } })
 const add = (e: ElementIR, parentId?: string) => { snapshot.elements.push({ id: e.id, name: e.name, kind: e.kind, slide: 1, parentId, properties: { ...e, ...('children' in e ? { children: undefined } : {}) } }); if ('children' in e) e.children.forEach(c => add(c, e.id)) }
 roots.forEach(e => add(e)); return snapshot
}
