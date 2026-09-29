"use client"
import { useEffect, useState } from 'react'
import { materialIdentity } from '@/lib/presentations/material-identity'
import { executeLayoutGeneration, layoutDelay, LayoutGenerationError } from '@/browser/layout-generation'
import type { LayoutView } from '@/lib/presentations/layout-workflow'
import type { publicLayoutJob } from '@/lib/presentations/layout-jobs'
import { PresentationSlideGallery, type SlidePreview } from './presentation-slide-gallery'

export function PresentationLayoutStatus({ projectId, text, uploadId, paused, allowStart }: { projectId: string; text: string; uploadId: string; paused: boolean; allowStart: boolean }) {
  const key = `${projectId}:${uploadId}:${text}`
  const [retry, setRetry] = useState(0), [view, setView] = useState<{ key: string; message: string; data?: LayoutView; retry?: boolean } | null>(null)
  const [savedSlides, setSavedSlides] = useState<{ key: string; slides: SlidePreview[] } | null>(null)
  useEffect(() => {
    if (paused) return
    const controller = new AbortController(), signal = controller.signal
    let latest: LayoutView | undefined
    const show = (message: string, canRetry = false) => { if (!signal.aborted) setView({ key, message, data: latest, retry: canRetry }) }
    const work = async () => {
      const materialId = await materialIdentity(text), url = `/api/projects/${projectId}/layout`, generation = `/api/projects/${projectId}/generation`
      const state = async () => {
        const response = await fetch(generation, { signal, cache: 'no-store' })
        if (!response.ok) throw Error('Не удалось проверить фоновый обработчик.')
        return response.json() as Promise<{ available: boolean; job: ReturnType<typeof publicLayoutJob> }>
      }
      const background = await state()
      if (!allowStart && !retry && background.job?.status === 'complete') {
        const response = await fetch(`/api/projects/${projectId}/slides`, { signal, cache: 'no-store' })
        if (!response.ok) throw Error('Не удалось открыть сохранённые слайды.')
        const saved = await response.json() as { presentation: { slides: SlidePreview[] } | null }
        if (saved.presentation?.slides.length) {
          if (!signal.aborted) setSavedSlides({ key, slides: saved.presentation.slides })
          show(`Презентация готова: ${saved.presentation.slides.length} слайдов.`); return
        }
      }
      if (!background.available && !background.job && (allowStart || retry > 0)) {
        await executeLayoutGeneration(projectId, { signal, materialId, uploadId, retry: retry > 0, onUpdate: (data, message) => { latest = data; show(message) } })
        return
      }
      let enqueued = false
      for (;;) {
        signal.throwIfAborted()
        const r = await fetch(url, { signal, cache: 'no-store' }), data = await r.json() as LayoutView & { configured: boolean; error?: string }
        if (!r.ok) throw Error(data.error ?? 'Не удалось подготовить рецепт.')
        if (data.materialId !== materialId || data.uploadId !== uploadId) throw Error('Проект изменился. Обновите страницу для сохранённой версии.')
        latest = data
        if (data.status === 'ready') { show(`Презентация готова: ${data.slides.length} слайдов.`); return }
        if (data.status === 'blocked') { show(data.slides.find(s => s.phase === 'blocked')?.error ?? 'Содержание не помещается в состояния нового рецепта. Исходный текст сохранён.'); return }
        if (!allowStart && !retry && data.next?.phase === 'failed') { show(data.next.error ?? 'Подготовка прервалась. Проверенные этапы сохранены.', data.next.errorCode !== 'LAYOUT_BUDGET_EXHAUSTED'); return }
        if (!data.configured && data.next?.phase !== 'render') { show('Содержание сохранено. Для создания слайдов требуется подключение модели.'); return }
        const status = await state(), job = status.job?.inputId === data.inputId ? status.job : null
        if (!enqueued && (allowStart || retry > 0)) {
          const response = await fetch(generation, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputId: data.inputId, retry: retry > 0 }) })
          if (!response.ok) throw Error((await response.json() as { error?: string }).error ?? 'Не удалось продолжить генерацию.')
          enqueued = true
        }
        if (!enqueued && !job) { show('Содержание сохранено. Нажмите «Сгенерировать слайды», чтобы применить текущее оформление.'); return }
        if (job?.status === 'blocked') { show(job.error ?? 'Создание прервалось. Проверенные этапы сохранены.', data.next?.errorCode !== 'LAYOUT_BUDGET_EXHAUSTED'); return }
        if (job?.status === 'cancelled') throw new LayoutGenerationError('Проект изменился. Обновите страницу для сохранённой версии.')
        show(status.available ? job?.progress.detail ?? 'Генерация ожидает обработчика…' : 'Генерация сохранена в очереди. Ожидаем подключения обработчика…')
        await layoutDelay(2000, signal)
      }
    }
    void work().catch(e => { if (!signal.aborted) show(e instanceof Error ? e.message : 'Не удалось создать слайды.', !(e instanceof LayoutGenerationError) || e.canRetry) })
    return () => controller.abort()
  }, [key, projectId, text, uploadId, paused, retry, allowStart])
  if (paused) return null
  const current = view?.key === key ? view : null
  return <section aria-label="Презентация">
    <p className="ws-form-status" role="status">{current?.message ?? 'Подготавливаем слайды…'}</p>
    {current?.retry && <button className="pw-outline" onClick={() => setRetry(n => n + 1)}>Продолжить создание</button>}
    <PresentationSlideGallery slides={current?.data?.slides.map(s => ({ id: s.id, title: s.title,
      image: s.previewRound !== undefined ? `/api/projects/${projectId}/layout/preview?inputId=${current.data!.inputId}&slideId=${encodeURIComponent(s.id)}&round=${s.previewRound}&render=${current.data!.renderVersion}` : undefined,
      status: s.phase === 'ready' ? 'Готов' : s.phase === 'blocked' ? 'Не прошёл проверку' : s.phase === 'failed' ? 'Подготовка прервалась' : s.previewRound !== undefined ? 'Проверяем оформление' : s.phase === 'plan' ? 'Ожидает подготовки' : 'Создаём слайд',
    })) ?? (!allowStart && savedSlides?.key === key ? savedSlides.slides : [])} />
  </section>
}
