import type { EditableCatalog, EditableTemplate } from '../design-system/editable-contract'
import type { VisualManifest } from '../digital-designer/visual-package'
import { neutralContainer, readSourceScene, type SourceScene } from '../design-system/source-scene'
import { normalizedText } from '../design-system/editable-native-layout'
import { sourceCandidate } from './source'

/** Legacy text templates predate native sourceLayout. Reconstruct a separate
 * working view from their exact object IDs; never rewrite the saved catalog. */
export function withNativeQuote(t: EditableTemplate, scene?: SourceScene): EditableTemplate {
  if (t.sourceLayout || t.kind !== 'text' || !scene || t.sourceIds.length !== 2 || !t.data.text || !t.data.value) return t
  const records = t.sourceIds.map(id => scene.records.get(id))
  if (records.some(r => !r || r.disposition !== 'visible' || r.element.kind !== 'text')) return t
  if (records.some(r => r!.ancestors.some(id => !neutralContainer(scene.records.get(id)!.element)))) return t
  const fields = ['text', 'value'] as const
  const matched = fields.map(field => records.filter(r => r?.element.kind === 'text' && normalizedText(r.element.text) === normalizedText(t.data[field])))
  if (matched.some(r => r.length !== 1) || matched[0][0] === matched[1][0]) return t
  const x = Math.min(...records.map(r => r!.bounds.x)), y = Math.min(...records.map(r => r!.bounds.y))
  return { ...t, sourceLayout: { graphic: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', graphicIds: [], structure: { panels: 0, orientation: 'vertical', inline: false }, text: matched.map((rows, i) => {
    const r = rows[0]!, element = structuredClone(r.element)
    if (element.kind !== 'text') throw Error('Expected native quote text')
    element.bounds = { ...r.bounds, x: r.bounds.x - x, y: r.bounds.y - y }
    return { element, binding: { field: fields[i] } }
  }) } }
}
export async function candidateScene(bucket: R2Bucket, upload: string, templates: EditableTemplate[]) {
  if (!templates.some(t => !t.sourceLayout && t.kind === 'text' && t.data.text && t.data.value)) return undefined
  const manifest = await (await bucket.get(`visual/${upload}/manifest.json`))?.json<VisualManifest>()
  return manifest ? readSourceScene(manifest.snapshot) : undefined
}
export async function catalogCandidates(bucket: R2Bucket, upload: string, catalog: EditableCatalog) {
  const templates = catalog.families.flatMap(f => f.variants), scene = await candidateScene(bucket, upload, templates)
  const checks = new Set(catalog.qualification?.checks.filter(c => c.passed).map(c => c.id) ?? [])
  return Promise.all(templates.map(t => checks.has(t.id) ? sourceCandidate(withNativeQuote(t, scene), catalog.id) : { template: t, reason: 'Исходный компонент ещё не прошёл проверку импорта.' }))
}
