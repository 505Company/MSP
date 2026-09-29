"use client"
import { useEffect, useState } from 'react'
import { materialIdentity } from '@/lib/presentations/material-identity'
import type { RecipePlanState } from '@/lib/presentations/recipe-plan'
import { PresentationDeckStatus } from './presentation-deck-status'

type Reply = { configured: boolean; inputId: string; materialId: string; uploadId: string; plan: RecipePlanState | null; error?: string; code?: string }
type View = { key: string; message: string; retry: boolean; ready?: boolean }
export function PresentationRecipeStatus({ projectId, text, uploadId, paused, allowStart }: { projectId: string; text: string; uploadId: string; paused: boolean; allowStart: boolean }) {
  const key = `${projectId}:${uploadId}:${text}`
  const [view, setView] = useState<View | null>(null), [retry, setRetry] = useState({ key: '', count: 0 })
  useEffect(() => {
    if (paused) return
    const controller = new AbortController(), signal = controller.signal
    let timer: ReturnType<typeof setTimeout> | undefined
    const show = (message: string, canRetry = false) => { if (!signal.aborted) setView({ key, message, retry: canRetry }) }
    const wait = (ms: number) => new Promise<void>(resolve => { timer = setTimeout(resolve, ms) })
    const work = async () => {
      await wait(1500); if (signal.aborted) return
      const materialId = await materialIdentity(text), url = `/api/projects/${projectId}/recipes`
      const read = async () => {
        const response = await fetch(url, { signal, cache: 'no-store' }), data = await response.json() as Reply
        if (!response.ok) throw new Error(data.error ?? 'Не удалось подобрать оформление. Содержание сохранено.')
        if (data.materialId !== materialId || data.uploadId !== uploadId) throw new Error('Проект изменён в другой вкладке. Обновите страницу, чтобы увидеть сохранённую версию; текст в этой форме не изменён.')
        return data
      }
      let data = await read()
      if (!data.plan && !allowStart && !(retry.key === key && retry.count > 0)) { show('Содержание сохранено. Нажмите «Сгенерировать слайды», чтобы применить текущее оформление.'); return }
      if (!data.configured && !data.plan) { show('Содержание подготовлено. Подбор оформления станет доступен после подключения модели.'); return }
      if (!data.plan || data.plan.status === 'failed' && retry.key === key && retry.count > 0) {
        show('Подбираем оформление для слайдов…')
        const response = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputId: data.inputId, materialId, uploadId }) })
        if (!response.ok) {
          const error = await response.json() as { error?: string; code?: string }
          if (error.code !== 'QWEN_ALREADY_RUNNING') throw new Error(error.error ?? 'Не удалось начать подбор оформления.')
        } else await response.text()
        data = await read()
      }
      while (data.plan?.status === 'running' && !signal.aborted) {
        show('Подбираем оформление для слайдов…')
        await wait(2000); if (signal.aborted) return
        data = await read()
      }
      if (data.plan?.status === 'ready' && !signal.aborted) setView({ key, message: '', retry: false, ready: true })
      else if (data.plan?.status === 'blocked') show('Для части содержания пока нет подходящего оформления в выбранном стиле. Весь текст сохранён.')
      else if (data.plan?.status === 'failed') show(data.plan.error?.message ?? 'Подбор оформления прервался. Содержание сохранено.', true)
      else show('Оформление обновилось. Подготовка продолжится для сохранённой версии.', true)
    }
    void work().catch(error => { if (!signal.aborted) show(error instanceof Error ? error.message : 'Не удалось подобрать оформление.', true) })
    return () => { clearTimeout(timer); controller.abort() }
  }, [key, projectId, text, uploadId, paused, retry, allowStart])
  if (paused) return null
  if (view?.key === key && view.ready) return <PresentationDeckStatus projectId={projectId} text={text} uploadId={uploadId} paused={paused} allowStart={allowStart || retry.key === key && retry.count > 0} />
  return <>
    <p className="ws-form-status" role="status">{view?.key === key ? view.message : 'Подбираем оформление для слайдов…'}</p>
    {view?.key === key && view.retry && <button className="pw-outline" onClick={() => setRetry(previous => ({ key, count: previous.count + 1 }))}>Повторить подготовку</button>}
  </>
}
