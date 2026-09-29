import type {BoundsIR} from '../../vendor/drag/src/core/model'
import type {EditableProposal,EditableTemplate} from './editable-contract'
import type {SceneRecord,SourceScene} from './source-scene'

export const containsBounds=(a:BoundsIR,b:BoundsIR,tolerance=2)=>b.x>=a.x-tolerance&&b.y>=a.y-tolerance&&b.x+b.width<=a.x+a.width+tolerance&&b.y+b.height<=a.y+a.height+tolerance
export const area=(b:BoundsIR)=>b.width*b.height
export function sourceMembers(ids:string[],scene:SourceScene){
 const selected=new Set(ids)
 return [...scene.records.values()].filter(r=>r.disposition==='visible'&&(selected.has(r.element.id)||r.ancestors.some(id=>selected.has(id))))
}
export function leavesOnSlide(scene:SourceScene,slide:number){return [...scene.records.values()].filter(r=>r.source.slide===slide&&r.disposition==='visible'&&!('children' in r.element))}
export function isPanel(r:SceneRecord){return ['rectangle','path','ellipse'].includes(r.element.kind)&&'fill'in r.element&&!!r.element.fill?.color.a&&r.bounds.width>40&&r.bounds.height>25}

/** A semantic selection may omit an arrow inside its circle or a label inside
 * a panel. Complete only containment in an explicitly selected visual object;
 * never pull arbitrary neighbouring text, slide backgrounds or hidden nodes. */
export function completeSourceIds(ids:string[],scene:SourceScene):string[]{
 const members=sourceMembers(ids,scene),first=members[0];if(!first)return ids
 const leaves=leavesOnSlide(scene,first.source.slide),slide=scene.slides.find(s=>s.number===first.source.slide)
 const pageArea=slide?slide.width*slide.height:Infinity
 const anchors=members.filter(r=>!('children'in r.element)&&r.element.kind!=='text'&&area(r.bounds)<pageArea*.75)
 const added=leaves.filter(r=>!members.includes(r)&&anchors.some(a=>area(r.bounds)<area(a.bounds)*.98&&containsBounds(a.bounds,r.bounds)))
 return [...new Set([...ids,...added.map(r=>r.element.id)])]
}

/** Interpret model membership using source geometry, leaving the original
 * reply intact. A coloured card and its external annotation are reusable
 * separately; repeated panels explicitly referenced in data.items are not lost. */
