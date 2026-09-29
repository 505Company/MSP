"use client"
/* eslint-disable @next/next/no-img-element -- generated canvas preview */
import { useEffect, useRef, useState } from 'react'
import type { CatalogComponent } from '@/lib/design-system/catalog-types'
import type { RenderReport } from '@/lib/design-system/types'
import { blankSlide, composeSlide, type SavedSlide, type SlideDocument } from '@/lib/slides/document'
import { loadPresentationReader } from '@/lib/digital-designer/browser-loader'
import { flatten } from '@/lib/design-system/compiler'
import { componentLabel, textFieldLabel, componentIssueText } from '@/lib/design-system/display'

const message=(e:unknown)=>e instanceof Error?e.message:'Не удалось выполнить операцию'
export function SlideComposer({uploadId,projectId,component,values,canAdd}:{uploadId:string;projectId?:string;component:CatalogComponent|null;values:Record<string,string>;canAdd:boolean}){
  const url=projectId?`/api/projects/${projectId}/slide`:`/api/uploads/${uploadId}/slide`
  const [doc,setDoc]=useState<SlideDocument>(blankSlide)
  const [definitions,setDefinitions]=useState<Record<string,CatalogComponent>>({})
  const [saved,setSaved]=useState<SavedSlide|null>(null)
  const [loaded,setLoaded]=useState(false)
  const [selected,setSelected]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [report,setReport]=useState<(RenderReport&{signature:string})|null>(null)
  const resources=useRef(new Map<string,Promise<{id:string;bytes:Uint8Array}>>())
  const signature=JSON.stringify(doc),dirty=loaded&&signature!==JSON.stringify(saved?.document??blankSlide())
  const current=doc.items.find(i=>i.id===selected),definition=current?definitions[current.definitionId]?.component:undefined
  const verified=!!report?.fits&&report.signature===signature
  const rendering=report?.signature!==signature

  useEffect(()=>{
    let cancelled=false
    fetch(url).then(async r=>{const data=await r.json() as {slide:SavedSlide|null;error?:string};if(!r.ok)throw new Error(data.error);return data.slide as SavedSlide|null}).then(slide=>{if(!cancelled){if(slide){setSaved(slide);setDoc(slide.document);setDefinitions(slide.definitions);setSelected(slide.document.items[0]?.id??'')}setLoaded(true)}}).catch(e=>{if(!cancelled)setError(message(e))})
    return()=>{cancelled=true}
  },[url])
  async function assets(ids:string[]){return Promise.all(ids.map(id=>{
    let promise=resources.current.get(id)
    if(!promise){promise=fetch(`/api/uploads/${uploadId}/assets/${id}`).then(async r=>{if(!r.ok)throw new Error('Исходное изображение недоступно');return {id,bytes:new Uint8Array(await r.arrayBuffer())}}).catch(e=>{resources.current.delete(id);throw e});resources.current.set(id,promise)}
    return promise
  }))}
  useEffect(()=>{
    if(!loaded)return
    let cancelled=false
    const timer=setTimeout(async()=>{
      try{
        const scene=composeSlide(doc,definitions),reader=await loadPresentationReader(),result=await reader.renderNewSlide(scene,await assets(scene.source.assetIds))
        if(!cancelled)setReport({...result,signature})
      }catch(e){if(!cancelled)setReport({signature,dataUrl:'',fits:false,issues:[{code:'slide-error',message:message(e)}]})}
    },250)
    return()=>{cancelled=true;clearTimeout(timer)}
    // assets() uses a stable ref scoped to this upload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[doc,definitions,signature,loaded,uploadId])
  useEffect(()=>{
    if(!dirty)return
    const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''}
    window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard)
  },[dirty])

  function add(){
    if(!component||!canAdd||doc.items.length>=24)return
    const c=component.component,scale=Math.min(1,(doc.width-80)/c.scene.width,(doc.height-80)/c.scene.height),id=crypto.randomUUID(),offset=Math.min(doc.items.length*24,96)
    setDefinitions(d=>({...d,[component.definitionId]:component}))
    setDoc(d=>({...d,items:[...d.items,{id,componentId:c.id,definitionId:component.definitionId,values:{...values},x:Math.min(40+offset,d.width-c.scene.width*scale),y:Math.min(40+offset,d.height-c.scene.height*scale),scale}]}));setSelected(id);setError('')
  }
  function updateItem(patch:Partial<SlideDocument['items'][number]>){setDoc(d=>({...d,items:d.items.map(i=>i.id===selected?{...i,...patch}:i)}))}
  async function save(){
    setBusy(true);setError('')
    try{
      const response=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:saved?.id??null,document:doc})}),data=await response.json() as {slide:SavedSlide|null;error?:string}
      if(!response.ok)throw new Error(data.error)
      if(!data.slide)throw new Error("Слайд не сохранён");setSaved(data.slide);setDefinitions(data.slide.definitions)
    }catch(e){setError(message(e))}finally{setBusy(false)}
  }
  async function reload(){
    setBusy(true);setError('')
    try{const response=await fetch(url),data=await response.json() as {slide:SavedSlide|null;error?:string};if(!response.ok)throw new Error(data.error);const next=data.slide as SavedSlide|null;setSaved(next);setDoc(next?.document??blankSlide());setDefinitions(next?.definitions??{});setSelected(next?.document.items[0]?.id??'');setLoaded(true)}catch(e){setError(message(e))}finally{setBusy(false)}
  }
  async function download(){
    if(!verified||!doc.items.length)return
    setBusy(true);setError('')
    try{
      const scene=composeSlide(doc,definitions),reader=await loadPresentationReader(),bytes=await reader.exportNewSlide(scene,await assets(scene.source.assetIds)),blob=new Blob([Uint8Array.from(bytes)],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}),href=URL.createObjectURL(blob),link=document.createElement('a')
      link.href=href;link.download=`${doc.name.replace(/[\\/:*?"<>|]/g,'-')}.pptx`;link.click();setTimeout(()=>URL.revokeObjectURL(href),30000)
    }catch(e){setError(message(e))}finally{setBusy(false)}
  }
  const fonts=[...new Set(doc.items.flatMap(i=>{const c=definitions[i.definitionId]?.component;return c?flatten(c.scene.elements).filter(e=>e.kind==='text').flatMap(e=>[e.fontFamily,...e.styleRuns?.map(r=>r.fontFamily)??[]]):[]}))]
  return <section className="slide-composer" aria-label="Новый слайд">
    <div className="cw-title"><div><h3>Новый слайд</h3><p>Соберите слайд из компонентов каталога. Текст и фигуры останутся редактируемыми в PPTX.</p></div><button className="pw-primary" onClick={add} disabled={!loaded||busy||!canAdd||doc.items.length>=24}>Добавить выбранный компонент</button></div>
    {error&&<p className="pw-error" role="alert">{error} <button className="pw-text-button" onClick={reload} disabled={busy}>Открыть сохранённый слайд</button>{dirty&&<small>Это заменит текущие несохранённые правки.</small>}</p>}
    {!loaded&&!error&&<p role="status">Открываем слайд…</p>}
    {loaded&&<>
      <div className="cw-filters"><label>Название слайда<input value={doc.name} maxLength={120} disabled={busy} onChange={e=>setDoc(d=>({...d,name:e.target.value}))}/></label><label>Формат слайда<select value={`${doc.width}x${doc.height}`} disabled={busy} onChange={e=>{const [width,height]=e.target.value.split('x').map(Number);setDoc(d=>({...d,width,height}))}}><option value="960x540">16:9 · 960 × 540</option><option value="960x720">4:3 · 960 × 720</option></select></label><label>Фон слайда<input type="color" value={doc.background} disabled={busy} onChange={e=>setDoc(d=>({...d,background:e.target.value}))}/></label></div>
      <div className="slide-grid">
        <div><div className="slide-preview" style={{aspectRatio:`${doc.width}/${doc.height}`}} aria-busy={rendering}>{!rendering&&report?.dataUrl?<img src={report.dataUrl} alt={`Новый слайд «${doc.name}»`}/>:<p role="status">{rendering?'Проверяем слайд…':'Исправьте ограничения, чтобы увидеть полный слайд.'}</p>}</div>
          {!doc.items.length&&<p className="ds-note">Выберите компонент выше и добавьте его на слайд. В первой версии можно разместить до 24 экземпляров.</p>}
          {!rendering&&report&&<div className="slide-check" aria-live="polite">{[...new Set(report.issues.map(componentIssueText))].map((message,i)=><p className="cw-issue" key={i}>{message}</p>)}{report.fits&&doc.items.length>0&&<p className="cw-ok">Слайд готов к редактируемому экспорту.</p>}</div>}
        </div>
        <div className="slide-inspector">
          <div className="slide-items" aria-label="Объекты нового слайда">{doc.items.map((i,n)=><button key={i.id} className="pw-outline" aria-pressed={i.id===selected} onClick={()=>setSelected(i.id)} disabled={busy}>{n+1}. {definitions[i.definitionId]?componentLabel(definitions[i.definitionId].component):'Компонент'}</button>)}</div>
          {current&&definition&&<>
            <div className="slide-position">{(['x','y'] as const).map(axis=><label key={axis}>{axis.toUpperCase()}, px<input type="number" value={Math.round(current[axis]*100)/100} disabled={busy} onChange={e=>updateItem({[axis]:Number(e.target.value)})}/></label>)}<label>Масштаб, %<input type="number" min="5" max="400" value={Math.round(current.scale*10000)/100} disabled={busy} onChange={e=>updateItem({scale:Number(e.target.value)/100})}/></label></div>
            <div className="cw-fields">{definition.slots.map((slot,index)=><div key={slot.id}><label htmlFor={`slide-slot-${current.id}-${slot.id}`}>{textFieldLabel(slot,index)}</label><textarea id={`slide-slot-${current.id}-${slot.id}`} value={current.values[slot.id]??slot.defaultText} maxLength={slot.maxLength} disabled={busy} onChange={e=>updateItem({values:{...current.values,[slot.id]:e.target.value}})}/></div>)}</div>
            <div className="cw-actions"><button className="pw-outline" disabled={busy||doc.items[0].id===selected} onClick={()=>setDoc(d=>{const items=[...d.items],n=items.findIndex(i=>i.id===selected);[items[n-1],items[n]]=[items[n],items[n-1]];return {...d,items}})}>Слой ниже</button><button className="pw-outline" disabled={busy||doc.items.at(-1)?.id===selected} onClick={()=>setDoc(d=>{const items=[...d.items],n=items.findIndex(i=>i.id===selected);[items[n+1],items[n]]=[items[n],items[n+1]];return {...d,items}})}>Слой выше</button><button className="pw-text-button" disabled={busy} onClick={()=>{setDoc(d=>({...d,items:d.items.filter(i=>i.id!==selected)}));setSelected('')}}>Удалить со слайда</button></div>
          </>}
        </div>
      </div>
      <div className="cw-actions"><button className="pw-outline" disabled={busy||!dirty} onClick={save}>Сохранить слайд</button><button className="pw-primary" disabled={busy||!verified||!doc.items.length} onClick={download}>Скачать PPTX</button><button className="pw-text-button" disabled={busy||!dirty} onClick={reload}>Отменить правки слайда</button></div>
      <p className="slide-saved" role="status">{busy?'Выполняем…':dirty?'Есть несохранённые изменения слайда.':saved?`Слайд сохранён ${new Date(saved.createdAt).toLocaleString('ru-RU')}`:'Пустой слайд ещё не сохранён.'}</p>
      {fonts.length>0&&<small>Шрифты в PPTX: {fonts.join(', ')}. Они должны быть доступны в приложении, где вы откроете файл; в PPTX шрифты не встроены.</small>}
    </>}
  </section>
}
