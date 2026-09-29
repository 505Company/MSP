import { z } from 'zod'
import type { SourceSnapshot } from '../../digital-designer/source-types'
import { SemanticValidationError } from '../../design-system/semantic-contract'
import { readSourceScene } from '../../design-system/source-scene'
import { templateExtractionTask } from './template-task'
import { templateProposalSchema, validateTemplateProposal } from './template-contract'

const extractionSchema = z.object({
  profile: z.enum(['repeated-text', 'paired-percent', 'unsupported']),
  proposal: templateProposalSchema.nullable(), reason: z.string().min(1).max(500),
}).strict()
export type DiscoveryExtraction = z.infer<typeof extractionSchema>
export function discoveryExtractionTask(snapshot: SourceSnapshot, previews: { slideId: string; dataUrl: string }[], allowedSlides: string[], rejected?: { issues: string[]; response: string }) {
  const task = templateExtractionTask(snapshot, previews, { excludeSlideIds: snapshot.slides.filter(s => !allowedSlides.includes(s.id)).map(s => s.id), limit: 5, additionalFamily: true, discovery: true })
  task.schemaName = 'recipe_discovery_extraction_v2'
  task.schema = { type: 'object', additionalProperties: false, required: ['profile', 'proposal', 'reason'], properties: {
    profile: { type: 'string', enum: ['repeated-text', 'paired-percent', 'unsupported'] },
    proposal: { anyOf: [task.schema, { type: 'null' }] }, reason: { type: 'string', minLength: 1, maxLength: 500 },
  } }
  task.messages[0] = { role: 'system', content: `${task.messages[0].content}
Это автономное пополнение библиотеки. Верни оболочку {profile, proposal, reason}, а описанный выше полный рецепт помести в proposal. Код поддерживает только repeated-text: 2–8 равноправных текстовых пунктов с heading/body, и paired-percent: такие же пункты с ровно двумя нативными процентами у каждого. Выбор профиля и смысловые роли определяешь ты. Даже одиночный процент, диапазон процентов или индекс в карточке НЕ является обычным body текстового профиля. Такие количественные семьи пока не поддерживаются, если нет обязательных двух скалярных процентов на пункт. Парные показатели нельзя спрятать в optional note и назвать текстовым рецептом. Полосы/плашки и показатели будут отдельно уточнены моделью. Не поддерживаются произвольные диаграммы, таблицы, процессы, фотографии с фактическими подписями, растр с неотделимым текстом. Если ни один ПОЛНЫЙ кандидат не подходит, верни unsupported, proposal=null и конкретную причину. Это нормальный результат, не повод выдумывать поля. Нельзя выделить лишь удобную часть слайда, удалив остальные смысловые блоки. graphics принимает только НЕтекстовые leaf-объекты; нельзя пометить исходный текст как graphics/source-only, чтобы избавиться от сложной семантики. Для настоящего текста sourceOnlyText разрешает лишь номер страницы и данные мероприятия, не числовые факты. Все показанные слайды уже отфильтрованы по библиотеке. Не копируй факты исходника в повторно используемую графику.` }
  if (rejected) task.messages.push({ role: 'user', content: JSON.stringify({ previousRejected: rejected.response, issues: rejected.issues,
    instruction: 'Предыдущая полная попытка и её уточнение не прошли контракт. Это последняя попытка поиска в данном задании. Можно выбрать другой переданный слайд или вернуть unsupported. Не повторяй исключение содержательных текстов через graphics. Не меняй данные и не маскируй метрики как body.' }) })
  return task
}
export function validateDiscoveryExtraction(raw: unknown, snapshot: SourceSnapshot, allowedSlides: string[]): DiscoveryExtraction {
  const parsed = extractionSchema.safeParse(raw)
  if (!parsed.success) throw new SemanticValidationError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 20))
  const value = parsed.data
  if (value.profile === 'unsupported') {
    if (value.proposal) throw new SemanticValidationError(['unsupported-requires-null-proposal'])
    return value
  }
  if (!value.proposal) throw new SemanticValidationError(['supported-profile-requires-proposal'])
  validateTemplateProposal(value.proposal, snapshot, allowedSlides)
  if (value.profile === 'repeated-text') {
    const scene = readSourceScene(snapshot)
    const percentages = value.proposal.slots.filter(s => s.item > 0 && /\d\s*%/.test(scene.records.get(s.sourceId)?.element.kind === 'text' ? (scene.records.get(s.sourceId)!.element as { text: string }).text : ''))
    if (percentages.length) throw new SemanticValidationError(['quantitative-slots-require-paired-percent-or-unsupported: исходные проценты нельзя оставлять необязательной подписью текстового семейства'])
  }
  return value
}
