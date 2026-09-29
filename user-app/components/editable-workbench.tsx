"use client"
import { useEffect, useMemo, useRef, useState } from 'react'
import { Blocks, Image as ImageIcon, LayoutGrid, Search } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { editableState } from '@/lib/design-system/editable-analysis'
import type { EditableData, EditableTemplate } from '@/lib/design-system/editable-contract'
import { renderEditableHtml } from '@/lib/design-system/editable-render'
import {EditableMarkup} from './editable-markup'
import { useRefinement } from './design-system-refinement'
import { componentSettingsPath } from '@/lib/component-lab/links'
import { useComponentPreparation, preparationLabel } from './use-component-preparation'

type State=Awaited<ReturnType<typeof editableState>>
function Preview({template,data,thumbnail=false,uploadId}:{uploadId:string;template:EditableTemplate;data?:EditableData;thumbnail?:boolean}) {
  const ref=useRef<HTMLDivElement>(null),inner=useRef<HTMLDivElement>(null)
  const fitted=thumbnail||!!template.sourceLayout||!!template.sourceRegion
  const html=useMemo(()=>renderEditableHtml(template,data??template.data),[template,data])
  useEffect(()=>{
    if(!fitted||!ref.current||!inner.current)return
    const fit=()=>{const box=ref.current,body=inner.current;if(!box||!body)return;const scale=Math.min((box.clientWidth-28)/800,(box.clientHeight-24)/Math.max(1,body.scrollHeight));body.style.transform=`translate(-50%,-50%) scale(${scale})`}
    const observer=new ResizeObserver(fit);observer.observe(ref.current);observer.observe(inner.current);void document.fonts.ready.then(fit);fit()
    return()=>observer.disconnect()
  },[html,fitted])
  return <div ref={ref} className={thumbnail?'ed-thumbnail':fitted?'ed-preview ed-preview-native':'ed-preview'}><EditableMarkup uploadId={uploadId} ref={inner} className={fitted?'ed-thumbnail-content':'ed-content'} html={html}/></div>
}

