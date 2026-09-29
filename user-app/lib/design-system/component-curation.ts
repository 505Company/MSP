import type { ElementIR } from '../../vendor/drag/src/core/model'
import type { ComponentDefinition } from './types'
import { editableText, visibleElements } from './compiler'
import type { SourceSnapshot } from '../digital-designer/source-types'

export const CURATION_VERSION = 'component-selection-2'
export const componentTagLabels = {
  background: 'Фон', illustration: 'Иллюстрация', image: 'Изображение', photo: 'Фото', icon: 'Иконка', logo: 'Логотип',
  text: 'Текст', heading: 'Заголовок', caption: 'Подпись', metric: 'Показатель', card: 'Карточка',
  list: 'Список', steps: 'Этапы', quote: 'Цитата', comparison: 'Сравнение', table: 'Таблица',
  chart: 'Диаграмма', legend: 'Легенда', divider: 'Разделитель', marker: 'Маркер', decoration: 'Декор', shape: 'Фигура',
} as const
export type ComponentTag = keyof typeof componentTagLabels
export type ComponentUsage = { description: string; tags: ComponentTag[]; previewOnDark: boolean }
export type CuratedComponent = ComponentUsage & { id: string; occurrenceIds: string[]; slides: number[] }
export type ComponentSelection = {
  version: string; components: CuratedComponent[]
  omitted: { id: string; reason: 'solid-background' | 'unsupported' | 'empty' }[]
}

/** Tags describe evidence in the current source. They are not permission to
 * change a resource or to use a photograph as an arbitrary background. */
export function componentUsage(component: ComponentDefinition): ComponentUsage {
  const nodes = visibleElements(component.scene.elements), leaves = nodes.filter(e => !('children' in e))
  const roles = new Set(component.semantics.map(s => s.role))
  const name = `${component.name} ${component.semantics.map(s => s.name).join(' ')}`.toLocaleLowerCase('ru')
  const tags = new Set<ComponentTag>()
  const add = (tag: ComponentTag, when: boolean) => { if (when) tags.add(tag) }
  add('background', roles.has('background') || /(?:^|\s)фон(?:\s|$)|background/i.test(name))
  add('logo', roles.has('logo') || /логотип|\blogo\b/i.test(name))
  add('icon', roles.has('icon') || /иконк|значок/i.test(name))
  add('photo', roles.has('photo') || /фотограф|(?:^|\s)фото(?:\s|$)/i.test(name))
  add('illustration', roles.has('illustration') || /иллюстрац/i.test(name))
  add('heading', roles.has('title') || /заголовок/i.test(name))
  add('caption', roles.has('caption'))
  add('metric', roles.has('metric') || /метрик|показател/i.test(name))
  add('quote', /цитат/i.test(name))
  add('steps', /этап|процесс|таймлайн|шаг /i.test(name))
  add('comparison', /сравнен/i.test(name))
  add('list', /список/i.test(name) || leaves.some(e => e.kind === 'text' && e.paragraphs?.some(p => p.markerLength)))
  add('card', component.kind === 'compound' && /карточк|спикер|сотрудник/i.test(name))
  add('table', nodes.some(e => e.kind === 'table'))
  add('chart', roles.has('chart') || nodes.some(e => e.kind === 'chart'))
  add('divider', roles.has('divider') || leaves.length === 1 && leaves[0].kind === 'line' || /разделител|линия/i.test(name))
  add('marker', /маркер|стрелк|точка навигации/i.test(name))
  add('legend', /легенд|legend/i.test(name))
  add('text', leaves.some(e => e.kind === 'text' && Boolean(e.text.trim())))
  add('decoration', !tags.size && (roles.has('decoration') || roles.has('pattern')))
  add('image', !['illustration', 'photo', 'logo', 'icon'].some(tag => tags.has(tag as ComponentTag)) && leaves.some(e => e.kind === 'raster'))
  add('shape', !tags.size)
  const descriptions: Record<ComponentTag, string> = {
    background: 'Для оформления фона', illustration: 'Графика для акцента на слайде', image: 'Изображение из шаблона', photo: 'Фотография из шаблона',
    icon: 'Значок для смыслового акцента', logo: 'Фирменный знак', heading: 'Для заголовка слайда или раздела',
    caption: 'Для подписи и пояснения', metric: 'Для выделения ключевого показателя', quote: 'Для цитаты и её автора',
    steps: 'Для шага или этапа процесса', comparison: 'Для сопоставления вариантов', list: 'Для перечня пунктов',
    card: 'Для отдельного смыслового блока', table: 'Для табличных данных', chart: 'Для представления данных',
    legend: 'Обозначает ряд данных', divider: 'Для разделения содержания', marker: 'Для отметки или связи элементов', text: 'Для основного текста',
    decoration: 'Фирменный декоративный элемент', shape: 'Для подложки или графического акцента',
  }
  const paints = leaves.flatMap(e => e.kind === 'text' ? e.colorRuns?.map(r => r.fill.color) ?? [] : 'fill' in e && e.fill ? [e.fill.color] : [])
  const pale = paints.filter(c => c.r * .2126 + c.g * .7152 + c.b * .0722 > .75).length
  return { tags: [...tags], description: descriptions[[...tags][0]], previewOnDark: paints.length > 0 && pale / paints.length > .7 }
}

