import type { SourceSnapshot } from '../digital-designer/source-types'
import type { ElementIR, GroupElementIR, TextElementIR } from '../../vendor/drag/src/core/model'
import type { ComponentDefinition, ComponentLibrary, TextSlot } from './types'
import type { SemanticSystem } from './semantic-scan'
import { contentHash } from './catalog'
import { compileLibrary, flatten, unsupported, visibleElements } from './compiler'
import { createTextFields } from './text-fields'
import { readSourceScene, nativeListMarker } from './source-scene'
import type { SourceRule } from './source-system'
import { unavailableSourceSlides } from './source-availability'

export const SEMANTIC_COMPILER_VERSION = 'web-semantic-components-2'
export type SemanticMetadata = {
  version: string; sourceRevision: string
  coverage: { records: number; processed: number; unresolved: number; rulesUnresolved: number; complete: boolean }
  decisions: { elementId: string; role: string; representedBy: string | null; reason: string | null }[]
  styleRoles: { styleId: string; roles: string[] }[]; rules: SourceRule[]
}
const textNames: Record<string, string> = { title: 'Заголовок', body: 'Текстовый блок', caption: 'Подпись', metric: 'Показатель', other: 'Текст' }

/** Model selects meaning and membership; this compiler only selects existing
 * branches, retaining each ancestor transform/mask and the original assets. */
