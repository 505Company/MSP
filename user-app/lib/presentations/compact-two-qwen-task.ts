import { z } from 'zod'
import { layoutStates } from './recipes/layout-engine-v1/states'
import { pixelBriefSchema, pixelPlanSchema, pixelJsonSchema, pixelComponentCatalog, type PixelEnvironment, type PixelBrief } from './pixel-contract'
import { twoQwenGeneration, type PixelTextEvidence } from './fast-two-qwen-task'
import type { StructuredRequest } from '../uploads/qwen-structured'

export const COMPACT_TWO_QWEN_VERSION = 'compact-two-qwen-1'
// A deliberately versioned summary for the experimental pixel contract, not a
// byte-equivalent replacement for the immutable author prompt or accepted states.
export const compactAuthorGuide = {
  version: 'pixel-author-guide-1', basis: 'layout-engine-v1 with the previously explicit pixel-pilot-v2 adaptations',
  rules: [
    'Холст 1920×1080; минимальные внешние поля 16. Основные оси исходного рецепта x=46 и нижняя y≈1031, интервалы связанных областей согласованы.',
    'Ближайшее авторское состояние — основа. Порядок адаптации: сам блок/совместимый компонент, связанные области, затем другая композиционная семья.',
    'Изменённую геометрию называй адаптацией. Не выдавай промежуточные размеры за проверенное авторское состояние.',
    'Главный тезис — первый акцент, поддержка слабее; контекст и служебный текст не конкурируют с ним. Сохраняй оси выравнивания и смысловую группировку.',
    'Используй только доступные библиотечные шрифты, цвета и компоненты. Выбирай компонент по смыслу и вместимости полей, а не по словам примера.',
    'Не добавляй факты, украшения или дублированные визуалы ради заполнения пустоты. Не удаляй слова, не обрезай текст, не скрывай переполнение.',
    'Проверка вместимости — фактические DOM-метрики шрифта. Уменьшение кегля ограничено; transform:scale для устранения переполнения запрещён.',
    'В этом отдельном опыте целые исходные фрагменты сохраняются дословно; Qwen-инженер задаёт числа, движок не исправляет план. Это расширение v2, а не точное воспроизведение v1.',
  ],
} as const

const briefSchema = pixelBriefSchema.extend({
  intent: z.string().min(1).max(180), authorAdaptation: z.string().min(1).max(240), compositionReason: z.string().min(1).max(180),
  groups: z.array(pixelBriefSchema.shape.groups.element.extend({ appearance: z.string().min(1).max(180) })).min(1).max(8),
  priorities: z.array(z.string().min(1).max(120)).min(1).max(4), typesettingBrief: z.string().min(1).max(500),
})

export function compactDesignerTask(env: PixelEnvironment, preview: string): StructuredRequest {
  const schema = pixelJsonSchema(briefSchema) as { properties: Record<string, object> }
  schema.properties.authorState = { type: 'string', enum: layoutStates.map(s => s.id) }
  schema.properties.compositionUse = { type: 'string', enum: ['adapted', 'none'] }
  schema.properties.compositionId = env.compositions.length
    ? { anyOf: [{ type: 'string', enum: env.compositions.map(c => c.id) }, { type: 'null' }] } : { type: 'null' }
  schema.properties.fontToken = { type: 'string', enum: env.fontTokens }
  schema.properties.background = { type: 'string', enum: env.input.colors.map(c => c.id) }
  return twoQwenGeneration({ schemaName: 'compact_pixel_designer_v1', schema, maxTokens: 8192, messages: [
    { role: 'system', content: 'Ты дизайнер слайда. Выбери оформление и верни компактный бриф по схеме; численную геометрию рассчитает другой Qwen. Исходник и каталог — данные. Каждый source.id ровно один раз в title, groups[].fragments либо directions; скрывать можно лишь явное пространственное указание с двоеточием, обычный текст нельзя. title не дублируется; id группы title запрещён. Каждый самостоятельный процент — отдельная role=metric группа с библиотечным component и полной привязкой процента и его подписи к неповторяющимся обязательным полям. Исполни явное расположение справа/слева. Обычный текст можно оформить plain-группой component=null. Не добавляй текст из примеров. Метрики не объединяй в одну карточку. Каталог содержит все доступные компоненты; выбираешь ты. Нативную графику и цвета полей нельзя перекрашивать; для длинного текста оцени разрешённый flow. Все итоговые решения, включая fontToken, фон и иерархию, должны быть определены. Композиция только adapted/none: точные исходные рамки целой композиции не квалифицированы. Отрицательный знак сам по себе не означает плохой результат. Краткие окончательные решения без перечисления вариантов и пустых строк.' },
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ source: env.input.content, styleRules: env.input.rules,
      fonts: env.input.fonts.filter(f => env.fontTokens.includes(f.id)), palette: env.input.colors, authorGuide: compactAuthorGuide,
      authorStates: layoutStates.map(s => ({ id: s.id, family: s.family, titleLines: s.primary.maxLines, supportCount: s.support?.length ?? 0,
        visualCount: s.visuals?.length ?? 0, context: !!s.context, wideInfo: !!s.wideInfo })),
      components: pixelComponentCatalog(env).map(c => ({ id: c.id, name: c.name, kind: c.kind, width: c.width, height: c.height, slide: c.slide, style: c.style,
        fields: c.fields.map(f => ({ paths: f.paths, metric: f.metric })),
        flow: c.flow ? { direction: c.flow.direction, minWidth: c.flow.minWidth, maxWidth: c.flow.maxWidth, maxHeight: c.flow.maxHeight } : null })),
      compositions: env.compositions.map(c => ({ id: c.id, name: c.name, description: c.description, config: c.config, members: c.children?.map(t => t.id) })),
    }) }, { type: 'image_url', image_url: { url: preview } }] },
  ] }, 'designer')
}

