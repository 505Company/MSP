"use client"
import { useEffect, useState } from 'react'
import type { StructureState } from '@/lib/presentations/structure'
import { materialIdentity } from '@/lib/presentations/material-identity'
import { PresentationRecipeStatus } from './presentation-recipe-status'
import { PresentationLayoutStatus } from './presentation-layout-status'
import { activeRecipe } from '@/lib/presentations/active-recipe'

type Reply = { configured: boolean; materialId: string; structure: StructureState | null; error?: string; code?: string }
type View = { key: string; message: string; retry: boolean; ready?: boolean }

/** Automatic processing is intentionally represented by one status line. The
 * model contract, intermediate blocks and IDs are not an extra user workflow. */
export function PresentationStructureStatus({ projectId, text, uploadId, paused, stylePaused, allowStart }: { projectId: string; text: string; uploadId: string; paused: boolean; stylePaused: boolean; allowStart: boolean }) {
  const key = `${projectId}:${text}`
  const [view, setView] = useState<View | null>(null)
  const [retry, setRetry] = useState({ key: '', count: 0 })
  useEffect(() => {
    if (paused) return
    const controller = new AbortController(), signal = controller.signal
    let timer: ReturnType<typeof setTimeout> | undefined
    let expectedMaterialId = ''
    const show = (message: string, canRetry = false) => { if (!signal.aborted) setView({ key, message, retry: canRetry }) }
    const wait = (ms: number) => new Promise<void>(resolve => { timer = setTimeout(resolve, ms) })
    const url = `/api/projects/${projectId}/structure`
    const read = async () => {
      const response = await fetch(url, { signal, cache: 'no-store' }), data = await response.json() as Reply
      if (!response.ok) throw new Error(data.error ?? 'Не удалось подготовить содержание. Текст сохранён.')
      if (data.materialId !== expectedMaterialId) throw new Error('Проект изменён в другой вкладке. Обновите страницу, чтобы увидеть сохранённую версию; текст в этой форме не изменён.')
      return data
    }
    const work = async () => {
      // Let autosave settle before a paid request; an edit cancels this timer.
      await wait(1500); if (signal.aborted) return
      expectedMaterialId = await materialIdentity(text)
      let data = await read()
      if (!data.structure && !allowStart && !(retry.key === key && retry.count > 0)) { show('Содержание сохранено. Нажмите «Сгенерировать слайды», когда будете готовы.'); return }
      if (!data.configured && !data.structure) { show('Содержание сохранено. Автоматическая подготовка станет доступна после подключения модели.'); return }
      if (!data.structure || data.structure.status === 'failed' && retry.key === key && retry.count > 0) {
        show('Распределяем содержание по слайдам…')
        const response = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ materialId: data.materialId }) })
        if (!response.ok) {
          const error = await response.json() as { error?: string; code?: string }
          if (error.code !== 'QWEN_ALREADY_RUNNING' && error.code !== 'CONTENT_CHANGED') throw new Error(error.error ?? 'Не удалось начать подготовку содержания.')
        } else {
          // Consume the HTTP stream to keep the Worker alive until completion.
          await response.text()
        }
        data = await read()
      }
      while (data.structure?.status === 'running' && !signal.aborted) {
        show('Распределяем содержание по слайдам…')
        await wait(2000); if (signal.aborted) return
        data = await read()
      }
      if (data.structure?.status === 'ready' && !signal.aborted) setView({ key, message: '', retry: false, ready: true })
      else if (data.structure?.status === 'failed') show(data.structure.error?.message ?? 'Разбор прервался. Содержание сохранено.', true)
      else show('Содержание обновилось. Продолжаем подготовку…')
    }
    void work().catch(error => { if (!signal.aborted) show(error instanceof Error ? error.message : 'Не удалось подготовить содержание.', true) })
    return () => { clearTimeout(timer); controller.abort() }
  }, [key, projectId, text, paused, retry, allowStart])

  if (paused || !view || view.key !== key) return null
  return <div className="ws-structure-status">
    {view.ready ? activeRecipe() === 'layout-engine-v1' ? <PresentationLayoutStatus key={`${key}:${uploadId}`} projectId={projectId} text={text} uploadId={uploadId} paused={stylePaused} allowStart={allowStart || retry.key === key && retry.count > 0} /> : <PresentationRecipeStatus key={`${key}:${uploadId}`} projectId={projectId} text={text} uploadId={uploadId} paused={stylePaused} allowStart={allowStart || retry.key === key && retry.count > 0} /> : <p className="ws-form-status" role="status">{view.message}</p>}
    {view.retry && <button className="pw-outline" onClick={() => setRetry(previous => ({ key, count: previous.count + 1 }))}>Повторить подготовку</button>}
  </div>
}
