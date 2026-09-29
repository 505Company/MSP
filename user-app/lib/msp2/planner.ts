import { z } from 'zod'
import { compactPackets, compactSchema, validateCompact, type CompactReply, type SourceAtom } from '../presentations/studio/compact-content'
import { bindDataMaterial } from '../presentations/data-assembly'
import { dataMaterial } from '../presentations/data-material'
import type { EditableTemplate } from '../design-system/editable-contract'
import { designTokens } from './theme'
import { chooseBackground } from './background'
import { contentIssues } from '../component-lab/contract'
import { pixelJsonSchema } from '../presentations/pixel-contract'
import type { StructuredRequest } from '../uploads/qwen-structured'
import type { ComponentBinding, ContentSlide, DesignLibrary, SlidePacket, SlidePlan } from './types'

/** File adapters already normalize spreadsheets to JSON. Keep cells as data,
 * including empty cells and embedded newlines, rather than tokenizing JSON. */
export function sourcePackets(text: string): SlidePacket[] {
  const structured = /^[\[{]/.test(text.trim()) ? dataMaterial(text, 'json') : null
  if (!structured) return compactPackets(text)
  if (!structured.length) throw Error('Добавьте хотя бы одну таблицу или график.')
  return structured.map((material, index) => {
    if (material.kind !== 'table' && material.kind !== 'chart') throw Error('MSP 2 принимает JSON таблиц и графиков. Для другого содержания используйте текст.')
    const type = material.config.chartType
    if (material.kind === 'chart' && !['bar', 'line', 'area', 'donut', 'pie'].includes(type ?? '')) throw Error('Для графика выберите bar, line, area, donut или pie.')
    const title = material.title || 'Данные'
    const columns = material.kind === 'table' ? material.data.columns! : ['Категория', ...material.data.series!.map(s => s.name)]
    const rows = material.kind === 'table' ? material.data.rows! : material.data.categories!.map((c, i) => [c, ...material.data.series!.map(s => s.values[i] === null ? '' : String(s.values[i]))])
    if (material.kind === 'chart' && material.data.series!.some(s => s.values.some(v => v === null))) throw Error('Для графика с пропусками оставьте данные таблицей: пустая ячейка не равна нулю.')
    return { id: `slide-${index + 1}`, index, atoms: [{ id: 'f1', text: title, line: 0, start: 0, end: title.length }], tables: [{ id: 't1', line: 1, columns, rows, headerRecovered: false, ...(material.kind === 'chart' ? { requestedChart: type as 'bar' | 'line' | 'area' | 'donut' | 'pie' } : {}) }], directions: [], directionLines: [] }
  })
}
const roles: Record<string, string[]> = { number: ['value'], caption: ['caption'], ordinal: ['marker'], title: ['heading'], body: ['body', 'text'], quote: ['quote'], author: ['author'] }

/** Component admission belongs to the importer. The new planner only matches
 * complete field signatures, without substituting sample text or media. */
export function compatibleComponents(block: ContentSlide['blocks'][number], library: DesignLibrary): ComponentBinding[] {
  if (block.role !== 'body' || block.data) return []
  return Object.entries(library.prepared).flatMap(([id, pin]) => {
    if (pin.profile.family === 'media-text') return []
    const used = new Set<string>(), fields: Record<string, string> = {}
    for (const f of pin.profile.fields) {
      const source = roles[f.role]?.find(k => block.fields[k] !== undefined && !used.has(k))
      if (source) { fields[f.id] = source; used.add(source) } else if (f.required) return []
    }
    if (Object.keys(block.fields).some(k => !used.has(k))) return []
    const content = Object.fromEntries(Object.entries(fields).map(([id, key]) => [id, block.fields[key]]))
    return contentIssues(pin.profile, content).length ? [] : [{ id, fields, kind: 'prepared' as const }]
  })
}

/** Local mode groups consecutive source rows; it does not invoke a model or
 * reuse recipes. The same lossless source-reference validator gates both modes. */
export function localStructure(packet: SlidePacket): CompactReply {
  const rows = [...new Set(packet.atoms.map(a => a.line))].map(line => packet.atoms.filter(a => a.line === line))
  const blocks: CompactReply['blocks'] = []
  const add = (kind: CompactReply['blocks'][number]['kind'], fields: Record<string, SourceAtom[]>, role: 'title' | 'body' | 'footer' = 'body') => {
    const first = Object.values(fields).flat()[0]
    const hint = [...packet.directionLines ?? []].reverse().find(d => d.line < first.line)?.text ?? ''
    blocks.push({ kind, role, priority: kind === 'metric' ? 'primary' : 'normal', placement: role === 'body' && /^слева/iu.test(hint) ? 'left' : role === 'body' && /^справа/iu.test(hint) ? 'right' : 'auto', fields: Object.entries(fields).map(([name, atoms]) => ({ name: name as 'text', ids: atoms.map(a => a.id) })), data: '', chart: 'none' })
  }
  const title = rows.shift()!
  while (rows.length && /[,—–-]$/.test(title.at(-1)!.text) && /^\p{Ll}/u.test(rows[0][0].text)) title.push(...rows.shift()!)
  add('text', { text: title }, 'title')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], value = row[0].text
    if (/^(?:источник:|примечание:|по данным)/iu.test(value) && i === rows.length - 1) { add('text', { text: row }, 'footer'); continue }
    if (row.length > 1 && /^\d{1,3}$/.test(value)) {
      const body: SourceAtom[] = []
      while (rows[i + 1] && !(rows[i + 1].length > 1 && /^\d{1,3}$/.test(rows[i + 1][0].text))) body.push(...rows[++i])
      if (body.length) add('step', { marker: row.slice(0, 1), heading: row.slice(1), body })
      else add('text', { text: row })
    } else if (/^[+−–-]?\d[\d\s.,/]*(?:%|×|млн|млрд|тыс\.?|дней|дня|день|мин)?$/iu.test(value) && (row.length > 1 || rows[i + 1])) {
      add('metric', { value: row.slice(0, 1), caption: row.length > 1 ? row.slice(1) : rows[++i] })
    } else {
      // Keep prose together, avoiding one tiny card per sentence.
      const text = [...row]
      while (rows[i + 1] && rows[i + 1][0].line === rows[i][0].line + 1 && !/^\d|^[+−]|^источник:|^по данным/iu.test(rows[i + 1][0].text) && text.map(a => a.text).join(' ').length < 420) text.push(...rows[++i])
      add('text', { text })
    }
  }
  for (const table of packet.tables) {
    const hint = [...packet.directionLines ?? []].reverse().find(d => d.line < (table.line ?? Infinity))?.text ?? ''
    blocks.push({ kind: table.requestedChart ? 'chart' : 'table', role: 'body', priority: 'primary', placement: /^слева/iu.test(hint) ? 'left' : /^справа/iu.test(hint) ? 'right' : 'auto', fields: [], data: table.id, chart: table.requestedChart ?? 'none' })
  }
  return { blocks }
}

