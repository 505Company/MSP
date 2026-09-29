import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { loadJson, saveJson } from './pixel-pilot-store'

const root = 'outputs/diagnostics/qwen-fast-comparison/compact-v1'
const probe = await loadJson(`${root}/probe/result.json`), slide = await loadJson(`${root}/slide/result.json`)
const review = await loadJson(`${root}/probe/review.json`), visual = await loadJson(`${root}/slide/visual-review.json`)
const sizes = await loadJson(`${root}/sizes.json`), budget = await loadJson('outputs/diagnostics/qwen-pixel-service/experiment.json')
const measurement = await loadJson(`${root}/slide/measurement.json`)
const storageReview = await loadJson(`${root}/slide/storage-review.json`), lateReceipt = await loadJson(`${root}/slide/late-receipt.json`)
const pngHash = measurement ? createHash('sha256').update(await readFile(`${root}/slide/slide.png`)).digest('hex') : null
const visuallyAccepted = visual?.verdict === 'pass' && visual?.planHash === measurement?.planHash && visual?.pngSha256 === pngHash
const stages = [probe, slide].filter(Boolean).flatMap(result => result.runs.map((run: typeof probe.runs[number]) => {
  const p = run.provenance ?? run.attempts.at(-1)?.provenance, o = p?.observation
  return { mode: result.mode, role: run.scope.role, status: run.status, error: run.error, requestId: p?.requestId,
    generationId: p?.generationId, model: p?.reportedModel, finishReason: p?.finishReason,
    ttftMs: o?.ttftMs ?? null, firstContentAfterPostMs: o?.firstContentMs !== null && o?.firstContentMs !== undefined && o?.requestSentMs !== null
      ? o.firstContentMs - o.requestSentMs : null,
    headersAfterPostMs: o?.responseHeadersMs !== null && o?.responseHeadersMs !== undefined && o?.requestSentMs !== null
      ? o.responseHeadersMs - o.requestSentMs : null,
    durationMs: p?.elapsedMs, observation: o, usage: p?.usage, reasoning: p?.reasoning, receipt: p?.routingReceipt }
}))
const seconds = (ms: number | null | undefined) => ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(2)} с`
const percentage = (stage: 'designer' | 'typesetter') => (100 * (1 - sizes[stage].after.textCharacters / sizes[stage].before.textCharacters)).toFixed(1)
const metrics = { stages, sizes, sharedUsed: budget.used, sharedLimit: budget.maxRequests,
  probeTransportPassed: probe?.passed || review?.transportPassed || false,
  slideTechnicalPass: slide?.technicalPass ?? false, visuallyAccepted: !!visuallyAccepted,
  slideGenerationMs: slide?.elapsedMs, slideGenerationWithinTarget: slide?.generationWithinTarget ?? false,
  receiptCostRub: stages.reduce((sum: number, s: typeof stages[number]) => sum + (s.receipt?.totalCostRub ?? 0), 0),
  missingReceipts: stages.filter((s: typeof stages[number]) => !s.receipt).length,
  limitations: ['TTFT is first nonempty model delta, not server profiling.', 'Old timeout causes cannot be reconstructed.', 'The short diagnostic is not a slide benchmark.', 'Reasoning text is never persisted.', 'Concurrent application activity is reported separately.'] }
await saveJson(`${root}/metrics.json`, metrics)
const lines = ['# Диагностика и компактные два Qwen', '',
  `Общий расход: **${budget.used}/${budget.maxRequests}**. В этой последовательности: короткая проверка ${probe?.newRequests ?? 0}, полный слайд ${slide?.newRequests ?? 0}. Платных повторов нет.`, '',
  `Текст дизайнера: ${sizes.designer.before.textCharacters} → ${sizes.designer.after.textCharacters} символов (−${percentage('designer')}%). Расчётчик на том же брифе: ${sizes.typesetter.before.textCharacters} → ${sizes.typesetter.after.textCharacters} (−${percentage('typesetter')}%). Это не токены. Превью и исходные фрагменты сохранены.`, '',
  '| Этап | Статус | Заголовки после POST | Первый фрагмент модели | Первый content | Запрос целиком | Вход / выход | Reasoning токены |',
  '|---|---|---:|---:|---:|---:|---:|---:|',
  ...stages.map((s: typeof stages[number]) => `| ${s.mode}/${s.role} | ${s.status} ${s.error?.code ?? ''} | ${seconds(s.headersAfterPostMs)} | ${seconds(s.ttftMs)} | ${seconds(s.firstContentAfterPostMs)} | ${seconds(s.durationMs)} | ${s.usage?.promptTokens ?? '—'} / ${s.usage?.completionTokens ?? '—'} | ${s.reasoning?.tokens ?? '—'} |`), '',
  'В полном запуске дизайнер начал reasoning через 4,156 с после POST и передавал его до отметки 239,379 с от начала запроса. Сохранены 4361 непустой reasoning-фрагмент и счётчик 13937 символов; contentCharacters=0, firstContentMs=null, finishReason=null. Ни одного символа итогового JSON не получено. Это показывает длительную фазу рассуждений в данном запуске; длительное начальное ожидание или потеря всех данных потока его не объясняют. Почему модель не перешла к ответу, пока не установлено. reasoning=low не обеспечил нужное время. Текст рассуждений не сохранялся.', '',
  'Content — видимый канал ответа. При ошибке в нём может быть только незавершённый JSON; он не считается готовым планом. Служебный первый байт/событие и первый модельный фрагмент различаются. Недоступный usage не заменён нулём.', '',
  `Короткая проверка: ${metrics.probeTransportPassed ? 'ответ и маршрут проверены' : 'не пройдена'}, ${seconds(probe?.elapsedMs)}. Проверено чтение числа исходных фрагментов и компонентов и крайних ID. Это не дизайн и не измерение полной генерации.`, '',
  ...(review ? ['В исходном probe/result.json общий passed=false сохранён: во время запроса шёл другой импорт и изменились записи semantic-scans. Сам пробный запуск не открывал браузер и писал только локальные диагностические файлы; SQL-инвентарь читался readOnly. Проверка транспорта/ответа принята отдельно в probe/review.json; неизменность всего общего хранилища не заявляется.', ''] : []),
  slide ? `Полный слайд: **${seconds(slide.elapsedMs)}**, технический результат ${slide.technicalPass ? 'PASS' : 'не получен'}, визуальная проверка ${visuallyAccepted ? 'PASS' : visual?.verdict ?? 'не выполнена'}. ${slide.failure ?? ''}` : 'Полный слайд ещё не завершён.', '',
  ...(slide?.runs.flatMap((r: typeof probe.runs[number]) => r.error?.issues?.map((issue: string) => `- ${issue}`) ?? []) ?? []), '',
  ...(measurement ? ['![Новый слайд](slide/slide.png)', ''] : ['Нового PNG нет.', '']),
  ...(storageReview ? [`Полный инвентарь изменился на ${storageReview.changedCount} записей; все изменения относятся к другому импорту: ${storageReview.allChangesBelongToOtherImport}. Замороженный источник неизменен: ${storageReview.frozenSourceUnchanged}. [Аудит совместной работы](slide/storage-review.json).`, ''] : []),
  `Стоимость по полученным квитанциям: ${metrics.receiptCostRub.toFixed(6)} ₽. Запросов без квитанции: ${metrics.missingReceipts}; их стоимость неизвестна.`, '',
  ...(lateReceipt ? [`Повторный GET квитанции дизайнера: ${lateReceipt.code ?? 'получена'}. Ошибка проверки маршрута после тайм-аута не доказывает нулевую стоимость или использование другого провайдера; аттестованной квитанции для него нет.`, ''] : []),
  'Клиент теперь сохраняет частичный ответ/ID/счётчики и время при EOF, socket reset, SSE error, malformed JSON, timeout и cancel. Незавершённый ответ не валидируется и не кешируется. Текст приватных рассуждений не записывается. Прежние успешные кеши остаются совместимы.', '',
  'Проверки: 402 Node-теста, typecheck/lint; реальное browser-измерение и точный рендер используют прежний проверенный путь. Новая компактная инструкция — отдельный экспериментальный профиль; исходный авторский промпт и ранее сохранённые ответы неизменны.', '',
  '[Параметры и границы](LAUNCH.md) · [Метрики](metrics.json) · [Короткая проверка](probe/result.json)' + (slide ? ' · [Полный прогон](slide/result.json)' : '') + ' · [Предыдущее сравнение](../RESULTS.md)', '',
  'BF16 объявлен endpoint; аппаратная точность/revision не аттестованы. Один успешный короткий ответ не объясняет прежние тайм-ауты и не гарантирует задержку будущего слайда.', '']
await writeFile(`${root}/RESULTS.md`, lines.join('\n'))
console.log(JSON.stringify({ stages: stages.map((s: typeof stages[number]) => ({ role: s.role, status: s.status, ttftMs: s.ttftMs, durationMs: s.durationMs })),
  slideTechnicalPass: metrics.slideTechnicalPass, visuallyAccepted: metrics.visuallyAccepted, receiptCostRub: metrics.receiptCostRub, missingReceipts: metrics.missingReceipts }))