/** Text contrast takes priority over the area of a pale shape or photograph. */
export function componentPreviewOnDark(component: ComponentDefinition, graphicFallback = false) {
  const texts = visibleElements(component.scene.elements).filter(e => e.kind === 'text' && e.text.trim())
  let total = 0, pale = 0
  for (const text of texts) {
    if (text.kind !== 'text') continue
    for (const run of text.colorRuns ?? []) {
      const weight = text.text.slice(run.start, run.end).replace(/\s/g, '').length
      const c = run.fill.color
      total += weight
      if (c.r * .2126 + c.g * .7152 + c.b * .0722 > .75) pale += weight
    }
  }
  if (total) return pale / total > .55
  const strokes = visibleElements(component.scene.elements).flatMap(e => 'stroke' in e && e.stroke ? [e.stroke.paint.color] : [])
  const paleStrokes = strokes.filter(c => c.r * .2126 + c.g * .7152 + c.b * .0722 > .75).length
  return graphicFallback || componentUsage(component).previewOnDark || strokes.length > 0 && paleStrokes / strokes.length > .7
}

/** Preview context only: transparent source artwork keeps its original pixels. */
export function sourceSlidePreviewOnDark(snapshot: SourceSnapshot, slideNumber: number) {
  const slide = snapshot.slides.find(s => s.number === slideNumber)
  const background = snapshot.elements.find(e => e.slide === slideNumber && !e.parentId && e.kind === 'rectangle' && e.name === 'Slide background')
  if (!slide || !background) return false
  const p = background.properties as Partial<ElementIR> & { fill?: { color: { r: number; g: number; b: number; a: number } }; gradient?: unknown; pattern?: unknown }
  const b = p.bounds, color = p.fill?.color
  return !!(p.visible && p.opacity === 1 && !p.gradient && !p.pattern && color?.a === 1 && b && Math.abs(b.x) < .5 && Math.abs(b.y) < .5 && Math.abs(b.width - slide.width) < .5 && Math.abs(b.height - slide.height) < .5 && color.r * .2126 + color.g * .7152 + color.b * .0722 < .4)
}

function plainBackground(component: ComponentDefinition, tags: ComponentTag[]) {
  if (!tags.includes('background') && !visibleElements(component.scene.elements).some(e => e.name === 'Slide background')) return false
  const nodes = visibleElements(component.scene.elements), leaves = nodes.filter(e => !('children' in e)), e = leaves[0]
  return leaves.length === 1 && e.kind === 'rectangle' && Boolean(e.fill) && !e.gradient && !e.pattern && !e.pathData && !e.clipBounds
    && !(e.stroke && e.stroke.width > 0 && e.stroke.paint.color.a > 0)
    && nodes.every(n => !n.rotation && !n.effects?.length && !n.blur && !('clipsContent' in n && n.clipsContent) && !('clipPathData' in n && n.clipPathData))
}

function stable(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]))
  return value
}

/** Ignore names, source IDs and placement on the source slide. Preserve size,
 * paint order, typography, assets, fixed copy, cropping, masks and transforms.
 * Only a whole, plain editable field may ignore its example text. */
export function componentFingerprint(component: ComponentDefinition) {
  const fields = new Map(component.slots.map(s => [s.elementId, s]))
  const visit = (elements: ElementIR[], x = 0, y = 0): unknown[] => [...elements].sort((a, b) => a.zIndex - b.zIndex).flatMap(e => {
    if (!e.visible || e.opacity === 0) return []
    const passThrough = e.kind === 'group' && !e.rotation && e.opacity === 1 && !e.effects?.length && !e.blur
      && !e.centeredTransform?.flipH && !e.centeredTransform?.flipV && !e.clipsContent && !e.clipPathData && !e.tableGrid && !e.layout
    if (passThrough) return visit(e.children, x + e.bounds.x, y + e.bounds.y)
    const data: Record<string, unknown> = Object.fromEntries(Object.entries(e).filter(([k]) => !['id', 'name', 'sourceRef', 'zIndex', 'children', 'reason'].includes(k)))
    data.bounds = { ...e.bounds, x: x + e.bounds.x, y: y + e.bounds.y }
    if ('children' in e) data.children = visit(e.children)
    const slots = component.slots.filter(s => s.elementId === e.id)
    if (slots.length) data.fields = slots.map(s => ({ range: s.range, policy: s.policy, maxLength: s.maxLength }))
    if (e.kind === 'text' && fields.has(e.id) && slots.length === 1 && !slots[0].range && !component.fixedTextIds.includes(e.id) && editableText(e)) {
      data.text = '{{text}}'
      for (const key of ['styleRuns', 'colorRuns', 'paragraphs'] as const) if (e[key]?.length) data[key] = e[key].map(run => ({ ...run, start: 0, end: 1 }))
    }
    return [data]
  })
  return JSON.stringify(stable({ kind: component.kind, width: component.scene.width, height: component.scene.height, elements: visit(component.scene.elements) }))
}

export function curateComponents(components: ComponentDefinition[]): ComponentSelection {
  const groups = new Map<string, CuratedComponent>(), omitted: ComponentSelection['omitted'] = []
  for (const component of components) {
    const usage = componentUsage(component)
    const reason = component.issues.some(i => i.severity !== 'warning') ? 'unsupported'
      : !visibleElements(component.scene.elements).some(e => !('children' in e)) ? 'empty'
      : plainBackground(component, usage.tags) ? 'solid-background' : null
    if (reason) { omitted.push({ id: component.id, reason }); continue }
    const key = componentFingerprint(component), existing = groups.get(key)
    if (existing) {
      existing.occurrenceIds.push(component.id)
      if (!existing.slides.includes(component.source.slide)) existing.slides.push(component.source.slide)
      existing.tags = [...new Set([...existing.tags, ...usage.tags])]
    } else groups.set(key, { id: component.id, occurrenceIds: [component.id], slides: [component.source.slide], ...usage })
  }
  return { version: CURATION_VERSION, components: [...groups.values()], omitted }
}
