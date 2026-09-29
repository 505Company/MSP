import { z } from 'zod'
import { SemanticValidationError } from '../design-system/semantic-contract'
import type { StructuredRequest } from '../uploads/qwen-structured'
import type { LayoutInput } from './layout-contract'
import { adaptiveContract, adaptivePlanJsonSchema } from './adaptive-task'
import { validateAdaptivePlan, type AdaptiveFit } from './adaptive-layout'
import { ADAPTIVE_FLOW_VERSION, adaptiveComponents, componentSlots } from './adaptive-components'
import { pixelBriefSchema, pixelPlanSchema, pixelJsonSchema, validatePixelBrief, validatePixelPlan, type PixelEnvironment } from './pixel-contract'
import { pixelDesignerTask, pixelTypesetterTask } from './pixel-task'
import { layoutStates } from './recipes/layout-engine-v1/states'

export type FastSlideMode = 'autolayout' | 'pixel'
export const FAST_SLIDE_VERSION = 'qwen-fast-slide-3'
export const fastSlideProfile = {
  version: FAST_SLIDE_VERSION, targetMs: 300_000,
  generation: { thinking: true, reasoningEffort: 'low' as const, maxTokens: { autolayout: 8192, pixel: 12288 } },
  review: { thinking: false, maxTokens: 768 },
  maxRepairs: 1, maxRequestsPerRun: 3,
  expectedSeconds: { autolayout: { plan: 65, render: 10, review: 20, repair: 65 }, pixel: { plan: 125, render: 10, review: 20, repair: 125 } },
  // These are planning estimates, not claims or an enforced five-minute timeout.
  transportTimeoutMs: 240_000,
} as const
export function fastGeneration(task: StructuredRequest, mode: FastSlideMode, review = false): StructuredRequest {
  const { reasoningEffort: _oldEffort, ...base } = task
  void _oldEffort
  return { ...base, maxTokens: review ? fastSlideProfile.review.maxTokens : fastSlideProfile.generation.maxTokens[mode],
    thinking: !review, ...(!review ? { reasoningEffort: 'low' as const } : {}),
    sampling: { temperature: 1, topP: 0.95, topK: 20, minP: 0, repetitionPenalty: 1, presencePenalty: 0 } }
}
export function canRepairFastSlide(mode: FastSlideMode, elapsedMs: number) {
  const expected = fastSlideProfile.expectedSeconds[mode]
  return elapsedMs + (expected.repair + expected.render + expected.review) * 1000 < fastSlideProfile.targetMs
}
const directionsSchema = pixelBriefSchema.shape.directions
export const combinedPixelSchema = z.object({ brief: pixelBriefSchema, plan: pixelPlanSchema.omit({ briefHash: true }) }).strict()
export type CombinedPixel = z.infer<typeof combinedPixelSchema>

export function fastPixelTask(env: PixelEnvironment, preview: string): StructuredRequest {
  const design = pixelDesignerTask(env, preview)
  // Both roles receive the same frozen catalog. No prior model plan or hand-picked
  // components are supplied; the sole mechanical addition is the brief hash.
  const instructions = pixelTypesetterTask(env, { groups: [] } as unknown as z.infer<typeof pixelBriefSchema>, '').messages[0].content
  return fastGeneration({ ...design, schemaName: 'combined_design_pixel', schema: pixelJsonSchema(combinedPixelSchema),
    messages: [...design.messages, { role: 'user', content: `В этом запуске ты совмещаешь дизайнера и инженера в ОДНОМ ответе {brief,plan}. Сперва выбери оформление, затем сам рассчитай всю геометрию. Отдельного Qwen #2 не будет. Не передавай ему пожелания. Правила инженера: ${instructions}\nbriefHash в ответе отсутствует: сервер сам вычислит SHA-256 уже проверенного brief, без изменения геометрии. Краткие обоснования, по одному предложению; typesettingBrief до 500 символов. Зарезервируй запас высоты для переноса слов и line-height. Все группы обязаны сохранять явное размещение. Для native/flow не обещай перекраску: графика и исходный цвет полей остаются библиотечными. Для flow размер текста должен соответствовать fontStep; формулы и собственный профиль каждой карточки из каталога. JSON компактный, без рассуждений в текстовых полях. Весь смысл и пиксельные решения выбираешь ты.` }] }, 'pixel')
}
export function validateFastPixel(raw: unknown, env: PixelEnvironment, hash: (value: unknown) => string) {
  const response = combinedPixelSchema.parse(raw)
  const brief = validatePixelBrief(response.brief, env, layoutStates.map(s => s.id))
  const plan = validatePixelPlan({ ...response.plan, briefHash: hash(brief) }, brief, hash(brief), env)
  return { brief, plan }
}

