import { editableReplySchema, type EditableReply, type EditableTemplate } from './editable-contract'
import { sourceCoverage } from './component-intent'
import { recognitionObjects } from './editable-discovery'
import { readSourceScene } from './source-scene'
import type { SourceSnapshot } from '../digital-designer/source-types'
import type { validateRecognitionReply } from './editable-analysis'
import type { ImportOmission } from './semantic-isolation'
import { SemanticValidationError } from './semantic-contract'

/** Recover independently valid blocks after a rejected model answer. Failed
 * fields/relations are never repaired by inventing an adaptive profile. */
export function isolateEditableReply(raw: unknown, snapshot: SourceSnapshot, slides: number[], native: EditableTemplate[], validate: typeof validateRecognitionReply) {
  const scene = readSourceScene(snapshot), reply: EditableReply = { slides: [] }, omissions: ImportOmission[] = []
  const source = raw && typeof raw === 'object' && 'slides' in raw && Array.isArray(raw.slides) ? raw.slides : []
  for (const slide of slides) {
    const originals = source.filter(s => s && typeof s === 'object' && s.slide === slide)
    const original = originals.length === 1 ? originals[0] : null
    const supplied = recognitionObjects(scene, slide, native.filter(t => t.slide === slide).flatMap(t => t.sourceIds)).map(r => r.element.id)
    const emptyRoles = () => ({ background: [] as string[], decoration: [] as string[], context: [] as string[], unresolved: [] as string[] })
    const item: EditableReply['slides'][number] = { slide, blocks: [], objectRoles: emptyRoles(), note: typeof original?.note === 'string' ? original.note.slice(0, 4000) : '' }
    const deferred = new Set<string>()
    const skip = (entry: unknown, reason: string) => {
      const data = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      const selected = new Set(Array.isArray(data.sourceIds) ? data.sourceIds.filter(id => typeof id === 'string' && scene.records.get(id)?.source.slide === slide) : [])
      const ids = supplied.filter(id => selected.has(id) || scene.records.get(id)?.ancestors.some(parent => selected.has(parent)))
      ids.forEach(id => deferred.add(id))
      omissions.push({ name: typeof data.name === 'string' ? data.name.slice(0, 120) : 'Неразобранная конструкция', elementIds: ids, slides: [slide], reason })
    }
    if (!original || !Array.isArray(original.blocks) || original.blocks.length > 100) {
      omissions.push({ name: 'Конструкции слайда', elementIds: supplied, slides: [slide], reason: 'Ответ для этого слайда не удалось проверить. Исходные объекты сохранены.' })
    } else {
      const ordered: unknown[] = [...original.blocks].sort((a, b) => Number(a?.kind === 'composition') - Number(b?.kind === 'composition'))
      for (const entry of ordered) {
        const parsed = editableReplySchema.shape.slides.element.shape.blocks.element.safeParse(entry)
        if (!parsed.success) { skip(entry, 'Формат конструкции не прошёл проверку. Исходные объекты сохранены.'); continue }
        const candidate = { ...item, blocks: [...item.blocks, parsed.data], objectRoles: emptyRoles() }
        candidate.objectRoles.unresolved = sourceCoverage(candidate, supplied, scene).unassigned
        try { item.blocks = validate({ slides: [candidate] }, snapshot, [slide], native).slides[0].blocks }
        catch (error) {
          if (!(error instanceof SemanticValidationError)) throw error
          skip(entry, 'Состав, данные или адаптивные поля не прошли проверку. Другие компоненты продолжают создаваться.')
        }
      }
    }
    // Do not keep an ambiguous instance simply because it appeared first.
    item.blocks = item.blocks.filter(b => !sourceCoverage({ blocks: [b] }, supplied, scene).covered.some(id => deferred.has(id)))
    item.blocks = item.blocks.filter(b => b.kind !== 'composition' || b.memberIds.every(id => item.blocks.some(child => child.id === id && child.kind !== 'composition')))
    const roles = editableReplySchema.shape.slides.element.shape.objectRoles.safeParse(original?.objectRoles)
    if (roles.success && roles.data && !sourceCoverage({ ...item, objectRoles: roles.data }, supplied, scene).issues.length) item.objectRoles = roles.data
    else if (original?.objectRoles) omissions.push({ name: 'Назначение объектов', elementIds: supplied, slides: [slide], reason: 'Роли части объектов противоречат друг другу. Неопределённые объекты сохранены отдельно.' })
    const coverage = sourceCoverage(item, supplied, scene)
    // A failed block cannot become an accepted decoration through a conflicting role.
    const deferredUncovered = [...deferred].filter(id => !coverage.covered.includes(id))
    for (const role of ['background', 'decoration', 'context'] as const) item.objectRoles![role] = item.objectRoles![role].filter(id => !sourceCoverage({ blocks: [], objectRoles: { ...emptyRoles(), [role]: [id] } }, supplied, scene)[role].some(child => deferredUncovered.includes(child)))
    item.objectRoles!.unresolved = [...new Set([...item.objectRoles!.unresolved, ...sourceCoverage(item, supplied, scene).unassigned])]
    item.note = [item.note, 'Неподтверждённые конструкции пропущены; исходные объекты сохранены.'].filter(Boolean).join(' ').slice(0, 4000)
    reply.slides.push(item)
  }
  return { reply: validate(reply, snapshot, slides, native), omissions }
}
