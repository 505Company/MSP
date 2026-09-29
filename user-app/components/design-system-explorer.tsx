"use client"
/* Native images use authenticated same-origin resource routes without an image optimizer. */
/* eslint-disable @next/next/no-img-element */
import { useId } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowDownToLine, ExternalLink } from 'lucide-react'
import type { VisualManifest } from '@/lib/digital-designer/visual-package'
import type { CheckpointResult } from '@/lib/digital-designer/pipeline'
import knowledge from '@/lib/digital-designer/knowledge.json'
import {ReconstructionGallery} from './reconstruction-gallery'
import { ComponentWorkbench } from './component-workbench'
import { EditableWorkbench } from './editable-workbench'
import { useSourceSystem, NativeStyles } from './source-system-panel'
import { designSystemSection, designSystemSections } from './design-system-sections'
import { DesignSystemRefinement } from './design-system-refinement'
import { SourceRefinement } from './source-refinement'
import { RecipeDiscovery } from './recipe-discovery'
import { BackgroundWorkbench } from './background-workbench'
import { DiagramWorkbench } from './diagram-workbench'
import { ImportIssues } from './import-issues'
import { QualityAudit } from './quality-audit'

export function DesignSystemExplorer({uploadId,visual,checkpoint,automated=false}:{uploadId:string;automated?:boolean;visual:VisualManifest;checkpoint:CheckpointResult|null}){
  const tab=designSystemSection(useSearchParams().get('section'))
  const navigationId=useId()
  const s=visual.snapshot,findings=checkpoint?.result.findings??[],assetUrl=(id:string)=>`/api/uploads/${uploadId}/assets/${id}`
  const originals=visual.assets.filter(a=>a.origins.some(o=>/^(ppt\/media\/|pdf\/)/.test(o)))
  const {system,error:systemError}=useSourceSystem(uploadId,JSON.stringify(checkpoint?.result??null))
  const selected=tab==='composition'?findings.filter(f=>f.kind==='molecule'||f.kind==='rule'&&/композиц|сетк|верстк|вёрстк|отступ|располож/i.test(f.name+' '+f.role+' '+f.value)):findings.filter(f=>f.kind==='rule'||f.kind==='token')
  const title=(id:string)=>knowledge.catalogue.find(c=>c.id===id)?.name??id
  return <DesignSystemRefinement key={uploadId} uploadId={uploadId}><section className="ds-explorer ds-explorer--sidebar" data-section={tab} aria-label="Компоненты дизайн-системы">
    <header><div><h2 id={`${navigationId}-heading`}>{designSystemSections.find(([id])=>id===tab)![1]}</h2>{tab!=='components'&&<p>{s.slideCount} слайдов · {s.elements.length} объектов · {originals.length} исходных ресурсов</p>}</div></header>
    {!!system?.summary.incompleteSlides&&<p className="ss-warning" role="alert">Часть объектов не удалось прочитать на слайдах {system.incompleteSlideNumbers.join(', ')}. Исходник, текст и доступные ресурсы сохранены; дизайн-система этих слайдов неполна.</p>}
    <ImportIssues key={uploadId} uploadId={uploadId}/>
    <QualityAudit uploadId={uploadId} showStyle={tab==='style'}/>
    <div className="ds-layout">
    <div className="ds-panel" role="region" aria-labelledby={`${navigationId}-heading`}>
      {tab==='components'&&<><EditableWorkbench automated={automated} uploadId={uploadId} section="components"/><ReconstructionGallery uploadId={uploadId} section="components"/><ComponentWorkbench key={uploadId} uploadId={uploadId}/></>}
      {tab==='composition'&&<><RecipeDiscovery uploadId={uploadId}/><EditableWorkbench automated={automated} uploadId={uploadId} section="composition"/></>}
      {tab==='colors'&&(system?<NativeStyles key="colors" system={system} filter="colors"/>:<p role="status">{systemError||'Собираем стили из всех объектов…'}</p>)}
      {tab==='backgrounds'&&<BackgroundWorkbench key={uploadId} uploadId={uploadId}/>}
      {tab==='diagrams'&&<DiagramWorkbench key={uploadId} uploadId={uploadId}/>}
      {tab==='type'&&(system?<NativeStyles key="typography" system={system} filter="typography"/>:<p role="status">{systemError||'Собираем типографику из всех объектов…'}</p>)}
      {tab==='assets'&&<><EditableWorkbench automated={automated} uploadId={uploadId} section="graphics"/><ReconstructionGallery uploadId={uploadId}/><ComponentWorkbench uploadId={uploadId} section="graphics"/><details><summary>Все файлы исходника</summary><div className="ds-assets">{originals.map((a,index)=>{const f=findings.find(f=>f.evidence.assetIds.includes(a.id));return <article key={a.id}>{['image/png','image/jpeg','image/webp'].includes(a.mime)?<img src={assetUrl(a.id)} loading="lazy" alt={f?.name??`Изображение ${index+1}`}/>:<div className="ds-unsupported">{a.extension.toUpperCase()}<small>Доступно для скачивания</small></div>}<h4>{f?.name??`Изображение ${index+1}`}</h4><a href={`${assetUrl(a.id)}?download=1`}>Скачать {a.extension.toUpperCase()} <ArrowDownToLine size={13}/></a></article>})}</div></details></>}
      {tab==='style'&&!system?.semantic&&<>{!checkpoint?.visualAnalysis&&<p className="ds-note">Визуальный анализ ещё не завершён. Извлечённые свойства и ресурсы уже доступны.</p>}<div className="ds-findings">{selected.map(f=><article key={f.id}><span className="ds-tag">{title(f.categoryId)} · наблюдение</span><h3>{f.name}</h3><p>{f.value}</p><p className="ds-role">{f.role}</p><small>{f.evidence.basis==='inferred'?'Предположение':'По исходным слайдам'}</small><div className="ds-evidence">{f.evidence.slideIds.map(id=><a key={id} href={assetUrl(`preview-${id}`)} target="_blank" rel="noreferrer">Слайд {Number(id.slice(1))} <ExternalLink size={12}/></a>)}</div>{f.transforms.allowed.length>0&&<p className="ds-role">Можно: {f.transforms.allowed.join('; ')}</p>}{f.transforms.forbidden.length>0&&<p className="ds-role">Ограничения: {f.transforms.forbidden.join('; ')}</p>}</article>)}</div>{!selected.length&&checkpoint?.visualAnalysis&&<p className="ds-note">Доказуемые правила этого раздела не найдены. Они не добавляются автоматически.</p>}</>}
      {tab==='style'&&!system?.semantic&&checkpoint?.visualAnalysis&&<><h3>Стиль фотографий</h3>{checkpoint.result.photoStyle.status==='insufficient_evidence'&&<p className="ds-note">Недостаточно материала для устойчивых правил фотостиля.</p>}{checkpoint.result.photoStyle.variants.map((v,i)=><article className="ds-rule" key={i}><h4>{v.name}</h4><p>{v.task}</p>{v.properties.map((p,j)=><div key={j}><p>{p.value}</p><small>{p.evidence.basis==='inferred'?'Предположение':'Наблюдение по источнику'} · слайды {p.evidence.slideIds.map(id=>Number(id.slice(1))).join(', ')}</small></div>)}</article>)}{checkpoint.result.photoStyle.limitations.map((l,i)=><p className="ds-note" key={i}>{l}</p>)}</>}
      {tab==='style'&&system?.semantic&&<div className="ds-findings">{system.rules.map(rule=><article key={rule.id}><h3>{rule.name}</h3><p>{rule.sourceTexts[0]?.text}</p><div className="ds-evidence">{[...new Set(rule.sourceTexts.map(t=>t.slide))].map(n=><a key={n} href={assetUrl(`preview-s${String(n).padStart(2,'0')}`)} target="_blank" rel="noreferrer">Слайд {n} <ExternalLink size={12}/></a>)}</div></article>)}{!system.rules.length&&<p className="ds-note">В шаблоне нет явных инструкций по оформлению.</p>}</div>}
      {tab==='source'&&<SourceRefinement uploadId={uploadId} visual={visual}/>}
    </div>
    </div>

  </section></DesignSystemRefinement>
}