const planSchema = compactSchema.extend({
  arrangement: z.enum(['balanced', 'horizontal', 'vertical', 'focus-left', 'focus-right']),
  components: z.array(z.object({ block: z.string().max(80), component: z.string().max(300) }).strict()).max(80),
  rationale: z.string().min(1).max(1200),
}).strict()

export function validatePlan(raw: unknown, packet: SlidePacket, library: DesignLibrary): SlidePlan {
  const value = planSchema.parse(raw)
  for (const block of value.blocks) for (const field of block.fields) {
    const positions = field.ids.map(id => packet.atoms.findIndex(a => a.id === id))
    if (positions.some((at, i) => at < 0 || i > 0 && at <= positions[i - 1])) throw Error('Изменён порядок фрагментов исходного текста.')
  }
  const validated = validateCompact({ blocks: value.blocks }, packet), theme = designTokens(library)
  const content: ContentSlide = { ...validated.content, blocks: validated.content.blocks.map(block => {
    const material = validated.materials[block.id]
    if (!material) {
      const order = ['marker', 'value', 'heading', 'text', 'quote', 'body', 'caption', 'author']
      return { ...block, fields: Object.fromEntries(order.filter(key => key in block.fields).map(key => [key, block.fields[key]])) }
    }
    const fallback: EditableTemplate = { id: `msp2-${material.kind}`, kind: material.kind, name: 'Данные в стиле презентации', description: 'Точные данные источника', tags: ['Данные'], sourceIds: [], memberIds: [], slide: 0, width: 1600, height: 800, graphicHtml: {}, dataStatus: 'native', data: {}, style: { font: theme.font, fontSize: 28, color: theme.ink, background: theme.background, accent: theme.accent, palette: theme.palette, headerFill: theme.accent, headerColor: theme.background, padding: 16, radius: 0 }, config: { ...material.config, legend: (material.data.series?.length ?? 0) > 1, grid: true, axis: true, labels: true } }
    const compatible = library.editable.filter(t => t.kind === material.kind && (t.kind !== 'chart' || t.config.chartType === material.config.chartType))
    const templates = compatible.length ? compatible : [fallback]
    const entry = bindDataMaterial(material, templates)[0]
    return { ...block, data: { template: entry.template, values: material.kind === 'table' ? { ...entry.data, rows: material.data.rows, rowKeys: material.data.rows?.map((_, i) => i) } : entry.data, sourceId: value.blocks[Number(block.id.slice(1)) - 1].data } }
  }) }
  if (content.blocks.length > 14) throw Error('На одном слайде больше 14 смысловых блоков. Разделите материал явно.')
  const components: SlidePlan['components'] = {}
  for (const selection of value.components) {
    const block = content.blocks.find(b => b.id === selection.block)
    if (!block || components[selection.block]) throw Error('Неизвестный или повторный блок компонента.')
    const binding = compatibleComponents(block, library).find(b => b.id === selection.component)
    if (!binding) throw Error('Компонент не соответствует исходным полям: ' + selection.block)
    components[selection.block] = binding
  }
  for (const block of content.blocks) {
    const bindings = compatibleComponents(block, library)
    if (!components[block.id] && bindings[0]) components[block.id] = bindings[0]
  }
  const background = Object.keys(components).length ? undefined : chooseBackground(content, library)
  return { content, components, arrangement: value.arrangement, rationale: value.rationale, ...(background ? { background } : {}) }
}