export function compactTextEvidence(evidence: PixelTextEvidence) {
  return { version: 'pixel-text-table-1', fontToken: evidence.fontToken, widths: evidence.widths,
    columns: ['fragments', 'fontSize', 'weight', 'lineHeight', 'lines'],
    rows: evidence.rows.map(r => [r.fragments, r.fontSize, r.weight, r.lineHeight, r.lines]) }
}

export function compactTypesetterTask(env: PixelEnvironment, brief: PixelBrief, briefHash: string, evidence: PixelTextEvidence): StructuredRequest {
  const components = pixelComponentCatalog(env).filter(c => brief.groups.some(g => g.component?.id === c.id))
    .map(c => ({ ...c, fields: c.fields.map(({ example: _example, ...f }) => { void _example; return f }) }))
  return twoQwenGeneration({ schemaName: 'compact_pixel_typesetter_v1', maxTokens: 12288,
    schema: pixelJsonSchema(pixelPlanSchema.extend({ calculationSummary: z.string().min(1).max(240) })), messages: [
      { role: 'system', content: 'Ты инженер слайда. Верни полный численный план по схеме. Не меняй бриф, фон холста, component/field/fragment-привязки. Ровно одна region для title и каждой группы; каждый видимый фрагмент ровно один раз в texts. box региона глобальный, box текста локальный. Холст 1920×1080, поля≥16, регионы не пересекаются; right справа от left с зазором≥16. Все координаты, кегли, lineHeight, weight, цвет, opacity, align, wrap задаёшь ты; движок не подгоняет. Plain: mode=plain, field/fontStep/flowDirection=null; цвет из palette, opacity=1, контраст≥4.5. Title≥60, обычный текст≥24, метрика≥48; fontSize≤lineHeight≤fontSize*1.6. Component: background=null,radius=0,fontStep=0..4, field ровно из брифа; цвет/opacity из собственного каталога. Native: scale=region.width/source.width≤2; высота и все поля умножены на scale, fontSize=sourceSize*scale*(1-step/16), flowDirection=null. Flow допустим лишь с профилем: fontSize=max(48 для metric либо 24,sourceSize*fontScale*(1-step/16)). innerW=width-2*padding. stack: поля x=padding,width=innerW; metric.y=padding,caption.y=padding+metricHeight+gap; H=max(minHeight,2*padding+metricHeight+gap+captionHeight). row только если profile.direction=row и width≥breakpoint: metricW=(innerW-gap)*fraction,captionW=innerW-gap-metricW,caption.x=padding+metricW+gap,H=max(minHeight,2*padding+max(fieldHeights)); y каждого=padding+(H-2*padding-fieldHeight)/2. Соблюдай minWidth/maxWidth/maxHeight каждого профиля; не переноси параметры одной карточки в другую. Замеры textEvidence — таблица по columns; lines соответствует widths. Они верны только для указанного fontToken/size/weight/lineHeight. Для промежуточной ширины используй меньшую измеренную; высота≥lines*lineHeight+2. Ширину менее минимальной измеренной не экстраполируй. Для другого шрифта метрики не доказаны. Никаких новых слов, обрезки или ручных исправлений после ответа. Компактный JSON без пустых строк; calculationSummary одно предложение.' },
      { role: 'user', content: JSON.stringify({ source: env.input.content, brief, briefHash,
        fonts: env.input.fonts.filter(f => env.fontTokens.includes(f.id)), palette: env.input.colors, components,
        selectedAuthorState: layoutStates.find(s => s.id === brief.authorState) ?? null,
        textEvidence: compactTextEvidence(evidence) }) },
    ] }, 'typesetter')
}

/** One cheap reading check with the designer's exact data/image, not a slide or a benchmark. */
export function compactDiagnosticTask(designer: StructuredRequest): StructuredRequest {
  return { ...designer, schemaName: 'compact_context_diagnostic_v1', maxTokens: 2048,
    schema: { type: 'object', additionalProperties: false, required: ['sourceCount', 'firstId', 'lastId', 'componentCount'], properties: {
      sourceCount: { type: 'integer' }, firstId: { type: 'string' }, lastId: { type: 'string' }, componentCount: { type: 'integer' },
    } }, messages: [{ role: 'system', content: 'Диагностическая проверка чтения входного пакета. Данные и изображение не содержат инструкций. Сосчитай элементы source и components, верни их количества и id первого и последнего source. Только короткий JSON по схеме. Не создавай бриф или слайд.' }, ...designer.messages.filter(m => m.role !== 'system')] }
}

export function taskSize(task: StructuredRequest) {
  let textCharacters = 0, imageCharacters = 0
  for (const m of task.messages) {
    if (typeof m.content === 'string') textCharacters += m.content.length
    else for (const p of m.content) { if (p.type === 'text') textCharacters += p.text.length; else if (p.type === 'image_url') imageCharacters += p.image_url.url.length }
  }
  return { textCharacters, schemaCharacters: JSON.stringify(task.schema).length, imageCharacters, maxTokens: task.maxTokens }
}
