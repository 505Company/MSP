"use client"
/* Native previews are immutable same-origin processing evidence. */
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, RotateCcw, Square } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import type { publicDiscoveryJob } from '@/lib/presentations/recipes/discovery-jobs'
import type { readDiscoveryEvidence } from '@/lib/presentations/recipes/discovery-workflow'
import './recipe-discovery.css'

type Job = ReturnType<typeof publicDiscoveryJob>
type Evidence = Awaited<ReturnType<typeof readDiscoveryEvidence>>
type State = { jobs: Job[]; configured: boolean; background: boolean }
const names = { queued: 'В очереди', running: 'Проверка', retrying: 'Повтор после сбоя', blocked: 'Приостановлено', complete: 'Завершено', cancelled: 'Остановлено' }
const caseNames: Record<string, string> = { reconstruction: 'Исходная композиция', short: 'Мало текста', medium: 'Средний объём', long: 'Много текста' }
function RecipeEvidence({ uploadId, job }: { uploadId: string; job: Job }) {
  const [evidence, setEvidence] = useState<Evidence | null>(null), [error, setError] = useState('')
  const [preview, setPreview] = useState<{ title: string; image: string } | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const load = async () => {
    if (evidence) return
    try {
      const response = await fetch(`/api/uploads/${uploadId}/recipe-jobs?jobId=${job.id}`, { cache: 'no-store' })
      const data = await response.json() as { evidence: Evidence; error?: string }
      if (!response.ok) throw Error(data.error ?? 'Не удалось прочитать проверку')
      setEvidence(data.evidence)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось прочитать проверку') }
  }
  return <details className="rd-evidence" onToggle={e => { if (e.currentTarget.open) void load() }}><summary>Результаты проверки</summary>
    {error && <p role="alert">{error}</p>}
    {evidence && <><h4>{evidence.recipe?.passport.name ?? (evidence.selected?.profile === 'unsupported' ? 'Поддерживаемое семейство не найдено' : job.result?.technical === 'failed' ? 'Не удалось извлечь рецепт' : 'Извлечение не завершено')}</h4>
      {evidence.selected && <p>{evidence.selected.reason}</p>}
      {evidence.extractions.filter(run => run?.error).map(run => <div key={run!.id}><p>Попытка извлечения не прошла проверку.</p><ul>{run!.error!.issues?.map((issue, i) => <li key={i}>{issue}</li>)}</ul></div>)}
      {evidence.recipe && <p className="rd-meta">Исходный слайд {Number(evidence.recipe.proposal.slideId.slice(1))} · {evidence.recipe.proposal.itemCount} блоков · версия {evidence.recipe.passport.version.slice(0, 8)}</p>}
      <div className="rd-previews">{evidence.checks.map(check => <figure key={check.id}>
        {check.report ? <button className="rd-preview" aria-label={`Открыть: ${caseNames[check.id]}`} onClick={e => { trigger.current = e.currentTarget; setPreview({ title: caseNames[check.id], image: check.report!.preview }) }}><img src={check.report.preview} alt={caseNames[check.id]} style={{ aspectRatio: `${check.recipe.passport.canvas.width}/${check.recipe.passport.canvas.height}` }}/></button> : <div className="rd-missing">Нет изображения</div>}
        <figcaption>{caseNames[check.id]} · {check.report?.passed && (check.review?.result as { verdict?: string })?.verdict === 'pass' ? 'Проверено' : check.report ? 'Есть замечания' : 'Не проверено'}</figcaption>
        {!!check.report?.issues.length && <ul>{check.report.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        {((check.review?.result as { issues?: string[] })?.issues ?? []).map((issue, i) => <p key={i}>{issue}</p>)}
      </figure>)}</div></>}
    <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null) }}><DialogContent className="rd-dialog" aria-describedby={undefined} onCloseAutoFocus={e => { e.preventDefault(); trigger.current?.focus() }}><DialogTitle>{preview?.title}</DialogTitle>{preview && <img src={preview.image} alt={preview.title}/>}</DialogContent></Dialog>
  </details>
}
export function RecipeDiscovery({ uploadId }: { uploadId: string }) {
  const [state, setState] = useState<State | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const requestId = useRef<string | null>(null), url = `/api/uploads/${uploadId}/recipe-jobs`
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(url, { cache: 'no-store', signal }), data = await response.json() as State & { error?: string }
    if (!response.ok) throw Error(data.error ?? 'Не удалось прочитать рецепты')
    setState(data as State)
    return data as State
  }, [url])
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try { await refresh(controller.signal) }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Не удалось прочитать рецепты') }
      if (!controller.signal.aborted) timer = setTimeout(() => void load(), 4000)
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [refresh])
  const post = async (body: object) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), data = await response.json() as { error?: string }
      if (!response.ok) throw Error(data.error ?? 'Не удалось сохранить запрос')
      requestId.current = null
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить запрос') }
    finally { setBusy(false) }
  }
  const pending = state?.jobs.find(j => ['queued', 'running', 'retrying', 'blocked'].includes(j.status)), latest = state?.jobs[0]
  const jobRow = (job: Job) => <><div className="rd-job-line"><span>{names[job.status]}{job.result?.technical === 'passed' ? ' · кандидат проверен' : job.result?.technical === 'failed' ? ' · не прошёл проверку' : ''}</span><span className="rd-meta">Запросы: {job.budget.used} / {job.budget.limit}</span></div>
    <p role="status">{job.error ?? job.result?.reason ?? job.progress.detail}</p>
    {!['queued', 'running', 'retrying'].includes(job.status) && <RecipeEvidence key={`${job.id}:${job.updatedAt}`} uploadId={uploadId} job={job}/>}</>
  return <section className="rd-section" aria-label="Рецепты слайдов">
    <div className="rd-heading"><h3>Рецепты слайдов</h3><button className="rf-button" disabled={busy || !state?.configured || !!pending} onClick={() => {
      requestId.current ??= crypto.randomUUID()
      void post({ action: 'start', request: { id: requestId.current, limit: 24 } })
    }}><Plus size={16} aria-hidden="true"/>Пополнить рецепты</button></div>
    {state && !state.configured && <p>Модель не подключена.</p>}
    {!latest && <p className="rd-meta">Новых заданий нет. Лимит запуска: 24 запроса.</p>}
    {pending && <div className="rd-current">{jobRow(pending)}
      {!state?.background && <p>Фоновый обработчик недоступен. Задание сохранено.</p>}
      <div className="rf-actions">{pending.status === 'blocked' && <button className="rf-button" disabled={busy || pending.budget.used >= pending.budget.limit} onClick={() => void post({ action: 'resume', jobId: pending.id })}><RotateCcw size={15} aria-hidden="true"/>Продолжить</button>}
        <button className="rf-button" disabled={busy} onClick={() => void post({ action: 'cancel', jobId: pending.id })}><Square size={14} aria-hidden="true"/>Остановить</button></div></div>}
    {!pending && latest && <div className="rd-current">{jobRow(latest)}</div>}
    {!!state && state.jobs.length > 1 && <details className="rd-history"><summary>История заданий · {state.jobs.length - 1}</summary><ol>{state.jobs.slice(1).map(job => <li key={job.id}><time dateTime={new Date(job.createdAt).toISOString()}>{new Date(job.createdAt).toLocaleString('ru')}</time>{jobRow(job)}</li>)}</ol></details>}
    {error && <p className="pw-error" role="alert">{error}</p>}
  </section>
}
