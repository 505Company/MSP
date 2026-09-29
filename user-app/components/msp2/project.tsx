"use client"
/* eslint-disable @next/next/no-img-element -- measured slide previews */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from '../site-link'
import { workspaceRequest } from '../workspace-data'
import { renderMsp2Slide } from '@/browser/msp2-render'
import type { Project, Run, SlideResult } from '@/lib/msp2/types'
import { Icon } from './shell'
import { CreatePresentation } from './create'
import { Palette } from './dashboard'

export function Msp2Project() {
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null), [run, setRun] = useState<Run | null>(null), [error, setError] = useState(''), [working, setWorking] = useState(false), [message, setMessage] = useState(''), [editing, setEditing] = useState(false), [openSlide, setOpenSlide] = useState<SlideResult | null>(null)
  const controller = useRef<AbortController | null>(null), active = useRef(false)
  const read = useCallback(async (revision: string, signal?: AbortSignal) => { const data = await workspaceRequest<{ run: Run | null; configured: boolean }>(`/api/msp2/projects/${id}/run?revision=${revision}`, { signal, cache: 'no-store' }); if (!signal?.aborted) setRun(data.run); return data }, [id])
  const generate = useCallback(async (p: Project) => {
    if (active.current) return
    active.current = true; setWorking(true); setError(''); const abort = new AbortController(); controller.current = abort; const signal = abort.signal
    const post = async (action: string, extra: object = {}) => { const response = await fetch(`/api/msp2/projects/${id}/run`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, revision: p.revision, ...extra }) }); if (!response.ok) { const body = await response.json() as { error?: string }; throw Error(body.error ?? 'Не удалось сохранить сборку.') } return response }
    try {
      setMessage('Готовим компоненты дизайн-системы…')
      let current = ((await (await post('start')).json()) as { run: Run }).run; setRun(current)
      const errors: string[] = []
      for (const packet of current.packets) {
        signal.throwIfAborted(); if (current.results[packet.id]) continue
        try {
          if (!current.plans[packet.id]) { setMessage(`Разбираем содержание слайда ${packet.index + 1}…`); await (await post('plan', { slideId: packet.id })).text(); current = (await read(p.revision, signal)).run!; if (!current.plans[packet.id]) throw Error(current.errors[packet.id] ?? 'План слайда не готов.') }
          setMessage(`Размещаем и проверяем слайд ${packet.index + 1} из ${current.packets.length}…`)
          const result = await renderMsp2Slide(current.library, current.plans[packet.id], signal)
          current = ((await (await post('result', { result })).json()) as { run: Run }).run; setRun(current)
        } catch (e) {
          if (signal.aborted) throw e
          const detail = e instanceof Error ? e.message : 'Не удалось собрать слайд.'; errors.push(detail)
          current = ((await (await post('fail', { slideId: packet.id, error: detail.slice(0, 4000) })).json()) as { run: Run }).run; setRun(current)
        }
      }
      setMessage(`Готово ${Object.keys(current.results).length} из ${current.packets.length} слайдов`)
      if (errors.length) setError('Часть слайдов требует проверки. Готовые результаты сохранены.')
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Не удалось завершить сборку.') }
    finally { active.current = false; if (!signal.aborted) setWorking(false) }
  }, [id, read])
  useEffect(() => {
    const abort = new AbortController()
    void workspaceRequest<{ project: Project }>(`/api/msp2/projects/${id}`, { signal: abort.signal }).then(async ({ project: p }) => {
      if (abort.signal.aborted) return; setProject(p); await read(p.revision, abort.signal)
      const start = sessionStorage.getItem(`msp2-start:${id}`)
      if (start === p.revision && !abort.signal.aborted) { sessionStorage.removeItem(`msp2-start:${id}`); void generate(p) }
    }).catch(e => { if (!abort.signal.aborted) setError(e.message) })
    return () => { abort.abort(); controller.current?.abort() }
  }, [id, read, generate])
  useEffect(() => { if (!working) return; const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard) }, [working])
  async function download() {
    if (!run) return
    try {
      const { default: JSZip } = await import('jszip'), zip = new JSZip(), ready = run.packets.filter(p => run.results[p.id])
      zip.file('source.json', JSON.stringify({ project, run }, null, 2))
      for (const packet of ready) { const result = run.results[packet.id], number = String(packet.index + 1).padStart(2, '0'); zip.file(`slide-${number}.png`, result.preview.split(',')[1], { base64: true }); zip.file(`slide-${number}.html`, `<!doctype html><html lang="ru"><meta charset="utf-8"><style>body{margin:0}*{box-sizing:border-box}</style><body>${result.html}</body></html>`) }
      const blob = await zip.generateAsync({ type: 'blob' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'MSP-2-slides.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось подготовить экспорт.') }
  }
  if (!project) return <div className="m2-empty" role={error ? 'alert' : 'status'}>{error || 'Загружаем проект…'}</div>
  if (editing) return <><button className="m2-button m2-ghost" onClick={() => setEditing(false)}>Вернуться к слайдам</button><CreatePresentation project={project} onSaved={p => { setProject(p); setRun(null); setEditing(false); sessionStorage.removeItem(`msp2-start:${id}`); void generate(p) }} /></>
  const count = Object.keys(run?.results ?? {}).length
  return <div className="m2-project"><header className="m2-project-heading"><div><nav><Link href="/msp2/projects">Проекты</Link><Icon name="right" /><span>{project.name}</span></nav><h1>{project.name}</h1></div><Link className="m2-project-style" href={`/msp2/styles/${project.uploadId}`}>{run && <Palette style={{ colors: run.library.tokens.colors.map(c => c.hex) }} />}<span><strong>{project.styleName}</strong><small>Дизайн-система презентации</small></span><Icon name="check" /></Link></header>
    <section><div className="m2-section-heading"><div><h2>Слайды проекта</h2><p>Готовые слайды можно открыть, скачать или обновить из содержания.</p></div><div className="m2-heading-actions"><button className="m2-button m2-white" disabled={working} onClick={() => setEditing(true)}><Icon name="edit" />Редактировать содержание</button>{count > 0 && <button className="m2-button m2-white" onClick={() => void download()}>Скачать слайды</button>}</div></div>
      {(message || working) && <p className="m2-run-status" role="status">{working && <span className="m2-spinner" />}{message}</p>}{error && <p role="alert" className="m2-alert">{error}</p>}
      {!run && <div className="m2-empty"><h2>Содержание сохранено</h2><p>Создайте слайды с выбранной дизайн-системой.</p><button className="m2-button m2-primary" disabled={working} onClick={() => void generate(project)}><Icon name="generate" />Создать слайды</button></div>}
      {run && <div className="m2-slide-grid">{run.packets.map(packet => {
        const result = run.results[packet.id], title = run.plans[packet.id]?.content.title ?? packet.atoms[0]?.text ?? `Слайд ${packet.index + 1}`
        return <article className="m2-slide-card" key={packet.id}><div className="m2-slide-preview">{result ? <><img src={result.preview} alt={`Слайд ${packet.index + 1}: ${title}`} /><button className="m2-slide-overlay" onClick={() => setOpenSlide(result)} aria-label={`Открыть слайд ${packet.index + 1}`}>Открыть слайд</button></> : <div className="m2-pending"><span>{String(packet.index + 1).padStart(2, '0')}</span><p>{run.errors[packet.id] ?? (working ? 'Создаём слайд…' : 'Слайд ещё не готов')}</p></div>}</div><footer><span>{String(packet.index + 1).padStart(2, '0')}</span><h3>{title}</h3>{result && <button onClick={() => setOpenSlide(result)} aria-label={`Просмотреть слайд ${packet.index + 1}`}><Icon name="more" /></button>}</footer></article>
      })}</div>}
      {run && count < run.packets.length && !working && <div className="m2-bottom-actions"><button className="m2-button m2-white" onClick={() => void generate(project)}><Icon name="refresh" />Продолжить создание</button></div>}
    </section>{openSlide && <SlideViewer slide={openSlide} onClose={() => setOpenSlide(null)} />}
  </div>
}

function SlideViewer({ slide, onClose }: { slide: SlideResult; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.showModal()
    return () => previous?.focus()
  }, [])
  return <dialog ref={ref} className="m2-modal" aria-label="Просмотр слайда" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }}><button autoFocus aria-label="Закрыть просмотр" onClick={onClose}>Закрыть ×</button><img src={slide.preview} alt="Слайд целиком" /></dialog>
}
