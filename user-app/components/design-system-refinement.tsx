"use client"
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Plus, RotateCcw } from 'lucide-react'
import { ComponentAdaptationStatus } from './component-adaptation-status'
import { RefinementResult } from './refinement-result'
import { runEditableRefinements } from '@/browser/editable-refinement'
import { subscribeUploadCancellation } from '@/lib/uploads/cancellation-client'
import { refinementFeedback, refinementTaskFinished, type RefinementInput, type RefinementState, type RefinementJob } from '@/lib/design-system/refinement-contract'

type Request = Omit<RefinementInput, 'id' | 'catalogId'>
type Context = { uploadId: string; state: RefinementState | null; busy: boolean; error: string; start: (request: Request) => Promise<boolean>; command: (action: string, requestId?: string) => Promise<boolean>; startMany: (requests: (Request & {id:string})[]) => Promise<number> }
const RefinementContext = createContext<Context | null>(null)
export const useRefinement = () => useContext(RefinementContext)
declare global { interface Window { __mspRefinementFlights?: Map<string, Promise<void>> } }

function continueInBrowser(uploadId: string) {
  const flights = window.__mspRefinementFlights ??= new Map<string, Promise<void>>()
  const previous = flights.get(uploadId); if (previous) return previous
  const controller = new AbortController()
  const unsubscribe = subscribeUploadCancellation(id => { if (id === uploadId) controller.abort() })
  const run = () => runEditableRefinements(uploadId, controller.signal)
  const promise = Promise.resolve().then(async () => { if (navigator.locks) await navigator.locks.request(`msp-design-system-${uploadId}`, { signal: controller.signal }, run); else await run() }).finally(() => { unsubscribe(); flights.delete(uploadId) })
  flights.set(uploadId, promise); return promise
}
export function DesignSystemRefinement({ uploadId, children }: { uploadId: string; children: ReactNode }) {
  const [state, setState] = useState<RefinementState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const submissions=useRef(new Map<string,object>())
  const currentId = useRef<string | null>(null), fallbackFailure = useRef<string | null>(null)
  const url = `/api/uploads/${uploadId}/editable-system/refinements`
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(url, { cache: 'no-store', signal }), value = await response.json() as RefinementState & { error?: string }
    if (!response.ok) throw Error(value.error ?? 'Не удалось прочитать дополнения')
    setState(value)
    if (currentId.current && currentId.current !== value.catalogId) window.dispatchEvent(new CustomEvent('design-system:ready', { detail: uploadId }))
    currentId.current = value.catalogId
    return value
  }, [url, uploadId])
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      clearTimeout(timer)
      try {
        const value = await refresh(controller.signal)
        const job = value.jobs.find(j => j.id === value.pending)
        if (job && job.status !== 'failed' && job.status !== 'cancelled' && !value.background && (value.configured || job.input.target === 'graphic' || job.input.nativeOnly) && fallbackFailure.current !== job.id) {
          void continueInBrowser(uploadId).then(() => { if (!controller.signal.aborted) void load() }).catch(e => { fallbackFailure.current = job.id; if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Дополнение прервалось') })
        }
        if (value.pending || !value.ready) timer = setTimeout(() => void load(), 3000)
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Не удалось прочитать дополнения') }
    }
    const reload = () => { void load() }
    void load(); window.addEventListener('design-system:ready', reload); window.addEventListener('msp:refinement', reload)
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('design-system:ready', reload); window.removeEventListener('msp:refinement', reload) }
  }, [refresh, uploadId])
  const post = async (body: object) => {
    if (busy) return false
    setBusy(true); setError('')
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), value = await response.json() as { error?: string }
      if (!response.ok) throw Error(value.error ?? 'Не удалось сохранить запрос')
      fallbackFailure.current = null
      await refresh(); window.dispatchEvent(new Event('msp:refinement'))
      return true
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить запрос'); return false }
    finally { setBusy(false) }
  }
  const start = (request: Request) => post({ action: 'request', request: { ...request, id: crypto.randomUUID(), catalogId: state?.catalogId } })
  const startMany = async (requests:(Request & {id:string})[]) => {
    let accepted=0
    try { for(const request of requests){
      const latest=await refresh()
      const body=submissions.current.get(request.id)??{action:'request',request:{...request,catalogId:latest.catalogId}}
      submissions.current.set(request.id,body)
      if(!await post(body))break
      accepted++
    } } catch(e) { setError(e instanceof Error?e.message:'Не удалось сохранить очередь') }
    return accepted
  }
  const command = (action: string, requestId?: string) => post(action === 'undo' ? { action, catalogId: state?.catalogId } : { action, requestId })
  return <RefinementContext.Provider value={{ uploadId, state, busy, error, start, command, startMany }}>{children}</RefinementContext.Provider>
}

