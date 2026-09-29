import type { SourceSnapshot } from '../digital-designer/source-types'
import { readSourceScene, neutralContainer } from './source-scene'
import type { ScanBatch, SourceSystem } from './source-system'
import { unavailableSourceSlides } from './source-availability'

export const SCAN_VERSION = 'web-semantic-scan-1'

/** Preserve whole slides and source groups where they fit. Raw path commands
 * never decide semantic batch size; exact properties stay in the snapshot. */
export function planSemanticScan(snapshot: SourceSnapshot, system: SourceSystem) {
  const scene = readSourceScene(snapshot)
  const unavailable = new Set(unavailableSourceSlides(snapshot).map(s => s.number))
  const omitted = new Set([...scene.records.values()].filter(r => neutralContainer(r.element)).map(r => r.element.id))
  const byStyle = new Map<string, string[]>()
  for (const style of system.styles) for (const o of style.occurrences) {
    const ids = byStyle.get(o.elementId) ?? []; if (!ids.includes(style.id)) ids.push(style.id); byStyle.set(o.elementId, ids)
  }
  const nodeFor = (id: string): ScanBatch['nodes'][number] => {
    const r = scene.records.get(id)!
    return { id, parentId: r.source.parentId, slide: r.source.slide, kind: r.element.kind, properties: r.source.properties, styleIds: byStyle.get(id) ?? [] }
  }
  const candidates = [...scene.records.values()].filter(r => !unavailable.has(r.source.slide) && r.disposition === 'visible' && !r.tableId && !omitted.has(r.element.id))
  const batches: ScanBatch[] = [], pending: { elementId: string; reason: string }[] = []
  const compactBytes = (ids: string[]) => new TextEncoder().encode(JSON.stringify(ids.map(id => {
    const r = scene.records.get(id)!, e = r.element
    return { id, parentId: r.source.parentId, bounds: r.bounds, kind: e.kind, name: e.name, text: e.kind === 'text' ? e.text : null, styles: byStyle.get(id) }
  }))).length
  const eligible = new Set(candidates.map(r => r.element.id))
  const groups = [...omitted].map(id => ({ id, parts: (scene.children.get(id) ?? []).flatMap(function expand(n): string[] {
    return omitted.has(n.id) ? (scene.children.get(n.id) ?? []).flatMap(expand) : eligible.has(n.id) ? [n.id] : []
  }) })).filter(g => g.parts.length > 1)
  const make = (ids: string[]): ScanBatch => {
    const own = new Set(ids), context = [...new Set(ids.flatMap(id => scene.records.get(id)!.ancestors))].filter(id => !own.has(id))
    return { id: `scan-${batches.length + 1}`, bytes: compactBytes(ids), nodes: ids.map(nodeFor), context: context.map(nodeFor), sourceGroups: groups.filter(g => g.parts.every(id => own.has(id))) }
  }
  let current: string[] = []
  const fits = (ids: string[]) => ids.length <= 80 && new Set(ids.map(id => scene.sources.get(id)!.slide)).size <= 3 && compactBytes(ids) <= 26000
  const flush = () => { if (current.length) batches.push(make(current)); current = [] }
  const append = (ids: string[]) => { if (current.length && !fits([...current, ...ids])) flush(); current.push(...ids) }
  for (const slide of snapshot.slides) {
    const ids = candidates.filter(r => r.source.slide === slide.number).map(r => r.element.id)
    if (!ids.length) continue
    if (fits(ids)) { append(ids); continue }
    flush()
    const left = new Set(ids)
    for (const id of ids) {
      if (!left.has(id)) continue
      if (!fits([id])) { pending.push({ elementId: id, reason: 'Полный текст превышает размер одного запроса; источник сохранён.' }); left.delete(id); continue }
      // Largest fitting native group containing this object; keep its clipping
      // parent and graphic descendants together rather than splitting paths.
      const roots = [...scene.records.get(id)!.ancestors, id]
      const unit = roots.map(root => ids.filter(n => left.has(n) && (n === root || scene.records.get(n)!.ancestors.includes(root))))
        .find(group => group.includes(id) && fits(group)) ?? [id]
      append(unit); unit.forEach(n => left.delete(n))
    }
    flush()
  }
  flush()
  const suppliedIds = batches.flatMap(b => b.nodes.map(n => n.id))
  if (new Set(suppliedIds).size !== suppliedIds.length || suppliedIds.length + pending.length !== candidates.length) throw new Error('Неполная карта семантического разбора')
  const owner = new Map(batches.flatMap(b => b.nodes.map(n => [n.id, b.id] as const)))
  // A complete, bounded cross-boundary block is assessed once more with all
  // parts present. Oversized graphic boards are retained, never merged blindly.
  const boundaries = groups.filter(g => g.parts.length <= 12 && new Set(g.parts.map(id => owner.get(id))).size > 1 && g.parts.every(id => owner.has(id)))
  for (const g of boundaries) {
    const ids = [...new Set(g.parts.flatMap(id => [id, ...candidates.filter(r => r.ancestors.includes(id)).map(r => r.element.id)]))]
    if (fits(ids)) { const batch = make(ids); batch.id = `boundary-${batches.filter(b => b.id.startsWith('boundary-')).length + 1}`; batches.push(batch) }
  }
  return { batches, pending: [...pending, ...snapshot.elements.filter(e => unavailable.has(e.slide)).map(e => ({ elementId: e.id, reason: 'Неполностью прочитанный слайд; исходные объекты сохранены без предположений об их структуре.' }))], suppliedIds,
    omittedContainerIds: [...omitted].filter(id => !unavailable.has(scene.records.get(id)!.source.slide)),
    retainedTableIds: system.scan.retainedTableIds.filter(id => !unavailable.has(scene.sources.get(id)!.slide)) }
}
