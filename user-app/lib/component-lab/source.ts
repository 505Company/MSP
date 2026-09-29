import type { EditableTemplate } from '../design-system/editable-contract'
import { nativeBoundText } from '../design-system/editable-native-layout'
import { PROFILE_VERSION, profileSchema, metricPlaceholder, type ComponentContent, type ComponentField, type ComponentProfile } from './contract'
import { titleBodyParagraphs } from './source-paragraphs'
import { sourceUnitScale } from './metric-unit'
import { graphicParts, simpleRoundBadge, combinedGraphic } from './artwork'

export type SourceCandidate = { template: EditableTemplate; profile?: ComponentProfile; content?: ComponentContent; reason?: string }
export async function digest(value: unknown) {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stable(v)])) : v
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stable(value)))))].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Declarative subset of a rectangular, nine-sliceable native panel. */
export function supportedPanel(svg: string) {
  if (/<\s*\/?\s*(?!svg\b|g\b|rect\b|path\b)[a-z]/i.test(svg) || /(?:href|\bon\w+\s*=|url\s*\(|<!|<\?|\bstyle\s*=)/i.test(svg)) return false
  if (!/<(?:rect|path)\b/.test(svg)) return false
  return [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].every(([, path]) => {
    if (path.replace(/[-+\d.e\s,]/g, '') !== 'MLCLCLCLCZ') return false
    const n = path.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
    if (n.length !== 34) return false
    const r = n[0], w = n[2] + r, h = n[11] + r, k = .5522847498307936
    if (!n.every(Number.isFinite) || w <= 0 || h <= 0 || r < 0 || r > Math.min(w, h) / 2 + .01) return false
    return [r,0,w-r,0,w-r+r*k,0,w,r-r*k,w,r,w,h-r,w,h-r+r*k,w-r+r*k,h,w-r,h,r,h,r-r*k,h,0,h-r+r*k,0,h-r,0,r,0,r-r*k,r-r*k,0,r,0].every((v, i) => Math.abs(v - n[i]) < .02)
  }) && [...svg.matchAll(/rotate\(([^)]+)\)/g)].every(m => Number(m[1]) === 0)
}

/** Only a unique, first-painted panel filling the component can be separated.
 * A small icon tile is artwork; a panel above the content is not a background.
 * Keep all remaining native objects, masks and their relative positions. */
