import type {BoundsIR} from '../../vendor/drag/src/core/model'
import type {EditableProposal} from './editable-contract'
import type {SceneRecord,SourceScene} from './source-scene'
import {area,completeSourceIds,containsBounds,leavesOnSlide,sourceMembers} from './editable-structure'

/** Recognition occasionally puts a standalone icon in `feature`. Preserve its
 * evidence, but leave it in the graphic inventory instead of stopping the deck.
 * This exception cannot cover missing IDs, text descendants or content claims. */
export function graphicOnlyProposal(b:EditableProposal,scene:SourceScene):boolean{
 if(b.kind!=='feature'||!b.sourceIds.length)return false
 if(Object.entries(b.data).some(([key,value])=>key!=='graphicId'&&(Array.isArray(value)?value.length>0:typeof value==='string'&&value.trim().length>0)))return false
 if(b.sourceIds.some(id=>!scene.records.has(id)))return false
 const selected=new Set(completeSourceIds(b.sourceIds,scene))
 const members=[...scene.records.values()].filter(r=>selected.has(r.element.id)||r.ancestors.some(id=>selected.has(id)))
 if(members.some(r=>r.element.kind==='text'))return false
 return members.some(r=>r.disposition==='visible'&&['raster','rectangle','ellipse','path','line'].includes(r.element.kind))
}

const union=(records:SceneRecord[]):BoundsIR=>{
 const x=Math.min(...records.map(r=>r.bounds.x)),y=Math.min(...records.map(r=>r.bounds.y))
 return {x,y,width:Math.max(...records.map(r=>r.bounds.x+r.bounds.width))-x,height:Math.max(...records.map(r=>r.bounds.y+r.bounds.height))-y}
}
const overlap=(a:BoundsIR,b:BoundsIR)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))
export const coversText=(graphic:SceneRecord,text:SceneRecord)=>overlap(graphic.bounds,text.bounds)>=area(text.bounds)*.8
const visual=(r:SceneRecord)=>['raster','rectangle','path','ellipse'].includes(r.element.kind)&&r.bounds.width>8&&r.bounds.height>8

/** Check semantics against the actual selected text, not just the existence of
 * object IDs. A valid logo ID cannot stand in for a paragraph about a process.
 * This deliberately rejects only disjoint claims, not paraphrases. */
export function sourceTextMismatch(b:EditableProposal,scene:SourceScene):boolean{
 if(!['text','feature','metric'].includes(b.kind))return false
 const words=(s:string)=>s.toLocaleLowerCase('ru').match(/[\p{L}\p{N}]{4,}/gu)??[]
 const requested=words([b.data.title,b.data.text,...(b.data.items??[]).map(i=>i.text)].filter(Boolean).join(' '))
 if(requested.length<4)return false
 const actual=new Set(words(sourceMembers(b.sourceIds,scene).flatMap(r=>r.element.kind==='text'?r.element.text:[]).join(' ')))
 return !requested.some(w=>actual.has(w))&&sourceMembers(b.sourceIds,scene).some(r=>r.element.kind==='text')
}

/** Source evidence takes precedence over a coarse model kind. Recover only
 * local backings/markers: bounded size, overlap with selected text and no text
 * belonging to neighbouring blocks. Never use a whole-slide raster as a card. */
export function recoverEditableEvidence(b:EditableProposal,slide:number,scene:SourceScene):EditableProposal{
 if(!['text','feature','metric'].includes(b.kind))return b
 const selected=sourceMembers(b.sourceIds,scene),texts=selected.filter(r=>r.element.kind==='text'),page=scene.slides.find(s=>s.number===slide)
 if(!texts.length||!page)return b
 const box=union(texts),leaves=leavesOnSlide(scene,slide),outside=leaves.filter(r=>r.element.kind==='text'&&!texts.includes(r))
 const margin=Math.min(40,Math.max(...texts.map(r=>r.element.kind==='text'?r.element.fontSize:0))*1.5)
 const expanded={x:box.x-margin,y:box.y-margin,width:box.width+margin*2,height:box.height+margin*2}
 const candidates=leaves.filter(r=>visual(r)&&!selected.includes(r)&&area(r.bounds)<page.width*page.height*.4&&r.bounds.width<page.width*.9&&r.bounds.height<page.height*.9)
 const isMarker=(r:SceneRecord)=>r.element.kind==='text'&&/^\d{1,3}$/.test(r.element.text.trim())&&r.bounds.width<margin*2&&r.bounds.height<margin*2
 const enclosing=candidates.filter(r=>texts.every(t=>coversText(r,t))&&area(r.bounds)<area(box)*4&&r.bounds.width<box.width*2.5&&r.bounds.height<box.height*2.5&&!outside.some(t=>coversText(r,t)&&!isMarker(t))).sort((a,b)=>area(a.bounds)-area(b.bounds))[0]
 const local=candidates.filter(r=>containsBounds(expanded,r.bounds)&&texts.some(t=>coversText(r,t))&&!outside.some(t=>coversText(r,t)))
 // One unadorned title/label remains typography. Explicit graphics or strong
 // local backing evidence are needed to turn it into a component.
 const added=[...(enclosing?[enclosing]:[]),...local],ids=[...new Set([...b.sourceIds,...added.map(r=>r.element.id)])]
 const hasGraphic=sourceMembers(ids,scene).some(visual)
 return {...b,sourceIds:ids,kind:b.kind==='text'&&hasGraphic?'feature':b.kind==='feature'&&!hasGraphic?'text':b.kind}
}