export function localPlan(packet: SlidePacket, library: DesignLibrary) {
  return validatePlan({ ...localStructure(packet), components: [], arrangement: 'balanced', rationale: 'Сетка рассчитана по объёму текста, типам данных и компонентам дизайн-системы.' }, packet, library)
}

export function planningTask(packet: SlidePacket, library: DesignLibrary) {
  const task: StructuredRequest = {
    schemaName: 'msp2_slide_plan', schema: pixelJsonSchema(planSchema), maxTokens: 16384,
    thinking: true, reasoningEffort: 'medium', sampling: { temperature: .3, topP: .95, topK: 20 },
    messages: [{ role: 'system', content: `Ты проектируешь слайд MSP 2 через ограниченный каталог компонентов. Верни JSON по схеме. Первым идёт ровно один text/title, затем body и необязательный text/footer. Ссылайся только на ID исходных фрагментов: каждый ровно один раз, без пропусков, переписывания и повторов. fields: text→text; metric→value,caption; step→marker,heading,body; feature→heading,body; list→heading (необязательно),body; quote→quote,author (необязательно). table/chart используют data=ID таблицы, fields=[], chart=none для таблицы или указанный тип для графика. Остальные блоки data='', chart=none. Не выдумывай чисел или данных. Сохраняй порядок шагов и прямые указания положения. Объединяй связанные факты в смысловые блоки, до 14 на слайд. priority — primary для главного акцента, secondary или normal для пояснений. arrangement задаёт только предпочтение расчётчику сетки: balanced, horizontal, vertical, focus-left или focus-right. components: ссылки {block:'bN',component:ID} на совместимые подготовленные компоненты (bN — позиция в blocks начиная с 1). Если подходящего нет, оставь выбор пустым: движок применит текст или нативные данные в стиле дизайн-системы. Никаких HTML, CSS и координат. rationale кратко объясняет иерархию на русском.` },
    { role: 'user', content: JSON.stringify({ source: packet, designSystem: { name: library.name, rules: library.rules, components: Object.entries(library.prepared).map(([id, p]) => ({ id, name: p.profile.name, fields: p.profile.fields.map(f => ({ role: f.role, required: f.required })), minWidth: p.profile.minWidth, sourceHeight: p.profile.source.height })) } }) }],
  }
  return { task, validate: (raw: unknown) => validatePlan(raw, packet, library) }
}
