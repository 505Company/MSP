import { labTemplate } from './fixtures'

const ink = { r: 0, g: 0, b: 0, a: 1 }
const shape = (svg: string, w: number, h: number, x = 0, y = 0) => `<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(${x} ${y})"><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${svg}</svg></g></svg>`
export function familyFixture(kind: 'bare' | 'badge' | 'media' | 'quote') {
  const t = labTemplate(kind === 'media' || kind === 'quote' ? 'text' : 'metric')
  t.id = `fixture-${kind}`; t.style = {}; t.sourceIds = t.sourceIds.filter(id => id !== 'panel')
  t.sourceLayout!.graphic = '<svg></svg>'; t.sourceLayout!.graphicIds = []; t.sourceLayout!.structure!.panels = 0
  for (const s of t.sourceLayout!.text) s.element.colorRuns!.forEach(r => { r.fill.color = { ...ink } })
  if (kind === 'badge') {
    t.kind = 'feature'; t.data.value = '2'
    const lead = t.sourceLayout!.text[0].element; lead.text = '2'; lead.fontSize = 48; lead.styleRuns = [{ ...lead.styleRuns![0], end: 1, fontSize: 48 }]; lead.colorRuns = [{ start: 0, end: 1, fill: { type: 'solid', color: { r: 1, g: 1, b: 1, a: 1 } } }]; lead.bounds = { x: 10, y: 10, width: 80, height: 80 }
    t.sourceIds.push('marker'); t.sourceLayout!.graphicIds = ['marker']
    t.sourceLayout!.graphic = shape('<circle data-source-object="marker" cx="50" cy="50" r="50" fill="#174d7d"/>', 100, 100)
  }
  if (kind === 'media') {
    // A vector with a real clipping mask; not a VK circle or a shared panel.
    t.sourceIds.push('illustration'); t.sourceLayout!.graphicIds = ['illustration']
    t.sourceLayout!.graphic = shape('<defs><clipPath id="fixture-clip"><ellipse cx="90" cy="50" rx="85" ry="45"/></clipPath></defs><g data-source-object="illustration" clip-path="url(#fixture-clip)"><rect width="180" height="100" fill="#174d7d"/><rect x="90" width="90" height="100" fill="#b45834"/></g>', 180, 100)
    t.sourceLayout!.text.forEach((s, i) => { s.element.bounds = { x: 200, y: 20 + i * 90, width: 280, height: 80 } })
  }
  if (kind === 'quote') {
    t.kind = 'text'; t.data = { text: 'Хорошие решения начинаются с точного вопроса.', value: 'Автор исследования' }
    t.sourceLayout!.text.forEach((s, i) => {
      s.binding = { field: i ? 'value' : 'text' }; s.element.text = i ? t.data.value! : t.data.text!
      s.element.styleRuns!.forEach(r => { r.end = s.element.text.length }); s.element.colorRuns!.forEach(r => { r.end = s.element.text.length })
    })
  }
  return t
}
