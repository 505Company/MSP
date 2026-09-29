import { prepareLayoutFonts } from './layout-fonts'
import { fitLayout } from './layout-execution'
import { renderTemplateRecipe } from './template-recipe-execution'
import { fitAdaptiveLayout } from './adaptive-layout'
import type { LayoutView } from '../lib/presentations/layout-workflow'

export class LayoutGenerationError extends Error {
  constructor(message: string, readonly retryable = false, readonly canRetry = true) { super(message) }
}
const temporary = /^(QWEN_(UNAVAILABLE|TIMEOUT|TRUNCATED|INCOMPLETE|INTERRUPTED|STREAM_INTERRUPTED|RESPONSE_FAILED|EMPTY|INVALID_JSON|CANCELLED|HTTP_(429|500|502|503|504)))$/
export async function layoutDelay(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(finish, ms)
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
export async function executeLayoutGeneration(projectId: string, options: {
  signal?: AbortSignal; inputId?: string; materialId?: string; uploadId?: string; retry?: boolean
  onUpdate?: (view: LayoutView, message: string) => void
} = {}) {
  const { signal } = options, url = `/api/projects/${projectId}/layout`, retries = new Map<string, number>()
  let manualRetry = Boolean(options.retry)
  const post = async (body: object) => {
    const response = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) {
      const error = await response.json() as { code?: string; error?: string }
      if (error.code !== 'QWEN_ALREADY_RUNNING') throw new LayoutGenerationError(error.error ?? 'Не удалось продолжить создание слайдов.', temporary.test(error.code ?? `QWEN_HTTP_${response.status}`), error.code !== 'LAYOUT_BUDGET_EXHAUSTED')
    } else await response.text()
  }
  for (;;) {
    signal?.throwIfAborted()
    const response = await fetch(url, { signal, cache: 'no-store' }), view = await response.json() as LayoutView & { configured: boolean; error?: string }
    if (!response.ok) throw new LayoutGenerationError(view.error ?? 'Не удалось подготовить рецепт.')
    if (options.inputId && view.inputId !== options.inputId || options.materialId && view.materialId !== options.materialId || options.uploadId && view.uploadId !== options.uploadId) throw new LayoutGenerationError('Проект изменился. Продолжим для сохранённой версии.', false, false)
    const done = view.slides.filter(s => s.phase === 'ready').length
    if (view.status === 'ready') { options.onUpdate?.(view, `Презентация готова: ${view.slides.length} слайдов.`); return view }
    if (view.status === 'blocked') {
      const message = view.slides.find(s => s.phase === 'blocked')?.error ?? 'Содержание не помещается в состояния рецепта. Исходный текст сохранён.'
      options.onUpdate?.(view, message)
      throw new LayoutGenerationError(message, false, false)
    }
    const next = view.next
    if (!next) throw new LayoutGenerationError('Не найден следующий этап генерации.')
    const message = next.phase === 'review' ? 'Проверяем оформление слайда…' : next.phase === 'render' ? 'Проверяем текст и композицию…' : `Создаём слайды: ${done} из ${view.slides.length}…`
    options.onUpdate?.(view, message)
    if (!view.configured && !['render', 'running'].includes(next.phase)) throw new LayoutGenerationError('Содержание сохранено. Для создания слайдов требуется подключение модели.', false, false)
    if (next.phase === 'running') { await layoutDelay(2000, signal); continue }
    const action = next.phase === 'render' ? 'report' : next.plan && next.fit?.passed || next.template && next.templateFit?.passed || next.adaptive && next.adaptiveFit?.passed ? 'review' : 'plan'
    let retry = false
    if (next.phase === 'failed') {
      const key = `${view.inputId}:${next.id}:${next.round}:${action}`, count = retries.get(key) ?? 0
      if (!manualRetry && (!temporary.test(next.errorCode ?? '') || count >= 2)) throw new LayoutGenerationError(next.error ?? 'Создание прервалось. Проверенные этапы сохранены.', false, next.errorCode !== 'LAYOUT_BUDGET_EXHAUSTED')
      retry = true; retries.set(key, count + 1)
      options.onUpdate?.(view, 'Повторяем временно прерванный этап…')
      if (!manualRetry) await layoutDelay(count ? 15000 : 3000, signal)
    }
    const common = { inputId: view.inputId, slideId: next.id, round: next.round }
    if (action === 'review') await post({ ...common, action, retry })
    else if (action === 'report' && next.template) {
      const { recipe, material, plan } = next.template
      const report = await renderTemplateRecipe(recipe, material, plan)
      signal?.throwIfAborted()
      await post({ ...common, action, fit: report })
    }
    else {
      const fonts = await prepareLayoutFonts(next.input)
      signal?.throwIfAborted()
      if (action === 'plan') await post({ ...common, action, evidence: { fontTokens: fonts.fontTokens }, retry })
      else {
        if (!next.adaptive && !CSS.supports('text-box-trim', 'trim-both')) throw new LayoutGenerationError('Браузер не поддерживает точную вёрстку. Требуется обновить служебный обработчик.')
        if (!fonts.fontTokens.includes((next.adaptive ?? next.plan)!.fontToken)) throw new LayoutGenerationError('Выбранный исходный шрифт сейчас недоступен.')
        const options = { signal, fontCss: Object.values(fonts.css).join('\n') }
        const rendered = next.adaptive ? await fitAdaptiveLayout(next.input, next.adaptive, next.planHash!, options) : await fitLayout(next.input, next.plan!, next.planHash!, options)
        signal?.throwIfAborted()
        await post({ ...common, action, fit: rendered.fit, ...(rendered.preview ? { preview: rendered.preview } : {}) })
      }
    }
    manualRetry = false
  }
}
