import type {EditableTemplate} from './editable-contract'
import type {SourceScene} from './source-scene'
import {editableStructure} from './editable-structure'

/** Recover observed grids of complete blocks. This never groups by their names
 * or substitutes slide-specific recipes for source geometry. */
export function observedCompositions(blocks:EditableTemplate[],scene:SourceScene):EditableTemplate[]{
 const items=blocks.filter(t=>!['text','composition','progress','diagram'].includes(t.kind)).map(t=>{
  const b=t.sourceIds.flatMap(id=>scene.records.get(id)?.bounds??[])
  return {t,x:Math.min(...b.map(b=>b.x)),y:Math.min(...b.map(b=>b.y)),w:t.width,h:t.height}
 }).filter(b=>Number.isFinite(b.x)&&b.w>40&&b.h>30)
 const groups=new Map<string,typeof items>()
 for(const item of items){const key=editableStructure(item.t).key;groups.set(key,[...groups.get(key)??[],item])}
 // A highlight card or an illustration baked into its backing can have a
 // different structure from its neighbours. Source alignment still proves
 // their row; compare bounds instead of requiring identical storage shapes.
 const aligned:Array<typeof items>=[]
 for(const item of items.filter(i=>i.t.kind==='feature').sort((a,b)=>a.x-b.x)){
  const row=aligned.find(row=>row.every(b=>Math.abs(b.y-item.y)<Math.min(b.h,item.h)*.12&&Math.max(b.h,item.h)/Math.min(b.h,item.h)<1.3&&Math.max(b.w,item.w)/Math.min(b.w,item.w)<1.45))
  if(row)row.push(item);else aligned.push([item])
 }
 for(const [i,row] of aligned.entries())if(row.length>1)groups.set(`row:${i}`,row)
 const result:EditableTemplate[]=[]
 for(const [key,group] of groups){
  if(group.length<2)continue
  const ordered=group.sort((a,b)=>a.y-b.y||a.x-b.x),rows:Array<typeof items>=[]
  for(const item of ordered){const row=rows.find(row=>Math.abs(row[0].y-item.y)<Math.min(row[0].h,item.h)*.3);if(row)row.push(item);else rows.push([item])}
  rows.forEach(row=>row.sort((a,b)=>a.x-b.x))
  const grid=rows.every(row=>row.length===rows[0].length)&&rows.every(row=>row.every((b,i)=>!i||b.x>=row[i-1].x+row[i-1].w*.95&&b.x-row[i-1].x-row[i-1].w<Math.max(b.w,row[i-1].w)*.6))
  const stack=rows.every(row=>row.length===1)&&group.every(b=>Math.abs(b.x-group[0].x)<Math.min(b.w,group[0].w)*.15)
  if(!grid&&!stack)continue
  // Mixed sizes belong to a separate layout, not an invented uniform grid.
  if(Math.max(...group.map(b=>b.w))/Math.min(...group.map(b=>b.w))>1.45)continue
  const columns=stack?1:rows[0].length;if(columns>8||group.length>24)continue
  const children=rows.flat().map(b=>b.t),first=children[0],x=Math.min(...group.map(b=>b.x)),y=Math.min(...group.map(b=>b.y))
  if(result.some(t=>t.memberIds.length===children.length&&children.every(c=>t.memberIds.includes(c.id))))continue
  const gaps=rows.flatMap(row=>row.slice(1).map((b,i)=>Math.max(0,b.x-row[i].x-row[i].w)))
  const name=columns===1?'Вертикальная группа':columns===2?'Две колонки':`Сетка из ${columns} колонок`
  result.push({id:`composition-${first.id}${key.startsWith('row:')?'-aligned':''}`,name,description:'Сочетает связанные блоки с общим ритмом и выравниванием',tags:['Композиция',columns===1?'Вертикально':'Колонки',...first.tags.slice(0,2)],kind:'composition',slide:first.slide,sourceIds:[...new Set(children.flatMap(c=>c.sourceIds))],memberIds:children.map(c=>c.id),children,data:{},dataStatus:first.dataStatus,graphicHtml:{},width:Math.max(...group.map(b=>b.x+b.w))-x,height:Math.max(...group.map(b=>b.y+b.h))-y,style:{font:first.style.font,padding:0,gap:gaps.length?Math.min(100,gaps.reduce((a,b)=>a+b,0)/gaps.length):24},config:{layout:columns===1?'stack':'grid',columns}})
  // Keep the source's column proportions. Equal CSS columns would shrink a
  // wider card vertically and break an originally aligned row of panels.
  result.at(-1)!.columnWidths=rows[0].map(b=>b.w)
  result.at(-1)!.style.background=first.style.background
  // A vertical pair and a row are useful observed sub-compositions of a grid.
  if(rows.length>1&&columns>1){
   const base=result.at(-1)!,vertical=rows.map(row=>row[0].t),horizontal=rows[0].map(b=>b.t)
   for(const [suffix,members,cols,title] of [['vertical',vertical,1,'Вертикальная группа'],['row',horizontal,columns,name]] as const)result.push({...base,id:base.id+'-'+suffix,name:title,sourceIds:[...new Set(members.flatMap(c=>c.sourceIds))],memberIds:members.map(c=>c.id),children:members,config:{layout:cols===1?'stack':'grid',columns:cols}})
  }
 }
 return result
}
