"use client"

import { useEffect, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { Check, CircleAlert, Clock3, LoaderCircle, X } from 'lucide-react'
import Link, { useProcessingActive } from './site-link'
import { designProgressSnapshot, designProgressServerSnapshot, subscribeDesignProgress, designSteps,
  dismissDesignProgress, observeDesignUpload, observeBackgroundJob, remainingStageSeconds, resetDesignProgressTiming, type DesignTask } from '@/lib/uploads/design-progress'
import type { PublicProcessingJob } from '@/lib/uploads/processing-jobs'
import type { UploadJob } from '@/lib/uploads/domain'
import type { ScanRun } from '@/lib/design-system/semantic-scan'
import { cancelDesignSystem } from '@/lib/uploads/cancellation-client'
import { toast } from 'sonner'

function duration(seconds: number) {
  if (seconds < 60) return 'меньше минуты'
  const minutes = Math.ceil(seconds / 60)
  return minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

/** One read-only observer for all pages. It never starts or repeats model work. */
function useServerProgress() {
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    let disposed = false, fetching = false
    const controller = new AbortController()
    const refresh = async () => {
      if (fetching || disposed) return
      fetching = true
      try {
        const background = await fetch('/api/processing', { signal: controller.signal, cache: 'no-store' })
        if (background.ok) {
          const state = await background.json() as { available: boolean; jobs: PublicProcessingJob[] }
          for (const job of state.jobs) if (!disposed) observeBackgroundJob(job, state.available)
        }
        const response = await fetch('/api/uploads', { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw Error('status unavailable')
        const { uploads } = await response.json() as { uploads: UploadJob[] }
        const observed = designProgressSnapshot()
        for (const upload of uploads) {
          if (disposed) return
          if (upload.status === 'cancelled') { cancelDesignSystem(upload.id); continue }
          const task = observed.find(t => t.id === upload.id)
          if (task?.execution === 'background' || task?.owned || task?.status === 'complete') continue
          if (!['queued', 'processing'].includes(upload.status) && !task) continue
          const result = await fetch(`/api/uploads/${upload.id}/semantic-scan`, { signal: controller.signal, cache: 'no-store' })
          if (result.status === 410) { cancelDesignSystem(upload.id); continue }
          if (!result.ok) throw Error('status unavailable')
          const { run } = await result.json() as { run: ScanRun | null }
          if (!disposed) observeDesignUpload(upload, run)
        }
        if (!disposed) setOffline(false)
      } catch { if (!disposed) setOffline(true) }
      finally { fetching = false }
    }
    const visible = () => { resetDesignProgressTiming(); if (!document.hidden) void refresh() }
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 4000)
    void refresh()
    window.addEventListener('style-bank:uploads-changed', refresh)
    window.addEventListener('processing-jobs:changed', refresh)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('online', refresh)
    return () => {
      disposed = true; controller.abort(); clearInterval(timer)
      window.removeEventListener('style-bank:uploads-changed', refresh)
      window.removeEventListener('processing-jobs:changed', refresh)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('online', refresh)
    }
  }, [])
  return offline
}

export function DesignSystemProgress({ styleBase = '/styles' }: { styleBase?: string } = {}) {
  const tasks = useSyncExternalStore(subscribeDesignProgress, designProgressSnapshot, designProgressServerSnapshot)
  const protecting = useProcessingActive(), pathname = usePathname(), offline = useServerProgress()
  const [selected, setSelected] = useState(''), [now, setNow] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const task = tasks.find(t => t.id === selected) ?? tasks.find(t => pathname === `${styleBase}/${t.uploadId}`)
    ?? tasks.find(t => t.status === 'running') ?? tasks.at(-1)
  useEffect(() => {
    if (!tasks.some(t => t.status === 'running')) return
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [tasks])
  useEffect(() => {
    if (!protecting) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [protecting])
  if (!task) return protecting ? <div className="ds-progress" role="status">Обработка продолжается. Не закрывайте вкладку до завершения.</div> : null
  return <section className="ds-progress" aria-label="Сборка дизайн-системы" data-status={task.status}>
    <div className="ds-progress-heading">
      <div className="ds-progress-title"><strong>{task.status === 'complete' ? 'Дизайн-система готова' : task.status === 'error' ? 'Сборка приостановлена' : task.retryAt ? 'Продолжим автоматически' : task.status === 'waiting' ? 'Задание в очереди' : 'Собираем дизайн-систему'}</strong>
        {tasks.length > 1 ? <select aria-label="Обработка файла" value={task.id} onChange={e => setSelected(e.target.value)}>{tasks.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          : <span title={task.label}>{task.label}</span>}
      </div>
      <div className="ds-progress-actions">
        {task.uploadId && pathname !== `${styleBase}/${task.uploadId}` && <Link href={`${styleBase}/${task.uploadId}`}>Открыть</Link>}
        {task.status === 'error' && task.execution === 'background' && <button className="ds-progress-retry" disabled={retrying} onClick={async () => {
          setRetrying(true)
          try {
            const { delegateDesignSystem } = await import('./automatic-design-system')
            await delegateDesignSystem(task.id, true)
          } catch(error) { toast.error(error instanceof Error ? error.message : 'Не удалось продолжить обработку') }
          finally { setRetrying(false) }
        }}>Повторить с сохранённого этапа</button>}
        {task.status !== 'running' && task.status !== 'waiting' && <button aria-label="Скрыть завершённый статус" onClick={() => dismissDesignProgress(task.id)}><X size={17} /></button>}
      </div>
    </div>
    <Timeline task={task} now={now || task.updatedAt} offline={offline} />
  </section>
}

function Timeline({ task, now, offline }: { task: DesignTask; now: number; offline: boolean }) {
  const index = designSteps.findIndex(s => s.id === task.step), complete = task.status === 'complete'
  const remaining = designSteps.length - index - 1, estimate = offline ? null : remainingStageSeconds(task, now)
  return <>
    <ol className="ds-progress-steps" aria-label="Этапы сборки">{designSteps.map((step, at) => {
      const done = complete || at < index, current = !complete && at === index
      return <li key={step.id} data-state={done ? 'done' : current ? task.status : 'next'} aria-current={current ? 'step' : undefined}>
        <span className="ds-progress-marker" aria-hidden="true">{done ? <Check size={13} strokeWidth={2} /> : current && task.status === 'error' ? <CircleAlert size={15} /> : current && task.status === 'running' && !task.retryAt ? <LoaderCircle size={14} className="ds-progress-spinner" /> : at + 1}</span>
        <span><span className="ds-step-label">{step.label}</span><span className="ds-step-compact" aria-hidden="true">{step.compact}</span><span className="sr-only">{done ? ': завершён' : current ? task.status === 'running' ? ': выполняется' : ': текущий этап' : ': впереди'}</span></span>
      </li>
    })}</ol>
    <div className="ds-progress-current" role={task.status === 'error' ? 'alert' : 'status'} aria-live="polite">
      <p>{task.detail}{task.status === 'running' && task.total != null && <b className="ds-progress-count">{Math.min(task.completed ?? 0, task.total)}{task.unit==='percent'?'%':` из ${task.total}`}</b>}</p>
      {task.status === 'running' && <span className="ds-progress-time"><Clock3 size={13} aria-hidden="true" />{task.retryAt ? now < task.retryAt ? `Повтор через ${Math.ceil((task.retryAt-now)/1000)} с` : 'Ожидаем соединение' : estimate != null ? `Ещё ≈ ${duration(estimate)} на этот этап` : now - task.updatedAt > 15_000 ? `Текущая операция · ${duration(Math.floor((now-task.updatedAt)/1000))}` : 'Выполняется'}</span>}
    </div>
    {task.status === 'running' && task.total != null && <progress className="ds-progress-bar" aria-label={`Прогресс: ${designSteps[index].label}`} max={task.total} value={Math.min(task.completed ?? 0, task.total)} />}
    {!complete && <div className="ds-progress-footnote">
      <span>{task.status === 'running' ? `Шаг ${index + 1} из ${designSteps.length}${remaining ? ` · После него ещё ${remaining}` : ' · Последний этап'}` : task.saved ? 'Исходник и готовые этапы сохранены.' : 'Для повтора потребуется исходный файл.'}</span>
      <span>{offline ? 'Не удалось обновить статус. Проверим соединение автоматически.' : task.execution === 'background'
        ? task.status === 'error' ? 'Готовые этапы сохранены. Повтор начнётся с места остановки.' : !task.workerAvailable ? 'Обработчик недоступен. Задание возобновится после его подключения.' : 'Обработка на сервере. Можно свернуть или закрыть вкладку.' : task.status === 'running'
        ? task.owned ? 'Можно переключить вкладку. В фоне работа может замедлиться; не закрывайте её.' : 'Сохраните открытой вкладку, где запущена обработка.'
        : 'Продолжить можно с сохранённого этапа.'}</span>
    </div>}
  </>
}
