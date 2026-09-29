"use client"
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import type { SourceSystem, SourceStyle } from '@/lib/design-system/source-system'
import { typographyStyleHint } from '@/lib/design-system/source-typography'

export function useSourceSystem(uploadId:string,analysisRevision=''){
  const [state,setState]=useState<{uploadId:string;analysisRevision:string;system:SourceSystem|null;error:string}>({uploadId:'',analysisRevision:'',system:null,error:''})
  useEffect(()=>{
    const controller=new AbortController()
    fetch(`/api/uploads/${uploadId}/source-system`,{signal:controller.signal}).then(async response=>{
      const data=await response.json() as {system:SourceSystem;error?:string};if(!response.ok)throw new Error(data.error??'Не удалось открыть состав дизайн-системы')
      if(!controller.signal.aborted)setState({uploadId,analysisRevision,system:data.system,error:''})
    }).catch(e=>{if(!controller.signal.aborted)setState({uploadId,analysisRevision,system:null,error:e.message})})
    return()=>controller.abort()
  },[uploadId,analysisRevision])
  return state.uploadId===uploadId&&state.analysisRevision===analysisRevision?state:{system:null,error:''}
}
const kinds={fill:'Заливка',stroke:'Обводка',gradient:'Градиент',typography:'Текст','text-color':'Цвет текста',geometry:'Геометрия',effect:'Эффект'}
function Pager({page,count,size,setPage}:{page:number;count:number;size:number;setPage:(page:number)=>void}){
  const pages=Math.max(1,Math.ceil(count/size)),current=Math.min(page,pages)
  if(pages===1)return null
  return <div className="cw-pagination"><span role="status">{current} / {pages}</span><div><button className="pw-outline" onClick={()=>setPage(current-1)} disabled={current<=1}>Назад</button><button className="pw-outline" onClick={()=>setPage(current+1)} disabled={current>=pages}>Дальше</button></div></div>
}
const STYLE_PAGE_SIZE=48
export function NativeStyles({system,filter}:{system:SourceSystem;filter:'colors'|'typography'|'other'}){
  const [query,setQuery]=useState(''),[page,setPage]=useState(1)
  const all=system.styles.filter(s=>filter==='colors'?['fill','stroke','gradient','text-color'].includes(s.kind):filter==='typography'?s.kind==='typography':['geometry','effect'].includes(s.kind))
  const items=all.filter(s=>`${s.name} ${s.id} ${JSON.stringify(s.value)}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')))
  return <div className="ss-styles" aria-label="Стили дизайн-системы">
    <div className="ss-style-toolbar"><label className="ss-search"><Search size={14} aria-hidden="true"/><span className="sr-only">Поиск стиля</span><input type="search" value={query} placeholder="Поиск стиля" onChange={e=>{setQuery(e.target.value);setPage(1)}}/></label><Pager page={page} count={items.length} size={STYLE_PAGE_SIZE} setPage={setPage}/></div>
    <div className="ss-style-list">{items.slice((page-1)*STYLE_PAGE_SIZE,page*STYLE_PAGE_SIZE).map(style=><StyleRow key={style.id} style={style} peers={all.filter(s=>s.name===style.name).map(s=>s.value)}/>)}</div>
    {!items.length&&<p className="ds-note">Стилей по этим условиям нет.</p>}
  </div>
}
function styleHint(style:SourceStyle,peers:Record<string,unknown>[]){
  const color=(style.value.color??(style.value.paint as {color?:unknown})?.color) as {a?:number}|undefined
  if(color?.a!==undefined&&color.a<1)return `Непрозрачность ${Math.round(color.a*100)}%`
  if(style.kind!=='typography')return ''
  return typographyStyleHint(style.value,peers)
}
function StyleRow({style,peers}:{style:SourceStyle;peers:Record<string,unknown>[]}){
  const color=(style.value.color??(style.value.paint as {color?:unknown})?.color) as {r:number;g:number;b:number;a:number}|undefined
  const objects=new Set(style.occurrences.map(o=>o.elementId)).size,slides=new Set(style.occurrences.map(o=>o.slide)).size
  const name=style.name.replace(/\d+\.\d+(?=\s*(?:px|pt))/g,value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:2})).replace(/\bRegular\b/g,'Обычный').replace(/\bBold\b/g,'Жирный').replace(/\bItalic\b/g,'Курсив'),hint=styleHint(style,peers)
  return <article className="ss-style"><div className="ss-style-row">
    {color?<i className="ss-swatch" aria-hidden="true" style={{background:`rgba(${color.r*255},${color.g*255},${color.b*255},${color.a})`}}/>:<span className="ss-style-sample" aria-hidden="true">{style.kind==='typography'?'Aa':style.kind==='gradient'?'◒':'◇'}</span>}
    <span className="ss-style-name" title={[name,hint].filter(Boolean).join(' · ')}><span>{name}</span>{hint&&<small>{hint}</small>}</span><span className="ss-style-kind">{kinds[style.kind]}</span><span className="ss-style-usage" title={`Использований: ${objects} · Слайдов: ${slides}`}>{objects}× · {slides} сл.</span>
    </div></article>
}
