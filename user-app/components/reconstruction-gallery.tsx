"use client"
import {useReconstruction} from './use-reconstruction'
import Link from 'next/link'
import {componentSettingsPath} from '@/lib/component-lab/links'
import {Shapes,Blocks} from 'lucide-react'
import {EditableMarkup} from './editable-markup'
import {graphicHtml} from '@/lib/design-system/diagram-graph'
import {buildGraphicSystem} from '@/lib/design-system/graphic-components'
/** Groups describe the available pieces; compositions show their arrangement.
 * Neither view exposes the engine's variant/calibration controls. */
export function ReconstructionGallery({uploadId,section='assets'}:{uploadId:string;section?:'assets'|'components'}){
 const {state,error}=useReconstruction(uploadId)
 if(error)return <p role="alert">{error}</p>
 const system=buildGraphicSystem({results:state?.results??[]}),groups=system.groups.filter(g=>g.kind===(section==='components'?'diagram':'pattern'))
 if(!groups.length)return null
 return <div className="cw cw-gallery ed-gallery" aria-label="Группы компонентов">{groups.map(group=>{
  const surface=state?.results.find(r=>group.sourceResultIds.includes(r.id))?.diagram?.sourceSurface
  const items=system.components.filter(c=>group.componentIds.includes(c.id)).map(p=>({id:p.id,name:p.name,role:p.role,scene:p.scene,html:graphicHtml(p.scene.elements,p.scene.width,p.scene.height,uploadId)}))
  return <section key={group.id} aria-label={group.name}><div className="ed-gallery-toolbar"><p>{group.name}</p><Link href={`/styles/${uploadId}?section=${group.kind==='diagram'?'diagrams':'backgrounds'}`}>{group.kind==='diagram'?'Собрать схему':'Посмотреть фоны'}</Link></div><div className="cw-grid ed-grid">{items.map(item=>{const content=<><div className="ed-card-preview"><div style={{height:220,padding:24,background:surface??'#e5e9f0',display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{width:item.scene?Math.min(360,170*item.scene.width/item.scene.height):320,maxWidth:'100%'}}><EditableMarkup uploadId={uploadId} html={item.html}/></div></div><span className="cw-type-badge">{item.role==='block'?<Blocks size={17}/>:<Shapes size={17}/>}</span></div><div className="cw-card-body"><strong>{item.name}</strong><span className="cw-card-description">{item.role==='block'?'Для текста и данных в схеме':item.role==='connector'?'Связывает блоки в композиции':'Для фона и фирменных иллюстраций'}</span><span className="cw-tags"><span>{group.kind==='diagram'?'Схема':'Паттерн'}</span><span>Компонент</span></span></div></>;return section==='components'?<Link key={item.id} href={componentSettingsPath(uploadId,item.id)} className="cw-card ed-card" aria-label={`Открыть компонент «${item.name}»`}>{content}</Link>:<article key={item.id} className="cw-card ed-card">{content}</article>})}</div></section>
 })}</div>
}
