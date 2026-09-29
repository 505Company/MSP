"use client"
import { useEffect, useState } from 'react'
import { useWorkspaceData } from './workspace-data'
import { runQualityAudit } from '@/browser/quality-audit'
import type { QualityAuditState } from '@/lib/design-system/quality-audit-contract'

export function QualityAudit({uploadId,showStyle=false}:{uploadId:string;showStyle?:boolean}) {
  const {data,error,reload}=useWorkspaceData<QualityAuditState>(`/api/uploads/${uploadId}/quality-audit`)
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState('')
  const running=!!data?.job&&data.job.status!=='complete'
  useEffect(()=>{
    window.addEventListener('design-system:ready',reload);window.addEventListener('processing-jobs:changed',reload)
    const timer=running?setInterval(reload,5000):undefined
    return()=>{clearInterval(timer);window.removeEventListener('design-system:ready',reload);window.removeEventListener('processing-jobs:changed',reload)}
  },[running,reload])
  async function start(){
    setBusy(true);setFailure('')
    try{
      const r=await fetch(`/api/uploads/${uploadId}/quality-audit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start',explicit:true})}),body=await r.json() as {background?:boolean;error?:string}
      if(!r.ok)throw Error(body.error??'Не удалось начать аудит')
      reload();window.dispatchEvent(new Event('processing-jobs:changed'))
      if(!body.background)await runQualityAudit(uploadId,new AbortController().signal,()=>reload())
    }catch(e){setFailure(e instanceof Error?e.message:'Аудит прервался')}
    finally{setBusy(false);reload()}
  }
  if(error)return <p className="ds-note" role="status">Аудит сейчас недоступен. <button className="pw-outline" onClick={reload}>Повторить</button></p>
  if(!data)return null
  const job=data.job,checked=data.results.flatMap(r=>r.slides).length,total=job?.batches.reduce((n,b)=>n+b.slides.length,0)??0
  const added=job?.repairs.filter(r=>r.status==='accepted').length??0
  const findings=data.results.flatMap(r=>r.slides.flatMap(s=>s.findings.map(f=>({slide:s.slide,...f}))))
  const unchecked=job?.batches.filter(b=>b.status==='skipped')??[]
  return <>
    <details className="ds-note" aria-label="Аудит дизайн-системы">
      <summary>{!job?'Аудит смысловых блоков':data.stale?'Источник обновился · аудит требует повторения':`Аудит: ${checked} из ${total} слайдов${running?' · в работе':''}${added?` · добавлено целых блоков: ${added}`:''}`}</summary>
      {(!job||data.stale)&&<><p>Qwen сравнит исходные слайды с компонентами, проверит их смысловые связи и выделит приёмы шаблона. Это отдельные запросы к модели.</p><button className="pw-outline" disabled={busy} onClick={()=>void start()}>{busy?'Начинаем…':'Проверить дизайн-систему'}</button></>}
      {job&&!data.stale&&<>
        {job.integrity.status==='checked'?<p>Ресурсов в исходном PPTX: {job.integrity.resources}. Не перенесено: {job.integrity.missing.length}.</p>:<p>{job.integrity.reason}</p>}
        {job.integrity.missing.length>0&&<ul>{job.integrity.missing.map(m=><li key={m.path}>Слайды {m.slides.join(', ')}: не перенесено изображение {m.path.split('/').at(-1)}</li>)}</ul>}
        {findings.length===0&&!running&&<p>{checked===total?'В проверенных слайдах модель не нашла замечаний.':'Аудит неполон; отсутствие замечаний не подтверждает качество непроверенных слайдов.'}</p>}
        {!!findings.length&&<ul>{findings.map(f=>{const repair=job.repairs.find(r=>r.slide===f.slide&&r.findingId===f.id);return <li key={`${f.slide}:${f.id}`}><a href={`/styles/${uploadId}?section=source`}>Слайд {f.slide}</a>: {f.reason}{repair?.detail&&<p>{repair.detail}</p>}{repair?.componentIds?.map((id,i)=><p key={id}><a href={`/styles/${encodeURIComponent(uploadId)}/components/${encodeURIComponent(id)}`}>Открыть добавленный блок{repair.componentIds!.length>1?` ${i+1}`:''}</a></p>)}</li>})}</ul>}
        {unchecked.map(b=><p key={b.id}>Не проверены слайды {b.slides.join(', ')}: {b.error}</p>)}
        {data.results.flatMap(r=>r.rejected).map((r,i)=><p key={`rejected-${i}`}>Слайд {r.slide}: {r.reason}</p>)}
        {job.overview.status==='skipped'&&<p>Приёмы шаблона не обобщены: {job.overview.error}</p>}
        {running&&!busy&&<button className="pw-outline" onClick={()=>void start()}>Продолжить аудит</button>}
      </>}
      {failure&&<p role="alert">{failure}</p>}
    </details>
    {showStyle&&!data.stale&&data.style&&<section className="ds-findings" aria-label="Приёмы шаблона">
      <p className="ds-note">{data.style.summary} Наблюдения Qwen по исходным примерам.</p>
      {data.style.patterns.map((p,i)=><article key={i}><h3>{p.name}</h3><p>{p.purpose}</p><p>{p.application}</p><p>Сохранять: {p.preserve.join('; ')}.</p><small>{p.scope==='recurring'?'Повторяющийся приём':'Отдельный пример'} · слайды {[...new Set(p.evidence.map(e=>e.slide))].join(', ')}</small></article>)}
      {data.style.limitations.map((l,i)=><p className="ds-note" key={`limit-${i}`}>{l}</p>)}
    </section>}
  </>
}
