import type { SourceScene } from './source-scene'

export function recognitionObjects(scene: SourceScene, number: number, nativeIds: string[]) {
  const slide = scene.slides.find(s => s.number === number)!
  return [...scene.records.values()].filter(r => {
    if (r.source.slide !== number || r.disposition !== 'visible') return false
    if (nativeIds.includes(r.element.id)) return true
    if (r.ancestors.some(id => nativeIds.includes(id))) return false
    const ref = [r.element, ...r.ancestors.map(id => scene.records.get(id)!.element)].find(e => e.sourceRef)?.sourceRef
    if (ref && ref.part !== slide.part) return false
    return !('children' in r.element) || r.element.children.some(e => e.kind === 'raster')
  })
}

// Bound how many objects compete for one recognition response. This is a
// discovery setting, not a limit on the number of admitted components.
export const EDITABLE_DISCOVERY_LIMITS = { objects: 80, textFields: 30, textCharacters: 3600 } as const
export function editablePacketIsDense(scene: SourceScene, slides: number[]) {
  if (slides.length < 2) return false
  const selected = new Set(slides)
  const leaves = [...scene.records.values()].filter(r => selected.has(r.source.slide) && r.disposition === 'visible' && !('children' in r.element) && !r.tableId)
  const texts = leaves.filter(r => r.element.kind === 'text')
  return leaves.length > EDITABLE_DISCOVERY_LIMITS.objects || texts.length > EDITABLE_DISCOVERY_LIMITS.textFields || texts.reduce((sum, r) => sum + (r.element.kind === 'text' ? r.element.text.length : 0), 0) > EDITABLE_DISCOVERY_LIMITS.textCharacters
}
