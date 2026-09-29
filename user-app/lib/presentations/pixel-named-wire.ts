import { z } from 'zod'
import { SemanticValidationError } from '../design-system/semantic-contract'
import { contrastRatio } from './layout-html'
import { pixelComponentCatalog, pixelJsonSchema, validatePixelPlan, type PixelBrief, type PixelEnvironment, type PixelPlan } from './pixel-contract'
import { pixelWireSlots } from './pixel-wire'
import type { StructuredRequest } from '../uploads/qwen-structured'

const box = z.array(z.number().finite().min(0).max(1920)).length(4)
const region = z.object({ box, mode: z.enum(['plain', 'native', 'flow']), step: z.number().int().min(0).max(4).nullable(), direction: z.enum(['stack', 'row']).nullable() }).strict()
const text = z.object({ box, size: z.number().min(24).max(220), leading: z.number().min(24).max(264), weight: z.number().int().min(400).max(800),
  color: z.string(), opacity: z.number().min(.5).max(1), align: z.enum(['left', 'center', 'right']), wrap: z.boolean() }).strict()

/** Named compact fields avoid ambiguous numeric style indices. Source bindings,
 * canvas and the designer's one measured font remain explicit immutable input. */
export function namedPixelTask(base: StructuredRequest, env: PixelEnvironment, brief: PixelBrief): StructuredRequest {
  const slots = pixelWireSlots(brief), catalog = pixelComponentCatalog(env)
  const background = env.input.colors.find(c => c.id === brief.background)!.hex
  const readable = env.input.colors.filter(c => contrastRatio(c.hex, background) >= 4.5).map(c => c.id)
  const regions = Object.fromEntries(slots.regions.map(id => {
    const g = brief.groups.find(g => g.id === id), component = g?.component && catalog.find(c => c.id === g.component!.id)
    const s = pixelJsonSchema(region) as { properties: Record<string, object> }
    if (!component) { s.properties.mode = { const: 'plain', type: 'string' }; s.properties.step = { type: 'null' }; s.properties.direction = { type: 'null' } }
    else s.properties.mode = { type: 'string', enum: component.flow ? ['native', 'flow'] : ['native'] }
    return [id, s]
  }))
  const texts = Object.fromEntries(slots.texts.map(slot => {
    const g = brief.groups.find(g => g.id === slot.regionId), c = g?.component && catalog.find(c => c.id === g.component!.id)
    const field = c && c.fields.find(f => f.paths.includes(slot.field!))
    const s = pixelJsonSchema(text) as { properties: Record<string, object> }
    s.properties.color = field ? { type: 'string', const: field.color } : { type: 'string', enum: readable }
    s.properties.opacity = { type: 'number', const: field ? field.opacity : 1 }
    s.properties.size = { type: 'number', minimum: slot.regionId === 'title' ? 60 : field?.metric ? 48 : 24, maximum: 220 }
    return [slot.id, s]
  }))
  const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
  return { ...base, schemaName: 'pixel_named_wire_v1', schema: object({ regions: object(regions), texts: object(texts) }),
    messages: [...base.messages.filter(m => {
      if (typeof m.content !== 'string') return true
      try { return JSON.parse(m.content).protocol !== 'pixel-numeric-wire-1' } catch { return true }
    }), { role: 'user', content: JSON.stringify({ protocol: 'pixel-named-wire-1',
      instruction: 'Финальный формат заменяет две числовые таблицы: верни objects regions и texts с именованными ключами по НОВОЙ схеме. В каждом box ровно [x,y,width,height]. Все числа выбираешь ты. Текст остаётся локальным к региону. step — fontStep, direction — flowDirection, size — fontSize, leading — lineHeight. Имена регионов и text ID смотри в slots. Шрифт ВСЕГО текста — выбранный дизайнером measuredFont, для него сделаны все замеры. Plain области без подложек/скруглений, компоненты сохраняют нативную графику: эти фиксированные условия контракта не нужно повторять в ответе. Нативные цвета/opacity и допустимый контраст plain текста ограничены схемой; выбирай из разрешённых значений. Не печатай индексы цветов/шрифтов или прежние массивы параметров. Замеры карточек остаются справочником, все итоговые координаты и размеры всё равно задаёшь ты. Не меняй высоты из выбранного измеренного варианта: иначе меняются и зависимые координаты и полная высота карточки. Заголовок может занимать всю ширину холста, обязательно вмещать все строки. Не уменьшай поле заголовка до ширины левой колонки без необходимости.',
      slots, measuredFont: brief.fontToken, readablePlainColors: readable,
    }) }] }
}

export function decodeNamedPixel(raw: unknown, brief: PixelBrief, briefHash: string, env: PixelEnvironment): PixelPlan {
  const slots = pixelWireSlots(brief)
  const parsed = z.object({ regions: z.object(Object.fromEntries(slots.regions.map(id => [id, region]))).strict(),
    texts: z.object(Object.fromEntries(slots.texts.map(s => [s.id, text]))).strict() }).strict().safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.map(i => `named:${i.path.join('.')}:${i.message}`))
  const box = (r: number[]) => ({ x: r[0], y: r[1], width: r[2], height: r[3] })
  const plan: PixelPlan = { version: 'qwen-pixel-plan-1', briefHash, canvas: { width: 1920, height: 1080, background: brief.background },
    regions: slots.regions.map(id => { const r = parsed.data.regions[id]; return { id, box: box(r.box), mode: r.mode, fontStep: r.step, flowDirection: r.direction, background: null, radius: 0 } }),
    texts: slots.texts.map(s => { const t = parsed.data.texts[s.id]; return { ...s, box: box(t.box), fontToken: brief.fontToken, fontSize: t.size, lineHeight: t.leading,
      weight: t.weight, color: t.color, opacity: t.opacity, align: t.align, wrap: t.wrap } }), calculationSummary: 'Named compact model plan; fixed source bindings, measured designer font, no additional backgrounds. All geometry preserved.',
  }
  return validatePixelPlan(plan, brief, briefHash, env)
}
