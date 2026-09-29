"use client"
/* Source images are authenticated same-origin assets. */
/* eslint-disable @next/next/no-img-element */
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Scan, X } from 'lucide-react'
import type { VisualManifest } from '@/lib/digital-designer/visual-package'
import type { RefinementRegion } from '@/lib/design-system/refinement-contract'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { useRefinement } from './design-system-refinement'
import { RefinementResult } from './refinement-result'

/** Selection progress belongs beside its source slide, not above the library. */
function SelectionProgress() {
  const value = useRefinement()
  if (!value?.state) return null
  const { state, uploadId, busy, error, command } = value
  const jobs = state.jobs.filter(j => j.mode === 'region')
  if (!jobs.length) return null
  const job = jobs.find(j => j.id === state.pending) ?? jobs[0]
  const active = !['complete', 'cancelled'].includes(job.status)
  return <div className="rf-source-progress" aria-label="Проверка выделенных областей">
    <p role="status">{job.status === 'failed' ? 'Проверка приостановлена' : job.status === 'cancelled' ? 'Проверка остановлена' : active ? 'Проверяем выделенную область…' : `Проверка завершена. Добавлено: ${job.result?.added ?? 0}. Уточнено: ${job.result?.updated ?? 0}.`}</p>
    {job.status === 'failed' && <p>{job.tasks.find(t => t.status === 'failed')?.error ?? job.error}</p>}
    {active && <div className="rf-actions">{job.status === 'failed' && <button className="rf-button" disabled={busy} onClick={() => void command('retry', job.id)}>Продолжить</button>}<button className="rf-button" disabled={busy} onClick={() => void command('cancel', job.id)}>Остановить</button></div>}
    {active && !state.background && <p className="rf-muted">Проверка выполняется в браузере. Оставьте вкладку открытой.</p>}
    {!!state.queue?.length && <p>В очереди: {state.queue.length}. Области проверяются последовательно.</p>}
    {job.status === 'complete' && <RefinementResult job={job} uploadId={uploadId} active={state.applied.includes(job.id)}/>}
    {error && <p className="pw-error" role="alert">{error}</p>}
  </div>
}

