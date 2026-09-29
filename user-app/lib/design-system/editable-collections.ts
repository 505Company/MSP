import type { EditableReply } from './editable-contract'
import type { SourceSnapshot } from '../digital-designer/source-types'
import { readSourceScene, type SceneRecord } from './source-scene'

/** Models sometimes label a row of metrics as one metric. Split it only when
 * native text and disjoint source panels prove the membership of every object.
 * The original reply remains immutable; ambiguous collections are not guessed. */
export function expandMetricCollections(reply: EditableReply, snapshot: SourceSnapshot): EditableReply {
  const scene = readSourceScene(snapshot), used = new Set(reply.slides.flatMap(s => s.blocks.map(b => b.id)))
  const text = (s: string) => s.replace(/\s+/g, '').toLocaleLowerCase()
  const contains = (a: SceneRecord, b: SceneRecord) => {
    // Native text line boxes can extend slightly past the painted panel. Allow
    // a bounded descent, while still requiring unambiguous panel ownership.
    const tolerance = b.element.kind === 'text' ? Math.max(2, Math.min(6, b.element.fontSize * .25)) : 2
    return b.bounds.x >= a.bounds.x - tolerance && b.bounds.y >= a.bounds.y - tolerance && b.bounds.x + b.bounds.width <= a.bounds.x + a.bounds.width + tolerance && b.bounds.y + b.bounds.height <= a.bounds.y + a.bounds.height + tolerance
  }
  return { ...reply, slides: reply.slides.map(slide => ({ ...slide, blocks: slide.blocks.flatMap(b => {
    // An explicit semantic plan belongs to this exact block. Never copy it to
    // newly split children with different source ownership.
    if (b.adaptation || b.kind !== 'metric' || b.memberIds.length || new Set(b.sourceIds).size !== b.sourceIds.length || b.data.value || (b.data.items?.length ?? 0) > 20 || (b.data.items?.length ?? 0) < 2 || b.sourceIds.some(id => scene.sources.get(id)?.slide !== slide.slide)) return [b]
    const selected = new Set(b.sourceIds)
    const leaves = [...scene.records.values()].filter(r => r.disposition === 'visible' && !('children' in r.element) && (selected.has(r.element.id) || r.ancestors.some(id => selected.has(id))))
    const anchors = b.data.items!.map(item => leaves.filter(r => r.element.kind === 'text' && item.value?.trim() && text(r.element.text) === text(item.value)))
    if (anchors.some(a => a.length !== 1) || new Set(anchors.map(a => a[0].element.id)).size !== anchors.length) return [b]
    const panels = anchors.map(([anchor]) => leaves.filter(r => r.element.kind !== 'text' && r.element.kind !== 'raster' && 'fill' in r.element && r.element.fill?.color?.a && contains(r, anchor) && anchors.filter(([a]) => contains(r, a)).length === 1).sort((a,c) => a.bounds.width * a.bounds.height - c.bounds.width * c.bounds.height)[0])
    if (panels.some(p => !p)) return [b]
    const membership = leaves.map(r => panels.flatMap((p,i) => contains(p,r) ? [i] : []))
    if (membership.some(m => m.length !== 1)) return [b]
    const children = anchors.map(([anchor], i) => {
      const members = leaves.filter((_,n) => membership[n][0] === i), captions = members.filter(r => r.element.kind === 'text' && r !== anchor).sort((a,c) => a.bounds.y-c.bounds.y || a.bounds.x-c.bounds.x)
      let id = `${b.id.slice(0,95)}-item-${i+1}`; while (used.has(id)) id += '-x'; used.add(id)
      return { ...b, id, name: 'Показатель', description: 'Ключевое значение с пояснением', sourceIds: members.map(r => r.element.id), memberIds: [], config: {}, data: { value: anchor.element.kind === 'text' ? anchor.element.text : '', items: captions.map(r => ({ text: r.element.kind === 'text' ? r.element.text : '' })) } }
    })
    return [...children, { ...b, kind: 'composition' as const, memberIds: children.map(c => c.id), data: {} }]
  }) })) }
}
