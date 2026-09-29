/** OFFLINE PROTOTYPE. Can independent Figma rules express different hierarchies
 * for identical content? Not connected to the production generator or Qwen.
 * The input selects rules and bindings; it cannot supply CSS or coordinates. */
import { frames, walk } from './figma-catalog-v2/catalog'
import { FREE_FLEX_VERSION, validateFreeFlex, type FlexRef, type FreeFlexNode, type FreeFlexPlan } from '../free-flex'
import { componentSlots } from '../adaptive-components'
import type { PixelEnvironment } from '../pixel-contract'
import type { RecipeBrand } from './content-recipe'

export const BLOCK_PROTOTYPE_VERSION = 'figma-blocks-prototype-1'
type Sizing = 'hug' | 'fill'
export type BlockInstruction =
  | { id: string; rule: 'row' | 'stack'; sizing: Sizing; proportions?: 'equal' | 'fact-explanations'; children: BlockInstruction[] }
  | { id: string; rule: 'text'; role: 'title' | 'section' | 'body' | 'note'; refs: FlexRef[] }
  | { id: string; rule: 'metric'; sizing: Sizing; emphasis: 'hero' | 'peer' | 'support'; componentId: string | null; value: FlexRef[]; caption: FlexRef[] }
  | { id: string; rule: 'list'; items: FlexRef[][] }
export type BlockInstructions = { version: typeof BLOCK_PROTOTYPE_VERSION; intent: string; blocks: BlockInstruction[] }

// Source IDs identify the actual captured substructure, not a whole-slide alias.
// Cardinality and nesting are explicit prototype generalizations. No claim that
// the Figma author approved every possible recombination follows from this map.
export const blockRuleCatalog = [
  { rule: 'slide', nodes: ['21:700'], principle: 'Вертикальный поток; поля и интервалы исходного контентного слайда.' },
  { rule: 'row', nodes: ['21:443', '21:655'], principle: 'Равные колонки или пропорция факта и пояснений 760:1040.', adaptation: '2–5 повторений; внутрь колонки можно вложить другой блок.' },
  { rule: 'stack', nodes: ['21:707'], principle: 'Последовательный вертикальный поток с общим интервалом.', adaptation: 'Вложение и доля оставшегося места задаются логической инструкцией hug/fill.' },
  { rule: 'title', nodes: ['21:538'], principle: 'Заголовок контентного слайда 72 px; только шрифт и цвет текущей библиотеки.' },
  { rule: 'section', nodes: ['21:448'], principle: 'Заголовок группы 43 px.' },
  { rule: 'metric.hero', nodes: ['21:478', '21:480'], principle: 'Главное число 188 px, пояснение 38 px.', adaptation: 'Пара без панели центрируется в выделенной колонке; поля не разделяются свободным пространством.' },
  { rule: 'metric.peer', nodes: ['21:376', '21:379', '21:716'], principle: 'Самостоятельный факт 164 px, пояснение 27 px.', adaptation: 'При выборе панели число сверху, подпись снизу: распределение SPACE_BETWEEN из 21:716, графика и отступы — из выбранной библиотеки.' },
  { rule: 'metric.support', nodes: ['21:716', '21:717', '21:718'], principle: 'Второстепенная метрика 86 px и подпись 28 px; число сверху, подпись снизу.' },
  { rule: 'list', nodes: ['21:576', '21:579', '21:660'], principle: 'Повторяемые текстовые пункты; текст 32 px, интервал пояснений 14 px.', adaptation: '1–8 пунктов без добавленных маркеров. Составление этих двух исходных правил — решение прототипа.' },
  { rule: 'note', nodes: ['21:729'], principle: 'Мелкая подпись источника.', adaptation: 'Исходные 22 px подняты до 24 px для читаемости.' },
] as const
const sourceNodes = new Map(frames.flatMap(walk).map(n => [n.id, n]))
const source = (id: string) => { const n = sourceNodes.get(id); if (!n) throw Error(`Missing captured Figma node: ${id}`); return n }
const px = (id: string) => source(id).size!