export function prepareEditableBlocks(blocks:EditableProposal[],slide:number,scene:SourceScene):EditableProposal[]{
 const result:EditableProposal[]=[],all=leavesOnSlide(scene,slide),existing=new Set(blocks.map(b=>b.id))
 const unique=(id:string)=>{let next=id;while(existing.has(next))next+='-part';existing.add(next);return next}
 for(const original of blocks){
  if(original.kind==='composition'){result.push(original);continue}
  // Semantic fields belong to the model's exact block. Geometry recovery may
  // complete its source objects, but cannot clone that plan onto split children.
  if(original.adaptation){result.push({...original,sourceIds:completeSourceIds(original.sourceIds,scene)});continue}
  const metricItems=original.kind==='metric'?original.data.items?.filter(i=>i.graphicId&&i.value):undefined
  if(metricItems&&metricItems.length>1&&new Set(metricItems.map(i=>i.graphicId)).size===metricItems.length){
   const panels=metricItems.map(i=>scene.records.get(i.graphicId!))
   if(panels.every((p):p is SceneRecord=>!!p&&p.source.slide===slide)&&panels.every((p,i)=>panels.every((q,j)=>i===j||!containsBounds(p.bounds,q.bounds)&&!containsBounds(q.bounds,p.bounds)))){
    const selected=sourceMembers(original.sourceIds,scene).filter(r=>!('children'in r.element)),selectedIds=new Set(selected.map(r=>r.element.id))
    const owners=new Map(all.map(r=>[r.element.id,panels.flatMap((panel,i)=>{
     if(containsBounds(panel.bounds,r.bounds))return [i]
     // A source text frame can extend beyond its painted panel. Only an
     // explicitly selected field may use this bounded overlap allowance;
     // never collect arbitrary neighbouring text or guess ambiguous ownership.
     const p=panel.bounds,b=r.bounds,overlap=Math.max(0,Math.min(p.x+p.width,b.x+b.width)-Math.max(p.x,b.x))*Math.max(0,Math.min(p.y+p.height,b.y+b.height)-Math.max(p.y,b.y))
     return selectedIds.has(r.element.id)&&r.element.kind==='text'&&overlap>area(b)*.5&&containsBounds(p,{x:b.x+b.width/2,y:b.y+b.height/2,width:0,height:0},0)?[i]:[]
    })]))
    if(selected.every(r=>owners.get(r.element.id)?.length===1)){
    const children=metricItems.map((item,i)=>{
     const panel=panels[i]!,members=all.filter(r=>owners.get(r.element.id)?.length===1&&owners.get(r.element.id)![0]===i),captions=members.filter(r=>r.element.kind==='text')
     return {...original,id:i?unique(`${original.id}-item-${i+1}`):original.id,sourceIds:[panel.element.id,...members.map(r=>r.element.id)],data:{value:item.value!,items:captions.map(r=>({text:r.element.kind==='text'?r.element.text:''}))}}
    })
    result.push(...children);continue
    }
   }
  }
  const b={...original,sourceIds:completeSourceIds(original.sourceIds,scene)},members=sourceMembers(b.sourceIds,scene).filter(r=>!('children'in r.element))
  // A model can call an entire row a diagram. Separate only independently
  // enclosed native cards: every source leaf must have exactly one owner.
  // Cross-panel connectors, shared labels and overlapping panels prevent this.
  if(['diagram','feature'].includes(b.kind)) {
   const containers=members.filter(isPanel).filter(p=>members.filter(r=>r.element.kind==='text'&&containsBounds(p.bounds,r.bounds,6)).length>=2)
   const panels=containers.filter(p=>!containers.some(q=>q!==p&&containsBounds(q.bounds,p.bounds,0))).sort((a,b)=>a.bounds.y-b.bounds.y||a.bounds.x-b.bounds.x)
   const owners=members.map(r=>panels.filter(p=>containsBounds(p.bounds,r.bounds,6)))
   if(panels.length>=2&&panels.length<=12&&owners.every(o=>o.length===1)&&panels.every((a,i)=>panels.every((b,j)=>i===j||Math.min(a.bounds.x+a.bounds.width,b.bounds.x+b.bounds.width)-Math.max(a.bounds.x,b.bounds.x)<=0||Math.min(a.bounds.y+a.bounds.height,b.bounds.y+b.bounds.height)-Math.max(a.bounds.y,b.bounds.y)<=0))) {
    const children=panels.map((panel,i)=>{
     const owned=members.filter((_,j)=>owners[j][0]===panel),texts=owned.flatMap(r=>r.element.kind==='text'?[r.element]:[])
     const label=texts.filter(e=>/[\p{L}]/u.test(e.text)&&e.text.length<=100).sort((a,b)=>b.fontSize-a.fontSize)[0]?.text.replace(/\s+/g,' ').trim()
     return {...b,id:unique(`${b.id}-panel-${i+1}`),kind:'feature' as const,name:label?`Карточка: ${label}`:'Карточка с текстом',description:'Самостоятельная карточка из исходной группы',memberIds:[],config:{},sourceIds:owned.map(r=>r.element.id),data:{items:texts.map(e=>({text:e.text}))}}
    })
    const rows:{y:number;count:number}[]=[],tolerance=Math.min(...panels.map(p=>p.bounds.height))*.25
    for(const panel of panels){const row=rows.find(r=>Math.abs(r.y-panel.bounds.y)<=tolerance);if(row)row.count++;else rows.push({y:panel.bounds.y,count:1})}
    const columns=Math.max(...rows.map(r=>r.count))
    result.push(...children,{...b,kind:'composition',memberIds:children.map(c=>c.id),data:{},config:{layout:columns===1?'stack':'grid',columns}})
    continue
   }
  }
  // A card has a panel containing multiple text fields. A footnote outside the
  // panel must not inflate its dimensions, duplicate its body or set its colour.
  const panels=members.filter(isPanel),card=panels.filter(p=>members.filter(r=>r.element.kind==='text'&&containsBounds(p.bounds,r.bounds,6)).length>=2).sort((a,c)=>area(c.bounds)-area(a.bounds))[0]
  if(b.kind==='feature'&&card){
   const inside=members.filter(r=>containsBounds(card.bounds,r.bounds,6)),outside=members.filter(r=>!inside.includes(r))
   if(outside.some(r=>r.element.kind==='text')&&outside.some(r=>r.element.kind!=='text')&&outside.every(r=>r.bounds.y>=card.bounds.y+card.bounds.height-3)){
    result.push({...b,sourceIds:inside.map(r=>r.element.id)})
    result.push({...b,id:unique(`${b.id}-annotation`),name:'Акцент в тексте',description:'Выделяет показатель внутри пояснения',tags:['Акцент','Показатель','Подпись'],sourceIds:outside.map(r=>r.element.id),data:{items:outside.filter(r=>r.element.kind==='text').map(r=>({text:r.element.kind==='text'?r.element.text:''}))}})
    continue
   }
  }
  result.push(b)
  // Keep a decorated bar reusable independently from its comparison/chart.
  if(['feature','chart'].includes(b.kind)&&panels.length>1){
   for(const panel of panels){
    const inside=members.filter(r=>containsBounds(panel.bounds,r.bounds,3))
    if(panel.bounds.width<panel.bounds.height*2||!inside.some(r=>r.element.kind==='text'))continue
    result.push({...b,id:unique(`${b.id}-part-${result.length}`),kind:'feature',name:'Плашка с показателем',description:'Значение с маркером на фирменной плашке',tags:['Плашка','Показатель'],config:{},sourceIds:inside.map(r=>r.element.id),data:{items:inside.filter(r=>r.element.kind==='text').map(r=>({text:r.element.kind==='text'?r.element.text:''}))}})
   }
  }
 }
 return result
}

