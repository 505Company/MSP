"use client"
import { useEffect, useState } from 'react'
import { loadPresentationReader } from '@/lib/digital-designer/browser-loader'
import { materialIdentity } from '@/lib/presentations/material-identity'
import type { deckView, DeckState } from '@/lib/presentations/deck'
import { PresentationSlideGallery } from './presentation-slide-gallery'
type Reply = ReturnType<typeof deckView> & { error?: string; code?: string }
export function PresentationDeckStatus({ projectId, text, uploadId, paused, allowStart }: { projectId: string; text: string; uploadId: string; paused: boolean; allowStart: boolean }) {
  const key = `${projectId}:${uploadId}:${text}`, [retry, setRetry] = useState({ key: '', count: 0 })
  const [view, setView] = useState<{ key: string; message: string; retry?: boolean; state?: DeckState } | null>(null)
  useEffect(() => {
    if (paused) return
    const controller = new AbortController(), signal = controller.signal
    const show = (message: string, state?: DeckState, canRetry = false) => { if (!signal.aborted) setView({ key, message, state, retry: canRetry }) }
    const work = async () => {
      const materialId = await materialIdentity(text), url = `/api/projects/${projectId}/deck`, assetCache = new Map<string, Uint8Array>()
      const read = async () => {
        const response = await fetch(url, { signal, cache: 'no-store' }), data = await response.json() as Reply
        if (!response.ok) throw new Error(data.error ?? 'Не удалось подготовить слайды.')
        if (data.materialId !== materialId || data.uploadId !== uploadId) throw new Error('Проект изменён в другой вкладке. Обновите страницу, чтобы увидеть сохранённую версию.')
        return data
      }
      const post = async (body: object) => {
        const response = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        if (!response.ok) { const error = await response.json() as { code?: string; error?: string }; if (error.code !== 'QWEN_ALREADY_RUNNING') throw new Error(error.error ?? 'Не удалось продолжить создание слайдов.') }
        else await response.text()
      }
      const dataUrl = async (url: string) => {
        const response = await fetch(url, { signal }); if (!response.ok) throw new Error('Не удалось загрузить образец оформления.')
        const bytes = new Uint8Array(await response.arrayBuffer()); let binary = ''; for (const b of bytes) binary += String.fromCharCode(b)
        return `data:image/png;base64,${btoa(binary)}`
      }
      let retryRequested = retry.key === key && retry.count > 0
      for (;;) {
        signal.throwIfAborted()
        const data = await read(), state = data.state, completed = state?.slides.filter(s => s.fittedAttempt || s.status === 'ready').length ?? 0
        if (state?.status === 'ready') { show(`Презентация готова: ${state.slides.length} слайдов.`, state); return }
        if (state?.status === 'blocked') { show(state.error ?? 'Часть содержания пока не удалось разместить в выбранном оформлении. Исходный текст и готовые слайды сохранены.', state); return }
        if (state?.status === 'failed' && !retryRequested) { show(state.error ?? 'Создание слайдов прервалось. Готовые слайды сохранены.', state, true); return }
        if (!allowStart && !retryRequested) { show('Содержание сохранено. Нажмите «Сгенерировать слайды», чтобы продолжить.', state ?? undefined); return }
        const kind = data.next?.kind
        show(kind === 'catalog' || kind === 'search' ? 'Подбираем графику из дизайн-системы…' : kind === 'review' || kind === 'begin-review' || kind === 'settle-review' ? 'Проверяем оформление и согласованность слайдов…' : kind === 'reselect' ? 'Подбираем более подходящее оформление…' : `Создаём и проверяем слайды${state ? `: ${completed} из ${state.slides.length}` : ''}…`, state ?? undefined)
        if (state?.slides.some(s => s.status === 'running') || state?.jobs.some(j => j.status === 'running')) { await new Promise<void>(resolve => { const timer = setTimeout(resolve, 2000); signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true }) }); continue }
        const next = data.next; if (!next) return
        if (!['catalog','evidence','scene','render'].includes(next.kind)) {
          await post({ action: 'advance', inputId: data.inputId, ...(retryRequested ? { retry: true } : {}) }); retryRequested = false; continue
        }
        const input = next.input; if (!input) throw new Error('Не удалось получить данные слайда.')
        if (next.kind === 'scene') {
          const reference = await dataUrl(next.referenceUrl!); signal.throwIfAborted()
          await post({ action: 'advance', inputId: data.inputId, reference, ...(retryRequested ? { retry: true } : {}) }); retryRequested = false; continue
        }
        const reader = await loadPresentationReader()
        const ids = [...new Set(input.resources.flatMap(c => c.source.assetIds))]
        // Failed resources are excluded by preflight. Used resources must load completely at render time.
        for (const id of ids) if (!assetCache.has(id)) {
          const response = await fetch(`/api/uploads/${uploadId}/assets/${id}`, { signal })
          if (response.ok) assetCache.set(id, new Uint8Array(await response.arrayBuffer()))
        }
        const assets = [...assetCache].map(([id, bytes]) => ({ id, bytes }))
        if (next.scene && next.sceneHash) {
          const rendered = await reader.renderDeckSlide(next.scene, input, next.sceneHash, assets); signal.throwIfAborted()
          await post({ action: 'report', inputId: data.inputId, slideId: input.slideId, report: rendered.report, preview: rendered.preview })
        } else {
          const evidence = await reader.prepareDeckEvidence(input.resources, input.brand.tokens.fonts.map(f => f.family), assets)
          if (!evidence.fonts.length) throw new Error('Шрифты выбранного стиля недоступны в браузере. Исходное содержание сохранено.')
          signal.throwIfAborted()
          await post({ action: next.kind, inputId: data.inputId, evidence, ...(next.kind === 'catalog' ? { pageId: next.pageId } : { slideId: input.slideId }) })
        }
      }
    }
    void work().catch(error => { if (!signal.aborted) show(error instanceof Error ? error.message : 'Не удалось подготовить слайды.', undefined, true) })
    return () => controller.abort()
  }, [key, projectId, text, uploadId, paused, retry, allowStart])
  if (paused) return null
  const current = view?.key === key ? view : null
  return <section aria-label="Презентация">
    <p className="ws-form-status" role="status">{current?.message ?? 'Создаём и проверяем слайды…'}</p>
    {current?.retry && <button className="pw-outline" onClick={() => setRetry(previous => ({ key, count: previous.count + 1 }))}>Продолжить создание</button>}
    <PresentationSlideGallery slides={current?.state?.slides.map(s => ({ id: s.id, title: s.title,
      image: s.fittedAttempt || s.status === 'ready' ? `/api/projects/${projectId}/deck/preview?inputId=${current.state!.inputId}&slideId=${encodeURIComponent(s.id)}&sceneHash=${s.attempts.find(a => a.number === s.fittedAttempt)?.sceneHash ?? ''}` : undefined,
      status: s.status === 'ready' ? 'Готов' : s.status === 'failed' || s.status === 'blocked' ? 'Подготовка остановлена' : s.fittedAttempt ? 'Проверяем оформление' : 'Создаём слайд',
    })) ?? []} />
  </section>
}
