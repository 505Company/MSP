import { pixelDesignerReasonedTask, pixelTypesetterTask } from './pixel-task'
import type { PixelBrief, PixelEnvironment } from './pixel-contract'
import type { StructuredRequest } from '../uploads/qwen-structured'

export const fastTwoQwenProfile = {
  version: 'fast-two-qwen-1', targetMs: 300_000, maxRequests: 2,
  thinking: true, reasoningEffort: 'low' as const,
  maxTokens: { designer: 8192, typesetter: 12288 },
  plannedSeconds: { sourceAndFonts: 10, designer: 80, textMeasurement: 10, typesetter: 150, render: 10, reserve: 40 },
  transportTimeoutMs: 240_000,
  review: 'Browser source/geometry/PNG checks, followed by Codex visual inspection; no third model request.',
} as const
export function twoQwenGeneration(task: StructuredRequest, role: 'designer' | 'typesetter'): StructuredRequest {
  return { ...task, thinking: true, reasoningEffort: 'low', maxTokens: fastTwoQwenProfile.maxTokens[role],
    sampling: { temperature: 1, topP: 0.95, topK: 20, minP: 0, repetitionPenalty: 1, presencePenalty: 0 } }
}
export function fastTwoDesignerTask(env: PixelEnvironment, preview: string): StructuredRequest {
  const task = pixelDesignerReasonedTask(env, preview)
  task.messages.push({ role: 'user', content: 'Быстрый последовательный режим: ты только дизайнер, далее отдельный Qwen рассчитает геометрию. Максимально компактный законченный JSON: intent, adaptation, reason, appearance по одному короткому предложению, typesettingBrief до 500 символов. Не перечисляй отвергнутые варианты. title не дублируется ни в одной группе; regionId=title зарезервирован. Самостоятельные проценты — разные metric groups с библиотечными компонентами и полными полями. Исполни исходное размещение. Выбирай компоненты по полям и допустимой адаптации; для длинных подписей учитывай квалифицированный flow. Обычный текст не превращай в подпись. Не обещай перекраску нативной графики: это недоступно. Исходный знак минуса не означает отрицательную оценку. Бриф должен быть сразу исполнимым, без если получится и без новых слов в содержании. Для инженера останется только точная геометрия. Без пустых строк в JSON.' })
  return twoQwenGeneration(task, 'designer')
}
export type PixelTextEvidence = {
  version: 'pixel-text-evidence-1'; fontToken: string; widths: number[]
  rows: { fragments: string[]; fontSize: number; weight: number; lineHeight: number; lines: number[] }[]
}
export function fastTwoTypesetterTask(env: PixelEnvironment, brief: PixelBrief, briefHash: string, evidence: PixelTextEvidence): StructuredRequest {
  const task = pixelTypesetterTask(env, brief, briefHash)
  task.messages.push({ role: 'user', content: JSON.stringify({ textEvidence: evidence,
    instruction: 'Измерения сделаны настоящим браузером с выбранным дизайнером шрифтом. Это справочник переносов, а не готовые координаты или план. В каждой строке lines соответствует widths. Нужная высота текста >= lines*lineHeight, округли вверх и добавь 2px запаса; при промежуточной ширине используй консервативно ближайшую МЕНЬШУЮ измеренную ширину. Изменение кегля/weight меняет метрику; используй измеренные значения для обычного текста, а для компонентов соблюдай точную формулу fontStep из их собственного профиля. Используй brief.fontToken. Не применяй размеры первой карточки ко второй: их padding/gap/поля могут отличаться. Не перепутай локальные координаты текста с глобальными координатами региона. Flow caption.y=padding+metricHeight+gap; region.height=2*padding+metricHeight+gap+captionHeight для stack. В каждый текстовый box заложи полную измеренную высоту. Все координаты, размеры, кегли и интервалы выбери и запиши сам; после ответа движок ничего не подгоняет. Перепроверь сохранность и столкновения до ответа. calculationSummary — одно короткое предложение. Верни компактный полный JSON без пустых строк.' }) })
  return twoQwenGeneration(task, 'typesetter')
}