/** Family identity follows structure, not the broad model kind, source copy,
 * paint colour or number of repeated instances. Colours remain internal styles. */
export function editableStructure(t:EditableTemplate):{key:string;name:string}{
 if(t.kind==='composition'){
  const children=[...new Set(t.children?.map(c=>editableStructure(c).key)??[])].sort().join('+')
  return {key:`composition:${t.config.layout??'grid'}:${children}`,name:t.name}
 }
 const layout=t.sourceLayout
 // A model's broad "diagram" label can cover a code card, a photo collage
 // and a graph. Compare measured layout, not the label or the source words.
 if(layout&&t.kind==='diagram'){
  const q=(n:number)=>Math.round(n*20),size=Math.max(1,...layout.text.map(s=>s.element.fontSize))
  const text=layout.text.map(({element:e})=>[q(e.bounds.x/t.width),q(e.bounds.y/t.height),q(e.bounds.width/t.width),q(e.bounds.height/t.height),q(e.fontSize/size),/mono|courier|consolas/i.test(e.fontFamily)?'code':'text']).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const shapes=[...layout.graphic.matchAll(/<(rect|ellipse|path|image)\b/g)].map(m=>m[1]).sort()
  return {key:`diagram:${JSON.stringify([layout.structure,text,shapes])}`,name:t.name}
 }
 if(layout&&['feature','metric','text'].includes(t.kind)){
  const texts=layout.text.map(s=>s.element),short=t.width/t.height>2.7
  const numbered=texts.some(e=>/^\d{1,3}$/.test(e.text.trim())&&e.fontSize>=Math.max(...texts.map(t=>t.fontSize))*.85)
  const panelCount=layout.structure?.panels??0
  const role=t.kind==='metric'?'metric':layout.structure?.inline?'inline':layout.structure?.illustrated?'illustrated':short&&texts.length<=2?'label':numbered&&texts.length>=2?'numbered-card':panelCount>=2?'comparison':texts.length>=2?'card':'feature'
  const name={illustrated:'Карточка с иллюстрацией',label:'Плашка с подписью','numbered-card':'Карточка с номером',comparison:'Тезис с показателями',metric:'Показатель с подписью',inline:'Акцент в тексте',card:'Карточка с текстом',feature:'Тезис с графикой'}[role]
  const code=texts.some(e=>/mono|courier|consolas/i.test(e.fontFamily))
  return {key:`${t.kind}:${role}:${panelCount>1?'multiple':panelCount}:${texts.length>3?'many':texts.length}:${layout.structure?.orientation??''}${code?':code':''}`,name:code?'Карточка с кодом':name}
 }
 return {key:t.kind==='chart'?`chart:${t.config.chartType}:${!!t.config.horizontal}`:t.kind,name:t.name}
}
