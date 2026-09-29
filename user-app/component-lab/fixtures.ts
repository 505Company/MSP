/** Synthetic sources for isolated regression checks. Never published to a bank. */
import type { EditableTemplate, EditableCatalog } from '../lib/design-system/editable-contract'
import type { TextElementIR } from '../vendor/drag/src/core/model'
export function labTemplate(family: 'metric' | 'text' | 'numbered' = 'metric'): EditableTemplate {
  const definitions = family === 'metric' ? [['value', '73%', 90], ['text', 'Заявки обработаны', 28]] as const : family === 'text' ? [['title', 'Понять гостя', 40], ['text', 'Команда помогает найти решение.', 28]] as const : [['item', '01', 86], ['item', 'Понять гостя', 40], ['item', 'Команда помогает найти решение.', 28]] as const
  const fields = definitions.map(([key, value, size], i) => {
    const fontStyle = i < definitions.length - 1 ? 'Bold' as const : 'Regular' as const
    const element: TextElementIR = { id: `${family}-field-${i}`, kind: 'text', name: key, text: value, bounds: { x: 28, y: 28 + i * 115, width: 440, height: size * 1.3 }, fontFamily: 'Play', fontStyle, fontSize: size, rotation: 0, opacity: 1, visible: true, zIndex: 1,
      styleRuns: [{ start: 0, end: value.length, fontFamily: 'Play', fontStyle, fontSize: size }], colorRuns: [{ start: 0, end: value.length, fill: { type: 'solid', color: { r: 1, g: 1, b: 1, a: 1 } } }], textBox: { align: 'LEFT', vertical: 'TOP', wrap: true } }
    return { element, binding: key === 'item' ? { field: 'item' as const, index: i, part: 'text' as const } : { field: key } }
  })
  return { id: `lab-${family}`, name: `Тестовый компонент ${family}`, description: 'Синтетический источник для проверки механики', kind: family === 'metric' ? 'metric' : 'feature', width: 500, height: 420, slide: 1, sourceIds: ['panel', ...fields.map(f => f.element.id)], memberIds: [], tags: ['test'], dataStatus: 'native', style: {}, config: {}, graphicHtml: {},
    data: family === 'numbered' ? { items: definitions.map(d => ({ text: d[1] })) } : Object.fromEntries(definitions.map(d => [d[0], d[1]])),
    sourceLayout: { structure: { panels: 1, orientation: 'vertical', inline: false }, graphicIds: ['panel'], graphic: '<svg viewBox="0 0 500 420" width="100%" height="100%"><rect width="500" height="420" rx="16" fill="#265fc1"/></svg>', text: fields } }
}
export function labCatalog(): EditableCatalog {
  const templates = (['metric', 'text', 'numbered'] as const).map(labTemplate)
  return { id: 'e'.repeat(64), families: templates.map(t => ({ id: t.id, name: t.name, description: t.description, kind: t.kind, tags: t.tags, sourceIds: t.sourceIds, slides: [1], variants: [t] })), qualification: { checks: templates.map(t => ({ id: t.id, passed: true })) } } as EditableCatalog
}
export function labUnitMetric() {
  const t = labTemplate(), e = t.sourceLayout!.text[0].element, run = e.styleRuns![0]
  e.styleRuns = [{ ...run, end: 2 }, { ...run, start: 2, fontSize: 54 }]
  return t
}