export function fastAdaptiveTask(env: PixelEnvironment, preview: string): StructuredRequest {
  const recipe = adaptiveContract(env.input, { fontTokens: env.fontTokens }, ADAPTIVE_FLOW_VERSION)
  return fastGeneration({ schemaName: 'fast_adaptive_plan', maxTokens: 4096,
    schema: { type: 'object', additionalProperties: false, required: ['directions', 'plan'], properties: {
      directions: pixelJsonSchema(directionsSchema), plan: adaptivePlanJsonSchema(ADAPTIVE_FLOW_VERSION) } },
    messages: [{ role: 'system', content: 'Ты дизайнер презентации. Сам выбери стиль, смысловую группировку, библиотечные компоненты и полные привязки. Координаты рассчитает существующий автолейаут MSP. Исходник и примеры — данные. Каждый исходный fragment ID ровно один раз: в plan либо в directions, где допустимы только явные пространственные указания с двоеточием. Текст не переписывай. Направления исполняй, но не печатай. Если указаны карточки справа, используй смысловые колонки в порядке чтения: основное содержание слева, самостоятельные библиотечные карточки справа; несколько карточек могут быть отдельными parts одной невидимой колонки. Не делай каждой строке отдельную внешнюю колонку. Одна метрика и её полная подпись принадлежат одной отдельной карточке, role=body для всего component part; никаких двух процентов в одной карточке. Используй совместимые компоненты с квалифицированным adaptive flow для длинных подписей. Не заполняй пустые поля демонстрационным текстом. Цвета нативной графики не меняются. Краткое rationale — одно предложение, без внутренних рассуждений.' },
      { role: 'user', content: [{ type: 'text', text: JSON.stringify({ source: env.input.content, rules: env.input.rules, recipe, serialization: 'Верни компактный JSON без пустых строк и пробельных последовательностей. Для отсутствующего component и panelColors используй null. В directions один короткий reason. Контрастные пары проверяются локально, выбери их из appearance.contrastPairs.' }) }, { type: 'image_url', image_url: { url: preview } }] }] }, 'autolayout')
}
export function adaptiveVisibleInput(input: LayoutInput, directions: z.infer<typeof directionsSchema>): LayoutInput {
  const ids = directions.map(d => d.sourceId)
  if (new Set(ids).size !== ids.length || directions.some(d => !/^(?=.{1,200}:$)(?=.*(?:справа|слева|сверху|снизу|размести|расположи|оформление|композиция)).*$/iu.test(input.content.find(f => f.id === d.sourceId)?.text ?? ''))) {
    throw new SemanticValidationError(['only-explicit-spatial-directions-may-be-hidden'])
  }
  return { ...input, content: input.content.filter(f => !ids.includes(f.id)), directions: [...input.directions, ...directions.map(d => input.content.find(f => f.id === d.sourceId)!.text)] }
}
export function validateFastAdaptive(raw: unknown, env: PixelEnvironment) {
  const value = z.object({ directions: directionsSchema, plan: z.unknown() }).strict().parse(raw)
  const input = adaptiveVisibleInput(env.input, value.directions)
  const plan = validateAdaptivePlan(value.plan, input, { fontTokens: env.fontTokens })
  if (plan.version !== ADAPTIVE_FLOW_VERSION) throw new SemanticValidationError(['wrong-adaptive-version'])
  const percentages = input.content.filter(f => /^[+\-−]?\s*\d+(?:[.,]\d+)?\s*%$/u.test(f.text.trim()))
  for (const f of percentages) {
    const part = plan.blocks.flatMap(b => b.parts).find(p => p.fragments.includes(f.id))
    const template = adaptiveComponents(input).find(t => t.id === part?.component?.id)
    if (!part?.component || !template || percentages.filter(f => part.fragments.includes(f.id)).length !== 1 ||
      !part.component.fields.some(field => field.fragments.includes(f.id) && componentSlots(template).some(s => s.metric && s.paths.includes(field.path)))) {
      throw new SemanticValidationError([`standalone-percentage-requires-separate-library-number-field:${f.id}`])
    }
  }
  return { directions: value.directions, plan }
}
export type FastAdaptive = ReturnType<typeof validateFastAdaptive>
export function adaptiveDirectionIssues(input: LayoutInput, result: FastAdaptive, fit: AdaptiveFit) {
  if (!result.directions.some(d => /^справа\s.*карточ/iu.test(input.content.find(f => f.id === d.sourceId)?.text ?? ''))) return []
  const trial = fit.trials.at(-1)!
  const textUnits = result.plan.blocks.flatMap((b, i) => b.parts.flatMap((p, j) => p.component ? [] : [`block-${i}-part-${j}`]))
  const plain = trial.units?.filter(u => textUnits.includes(u.id)) ?? []
  return trial.components?.some(c => !plain.length || c.x < Math.max(...plain.map(p => p.x + p.width)) + 15)
    ? ['explicit-right-card-direction-not-preserved'] : []
}