export function sourceGraphicLayers(t: EditableTemplate) {
  const l = t.sourceLayout!, parts = graphicParts(l.graphic)
  if (supportedPanel(l.graphic) && l.structure?.panels === 1 && (!parts || parts.length === 1 && parts[0].width >= t.width * .9 && parts[0].height >= t.height * .9)) return { panel: l.graphic, parts: [] }
  const fullPanels = parts?.filter(p => p.tags.length === 1 && supportedPanel(p.svg) && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.width - t.width) < 1 && Math.abs(p.height - t.height) < 1) ?? []
  if (parts && parts.length > 1 && fullPanels.length === 1 && parts[0] === fullPanels[0]) {
    const p = parts[0]
    return { panel: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t.width} ${t.height}" width="100%" height="100%"><g transform="translate(${p.x} ${p.y})">${p.svg}</g></svg>`, parts: parts.slice(1) }
  }
  return { panel: '', parts }
}
export async function sourceCandidate(t: EditableTemplate, catalogId: string): Promise<SourceCandidate> {
  const decline = (reason: string) => ({ template: t, reason })
  const l = t.sourceLayout
  if (!l || !['metric', 'feature', 'text'].includes(t.kind) || t.children || t.sourceRegion || t.sourceChart || t.sourceInline || l.bar) return decline('Для этой конструкции нужен отдельный профиль адаптации')
  const { panel, parts } = sourceGraphicLayers(t)
  if (!panel && !parts) return decline('Сложная или растровая подложка пока не поддерживается')
  let slots = l.text.map(s => ({ slot: s, e: nativeBoundText(s, t.data) }))
  if (t.adaptation?.family === 'fixed') return decline(`Нужен отдельный профиль: ${t.adaptation.rationale}`)
  if (t.adaptation) {
    const selected = t.adaptation.fields.map(f => {
      const source = slots.find(s => s.e.id === f.sourceId)
      if (!source) return undefined
      const e = f.part === 'whole' ? source.e : titleBodyParagraphs(source.e)?.[f.part === 'heading' ? 0 : 1]
      return e ? { ...source, e } : undefined
    })
    if (selected.some(s => !s) || new Set(selected.map(s => s!.e.id)).size !== selected.length) return decline('Смысловой план не соответствует исходным текстовым объектам')
    slots = selected as typeof slots
  }
  if (!t.adaptation && t.kind === 'feature' && slots.length === 1 && !slots[0].slot.recoveredAsset) {
    const parts = titleBodyParagraphs(slots[0].e)
    if (parts) slots = parts.map((e, i) => ({ slot: { ...slots[0].slot, binding: { field: i === 0 ? 'title' : 'text' } }, e }))
  }
  if (!t.adaptation && t.kind === 'text' && slots.length === 2) {
    const quote = slots.find(s => s.slot.binding.field === 'text'), split = quote && titleBodyParagraphs(quote.e)
    if (quote && split) slots = [...split.map((e, i) => ({ slot: { ...quote.slot, binding: { field: (i ? 'title' : 'text') as 'title' | 'text' } }, e })), ...slots.filter(s => s !== quote)]
  }
  if (slots.length < 1 || slots.length > 3) return decline('Нужны одно–три различимых смысловых поля')
  const sorted = t.adaptation ? slots : slots.sort((a, b) => a.e.bounds.y - b.e.bounds.y || a.e.bounds.x - b.e.bounds.x)
  const metric = sorted.find(s => ['value', 'metric'].includes(s.slot.binding.field))
  let family: ComponentProfile['family'], roles: ComponentField['role'][]
  let artwork: ComponentProfile['artwork']
  if (t.adaptation) {
    family = t.adaptation.family; roles = t.adaptation.fields.map(f => f.role)
    if (['title-body', 'quote-author'].includes(family) && t.adaptation.layouts.some(l => l.state !== 'vertical')) return decline('Этот смысловой план требует неподдерживаемого состояния вёрстки')
  } else if (t.kind === 'metric' && sorted.length === 2 && metric) {
    family = 'number-caption'; roles = sorted.map(s => s === metric ? 'number' : 'caption')
  } else if (t.kind === 'feature' && sorted.length === 3 && /^\d{1,3}[.)]?$/.test(sorted[0].e.text.trim()) && sorted[1].e.fontSize >= sorted[2].e.fontSize * 1.15) {
    family = 'number-title-body'; roles = ['ordinal', 'title', 'body']
  } else if (t.kind === 'feature' && sorted.length === 2 && sorted[0] === metric && /^\d{1,3}[.)]?$/.test(metric.e.text.trim())) {
    family = 'ordinal-caption'; roles = ['ordinal', 'body']
  } else if (t.kind === 'feature' && parts?.length && sorted.length <= 2) {
    family = 'media-text'; roles = sorted.length === 1 ? ['body'] : ['title', 'body']
  } else if (t.kind === 'feature' && sorted.length === 2 && sorted[0].slot.binding.field === 'title' && sorted[1].slot.binding.field === 'text') {
    family = 'title-body'; roles = ['title', 'body']
  } else if (t.kind === 'text' && sorted[0].slot.binding.field === 'text' && sorted.at(-1)!.slot.binding.field === 'value') {
    family = 'quote-author'; roles = sorted.length === 2 ? ['quote', 'author'] : ['quote', 'body', 'author']
  } else return decline('Назначение полей неоднозначно; автоматическое переименование запрещено')
  const base = sorted.find((_, i) => ['body', 'caption', 'author'].includes(roles[i]))?.e
  if (!base) return decline('Не определено основное текстовое поле компонента')
  const scale = Math.max(1, Math.min(2, 28 / base.fontSize))
  if (parts?.length) {
    const art = combinedGraphic(parts), ordinal = sorted.find((_, i) => roles[i] === 'ordinal')
    const contained = (a: typeof art, b: typeof base.bounds) => b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.width <= a.x + a.width + 1 && b.y + b.height <= a.y + a.height + 1
    const badge = ordinal && parts.length === 1 && simpleRoundBadge(parts[0]) && contained(art, ordinal.e.bounds)
    if (!badge && family !== 'media-text') return decline('Графика не соответствует самостоятельному маркеру или иллюстрации')
    if (sorted.some(s => s !== (badge ? ordinal : undefined) && Math.min(art.x + art.width, s.e.bounds.x + s.e.bounds.width) - Math.max(art.x, s.e.bounds.x) > 2 && Math.min(art.y + art.height, s.e.bounds.y + s.e.bounds.height) - Math.max(art.y, s.e.bounds.y) > 2)) return decline('Иллюстрация пересекается с текстом исходника')
    if (parts.some(p => !parts.some(other => other !== p && contained(other, p))) && parts.length > 1 && !parts.some(p => parts.every(other => contained(p, other)))) return decline('Несколько независимых иллюстраций требуют отдельного профиля')
    artwork = { kind: badge ? 'badge' : 'media', svg: art.svg, hash: await digest(art.svg), width: art.width, height: art.height, size: Math.max(72, Math.min(280, art.width * scale)), ids: art.ids, ...(badge ? { field: ordinal!.e.id } : {}) }
  }
  const fields: ComponentField[] = []
  for (let i = 0; i < sorted.length; i++) {
    const { slot, e } = sorted[i], run = e.styleRuns?.[0], paint = e.colorRuns?.[0]?.fill.color
    if (slot.recoveredAsset || e.rotation || e.centeredTransform?.flipH || e.centeredTransform?.flipV || !e.visible || e.opacity !== 1 || e.effects?.length || e.blur || e.linkRuns?.length) return decline('Преобразования или восстановленные глифы требуют отдельной проверки')
    const font = run?.fontFamily ?? e.fontFamily, size = run?.fontSize ?? e.fontSize, style = run?.fontStyle ?? e.fontStyle ?? 'Regular'
    const unitScale = roles[i] === 'number' ? sourceUnitScale(e) : undefined
    if (/italic|oblique/i.test(style)) return decline('Курсив требует отдельной проверки точного начертания при экспорте')
    if (e.styleRuns?.some(r => r.fontFamily !== font || r.fontStyle !== style || unitScale === undefined && Math.abs(r.fontSize - size) > .1 || r.baselineShift || r.decoration && r.decoration !== 'NONE') || !paint || paint.a !== 1 || e.colorRuns?.some(r => JSON.stringify(r.fill.color) !== JSON.stringify(paint))) return decline('Смешанное оформление внутри поля пока не поддерживается')
    if (e.paragraphs?.some(p => e.text.slice(p.start, p.end).trim() && (p.markerLength || p.indent || p.left || p.right || p.tabs?.length || p.before || p.after))) return decline('Списки и сложные абзацы требуют собственного профиля')
    const role = roles[i], minimum = ['number', 'ordinal'].includes(role) ? Math.max(48, unitScale ? Math.ceil(24 / unitScale) : 48) : role === 'title' ? 28 : 24
    const align = e.textBox?.align ?? e.paragraphs?.[0]?.align ?? 'LEFT'
    if (align === 'JUSTIFIED') return decline('Выключка по ширине пока не поддерживается')
    const line = e.paragraphs?.[0]?.lineHeight
    fields.push({ id: e.id, role, required: true, order: i, font, weight: /Bold/.test(style) ? 700 : 400, italic: /Italic/.test(style), size: Math.min(180, Math.max(minimum, size * scale)), minimum, ...(unitScale !== undefined ? { unitScale } : {}),
      ...(role === 'number' && unitScale === undefined && metricPlaceholder(e.text) ? { sourcePlaceholder: e.text } : {}),
      leading: Math.max(1, Math.min(1.6, line ? line.unit === 'PIXELS' ? line.value / size : line.value / 100 : 1.2)),
      letterSpacing: (run?.letterSpacing ?? 0) * scale, color: '#' + [paint.r, paint.g, paint.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''), align: align.toLowerCase() as 'left' | 'center' | 'right' })
  }
  const x = sorted.map(s => s.e.bounds.x), padding = Math.max(16, Math.min(40, Math.min(...x) * scale))
  const horizontal = metric && sorted.find(s => s !== metric)!.e.bounds.x >= metric.e.bounds.x + metric.e.bounds.width - 4
  const parsed = profileSchema.safeParse({ version: PROFILE_VERSION, id: t.id, name: t.name, catalogId,
    fingerprint: await digest({ version: PROFILE_VERSION, source: t, catalogId }), family,
    source: { templateId: t.id, ids: t.sourceIds, width: t.width, height: t.height, graphic: panel, ...(!panel && /^#[\da-f]{6}$/i.test(t.style.background ?? '') && t.style.background!.toLowerCase() !== '#ffffff' ? { background: t.style.background } : {}) }, fields, ...(artwork ? { artwork } : {}),
    ...(t.adaptation ? { states: t.adaptation.layouts.map(l => l.state), preferred: t.adaptation.layouts[0]?.state, behavior: Object.fromEntries(t.adaptation.layouts.map(l => [l.state, { textAlign: l.textAlign, position: l.position, contentWidth: 100 }])) } : { states: ['title-body', 'quote-author'].includes(family) ? ['vertical'] : ['vertical', 'horizontal', 'compact'], preferred: horizontal && !['title-body', 'quote-author'].includes(family) ? 'horizontal' : 'vertical' }),
    padding, gap: 20, minWidth: 280, maxWidth: 1200, maxHeight: 1000 })
  if (!parsed.success) return decline('Исходные размеры или типографика выходят за допустимые пределы профиля')
  return { template: t, profile: parsed.data, content: Object.fromEntries(sorted.map(({ e }) => [e.id, e.text])) }
}
