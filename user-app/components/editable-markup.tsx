"use client"
import {useEffect,useState,type Ref} from 'react'
import {ensureUploadFonts} from '@/browser/fonts'
import {hydrateEditableHtml} from '@/lib/design-system/editable-hydrate'

type Prepared={source:string;markup:{__html:string};error:string}

/** React only receives finished markup. Native text is measured in a detached
 * tree so a parent render cannot replace its glyphs with the draft fallback. */
export function EditableMarkup({html,className,ref,uploadId}:{html:string;uploadId?:string;className?:string;ref?:Ref<HTMLDivElement>}){
 const [prepared,setPrepared]=useState<Prepared|null>(null)
 useEffect(()=>{
  let active=true
  const host=document.createElement('div');host.innerHTML=html
  void (async()=>{if(uploadId)await ensureUploadFonts(uploadId);return hydrateEditableHtml(host)})().then(issues=>{
   if(active)setPrepared({source:html,markup:{__html:host.innerHTML},error:issues[0]??''})
  }).catch(()=>{
   if(active)setPrepared({source:html,markup:{__html:''},error:'Не удалось отобразить исходное оформление'})
  })
  return()=>{active=false}
 },[html,uploadId])
 const current=prepared?.source===html?prepared:null
 return <div ref={ref} className={className} aria-busy={!current}>
  {current?<><div dangerouslySetInnerHTML={current.markup}/>{current.error&&<small role="alert">{current.error}</small>}</>:<small role="status">Готовим превью…</small>}
 </div>
}