const clamp = (n: number, max = 1) => Math.min(max, Math.max(0, n))
function RegionPicker({ uploadId, slide, onSent }: { uploadId: string; slide: VisualManifest['snapshot']['slides'][number]; onSent: () => void }) {
  const refinement = useRefinement(), id = useId(), anchor = useRef<{ x: number; y: number } | null>(null)
  type Draft={id:string;region:RefinementRegion;note:string;target:'auto'|'component'|'graphic'}
  const [drafts,setDrafts]=useState<Draft[]>([]),[sending,setSending]=useState(false),draftId=useRef(crypto.randomUUID())
  const [region, setRegion] = useState<RefinementRegion | null>(null), [note, setNote] = useState(''), [target, setTarget] = useState<'auto'|'component'|'graphic'>('auto')
  const point = (e: PointerEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) } }
  const drag = (e: PointerEvent<HTMLDivElement>) => { if (!anchor.current) return; const p = point(e), a = anchor.current; setRegion({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), width: Math.abs(a.x - p.x), height: Math.abs(a.y - p.y) }) }
  const keyboard = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key)) return
    e.preventDefault()
    setRegion(previous => {
      const r = previous ?? { x: .2, y: .2, width: .3, height: .3 }, delta = .01
      const dx = e.key === 'ArrowLeft' ? -delta : e.key === 'ArrowRight' ? delta : 0, dy = e.key === 'ArrowUp' ? -delta : e.key === 'ArrowDown' ? delta : 0
      return e.shiftKey ? { ...r, width: Math.max(.01, clamp(r.width + dx, 1 - r.x)), height: Math.max(.01, clamp(r.height + dy, 1 - r.y)) } : { ...r, x: clamp(r.x + dx, 1 - r.width), y: clamp(r.y + dy, 1 - r.height) }
    })
  }
  const valid = region && region.width >= .005 && region.height >= .005
  const state = refinement?.state
  const keepRegion = () => {if(valid){const saved={id:draftId.current,region,note,target};setDrafts(items=>[...items,saved]);draftId.current=crypto.randomUUID();setRegion(null);setNote('')}}
  const submit = async () => {
    const all=[...drafts,...(valid?[{id:draftId.current,region,note,target}]:[])]
    setSending(true)
    try{const accepted=await refinement?.startMany(all.map(d=>({id:d.id,mode:'region',slide:slide.number,region:d.region,note:d.note,target:d.target})))??0
      if(accepted===all.length){onSent();return}
      setDrafts(all.slice(accepted));setRegion(null);setNote('');draftId.current=crypto.randomUUID()
    }finally{setSending(false)}
  }
  return <>
    <DialogTitle>Добавить блоки · слайд {slide.number}</DialogTitle><DialogDescription id={`${id}-help`}>Отметьте область, нажмите «Ещё область» и выделите следующую. Система проверит их по очереди.</DialogDescription>
    <div className="rf-selection" style={{ aspectRatio: `${slide.width}/${slide.height}` }} tabIndex={0} role="group" aria-label="Область на исходном слайде" aria-describedby={`${id}-keys`}
      onPointerDown={e => { if (e.button !== 0 || sending) return; e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); anchor.current = point(e); setRegion(null) }} onPointerMove={drag} onPointerUp={e => { drag(e); anchor.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }} onPointerCancel={() => { anchor.current = null }} onKeyDown={keyboard}>
      <img src={`/api/uploads/${uploadId}/assets/preview-${slide.id}`} alt={`Исходный слайд ${slide.number}`} draggable={false}/>
      {drafts.map((d,i)=><span key={d.id} className="rf-selection-box rf-selection-saved" style={{left:`${d.region.x*100}%`,top:`${d.region.y*100}%`,width:`${d.region.width*100}%`,height:`${d.region.height*100}%`}}><b>{i+1}</b></span>)}
      {region && <span className="rf-selection-box" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}/>}</div>
    <p id={`${id}-keys`} className="rf-muted">Потяните рамку мышью или пальцем. С клавиатуры: Enter — начать, стрелки — передвинуть, Shift + стрелки — изменить размер.</p>
    <div className="rf-actions"><button className="rf-button" onClick={() => setRegion(null)} disabled={!region}>Сбросить область</button><button className="rf-button" disabled={!valid||drafts.length>=11||sending} onClick={keepRegion}>Ещё область</button><span className="rf-muted" aria-live="polite">{valid ? `Выделено ${Math.round(region.width * 100)} × ${Math.round(region.height * 100)}% слайда` : 'Область пока не выбрана'}</span></div>
    <label className="rf-label" htmlFor={`${id}-target`}>Что сохранить</label><select className="rf-target" id={`${id}-target`} value={target} onChange={e=>setTarget(e.target.value as typeof target)}><option value="auto">Определить автоматически</option><option value="component">Карточку или компонент с редактируемым текстом</option><option value="graphic">Фон или графику как изображение</option></select>
    <p className="rf-muted">{target==='graphic'?'Изображение появится в «Графике и иконках». Надписи внутри него останутся частью картинки.':'Для карточки внутри картинки потребуется восстановление. В каталог попадёт только результат, прошедший сравнение с исходником.'}</p>
    <label className="rf-label" htmlFor={`${id}-note`}>Что добавить, необязательно</label><textarea className="rf-textarea" id={`${id}-note`} value={note} onChange={e => setNote(e.target.value)} maxLength={600} rows={2} placeholder="Например: карточку целиком, вместе с подписью справа"/>
    {!!drafts.length&&<ol className="rf-drafts">{drafts.map((d,i)=><li key={d.id}><span>Область {i+1}{d.note?` · ${d.note}`:''} · {d.target==='graphic'?'Графика':'Компонент'}</span><button className="rf-button" disabled={sending} onClick={()=>setDrafts(items=>items.filter(item=>item.id!==d.id))}>Убрать</button></li>)}</ol>}
    {state?.pending && <p role="status">Области встанут в очередь после текущего дополнения.</p>}{state && !state.configured && target!=='graphic' && <p>Для проверки блока подключите модель.</p>}{refinement?.error && <p className="pw-error" role="alert">{refinement.error}</p>}
    <div className="rf-actions rf-footer"><DialogClose className="rf-button">Закрыть</DialogClose><button className="rf-button rf-primary" disabled={(!valid&&!drafts.length) || !state?.ready || (!state.configured&&(target!=='graphic'||drafts.some(d=>d.target!=='graphic'))) || sending || refinement?.busy} onClick={()=>void submit()}>{sending?'Сохраняем очередь…':drafts.length?`Проверить и добавить · ${drafts.length+Number(!!valid)}`:'Проверить и добавить'}</button></div>
  </>
}

export function SourceRefinement({ uploadId, visual }: { uploadId: string; visual: VisualManifest }) {
  const [slide, setSlide] = useState<VisualManifest['snapshot']['slides'][number] | null>(null), [sent, setSent] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  return <><SelectionProgress/>{sent && <p className="rf-result" role="status">Области отправлены на последовательную проверку. Добавленные компоненты и причины отклонения появятся здесь; графика — в «Графике и иконках».</p>}
    <div className="ds-slides">{visual.snapshot.slides.map(s => <article key={s.id}>{visual.previews.some(p => p.id === s.id) ? <><button className="rf-source-preview" aria-label={`Выбрать блок на слайде ${s.number}`} onClick={e => { trigger.current = e.currentTarget; setSlide(s); setSent(false) }}><img src={`/api/uploads/${uploadId}/assets/preview-${s.id}`} loading="lazy" alt={`Слайд ${s.number}`}/></button><div className="rf-source-caption"><h4>Слайд {s.number}</h4><button className="rf-button" onClick={e => { trigger.current = e.currentTarget; setSlide(s); setSent(false) }}><Scan size={15} aria-hidden="true"/>Добавить область</button></div></> : <><div className="ds-unsupported">Превью не построено</div><h4>Слайд {s.number}</h4></>}</article>)}</div>
    <Dialog open={!!slide} onOpenChange={open => { if (!open) setSlide(null) }}><DialogContent className="rf-region-dialog" showCloseButton={false} onCloseAutoFocus={e => { e.preventDefault(); trigger.current?.focus() }}><DialogClose className="cw-dialog-close" aria-label="Закрыть исходный слайд"><X size={20}/></DialogClose>{slide && <RegionPicker key={slide.id} uploadId={uploadId} slide={slide} onSent={() => { setSlide(null); setSent(true) }}/>}</DialogContent></Dialog>
  </>
}
