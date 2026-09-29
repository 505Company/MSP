"use client"
import { useCallback, useEffect, useState } from 'react'
import { Download,Trash2 } from 'lucide-react'
import type { StudioRun } from '@/lib/presentations/studio/contract'
import { generationLabels, generationSummary, isVisibleGeneration, type GenerationSummary } from '@/lib/presentations/studio/generations'
import { PresentationGeneration } from './presentation-generation'

const slideKey = (revision: string, slideId: string) => `${revision}/${slideId}`
const modes = ['fast', 'balanced', 'creative'] as const
export function PresentationHistory({ projectId, name, activeRevisions, onSettled, mode, onModeChange }: {
  projectId: string; name: string; activeRevisions: string[]; onSettled: (revision: string) => void
  mode: GenerationSummary['mode']; onModeChange: (mode: GenerationSummary['mode']) => void
}) {
  const [generations, setGenerations] = useState<GenerationSummary[]>([])
  const [runs, setRuns] = useState<Record<string, StudioRun>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState<'both' | 'pdf' | 'pptx'>('both')
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState('')
  const [editing,setEditing]=useState(false),[refresh,setRefresh]=useState<Record<string,number>>({})
  const [removed,setRemoved]=useState<{revision:string;slideId:string}[]>([])
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/projects/${projectId}/generations`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json() as { generations: GenerationSummary[]; error?: string }
      if (!response.ok) throw Error(data.error)
      setGenerations(previous => [...data.generations, ...previous.filter(g => !data.generations.some(r => r.revision === g.revision))])
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [projectId, retry])
  const updateRun = useCallback((run: StudioRun) => {
    setRuns(previous => previous[run.revision] === run ? previous : { ...previous, [run.revision]: run })
    setGenerations(previous => {
      const summary = generationSummary(run), old = previous.find(g => g.revision === run.revision)
      if (old && JSON.stringify(old) === JSON.stringify(summary)) return previous
      return [...previous.filter(g => g.revision !== run.revision), summary].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.revision.localeCompare(b.revision))
    })
  }, [])
  const toggle = useCallback((revision: string, id: string) => setSelected(previous => {
    const next = new Set(previous), key = slideKey(revision, id)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  }), [])
  const visibleGenerations = generations.filter(isVisibleGeneration)
  const revisions = [...new Set([...visibleGenerations.map(g => g.revision), ...activeRevisions])].filter(revision => {
    const summary = generations.find(g => g.revision === revision)
    return !summary || isVisibleGeneration(summary)
  })
  const chosen = revisions.flatMap(revision => (runs[revision]?.slides ?? []).filter(s => !runs[revision].deletedSlideIds?.includes(s.content.id)&&selected.has(slideKey(revision, s.content.id)) && runs[revision].results[s.content.id]?.passed).map(s => ({ run: runs[revision], slideId: s.content.id })))
  const busy=editing||exporting
  async function changeSlides(action:'delete'|'restore'){
    const slides=action==='restore'?removed:chosen.map(({run,slideId})=>({revision:run.revision,slideId}))
    if(!slides.length||busy)return
    setEditing(true);setExportError('')
    try{
      const response=await fetch(`/api/projects/${projectId}/generations`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,slides})})
      const data=await response.json() as {changes:{revision:string;deletedSlideIds:string[]}[];error?:string}
      if(!response.ok)throw Error(data.error)
      for(const change of data.changes){const run=runs[change.revision];if(run)updateRun({...run,deletedSlideIds:change.deletedSlideIds})}
      setRefresh(previous=>{const next={...previous};for(const change of data.changes)next[change.revision]=(next[change.revision]??0)+1;return next})
      setSelected(new Set());setRemoved(action==='delete'?slides:[])
    }catch(e){setExportError(e instanceof Error?e.message:'Не удалось изменить слайды.')}
    finally{setEditing(false)}
  }
  async function download() {
    if (!chosen.length || busy) return
    setExporting(true); setExportError('')
    try {
      const { downloadSelectedSlides } = await import('@/browser/studio-selection-export')
      await downloadSelectedSlides(name, chosen, format)
    } catch (e) { setExportError(e instanceof Error ? e.message : 'Не удалось экспортировать слайды.') }
    finally { setExporting(false) }
  }
  return <div className="msp-generation-history">
    <div className="msp-generation-tabs" role="tablist" aria-label="Режимы генерации">
      {modes.map((value, index) => <button key={value} type="button" role="tab" id={`generation-tab-${value}`} aria-selected={mode === value} aria-controls="generation-panel" tabIndex={mode === value ? 0 : -1} onClick={() => onModeChange(value)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % modes.length : event.key === 'ArrowLeft' ? (index + modes.length - 1) % modes.length : event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : null
        if (next === null) return
        event.preventDefault(); onModeChange(modes[next])
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
      }}>{generationLabels[value]}<span aria-hidden="true">{visibleGenerations.filter(g => g.mode === value).length}</span></button>)}
    </div>
    {loading && <p className="ws-form-status" role="status">Открываем историю генераций…</p>}
    {error && <div className="pw-error" role="alert">{error} <button className="pw-outline" onClick={() => { setLoading(true); setError(''); setRetry(n => n + 1) }}>Повторить</button></div>}
    <div id="generation-panel" role="tabpanel" aria-labelledby={`generation-tab-${mode}`} tabIndex={0}>
    {revisions.map((revision, index) => {
      const summary = generations.find(g => g.revision === revision), run = runs[revision]
      const ready = run?.slides.filter(s => !run.deletedSlideIds?.includes(s.content.id)&&run.results[s.content.id]?.passed) ?? []
      const allSelected = !!ready.length && ready.every(s => selected.has(slideKey(revision, s.content.id)))
      // Keep running generations mounted and the cross-mode selection intact.
      return <section className="msp-generation-group" key={revision} data-generation-revision={revision} hidden={!!summary && summary.mode !== mode}>
        <header className="msp-generation-heading"><div><span className="msp-generation-index">Генерация {index + 1}</span><h2>{summary ? `${generationLabels[summary.mode]} режим` : 'Новая генерация'}</h2><p>{summary && <><time dateTime={summary.createdAt}>{new Date(summary.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</time><span> · {summary.styleName}</span></>}</p></div>
          {!!ready.length && <button className="m2-button m2-outline" onClick={() => setSelected(previous => { const next = new Set(previous); for (const s of ready) { const key = slideKey(revision, s.content.id); if (allSelected) next.delete(key); else next.add(key) } return next })}>{allSelected ? 'Снять выбор' : 'Выбрать все слайды'}</button>}
        </header>
        <PresentationGeneration key={`${revision}/${refresh[revision]??0}`} projectId={projectId} revision={revision} paused={!!summary&&summary.mode!==mode&&!activeRevisions.includes(revision)&&!run} allowStart={activeRevisions.includes(revision)} onSettled={onSettled} onRunChange={updateRun} selectedSlides={selected} onToggleSlide={toggle}/>
      </section>
    })}
    {!loading && !error && !visibleGenerations.some(g => g.mode === mode) && !activeRevisions.some(r => !generations.some(g => g.revision === r)) && <p className="msp-generation-empty">В этом режиме пока нет генераций.</p>}
    </div>
    {(!!revisions.length || removed.length > 0) && <footer className="msp-export-bar" aria-label="Действия с выбранными слайдами">
      <div><strong aria-live="polite">Выбрано слайдов: {chosen.length}</strong></div>
      {removed.length>0&&<button className="msp-selection-clear" disabled={busy} onClick={()=>void changeSlides('restore')}>Отменить удаление ({removed.length})</button>}
      {chosen.length > 0 && <button className="msp-selection-clear" disabled={busy} onClick={() => setSelected(new Set())}>Снять выбор</button>}
      <button className="m2-button m2-outline msp-delete-slides" disabled={!chosen.length||busy} onClick={()=>void changeSlides('delete')}><Trash2 size={20}/>{editing?'Сохраняем…':'Удалить слайды'}</button>
      <label><select aria-label="Формат экспорта" value={format} disabled={busy} onChange={e => setFormat(e.target.value as typeof format)}><option value="both">PDF + PPTX (ZIP)</option><option value="pdf">PDF</option><option value="pptx">PPTX</option></select></label>
      <button className="m2-button m2-primary" disabled={!chosen.length || busy} onClick={() => void download()}><Download size={20}/>{exporting ? 'Экспортируем…' : 'Экспортировать'}</button>
      {exportError && <p className="pw-error" role="alert">{exportError}</p>}
    </footer>}
  </div>
}