const modeNames = { automatic: 'Проверка после импорта', scan: 'Поиск пропущенных компонентов', region: 'Блок с исходного слайда', feedback: 'Уточнение компонента' }
function SkippedSlides({ job }: { job: RefinementJob }) {
  const skipped = job.tasks.filter(t => t.status === 'skipped')
  return skipped.length ? <div className="rf-skipped"><p>Не удалось проверить: {skipped.map(t => `слайд ${t.slide}`).join(', ')}. Прежние компоненты сохранены.</p><ul>{skipped.map(t => <li key={t.slide}>Слайд {t.slide}: {t.error ?? 'Ответ не прошёл проверку.'}</li>)}</ul></div> : null
}
export function RefinementToolbar() {
  const value = useRefinement(); if (!value) return null
  const { uploadId, state, busy, error, start, command } = value, pending = state?.jobs.find(j => j.id === state.pending), latest = state?.jobs[0]
  const enabled = state?.ready && state.configured && !state.pending && !busy
  return <div className="rf-toolbar" aria-label="Дополнение дизайн-системы">
    <div className="rf-toolbar-row"><div><strong>Не хватает компонента?</strong><p>Проверьте исходные слайды ещё раз или отметьте нужный блок в разделе «Исходные слайды».</p></div>
      <button className="rf-button rf-primary" disabled={!enabled} onClick={() => void start({ mode: 'scan', note: '' })}><Plus size={16} aria-hidden="true"/>Дополнить дизайн-систему</button></div>
    <button className="rf-button" disabled={!state?.ready||!!state.pending||busy} onClick={()=>void start({mode:'scan',note:'',nativeOnly:true})}>Найти карточки внутри групп</button>
    {state && !state.ready && <p className="rf-muted">Дополнение станет доступно после проверки исходных компонентов.</p>}
    {state && !state.configured && <p className="rf-muted">Для поиска дополнений подключите модель в настройках сервиса.</p>}
    {state?.stale && <p className="rf-muted">Исходный каталог обновлён. Прошлые дополнения сохранены в истории; для этой версии требуется новая проверка.</p>}
    {pending && <div className="rf-progress" role="status"><span>{pending.status === 'failed' ? 'Проверка приостановлена' : modeNames[pending.mode]} · {pending.tasks.filter(refinementTaskFinished).length} из {pending.tasks.length} слайдов</span>
      {pending.status === 'failed' && <><p>{pending.tasks.find(t => t.status === 'failed') ? `Слайд ${pending.tasks.find(t => t.status === 'failed')!.slide}: ` : ''}{pending.tasks.find(t => t.status === 'failed')?.error ?? pending.error}</p><p>Продолжение сначала перепроверит сохранённый ответ. Если слайд не удастся разобрать, он останется в отчёте; остальные продолжат обрабатываться.</p></>}
      <SkippedSlides job={pending}/>
      {!state?.background && pending.status !== 'failed' && <p>Проверка выполняется в браузере. Оставьте вкладку открытой.</p>}
      <div className="rf-actions">{pending.status === 'failed' && <button className="rf-button" disabled={busy} onClick={() => void command('retry', pending.id)}>Продолжить</button>}<button className="rf-button" disabled={busy} onClick={() => void command('cancel', pending.id)}>Остановить</button></div></div>}
    {!pending && latest?.status === 'complete' && <><p className="rf-result" role="status">{latest.result?.version ? state?.stale ? 'Дополнение сохранено для прежней версии источника.' : state?.applied.includes(latest.id) ? `Добавлено: ${latest.result.added}. Уточнено: ${latest.result.updated}.` : 'Последнее дополнение отменено. Предыдущая версия восстановлена.' : latest.tasks.some(t => t.status === 'skipped') ? 'Проверка завершена с замечаниями. Новые компоненты не опубликованы.' : latest.result?.rejected ? 'Проверка завершена. Предложения не прошли проверку; причины ниже.' : 'Проверка завершена. Новых элементов не добавлено.'}{latest.remaining > 0 ? ` Ещё не проверены ${latest.remaining} слайдов — можно запустить дополнение снова.` : ''}</p><RefinementResult job={latest} uploadId={uploadId} active={!!state?.applied.includes(latest.id)}/><SkippedSlides job={latest}/></>}
    {!!state?.queue?.length && <div className="rf-progress"><p>В очереди: {state.queue.length}. Области проверяются последовательно.</p>{state.queue.map((id,i)=><div className="rf-actions" key={id}><span>Область {i+1} · слайд {state.jobs.find(j=>j.id===id)?.input.slide}</span><button className="rf-button" disabled={busy} onClick={()=>void command('cancel',id)}>Убрать из очереди</button></div>)}</div>}
    <ComponentAdaptationStatus uploadId={uploadId} catalogId={state?.catalogId??null} ready={!!state?.ready&&!state.pending}/>
    {error && <p className="pw-error" role="alert">{error}</p>}
    {!!state?.jobs.length && <details className="rf-history"><summary>История дополнений · {state.jobs.length}</summary><ol>{state.jobs.map(job => <li key={job.id}><span>{modeNames[job.mode]} <time dateTime={new Date(job.createdAt).toISOString()}>{new Date(job.createdAt).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></span><small>{job.status === 'complete' ? `Добавлено ${job.result?.added ?? 0}, уточнено ${job.result?.updated ?? 0}, не прошли проверку ${job.result?.rejected ?? 0}` : job.status === 'cancelled' ? 'Остановлено' : job.status === 'failed' ? 'Требуется продолжение' : 'Проверка выполняется'}</small><RefinementResult job={job} uploadId={uploadId} active={!!state.applied.includes(job.id)}/><SkippedSlides job={job}/></li>)}</ol>
      {state.canUndo && <button className="rf-button" disabled={busy} onClick={() => void command('undo')}><RotateCcw size={14} aria-hidden="true"/>Отменить последнее дополнение</button>}</details>}
  </div>
}

export function ComponentFeedback({ templateId }: { templateId: string }) {
  const refinement = useRefinement(), id = useId()
  const [feedback, setFeedback] = useState<keyof typeof refinementFeedback>('incomplete'), [note, setNote] = useState(''), [sent, setSent] = useState(false)
  if (!refinement) return null
  const { state, busy, error, start } = refinement
  return <details className="rf-feedback"><summary>Уточнить компонент</summary>{sent ? <p role="status">Запрос сохранён. Система проверит исходный блок; результат появится в истории дополнений.</p> : <form onSubmit={async e => { e.preventDefault(); if (await start({ mode: 'feedback', templateId, feedback, note })) setSent(true) }}>
    <label htmlFor={`${id}-reason`}>Что нужно уточнить?</label><select id={`${id}-reason`} value={feedback} onChange={e => setFeedback(e.target.value as keyof typeof refinementFeedback)}>{Object.entries(refinementFeedback).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    <label htmlFor={`${id}-note`}>Комментарий, необязательно</label><textarea id={`${id}-note`} value={note} onChange={e => setNote(e.target.value)} maxLength={600} rows={2} placeholder="Например: рядом с числом есть подпись"/>
    <p>Действующий компонент заменится только после успешной проверки исправления.</p><button className="rf-button rf-primary" disabled={busy || !state?.ready || !state.configured || !!state.pending}>Проверить компонент</button>
    {state?.pending && <p role="status">Сначала дождитесь текущего дополнения.</p>}{state && !state.configured && <p>Модель пока не подключена.</p>}{error && <p className="pw-error" role="alert">{error}</p>}
  </form>}</details>
}
