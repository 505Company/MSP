"use client"
import {ensureUploadFonts} from '@/browser/fonts'
import {useEffect,useState} from 'react'
import type {DataAssemblyView} from '@/lib/presentations/data-assembly'
import {renderEditableHtml} from '@/lib/design-system/editable-render'
import {qualifyEditableCatalog} from '@/lib/design-system/editable-qualification'
import {EDITABLE_VERSION,EDITABLE_COMPILER_VERSION} from '@/lib/design-system/editable-contract'
import {EditableMarkup} from './editable-markup'
import {PresentationSlideGallery} from './presentation-slide-gallery'

/** Only the finished result is public. Selection, binding and layout are automatic. */
export function PresentationDataStatus({projectId,revision,uploadId,paused}:{projectId:string;revision:string;uploadId:string;paused:boolean}){
 const [view,setView]=useState<DataAssemblyView|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 useEffect(()=>{
  if(paused)return
  const controller=new AbortController()
  const work=async()=>{
   const response=await fetch(`/api/projects/${projectId}/data-assembly`,{signal:controller.signal}),data=await response.json() as DataAssemblyView
   if(!response.ok)throw Error(data.error??'Не удалось оформить данные')
   if(data.projectRevision!==revision||data.uploadId!==uploadId)return
   await ensureUploadFonts(uploadId)
   const report=await qualifyEditableCatalog({id:data.id,version:EDITABLE_VERSION,compilerVersion:EDITABLE_COMPILER_VERSION,sourceRevision:revision,catalogId:data.id,createdAt:'',coverage:[],excluded:[],modelRunIds:[],liveRequests:0,families:data.slides.map(s=>({id:s.id,name:s.title,description:s.template.description,tags:s.template.tags,kind:s.template.kind,sourceIds:s.template.sourceIds,slides:[s.template.slide],variants:[{...s.template,id:s.id,data:s.data}]}))})
   if(report.checks.some(c=>!c.source))throw Error('Данные сохранены, но пока не помещаются в выбранное оформление.')
   if(!controller.signal.aborted){setView(data);setError('')}
  }
  void work().catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Не удалось оформить данные')})
  const ready=()=>setRetry(n=>n+1);window.addEventListener('design-system:ready',ready)
  return()=>{controller.abort();window.removeEventListener('design-system:ready',ready)}
 },[projectId,revision,uploadId,paused,retry])
 if(paused)return null
 const current=view?.projectRevision===revision&&view.uploadId===uploadId?view:null
 return <section aria-label="Презентация из данных"><p role="status" className={error?'pw-error':'ws-form-status'}>{error|| (current?`Данные оформлены в стиле шаблона: ${current.slides.length} слайдов.`:'Оформляем данные в стиле шаблона…')}</p>{error&&<button className="pw-outline" onClick={()=>setRetry(n=>n+1)}>Повторить подготовку</button>}{current&&!error&&<PresentationSlideGallery className="ws-data-slides" slides={current.slides.map(s=>({id:s.id,title:s.title,kind:s.template.kind,status:'Готов',content:<EditableMarkup uploadId={uploadId} className="ed-preview" html={renderEditableHtml(s.template,s.data)}/>}))}/>}</section>
}