export async function compileSemanticLibrary(snapshot: SourceSnapshot, semantic: SemanticSystem) {
  if (semantic.sourceRevision !== await contentHash(snapshot) || semantic.sourceId !== snapshot.sourceId) throw new Error('Смысловой разбор относится к другой версии источника')
  const scene = readSourceScene(snapshot)
  const decisions = new Map<string, SemanticMetadata['decisions'][number]>()
  for (const b of semantic.batches) for (const d of b.result.ledger) {
    const old = decisions.get(d.elementId)
    // A complete boundary package is an explicit refinement with all members.
    if (!old || b.id.startsWith('boundary-') || old.role === 'unresolved' && d.role !== 'unresolved') decisions.set(d.elementId, d)
  }
  for (const p of semantic.sourcePending) decisions.set(p.elementId, { ...p, role: 'unresolved', representedBy: null })
  const unresolved = new Set([...decisions.values()].filter(d => d.role === 'unresolved').map(d => d.elementId))
  const library: ComponentLibrary = { schemaVersion: 1, compilerVersion: SEMANTIC_COMPILER_VERSION, sourceId: snapshot.sourceId, name: snapshot.name,
    tokens: { colors: snapshot.colors, fonts: snapshot.fonts }, components: [], excluded: [], assemblyIssues: [], notes: ['Компоненты и поля определены смысловым разбором исходных слайдов. Исходный текст, геометрия и ресурсы сохранены.'] }
  const seen = new Map<string, ComponentDefinition>()
  async function add(ids: string[], name: string, kind: 'atom' | 'compound', requested: { elementId: string; label: string }[], role: string) {
    const sorted = [...ids].sort(), signature = sorted.join('|')
    if (seen.has(signature)) return
    const records = ids.map(id => scene.records.get(id))
    const refuse = (reason: string) => { library.assemblyIssues!.push({ findingId: `semantic:${signature}`, elementIds: ids, reason }) }
    if (!ids.length || records.some(r => !r || r.disposition !== 'visible') || new Set(records.map(r => r!.source.slide)).size !== 1) { refuse('Не удалось подтвердить исходный состав.'); return }
    const members = records.map(r => r!), nodes = members.flatMap(r => flatten([r.element])), sourceIds = new Set(nodes.map(n => n.id))
    if (nodes.length > 250 || members.some(r => r.ancestors.some(id => ids.includes(id))) || nodes.some(n => unresolved.has(n.id))) { refuse('Часть конструкции требует уточнения; исходник сохранён.'); return }
    const ancestors = new Set(members.flatMap(r => r.ancestors)), selected = new Set(ids)
    const prune = (e: ElementIR): ElementIR | null => {
      if (selected.has(e.id)) return structuredClone(e)
      if (!ancestors.has(e.id) || !('children' in e)) return null
      const children = e.children.flatMap(c => { const p = prune(c); return p ? [p] : [] })
      return children.length ? { ...structuredClone(e), children } : null
    }
    const branches = scene.roots.flatMap(root => { const p = prune(root); return p ? [p] : [] })
    const visible = nodes.filter(n => scene.records.get(n.id)?.disposition === 'visible')
    const extent = (e: ElementIR): ElementIR[] => !e.visible || e.opacity === 0 ? [] : [e, ...('children' in e && !e.clipsContent ? e.children.flatMap(extent) : [])]
    const boxes = members.flatMap(r => extent(r.element)).map(n => scene.records.get(n.id)!.bounds)
    const pad = Math.max(0, ...visible.map(n => 'stroke' in n ? (n.stroke?.width ?? 0) / 2 : 0))
    const x = Math.min(...boxes.map(b => b.x)) - pad, y = Math.min(...boxes.map(b => b.y)) - pad
    const width = Math.max(...boxes.map(b => b.x + b.width)) - x + pad, height = Math.max(...boxes.map(b => b.y + b.height)) - y + pad
    if (!Number.isFinite(width + height) || width <= 0 || height <= 0 || width > 10000 || height > 10000) { refuse('Размер компонента пока не поддерживается.'); return }
    const id = `sem-${(await contentHash({ ids: sorted, slots: requested.map(s => s.elementId).sort(), kind })).slice(0, 24)}`
    const root: GroupElementIR = { id: `viewport-${id}`, name, kind: 'group', bounds: { x: -x, y: -y, width, height }, rotation: 0, opacity: 1, visible: true, zIndex: 0, children: branches }
    const texts = visibleElements(nodes).filter((e): e is TextElementIR => e.kind === 'text')
    const slots: TextSlot[] = requested.flatMap(s => {
      const r = scene.records.get(s.elementId)
      return r?.element.kind === 'text' && sourceIds.has(s.elementId) && !r.tableId && !nativeListMarker(r, scene)
        ? createTextFields(r.element, s.label) : []
    })
    const fixed = [...new Set(texts.filter(t => !slots.some(s => s.elementId === t.id)).map(t => t.id))]
    const assets = [...new Set(nodes.filter(n => n.kind === 'raster').map(n => n.assetId))]
    if (assets.some(a => !snapshot.assets.some(s => s.id === a))) { refuse('Исходное изображение недоступно.'); return }
    const component: ComponentDefinition = { id, name, kind, source: { slide: members[0].source.slide, rootId: ids.length === 1 ? ids[0] : root.id, elementIds: [...sourceIds], ancestorIds: [...ancestors], assetIds: assets },
      scene: { width, height, elements: [root] }, slots, fixedTextIds: fixed,
      fixedTextReasons: Object.fromEntries(fixed.map(id => [id, 'Исходная надпись сохраняется; автоматическая замена не разрешена.'])),
      issues: unsupported(flatten(branches), snapshot, members[0].source.slide), semantics: [{ findingId: `semantic:${id}`, name, role, basis: 'visual_observation' }] }
    // Unsupported explicit fields must not silently become usable static copy.
    if (slots.length > 100 || requested.some(r => !slots.some(s => s.elementId === r.elementId))) component.issues.push({ code: 'semantic-slot-layout', severity: 'blocking', message: 'Заполнение сложного текста этого компонента пока недоступно.' })
    seen.set(signature, component); library.components.push(component)
  }
  const molecules = semantic.batches.flatMap(b => b.result.reply.molecules)
  for (const m of molecules) await add(m.elementIds, m.name, m.textSlots.length ? 'compound' : 'atom', m.textSlots, 'source-construction')
  for (const b of semantic.batches) for (const a of b.result.reply.atoms) await add([a.elementId], a.name, 'atom', [], a.category)
  const moleculeText = new Set(molecules.flatMap(m => m.textSlots.map(s => s.elementId)))
  for (const b of semantic.batches) for (const t of b.result.reply.content) {
    if (moleculeText.has(t.elementId) || !textNames[t.role]) continue
    await add([t.elementId], textNames[t.role], 'atom', [{ elementId: t.elementId, label: textNames[t.role] }], t.role)
  }
  // Native tables are retained as whole immutable structures. Their cells never
  // become independent reusable fields just because they contain simple text.
  const structural = compileLibrary(snapshot, null, { maxComponents: Infinity })
  for (const id of semantic.retainedTableIds) {
    const table = structural.components.find(c => c.source.rootId === id)
    if (table) library.components.push({ ...table, name: `Таблица · слайд ${table.source.slide}`, slots: [] })
    else library.excluded.push({ elementId: id, reason: 'Сложная таблица сохранена в исходных слайдах.' })
  }
  library.components.sort((a, b) => Number(b.kind === 'compound') - Number(a.kind === 'compound') || a.source.slide - b.source.slide || a.name.localeCompare(b.name, 'ru'))
  const ruleRows = semantic.rules.flatMap(r => r.rules)
  const rules: SourceRule[] = ruleRows.map(r => ({ id: `source-rule-${r.textId}`, name: r.title, interpretation: r.interpretation, status: 'candidate', basis: 'source-text',
    sourceTexts: r.occurrences.map(o => ({ elementId: o.elementId, slide: o.slide, text: r.sourceText })), elementIds: r.occurrences.map(o => o.elementId), allowed: [], forbidden: [] }))
  const roles = new Map<string, Set<string>>()
  for (const b of semantic.batches) for (const s of b.result.reply.styles) { const set = roles.get(s.styleId) ?? new Set(); set.add(s.role); roles.set(s.styleId, set) }
  const rulesUnresolved = semantic.rulePending.length + semantic.rules.reduce((n, r) => n + r.pending.length, 0)
  const metadata: SemanticMetadata = { version: semantic.version, sourceRevision: semantic.sourceRevision,
    coverage: { records: snapshot.elements.length, processed: decisions.size, unresolved: unresolved.size, rulesUnresolved, complete: !unresolved.size && !rulesUnresolved && !library.assemblyIssues?.length && !unavailableSourceSlides(snapshot).length },
    decisions: [...decisions.values()], styleRoles: [...roles].map(([styleId, names]) => ({ styleId, roles: [...names].sort() })), rules }
  return { library, metadata }
}