export function compileBlockPrototype(instructions: BlockInstructions, env: PixelEnvironment, brand: RecipeBrand, fit = 0) {
  if (instructions.version !== BLOCK_PROTOTYPE_VERSION || ![0, 1, 2].includes(fit)) throw Error('Invalid prototype version / fit step')
  const nodes: FreeFlexNode[] = [], provenance: { blockId: string; rule: string; sourceNodes: string[] }[] = []
  const factor = [1, .94, .88][fit], insets: Record<string, number> = {}, usedIds = new Set<string>()
  const size = (v: number, floor = 26) => Math.max(floor, Math.round(v * factor))
  const add = (node: FreeFlexNode, rule: string) => {
    if (usedIds.has(node.id)) throw Error(`Duplicate block id: ${node.id}`)
    usedIds.add(node.id); nodes.push(node)
    const evidence = blockRuleCatalog.find(r => r.rule === rule)!
    provenance.push({ blockId: node.id, rule, sourceNodes: [...evidence.nodes] })
  }
  const group = (id: string, parent: string | null, css: string, rule: string) => add({ id, parent, kind: 'flex', css, refs: [], component: null }, rule)
  const text = (id: string, parent: string, refs: FlexRef[], value: number, font: string, color: string, rule: string, heading = false) =>
    add({ id, parent, kind: 'text', refs, component: null, css: `font-family:${font};font-size:${value}px;line-height:${heading ? 1.2 : 1.3};color:${color};` }, rule)
  const canvas = source('21:700'), padding = canvas.pad!.map(v => `${v}px`).join(' '), gap = source('21:707').gap!
  group('root', null, `width:1920px;height:1080px;flex-direction:column;padding:${padding};gap:${gap}px;background-color:${brand.background};`, 'slide')
  const visit = (b: BlockInstruction, parent: string, parentAxis: 'row' | 'stack', weight = 1, depth = 0) => {
    if (depth > 5) throw Error('Prototype supports at most five nested rule groups')
    const fill = parentAxis === 'row' || 'sizing' in b && b.sizing === 'fill'
    const flow = `flex:${fill ? `${weight} 1 0` : '0 0 auto'};`
    if (b.rule === 'row' || b.rule === 'stack') {
      if (!b.children.length || b.children.length > (b.rule === 'row' ? 5 : 8)) throw Error('Unsupported group cardinality')
      if (b.proportions === 'fact-explanations' && (b.rule !== 'row' || b.children.length !== 2)) throw Error('The source split requires two columns')
      group(b.id, parent, `${flow}flex-direction:${b.rule === 'row' ? 'row' : 'column'};gap:${b.rule === 'row' ? source('21:443').gap : gap}px;align-items:stretch;`, b.rule)
      b.children.forEach((child, i) => visit(child, b.id, b.rule, b.proportions === 'fact-explanations' ? source(i ? '21:659' : '21:656').w : 1, depth + 1))
    } else if (b.rule === 'text') {
      const spec = {
        title: [size(px('21:538'), 64), brand.headingFont, brand.headingColor],
        section: [size(px('21:448'), 38), brand.headingFont, brand.headingColor],
        body: [size(px('21:579'), 28), brand.bodyFont, brand.bodyColor],
        note: [24, brand.bodyFont, brand.bodyColor],
      }[b.role] as [number, string, string]
      text(b.id, parent, b.refs, ...spec, b.role === 'body' ? 'list' : b.role, b.role === 'title' || b.role === 'section')
      if (parentAxis === 'row') nodes.at(-1)!.css += flow
    } else if (b.rule === 'list') {
      if (!b.items.length || b.items.length > 8) throw Error('Unsupported list cardinality')
      group(b.id, parent, `${flow}flex-direction:column;gap:${source('21:660').gap}px;`, 'list')
      b.items.forEach((refs, i) => text(`${b.id}-item-${i + 1}`, b.id, refs, size(px('21:579'), 28), brand.bodyFont, brand.bodyColor, 'list'))
    } else if (b.rule === 'metric') {
      const rule = `metric.${b.emphasis}`, valueSize = size(px(b.emphasis === 'hero' ? '21:478' : b.emphasis === 'peer' ? '21:376' : '21:717'), 72)
      const captionSize = size(px(b.emphasis === 'hero' ? '21:480' : b.emphasis === 'peer' ? '21:379' : '21:718'))
      if (b.componentId) {
        const template = env.input.components.find(c => c.id === b.componentId), profile = env.input.componentFlows?.[b.componentId]
        const slots = template && componentSlots(template)
        if (!template || !profile || slots?.length !== 2 || slots.filter(s => s.metric).length !== 1) throw Error('Qualified native metric component required')
        const pad = Math.max(32, Math.round(profile.padding * factor))
        insets[b.id] = pad
        add({ id: b.id, parent, kind: 'component', refs: [],
          css: `${flow}flex-direction:column;justify-content:space-between;gap:${gap}px;padding:${pad}px;`,
          component: { id: b.componentId, mode: 'free-flow', fields: slots.map(s => ({ path: s.paths[0], refs: s.metric ? b.value : b.caption,
            css: `font-family:${s.metric ? brand.metricFont : brand.bodyFont};font-size:${s.metric ? valueSize : captionSize}px;line-height:${s.metric ? 1.2 : 1.3};` })) } }, rule)
      } else {
        group(b.id, parent, `${flow}flex-direction:column;justify-content:center;gap:${gap}px;`, rule)
        text(`${b.id}-value`, b.id, b.value, valueSize, brand.metricFont, brand.headingColor, rule, true)
        text(`${b.id}-caption`, b.id, b.caption, captionSize, brand.bodyFont, brand.bodyColor, rule)
      }
    }
  }
  instructions.blocks.forEach(b => visit(b, 'root', 'stack'))
  const firstRef = nodes.find(n => n.refs.length)?.refs[0]
  if (!firstRef) throw Error('Text required')
  const plan: FreeFlexPlan = { version: FREE_FLEX_VERSION, rationale: instructions.intent,
    emphasis: [{ fragmentId: firstRef.fragmentId, importance: 1, reason: 'Иерархия назначена в инструкции; это локальная контрольная привязка, не ответ Qwen.' }], nodes }
  validateFreeFlex(plan, env)
  return { version: BLOCK_PROTOTYPE_VERSION, plan, insets, provenance, fit, catalog: blockRuleCatalog }
}
