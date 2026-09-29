import { z } from 'zod'
import { SemanticValidationError } from '../design-system/semantic-contract'
import { compactTypesetterTask } from './compact-two-qwen-task'
import { validatePixelPlan, type PixelBrief, type PixelEnvironment, type PixelPlan } from './pixel-contract'
import type { PixelTextEvidence } from './fast-two-qwen-task'
import type { StructuredRequest } from '../uploads/qwen-structured'

export const PIXEL_WIRE_VERSION = 'pixel-numeric-wire-1'
export const regionColumns = ['x', 'y', 'width', 'height', 'backgroundIndexOrMinus1', 'radius', 'modeIndex', 'fontStepOrMinus1', 'directionIndexOrMinus1']
export const textColumns = ['x', 'y', 'width', 'height', 'fontIndex', 'fontSize', 'lineHeight', 'weight', 'colorIndex', 'opacity', 'alignIndex', 'wrap01']
const modes = ['plain', 'native', 'flow'] as const, directions = ['stack', 'row'] as const, aligns = ['left', 'center', 'right'] as const

export function pixelWireSlots(brief: PixelBrief) {
  const texts: Pick<PixelPlan['texts'][number], 'id' | 'regionId' | 'fragments' | 'field'>[] = [
    { id: 'wire-t0', regionId: 'title', fragments: brief.title, field: null },
  ]
  for (const g of brief.groups) {
    const fields = g.component ? g.component.fields : g.fragments.map(id => ({ path: null, fragments: [id] }))
    for (const f of fields) texts.push({ id: `wire-t${texts.length}`, regionId: g.id, fragments: f.fragments, field: f.path })
  }
  return { regions: ['title', ...brief.groups.map(g => g.id)], texts }
}
const rows = (count: number, columns: number) => z.array(z.array(z.number().finite()).length(columns)).length(count)
export function decodePixelWire(raw: unknown, brief: PixelBrief, briefHash: string, env: PixelEnvironment): PixelPlan {
  const slots = pixelWireSlots(brief)
  const parsed = z.object({ regions: rows(slots.regions.length, regionColumns.length), texts: rows(slots.texts.length, textColumns.length) }).strict().safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.map(i => `wire:${i.path.join('.')}:${i.message}`))
  const token = <T>(values: readonly T[], index: number, name: string): T => {
    if (!Number.isInteger(index) || index < 0 || index >= values.length) throw new SemanticValidationError([`wire:${name}:index=${index}`])
    return values[index]
  }
  const box = (row: number[]) => ({ x: row[0], y: row[1], width: row[2], height: row[3] })
  // Only a lossless expansion: no measurements, rounding, fitting or defaults.
  const plan: PixelPlan = {
    version: 'qwen-pixel-plan-1', briefHash, canvas: { width: 1920, height: 1080, background: brief.background },
    regions: parsed.data.regions.map((r, i) => ({ id: slots.regions[i], box: box(r),
      background: r[4] === -1 ? null : token(env.input.colors, r[4], 'background').id, radius: r[5],
      mode: token(modes, r[6], 'mode'), fontStep: r[7] === -1 ? null : r[7], flowDirection: r[8] === -1 ? null : token(directions, r[8], 'direction') })),
    texts: parsed.data.texts.map((t, i) => ({ ...slots.texts[i], box: box(t), fontToken: token(env.fontTokens, t[4], 'font'),
      fontSize: t[5], lineHeight: t[6], weight: t[7], color: token(env.input.colors, t[8], 'color').id, opacity: t[9],
      align: token(aligns, t[10], 'align'), wrap: token([false, true], t[11], 'wrap') })),
    calculationSummary: 'Model-authored numeric rows expanded without changing any geometry or typography.',
  }
  return validatePixelPlan(plan, brief, briefHash, env)
}

export function pixelWireTask(env: PixelEnvironment, brief: PixelBrief, briefHash: string, evidence: PixelTextEvidence): StructuredRequest {
  const base = compactTypesetterTask(env, brief, briefHash, evidence), slots = pixelWireSlots(brief)
  const rowSchema = (count: number, columns: number) => ({ type: 'array', minItems: count, maxItems: count,
    items: { type: 'array', minItems: columns, maxItems: columns, items: { type: 'number' } } })
  const { reasoningEffort: _effort, ...task } = base
  void _effort
  return { ...task, schemaName: 'pixel_numeric_wire_v1', thinking: false, maxTokens: 4096,
    schema: { type: 'object', additionalProperties: false, required: ['regions', 'texts'], properties: {
      regions: rowSchema(slots.regions.length, regionColumns.length), texts: rowSchema(slots.texts.length, textColumns.length),
    } }, messages: [...base.messages, { role: 'user', content: JSON.stringify({
      protocol: PIXEL_WIRE_VERSION, instruction: 'Верни только две таблицы чисел regions и texts, строки строго в указанном порядке. Полный численный план и все ограничения прежние. Не печатай повторяющиеся ключи, ID, текст, хеш или объяснения. Каждое число задаёшь ты; таблицы только разворачиваются в прежний контракт без исправлений. Plain fontStep=-1,direction=-1; компоненты background=-1,radius=0,fontStep=0..4. Все индексы с нуля. Геометрия текста локальна к его региону. Используй измеренную высоту с запасом 2px. Не выбирай кегль 220 для подписей. Предпочитай измеренный квалифицированный flow при длинных подписях; native требует точного масштабирования всех полей и обычно слишком велик для длинной подписи.',
      regionColumns, regionOrder: slots.regions, textColumns, textOrder: slots.texts,
      fonts: env.fontTokens, colors: env.input.colors.map(c => c.id), modes, directions, aligns, wrap: [false, true],
    }) }] }
}

/** A separate speed experiment; the original compact control stays immutable. */
export function quickPixelDesignerTask(base: StructuredRequest, env: PixelEnvironment): StructuredRequest {
  const { reasoningEffort: _effort, ...task } = structuredClone(base)
  void _effort
  const schema = task.schema as { properties: Record<string, Record<string, unknown>> }
  for (const key of ['intent', 'authorAdaptation', 'compositionReason']) schema.properties[key].maxLength = 100
  schema.properties.typesettingBrief.maxLength = 240
  const eligible = env.input.content.filter(f => /^(?=.{1,200}:$)(?=.*(?:справа|слева|сверху|снизу|размести|расположи|оформление|композиция)).*$/iu.test(f.text)).map(f => f.id)
  const directionsSchema = schema.properties.directions as { maxItems: number; items: { properties: Record<string, object> } }
  directionsSchema.maxItems = eligible.length
  if (eligible.length) directionsSchema.items.properties.sourceId = { type: 'string', enum: eligible }
  return { ...task, thinking: false, schemaName: 'quick_pixel_designer_v2', maxTokens: 4096,
    messages: [...task.messages, { role: 'user', content: 'Окончательный краткий бриф. Не повторяй title в groups. Для compositionUse=none обязательно compositionId=null; ID компонента не является ID композиции. Каждый компонент требует ВСЕ свои fields: paths — альтернативные имена одного поля, выбирай одно. Для метрики с длинной подписью предпочитай квалифицированный flow: он умеет менять высоту подписи. Если flow=null, пропорции и рамки полей фиксированы: масштабирование всей карточки не увеличивает вместимость относительно кегля; длинная подпись может быть физически несовместима. Все варианты каталога доступны, выбери совместимые самостоятельно. Пояснения очень краткие, appearance одной фразой; не пиши неопределённые clean/none вместо конкретного оформления. Обычные тезисы — простой текст, если подходящей карточки нет. Шрифт, фон и контрастная иерархия должны быть определены.' }] }
}
