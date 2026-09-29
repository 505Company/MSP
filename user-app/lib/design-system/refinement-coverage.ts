import type { SourceSnapshot } from '../digital-designer/source-types'
import type { EditableCatalog, EditableTemplate } from './editable-contract'
import { readSourceScene, type SourceScene } from './source-scene'
import { sourceMembers } from './editable-structure'
import type { RefinementCoverage, RefinementRegion } from './refinement-contract'
import { unavailableSourceSlides } from './source-availability'

export const catalogTemplates = (catalog: EditableCatalog) => catalog.families.flatMap(f => f.variants)
export function sourceSignature(template: EditableTemplate, scene: SourceScene) {
  const ids = sourceMembers(template.sourceIds, scene).filter(r => !('children' in r.element)).map(r => r.element.id).sort()
  return `${template.kind}:${ids.join(',')}${template.sourceRegion ? ':' + JSON.stringify(template.sourceRegion.region) : ''}`
}
export function refinementCoverage(snapshot: SourceSnapshot, catalog: EditableCatalog, reviewed: Set<number> = new Set()): RefinementCoverage[] {
  const scene = readSourceScene(snapshot), templates = catalogTemplates(catalog)
  const passed = new Set(catalog.qualification?.checks.filter(c => c.passed).map(c => c.id))
  const represented = new Set(templates.filter(t => passed.has(t.id)).flatMap(t => sourceMembers(t.sourceIds, scene).map(r => r.element.id)))
  const unavailable = new Set(unavailableSourceSlides(snapshot).map(s=>s.number))
  return snapshot.slides.filter(s=>!unavailable.has(s.number)).map(slide => {
    const visible = [...scene.records.values()].filter(r => r.source.slide === slide.number && r.disposition === 'visible' && ((!('children' in r.element) && !r.tableId) || r.tableId === r.element.id))
    // Graphics and backgrounds can legitimately belong to other sections.
    // A covered coarse diagram still needs a semantic inspection.
    const ledger = catalog.coverage.find(c => c.slide === slide.number)?.objects
    const unresolved = [...ledger?.unresolved ?? [], ...ledger?.unassigned ?? []].filter(id => scene.records.get(id)?.disposition === 'visible' && !represented.has(id))
    const unassigned = [...new Set([...unresolved, ...visible.filter(r => r.element.kind === 'text' && r.element.text.trim() && !represented.has(r.element.id)).map(r => r.element.id)])]
    const broad = templates.filter(t => t.slide === slide.number && t.kind === 'diagram' && sourceMembers(t.sourceIds, scene).filter(r => r.element.kind === 'text').length >= 3).map(t => t.id)
    return { slide: slide.number, visible: visible.length, represented: visible.filter(r => represented.has(r.element.id)).length, unassigned, broad, reviewed: reviewed.has(slide.number) }
  })
}
export function regionSources(snapshot: SourceSnapshot, slideNumber: number, region: RefinementRegion) {
  const slide = snapshot.slides.find(s => s.number === slideNumber)
  if (!slide) throw Error('Исходный слайд не найден')
  const box = { x: region.x * slide.width, y: region.y * slide.height, width: region.width * slide.width, height: region.height * slide.height }, scene = readSourceScene(snapshot)
  const selected = [...scene.records.values()].filter(r => {
    if (r.source.slide !== slideNumber || r.disposition !== 'visible' || r.tableId !== r.element.id && ('children' in r.element || r.tableId)) return false
    const b = r.bounds, area = Math.max(0, Math.min(box.x + box.width, b.x + b.width) - Math.max(box.x, b.x)) * Math.max(0, Math.min(box.y + box.height, b.y + b.height) - Math.max(box.y, b.y))
    // A fragment of a slide-sized image still has real source evidence.
    return area > 0 && (area >= b.width * b.height * .5 || r.element.kind === 'raster' && area >= box.width * box.height * .5)
  }).map(r => r.element.id)
  if (!selected.length) throw Error('В области нет доступных исходных объектов. Выделите блок целиком.')
  if (selected.length > 250) throw Error('В области слишком много объектов. Выделите отдельный блок.')
  return selected
}