export function EditableWorkbench({uploadId,section,automated=true}:{uploadId:string;automated?:boolean;section:'components'|'composition'|'graphics'}) {
  const params=useSearchParams(), refinement=useRefinement(), focus=params.get('template'), receipt=params.get('refinement')
  const added=new Set(refinement?.state?.jobs.filter(j=>refinement.state?.applied.includes(j.id)).flatMap(j=>j.result?.items?.map(i=>i.id)??[])??[])
  const filterIds=receipt?new Set(refinement?.state?.jobs.find(j=>j.id===receipt)?.result?.items?.map(i=>i.id)??[]):null
  const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[query,setQuery]=useState('')
  const preparation=useComponentPreparation(uploadId,state?.catalog?.qualification?state.catalog.id:null,true)
  const jobs=new Map(preparation?.jobs.map(j=>[j.componentId,j])??[])
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
    const load=async()=>{try{const r=await fetch(`/api/uploads/${uploadId}/editable-system`,{signal:controller.signal}),s=await r.json() as State;if(!r.ok)throw Error(s.error??'Не удалось получить состояние');setState(s);setError('');if(!s.catalog?.qualification)timer=setTimeout(()=>void load(),5000)}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Не удалось открыть конструкции')}}
    const refresh=()=>{clearTimeout(timer);void load()};void load();window.addEventListener('design-system:ready',refresh)
    return()=>{controller.abort();clearTimeout(timer);window.removeEventListener('design-system:ready',refresh)}
  },[uploadId])
  const all=state?.catalog?.families??state?.native.map(t=>({id:t.id,name:t.name,description:t.description,tags:t.tags,kind:t.kind,variants:[t],sourceIds:t.sourceIds,slides:[t.slide]}))??[]
  const verified=new Set(state?.catalog?.qualification?.checks.filter(c=>c.passed).map(c=>c.id)??[])
  const available=state?.catalog?all.map(f=>{const variants=f.variants.filter(t=>verified.has(t.id));return {...f,variants,description:variants[0]?.description??f.description,tags:variants[0]?.tags??f.tags}}).filter(f=>f.variants.length):all
  const families=available.map(f=>({...f,variants:filterIds?f.variants.filter(t=>filterIds.has(t.id)):f.variants})).filter(f=>f.variants.length&&(f.kind!=='text'||f.variants.some(t=>t.adaptation&&t.adaptation.family!=='fixed'||jobs.get(t.id)?.result?.generationAdmission))&&(section==='graphics'?f.kind==='graphic':f.kind!=='graphic'&&(section==='composition'?['composition','diagram'].includes(f.kind):!['composition','diagram'].includes(f.kind)))&&`${f.name} ${f.tags.join(' ')}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')))
  // A direct link keeps its variant; a family card otherwise prefers a checked
  // adaptive variant. Status comes from the same queue used by the generator.
  const focusFamily=focus?families.find(f=>f.variants.some(t=>t.id===focus)):undefined
  if(!automated&&!families.length)return section==='composition'?<p className="ds-note">Сочетания компонентов появятся после автоматического разбора слайдов.</p>:null
  return <div className="cw cw-gallery ed-gallery" aria-label={section==='graphics'?'Добавленная графика':section==='composition'?'Каталог композиций':'Редактируемые компоненты'}>
    <div className="ed-gallery-toolbar"><label className="ws-search"><Search size={17} aria-hidden="true"/><input type="search" aria-label="Поиск конструкции" placeholder="Поиск по назначению" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
    {receipt&&<p className="rf-filter">Показаны элементы из выбранного дополнения. <a href={`/styles/${uploadId}?section=${section==='graphics'?'assets':section}`}>Показать весь каталог</a></p>}
    {section==='components'&&preparation&&!preparation.error&&<p className="ds-note" role="status">Вариантов с проверенной адаптивностью: {preparation.jobs.filter(j=>j.status==='complete'&&j.result?.generationAdmission).length}. {preparation.jobs.some(j=>['queued','running','retrying'].includes(j.status))?'Подготовка продолжается в фоне.':''}</p>}
    {preparation?.error&&<p className="ds-note">{preparation.error}</p>}
    {error&&<p className="pw-error" role="alert">{error}</p>}
    {!families.length&&!!query&&<p className="ds-note">По этому запросу ничего не найдено.</p>}
    <div className="cw-grid ed-grid">{families.map(f=>{const template=f.variants.find(t=>t.id===focus)??f.variants.find(t=>jobs.get(t.id)?.status==='complete'&&jobs.get(t.id)?.result?.generationAdmission)??f.variants[0];const job=jobs.get(template.id);return <Link className="cw-card ed-card" key={f.id} href={componentSettingsPath(uploadId,template.id)} data-component-id={template.id} data-highlighted={focusFamily?.id===f.id||undefined} aria-label={`Открыть ${section==='graphics'?'графику':section==='composition'?'композицию':'конструкцию'} «${f.name}»`}><span className="ed-card-preview"><Preview uploadId={uploadId} template={template} thumbnail/><span className="cw-type-badge" title={section==='graphics'?'Исходная графика':section==='composition'?'Композиция':'Редактируемый компонент'}>{section==='graphics'?<ImageIcon size={17}/>:section==='composition'?<LayoutGrid size={17}/>:<Blocks size={17}/>}</span></span><span className="cw-card-body"><strong>{f.name}</strong><span className="cw-card-description">{template.description}</span><span className="cw-tags">{f.tags.slice(0,4).map(tag=><span key={tag}>{tag}</span>)}</span><span className="cw-variant-count" title={job?.reason}>{f.variants.some(t=>added.has(t.id))?<span className="rf-new">Добавлено при дополнении</span>:section==='graphics'?'Исходная графика':preparationLabel(job)}</span></span></Link>})}</div>
  </div>
}
