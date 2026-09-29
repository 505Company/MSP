import type { EditableData,EditableTemplate } from './editable-contract'
import { nativeBoundText } from './editable-native-layout'
import type { ComponentFlow } from './component-adaptation'
import { scaleText } from '../../vendor/drag/src/core/text-flow'
export type FlowBox={x:number;y:number;width:number;height:number}
export type FlowMeasurement={width:number;height:number;fontStep:number;direction:'row'|'stack';fields:{sourceId:string;text:string;fontSize:number;box:FlowBox;ink:FlowBox}[]}
export function flowElements(t:EditableTemplate,data:EditableData,p:ComponentFlow,step:number) {
  return t.sourceLayout!.text.map((slot,i)=>{
    const e=scaleText(nativeBoundText(slot,data),p.fontScale*(1-step/16)),floor=i===p.metric?48:24
    if(e.fontSize<floor){const n=scaleText(e,floor/e.fontSize);Object.assign(e,n)}
    if(!e.paragraphs?.length)delete e.paragraphs
    e.flow={columns:1,gap:0,autoFit:'NONE'}
    return e
  })
}
export function flowGeometry(p:ComponentFlow,width:number,heights:number[],direction?:'row'|'stack') {
  const row=direction!=='stack'&&p.direction==='row'&&width>=p.breakpoint,inner=width-p.padding*2,gap=p.gap
  const height=Math.max(p.minHeight,p.padding*2+(row?Math.max(...heights):heights.reduce((a,b)=>a+b,0)+gap))
  const boxes:FlowBox[]=heights.map(h=>({x:p.padding,y:p.padding,width:inner,height:h}))
  if(row){const mw=(inner-gap)*p.fraction;boxes[p.metric].width=mw;boxes[p.caption].width=inner-gap-mw;boxes[p.caption].x+=mw+gap;for(const b of boxes)b.y+=(height-p.padding*2-b.height)/2}
  else{boxes[p.caption].y+=heights[p.metric]+gap}
  return {height,boxes,direction:row?'row' as const:'stack' as const}
}
export function flowIssues(m:FlowMeasurement,t:EditableTemplate,data:EditableData,p:ComponentFlow) {
  const issues:string[]=[],es=flowElements(t,data,p,m.fontStep)
  if(m.width<p.minWidth-1||m.width>p.maxWidth+1||m.height>p.maxHeight+1||!Number.isInteger(m.fontStep)||m.fontStep<0||m.fontStep>4)issues.push('flow-size-contract')
  if(m.fields.length!==2||es.some(e=>m.fields.filter(f=>f.sourceId===e.id).length!==1))return [...issues,'flow-fields']
  const fields=es.map(e=>m.fields.find(f=>f.sourceId===e.id)!),geometry=flowGeometry(p,m.width,fields.map(f=>f.box.height),m.direction)
  if(geometry.direction!==m.direction)issues.push('flow-direction')
  if(Math.abs(geometry.height-m.height)>1)issues.push('flow-height')
  const contains=(a:FlowBox,b:FlowBox)=>b.width>0&&b.height>0&&b.x>=a.x-1&&b.y>=a.y-1&&b.x+b.width<=a.x+a.width+1&&b.y+b.height<=a.y+a.height+1
  fields.forEach((f,i)=>{
    if(f.text!==es[i].text||!f.text.trim()||Math.abs(f.fontSize-Math.min(es[i].fontSize,...es[i].styleRuns?.map(r=>r.fontSize)??[]))>.01||f.fontSize<(i===p.metric?48:24)-.01)issues.push(`flow-text:${f.sourceId}`)
    if(['x','y','width','height'].some(k=>Math.abs(f.box[k as 'x']-geometry.boxes[i][k as 'x'])>1)||!contains(f.box,f.ink))issues.push(`flow-overflow:${f.sourceId}`)
  })
  return [...new Set(issues)]
}
