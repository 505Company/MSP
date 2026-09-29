import { z } from 'zod'
import type { ComponentDefinition, ComponentIssue } from '../design-system/types'
import type { CatalogComponent } from '../design-system/catalog-types'
import type { ElementIR } from '../../vendor/drag/src/core/model'
import { flatten, instantiateComponent } from '../design-system/compiler'

const itemSchema=z.object({id:z.string().uuid(),componentId:z.string().regex(/^[\w-]{1,160}$/),definitionId:z.string().regex(/^[a-f0-9]{64}$/),values:z.record(z.string().max(5000)).refine(v=>Object.keys(v).length<=100),x:z.number().finite().min(-10000).max(10000),y:z.number().finite().min(-10000).max(10000),scale:z.number().finite().min(.05).max(4)}).strict()
export const slideSchema=z.object({schemaVersion:z.literal(1),name:z.string().trim().min(1).max(120),width:z.number().min(320).max(3840),height:z.number().min(240).max(2160),background:z.string().regex(/^#[a-fA-F0-9]{6}$/),items:z.array(itemSchema).max(24)}).strict().refine(s=>new Set(s.items.map(i=>i.id)).size===s.items.length,'Повторяющийся экземпляр')
export type SlideDocument=z.infer<typeof slideSchema>
export type SavedSlide={id:string;parentId:string|null;createdAt:string;document:SlideDocument;definitions:Record<string,CatalogComponent>}
export const blankSlide=():SlideDocument=>({schemaVersion:1,name:'Новый слайд',width:960,height:540,background:'#FFFFFF',items:[]})

/** Scale the existing scene explicitly: the renderer's group bounds are not scale transforms. */
export function scaled(elements:ElementIR[],factor:number,instanceId:string){
  const result=structuredClone(elements)
  for(const e of flatten(result)){
    e.id=`${instanceId}-${e.id}`
    for(const b of [e.bounds,...('clipBounds' in e&&e.clipBounds?[e.clipBounds]:[])]){b.x*=factor;b.y*=factor;b.width*=factor;b.height*=factor}
    if(e.blur)e.blur*=factor
    e.effects?.forEach(f=>{f.offset.x*=factor;f.offset.y*=factor;f.radius*=factor})
    if(e.kind==='text'){
      e.fontSize*=factor
      e.styleRuns?.forEach(r=>{r.fontSize*=factor;if(r.letterSpacing!==undefined)r.letterSpacing*=factor})
      e.paragraphs?.forEach(p=>{p.fontSize*=factor;p.left*=factor;p.right*=factor;p.indent*=factor;p.before*=factor;p.after*=factor;if(p.defaultTab)p.defaultTab*=factor;p.tabs?.forEach(t=>t.position*=factor);if(p.lineHeight?.unit==='PIXELS')p.lineHeight.value*=factor})
      if(e.flow)e.flow.gap*=factor
    }
    if('stroke' in e&&e.stroke){e.stroke.width*=factor;e.stroke.dash=e.stroke.dash?.map(v=>v*factor)}
    if(e.kind==='path'&&e.pathData)e.pathData=e.pathData.replace(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g,n=>String(Number(n)*factor))
    if('clipPathData' in e&&e.clipPathData)e.clipPathData=e.clipPathData.replace(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g,n=>String(Number(n)*factor))
    if('tableGrid' in e&&e.tableGrid)throw new Error('Таблицы с динамической раскладкой пока нельзя размещать на новом слайде')
  }
  return result
}

export function composeSlide(raw:SlideDocument,definitions:Record<string,CatalogComponent>):ComponentDefinition{
  const doc=slideSchema.parse(raw),issues:ComponentIssue[]=[],color=doc.background.slice(1)
  const elements:ElementIR[]=[{id:'slide-background',name:'Фон слайда',kind:'rectangle',bounds:{x:0,y:0,width:doc.width,height:doc.height},rotation:0,opacity:1,visible:true,zIndex:0,fill:{type:'solid',color:{r:parseInt(color.slice(0,2),16)/255,g:parseInt(color.slice(2,4),16)/255,b:parseInt(color.slice(4,6),16)/255,a:1}}}]
  for(const [index,item] of doc.items.entries()){
    const saved=definitions[item.definitionId]
    if(!saved||saved.definitionId!==item.definitionId||saved.component.id!==item.componentId)throw new Error('Версия компонента недоступна; откройте каталог заново')
    const component=saved.component,scene=instantiateComponent(component,item.values),width=scene.width*item.scale,height=scene.height*item.scale
    if(item.x<0||item.y<0||item.x+width>doc.width+.01||item.y+height>doc.height+.01)issues.push({code:'outside-slide',message:`«${component.name}» выходит за границы слайда. Переместите или уменьшите конструкцию.`})
    issues.push(...component.issues.map(i=>({...i,elementId:i.elementId?`${item.id}-${i.elementId}`:undefined})))
    elements.push({id:item.id,name:component.name,kind:'group',bounds:{x:item.x,y:item.y,width,height},rotation:0,visible:true,opacity:1,zIndex:index+1,children:scaled(scene.elements,item.scale,item.id)})
  }
  const uniqueIssues=[...new Map(issues.map(issue=>[JSON.stringify([issue.code,issue.elementId,issue.message]),issue])).values()]
  return {id:'new-web-slide',name:doc.name,kind:'compound',source:{slide:1,rootId:'new-web-slide',ancestorIds:[],elementIds:flatten(elements).map(e=>e.id),assetIds:[...new Set(flatten(elements).filter(e=>e.kind==='raster').map(e=>e.assetId))]},scene:{width:doc.width,height:doc.height,elements},slots:[],fixedTextIds:[],issues:uniqueIssues,semantics:[]}
}
