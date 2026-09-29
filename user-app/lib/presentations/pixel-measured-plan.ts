import { z } from 'zod'
import { SemanticValidationError } from '../design-system/semantic-contract'
import { pixelWireSlots } from './pixel-wire'
import { namedPixelTask } from './pixel-named-wire'
import { validatePixelPlan, type PixelBrief, type PixelEnvironment, type PixelPlan } from './pixel-contract'
import type { StructuredRequest } from '../uploads/qwen-structured'
import type { measurePixelComponentEvidence } from '../../browser/pixel-component-evidence'

export type ComponentEvidence = Awaited<ReturnType<typeof measurePixelComponentEvidence>>
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const number = { type: 'number', minimum: 0, maximum: 1920 }
const fixed = (value: number | string | boolean | null | number[]) => ({ type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
  const: value, ...(Array.isArray(value) ? { items: { type: 'number' }, minItems: 4, maxItems: 4 } : {}) })
const array = (b: PixelPlan['regions'][number]['box']) => [b.x, b.y, b.width, b.height]

/** Constrained selection of measured component internals. Qwen still emits all
 * geometry, including global placement and free text frames. No post-fit exists. */
export function measuredPixelTask(base: StructuredRequest, env: PixelEnvironment, brief: PixelBrief, evidence: ComponentEvidence): StructuredRequest {
  const named = namedPixelTask(base, env, brief), slots = pixelWireSlots(brief)
  const schema = named.schema as { properties: { regions: { properties: Record<string, { properties: Record<string, unknown> }> }; texts: { properties: Record<string, unknown> } } }
  const blocks: Record<string, unknown> = {}
  for (const id of slots.regions) {
    const texts = slots.texts.filter(t => t.regionId === id), group = brief.groups.find(g => g.id === id)
    if (!group?.component) {
      blocks[id] = object({ frame: object({ x: number, y: number, width: number, height: number }), mode: fixed('plain'), step: fixed(null), direction: fixed(null),
        texts: object(Object.fromEntries(texts.map(t => [t.id, schema.properties.texts.properties[t.id]]))) })
      continue
    }
    const measured = evidence.groups.find(g => g.regionId === id)
    if (!measured?.candidates.length) throw new SemanticValidationError([`measured:${id}:no-fitting-qualified-component-candidate; designer must select a compatible component`])
    blocks[id] = { anyOf: measured.candidates.map(c => object({
      frame: object({ x: number, y: number, width: fixed(c.width), height: fixed(c.height) }), mode: fixed('flow'), step: fixed(c.step), direction: fixed(c.direction),
      texts: object(Object.fromEntries(texts.map(t => {
        const f = c.fields.find(f => f.path === t.field)!
        return [t.id, object({ box: fixed(array(f.box)), size: fixed(f.fontSize), leading: fixed(f.lineHeight), weight: fixed(f.weight),
          color: fixed(f.color), opacity: fixed(f.opacity), align: { type: 'string', enum: ['left', 'center', 'right'] }, wrap: fixed(true) })]
      }))),
    })) }
  }
  return { ...named, schemaName: 'pixel_measured_blocks_v1', schema: object({ blocks: object(blocks) }), messages: [
    ...named.messages.filter(m => { if (typeof m.content !== 'string') return true; try { return JSON.parse(m.content).protocol !== 'pixel-named-wire-1' } catch { return true } }),
    { role: 'user', content: JSON.stringify({ protocol: 'pixel-measured-blocks-1', slots, measuredFont: brief.fontToken,
      instruction: 'Новый окончательный формат: blocks — объект по ID региона. Каждый block содержит frame={x,y,width,height}, mode,step,direction,texts. frame глобален; box каждого текста локален и равен [x,y,width,height]. Для простого текста все размеры задаёшь ты; цвет ограничен читаемым контрастом. Для библиотечных карточек выбери ОДИН измеренный вариант из componentEvidence: схема сохраняет его связанные width/height/step/direction и ВСЕ внутренние текстовые размеры вместе. Не смешивай варианты. Ты выбираешь вариант, глобальные x/y карточки и все координаты простого текста. Все итоговые числа входят в ответ; после него движок ничего не подгоняет. Шрифт всего текста — measuredFont. Plain без подложек; у компонентов сохраняется исходная графика. Соблюдай поля 16, не пересекай области, правые карточки справа от левых тезисов с gap>=16. Крупный заголовок сверху: используй всю доступную ширину и замеры строк, высота текста>=lines*leading+2, frame вмещает локальный текст целиком. Не зажимай длинный заголовок в левую колонку. Три тезиса должны иметь ровный вертикальный ритм. Верни полный объект blocks без объяснений.' }) },
  ] }
}

const frame = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict()
const text = z.object({ box: z.array(z.number()).length(4), size: z.number(), leading: z.number(), weight: z.number(), color: z.string(), opacity: z.number(), align: z.enum(['left', 'center', 'right']), wrap: z.boolean() }).strict()
export function decodeMeasuredPixel(raw: unknown, env: PixelEnvironment, brief: PixelBrief, briefHash: string, evidence: ComponentEvidence): PixelPlan {
  const slots = pixelWireSlots(brief)
  const shape = z.object({ blocks: z.object(Object.fromEntries(slots.regions.map(id => [id, z.object({ frame, mode: z.enum(['plain', 'flow']), step: z.number().nullable(), direction: z.enum(['row', 'stack']).nullable(),
    texts: z.object(Object.fromEntries(slots.texts.filter(t => t.regionId === id).map(t => [t.id, text]))).strict(),
  }).strict()]))).strict() }).strict()
  const parsed = shape.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.map(i => `measured:${i.path.join('.')}:${i.message}`))
  const blocks = parsed.data.blocks, box = (a: number[]) => ({ x: a[0], y: a[1], width: a[2], height: a[3] }), close = (a: number, b: number) => Math.abs(a - b) < 1e-6
  for (const g of brief.groups.filter(g => g.component)) {
    const block = blocks[g.id], measured = evidence.groups.find(e => e.regionId === g.id)
    const matches = measured?.candidates.some(c => close(c.width, block.frame.width) && close(c.height, block.frame.height) && c.step === block.step && c.direction === block.direction &&
      slots.texts.filter(t => t.regionId === g.id).every(s => {
        const actual = block.texts[s.id], expected = c.fields.find(f => f.path === s.field)!
        return actual.box.every((v, i) => close(v, array(expected.box)[i])) && close(actual.size, expected.fontSize) && close(actual.leading, expected.lineHeight) &&
          actual.weight === expected.weight && actual.color === expected.color && close(actual.opacity, expected.opacity)
      }))
    if (!matches || block.mode !== 'flow') throw new SemanticValidationError([`measured:${g.id}:must-use-one-complete-measured-variant`])
  }
  return validatePixelPlan({ version: 'qwen-pixel-plan-1', briefHash, canvas: { width: 1920, height: 1080, background: brief.background },
    regions: slots.regions.map(id => { const b = blocks[id]; return { id, box: b.frame, mode: b.mode, fontStep: b.step, flowDirection: b.direction, background: null, radius: 0 } }),
    texts: slots.texts.map(s => { const t = blocks[s.regionId].texts[s.id]; return { ...s, box: box(t.box), fontToken: brief.fontToken,
      fontSize: t.size, lineHeight: t.leading, weight: t.weight, color: t.color, opacity: t.opacity, align: t.align, wrap: t.wrap } }),
    calculationSummary: 'Qwen selected whole measured component variants and authored every global frame and free-text box. Decoder preserves emitted geometry.',
  }, brief, briefHash, env)
}
