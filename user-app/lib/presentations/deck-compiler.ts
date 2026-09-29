import {assemblePattern} from '../design-system/pattern-geometry'
import type { ElementIR, SolidPaintIR, TextElementIR } from '../../vendor/drag/src/core/model'
import type { ComponentDefinition } from '../design-system/types'
import { flatten } from '../design-system/compiler'
import { scaled } from '../slides/document'
import { activeRecipeElements, boundText, type BoundScene, type DeckIssue, type RecipeElement, type SceneInput, type TextMeasurement } from './deck-contract'

export function paint(hex: string): SolidPaintIR {
  return { type: 'solid', color: { r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255, a: 1 } }
}
export function resourceSupported(component: ComponentDefinition) {
  return component.issues.every(i => i.severity === 'warning') && !component.slots.length && !component.fixedTextIds.length &&
    flatten(component.scene.elements).every(e => e.kind !== 'text' && e.kind !== 'table' && e.kind !== 'chart' && !e.blur && !e.effects?.length &&
      !('pattern' in e && e.pattern) && !(e.kind === 'path' && /[Aa]/.test(e.pathData ?? '')))
}
export function roundedPath(w: number, h: number, radii: number[]) {
  const [a,b,c,d] = radii.map(r => Math.min(Math.max(0, r), w / 2, h / 2)), k = .55228475
  return `M ${a} 0 L ${w-b} 0 C ${w-b+b*k} 0 ${w} ${b-b*k} ${w} ${b} L ${w} ${h-c} C ${w} ${h-c+c*k} ${w-c+c*k} ${h} ${w-c} ${h} L ${d} ${h} C ${d-d*k} ${h} 0 ${h-d+d*k} 0 ${h-d} L 0 ${a} C 0 ${a-a*k} ${a-a*k} 0 ${a} 0 Z`
}
function instance(e: RecipeElement, component: ComponentDefinition, fill: SolidPaintIR | undefined, base: Omit<ElementIR, 'kind'>): ElementIR {
  if (!resourceSupported(component)) throw new Error('Ресурс содержит неподдерживаемое оформление')
  const corners = e.radius !== undefined ? [e.radius, e.radius, e.radius, e.radius] : e.cornerRadii ?? [0, 0, 0, 0]
  const round = corners.some(r => r > 0)
  if (e.resourceRole === 'panel' || e.resourceRole === 'circle') {
    const leaf = flatten(component.scene.elements).find(n => n.visible && n.kind === (e.resourceRole === 'panel' ? 'rectangle' : 'ellipse'))
    if (!leaf || !('fill' in leaf)) throw new Error('Подложка недоступна')
    // Native surface instance: its catalog provenance is retained; the recipe
    // explicitly permits changing surface geometry, radius and palette role.
    return { ...base, ...(round && e.resourceRole === 'panel'
      ? { kind: 'path' as const, pathData: roundedPath(e.width, e.height, corners) }
      : { kind: e.resourceRole === 'circle' ? 'ellipse' as const : 'rectangle' as const }), fill: fill ?? leaf.fill }
  }
  if(component.pattern){const seed=[...e.id].reduce((n,c)=>n+c.charCodeAt(0),0);return {...base,kind:'group',children:assemblePattern(component.pattern,{width:e.width,height:e.height,mode:'fill',seed}).map((p,i)=>({...p,id:`${e.id}-part-${i}`}))}}
  const cover = (e.imageFit ?? e.fit ?? 'contain') === 'cover'
  const factor = (cover ? Math.max : Math.min)(e.width / component.scene.width, e.height / component.scene.height)
  const w = component.scene.width * factor, h = component.scene.height * factor
  return { ...base, kind: 'group', clipsContent: true, ...(round ? { clipPathData: roundedPath(e.width, e.height, corners) } : {}), children: [{ ...base, id: `${e.id}-content`, name: component.name, kind: 'group',
    bounds: { x: (e.width - w) * (e.focusX ?? .5), y: (e.height - h) * (e.focusY ?? .5), width: w, height: h }, opacity: 1,
    children: scaled(component.scene.elements, factor, e.id) }] }
}
export function compileDeckScene(scene: BoundScene, input: SceneInput, metrics: TextMeasurement[] = []): ComponentDefinition {
  const colors = new Map(scene.colors.map(c => [c.role, paint(c.hex)])), recipe = input.variant.recipe
  const elements: ElementIR[] = [{ id: 'slide-background', name: 'Фон', kind: 'rectangle', bounds: { x: 0, y: 0, ...recipe.canvas }, rotation: 0, opacity: 1, visible: true, zIndex: -1, fill: paint(scene.background) }]
  for (const e of activeRecipeElements(scene, input)) {
    const text = scene.texts.find(t => t.id === e.id)
    const marker = recipe.id === 'editorial-insight-04' && /^marker-\d+$/.test(e.id) ? scene.texts.find(t => t.id === `point${Number(e.id.split('-')[1]) + 1}`) : null
    const base = { id: e.id, name: e.id, bounds: { x: e.x, y: e.y + (text?.yOffset ?? marker?.yOffset ?? 0), width: e.width, height: e.height }, rotation: 0, opacity: e.opacity ?? 1, visible: true, zIndex: elements.length }
    if (e.kind === 'text') {
      const value = boundText(text!, input), fontSize = e.fontSize!, fill = colors.get(e.colorRole ?? 'ink')!
      const content: TextElementIR = { ...base, kind: 'text', text: value, fontSize, fontFamily: scene.fontFamily,
        fontStyle: e.fontStyle === 'Bold' ? 'Bold' : 'Regular', textBox: { align: e.align ?? 'LEFT', vertical: 'TOP', wrap: true },
        colorRuns: [{ start: 0, end: value.length, fill }], paragraphs: [{ start: 0, end: value.length, align: e.align ?? 'LEFT',
          left: 0, right: 0, indent: 0, before: 0, after: 0, fontSize, lineHeight: { unit: 'PERCENT', value: e.lineHeight ?? 112 } }],
        flow: { columns: 1, gap: 0, autoFit: 'NONE' } }
      elements.push(content)
    } else if (e.kind === 'asset') {
      const binding = scene.resources.find(r => r.role === e.resourceRole)!
      elements.push(instance(e, input.resources.find(c => c.id === binding.componentId)!, e.colorRole ? colors.get(e.colorRole) : undefined, base))
    } else if (e.kind === 'shape') {
      elements.push({ ...base, kind: 'rectangle', ...(e.colorRole ? { fill: colors.get(e.colorRole) } : {}),
        ...(e.gradient ? { gradient: { type: 'linear' as const, start: { x: 0, y: 0 }, end: e.gradient.direction === 'vertical' ? { x: 0, y: 1 } : { x: 1, y: 0 },
          stops: e.gradient.stops.map(s => ({ position: s.position, color: colors.get(s.colorRole)!.color })) } } : {}) })
    } else if (e.kind === 'line') {
      elements.push({ ...base, kind: 'path', pathData: `M 0 0 L ${(e.endX ?? e.x + e.width) - e.x} ${(e.endY ?? e.y + e.height) - e.y}`,
        stroke: { width: e.strokeWidth ?? 1, paint: colors.get(e.strokeRole ?? 'ink')! } })
    } else throw new Error(`Неподдерживаемый элемент рецепта: ${e.kind}`)
  }
  // Preserve authored measured-flow constraints; a box budget is never its ink height.
  const visiting = new Set<string>(), done = new Set<string>()
  const position = (id: string) => {
    if (done.has(id)) return
    if (visiting.has(id)) throw new Error('Цикл связей рецепта')
    visiting.add(id)
    const rule = recipe.elements.find(e => e.id === id), element = elements.find(e => e.id === id)
    if (rule?.after && element) {
      position(rule.after.target)
      const target = elements.find(e => e.id === rule.after!.target), measurement = metrics.find(m => m.id === rule.after!.target)
      if (target && measurement) element.bounds.y = target.bounds.y + measurement.height + rule.after.gap
    }
    done.add(id); visiting.delete(id)
  }
  for (const e of elements) position(e.id)
  const all = flatten(elements)
  return { id: input.slideId, name: input.title, kind: 'compound', source: { slide: 1, rootId: input.slideId, elementIds: all.map(e => e.id), ancestorIds: [], assetIds: [...new Set(all.filter(e => e.kind === 'raster').map(e => e.assetId))] },
    scene: { ...recipe.canvas, elements }, slots: [], fixedTextIds: all.filter(e => e.kind === 'text').map(e => e.id), issues: [], semantics: [] }
}
export function geometryIssues(scene: BoundScene, input: SceneInput, metrics: TextMeasurement[]): DeckIssue[] {
  const component = compileDeckScene(scene, input, metrics), issues: DeckIssue[] = []
  const texts = component.scene.elements.filter(e => e.kind === 'text')
  const issue = (code: string, elementId: string, message: string) => issues.push({ code, elementId, message })
  for (const e of texts) {
    const m = metrics.find(m => m.id === e.id), rule = input.variant.recipe.elements.find(r => r.id === e.id)!
    if (!m) { issue('missing-measurement', e.id, 'Не удалось измерить текст'); continue }
    const b = e.bounds, maxLines = Math.max(...[rule.maxLines ?? 100].flat())
    if (m.width > b.width + 1 || m.height > b.height + 1 || m.lines > maxLines) issue('text-overflow', e.id, `${e.id}: текст ${Math.ceil(m.width)}×${Math.ceil(m.height)} px, ${m.lines} строк; поле ${b.width}×${b.height}, максимум ${maxLines} строк. Кегль ${e.fontSize} нельзя уменьшать.`)
    if (b.x < 0 || b.y < 0 || b.x + b.width > component.scene.width + 1 || b.y + m.height > component.scene.height + 1) issue('outside-slide', e.id, `${e.id}: текст выходит за слайд`)
    if (Math.abs(m.x - b.x) > 1 || Math.abs(m.y - b.y) > 1) issue('invalid-measurement', e.id, 'Положение измерения не совпадает со сценой')
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j], am = metrics.find(m => m.id === a.id), bm = metrics.find(m => m.id === b.id)
    if (am && bm && Math.min(a.bounds.x + a.bounds.width, b.bounds.x + b.bounds.width) - Math.max(a.bounds.x, b.bounds.x) > 1 &&
      Math.min(a.bounds.y + am.height, b.bounds.y + bm.height) - Math.max(a.bounds.y, b.bounds.y) > 1) issue('text-overlap', b.id, `${a.id} и ${b.id}: текст пересекается`)
  }
  const gap = (aboveId: string, belowId: string, minimum: number) => {
    const a = component.scene.elements.find(e => e.id === aboveId), b = component.scene.elements.find(e => e.id === belowId), m = metrics.find(t => t.id === aboveId)
    if (a && b && m && b.bounds.y - (a.bounds.y + m.height) < minimum - 1) issue('minimum-gap', belowId, `${aboveId} → ${belowId}: отступ меньше ${minimum}px по измеренной высоте текста`)
  }
  if (input.variant.recipe.id === 'minimal-center-38') gap('title', 'subtitle', 48)
  if (input.variant.recipe.id === 'editorial-insight-04') {
    for (const id of ['visual', 'body', ...texts.filter(e => /^point\d+$/.test(e.id)).map(e => e.id)]) gap('title', id, 32)
    gap('body', 'point1', 32)
    for (let n = 1; n < 4; n++) gap(`point${n}`, `point${n + 1}`, 24)
    const last = texts.filter(e => /^point\d+$/.test(e.id)).at(-1); if (last) gap(last.id, 'footer', 30)
  }
  // Non-text layers after text must not cover it (intentional underlays precede text).
  for (const text of texts) for (const e of component.scene.elements) {
    if (e.kind === 'text' || e.zIndex < text.zIndex || e.opacity < .01 || e.bounds.width < 8 || e.bounds.height < 8) continue
    const h = metrics.find(m => m.id === text.id)?.height ?? text.bounds.height
    if (Math.min(text.bounds.x + text.bounds.width, e.bounds.x + e.bounds.width) - Math.max(text.bounds.x, e.bounds.x) > 2 &&
      Math.min(text.bounds.y + h, e.bounds.y + e.bounds.height) - Math.max(text.bounds.y, e.bounds.y) > 2) issue('text-covered', text.id, `${text.id}: поверх текста находится ${e.id}`)
  }
  return issues
}
