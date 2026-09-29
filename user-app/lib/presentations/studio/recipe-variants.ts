import {B,R,G,C,root,fixed,columns,type Bundle,type State,type Group,type ChildRef} from './authored/incoming/section-39-514.recipe'
import {isStep} from './compositions'
import type {Candidate,ContentSlide,SlotPresentation} from './contract'

export type Density=NonNullable<SlotPresentation['density']>
export type RecipeVariant={baseStateId:string;kind:'table-content'|'data-sidebar';density:Density;label:string}
export const tableVariants:Record<string,RecipeVariant>={}
const densityLabel={large:'крупные показатели',normal:'обычные показатели',compact:'компактные показатели'}

/** Explicit additional states, never an edit to the supplied frame. Each has a
 * complete outer contract; the table retains its wide 1828px track. */
export function withTableVariants(bundle:Bundle):Bundle{
  const base=bundle.states.find(s=>s.id==='data-evidence-table')
  if(!base)return bundle
  const states:State[]=[]
  for(const metrics of [0,1,2])for(const prose of [0,1])for(const conclusion of [0,1])for(const density of metrics?['normal','compact','large'] as const:['normal'] as const){
    const id=`${base.id}--table${prose?'-explanation':''}${metrics?`-${metrics}kpi`:''}${conclusion?'-conclusion':''}-${density}`
    const rail=metrics||prose,railHeight=density==='compact'?132:density==='large'?232:184
    const tableY=40+114+18+(rail?railHeight+18:0),tableHeight=626
    const regions=[R('title','title',undefined,B(46,40,1828,114)),R('table','table',undefined,B(46,tableY,1828,tableHeight),'evidence-table')]
    const groups:Group[]=[],children:ChildRef[]=[C('title')]
    if(rail){
      const gap=prose&&metrics?32:0,proseWidth=metrics?900:1828,metricWidth=prose?1828-proseWidth-gap:1828
      const railChildren=[]
      if(prose){regions.push(R('explanation','body',undefined,B(46,172,proseWidth,railHeight),'text'));railChildren.push(C('explanation'))}
      if(metrics){regions.push(R('metrics','metrics',undefined,B(46+(prose?proseWidth+gap:0),172,metricWidth,railHeight),'metric',metrics,metrics,{layouts:columns(metrics,metrics,24),preferredLayoutId:`columns-${metrics}`}));railChildren.push(C('metrics'))}
      groups.push(G('support-rail',B(46,172,1828,railHeight),'row',railChildren,{gap:fixed(gap),align:'stretch'}))
      children.push({kind:'group' as const,id:'support-rail'})
    }
    children.push(C('table',{flex:{grow:1,shrink:1}}))
    if(conclusion){regions.push(R('conclusion','conclusion',undefined,B(46,980,1828,72)));children.push(C('conclusion'))}
    groups.push(root(B(46,40,1828,1012),children,{gap:fixed(18)}))
    states.push({...base,id,modeId:id,regions,groups,adaptationNotes:[...base.adaptationNotes,'Stage 7: explicit table/content combination; supplied source frame is retained separately.']})
    tableVariants[id]={baseStateId:base.id,kind:'table-content',density,label:['Таблица',...prose?['пояснение']:[],...metrics?[`${metrics} ${metrics===1?'показатель':'показателя'}`]:[],...conclusion?['вывод']:[]].join(' + ')+(metrics?' · '+densityLabel[density]:'')}
  }
  // Side-specific directions need a distinct composition. The data area and
  // support rail keep independent contracts; mirroring is done by the host.
  const sideBase=bundle.states.find(s=>s.id==='media-case-result')!
  for(const metrics of [1,2,3])for(const prose of ['none','left','right','top'] as const)for(const conclusion of [0,1])for(const density of ['normal','compact','large'] as const){
    const id=`${sideBase.id}--data-${metrics}kpi-${prose}${conclusion?'-conclusion':''}-${density}`,leftWidth=1124,rightWidth=680,gap=24,top=prose==='top'?380:212,height=(conclusion?696:816)-(top-212)
    const regions=[R('title','title',undefined,B(46,40,1828,148)),R('data','data',undefined,B(46,top, leftWidth,height-(prose==='left'?208:0)),'visual',1,1,{allowedVisualTypes:['diagram']}),R('metrics','metrics',undefined,B(1194,top,rightWidth,height-(prose==='right'?256:0)),'metric',metrics,metrics,{layouts:[{...columns(metrics,1,24)[0],id:'stack',columns:1,minItems:metrics,maxItems:metrics}],preferredLayoutId:'stack'})]
    const left:ChildRef[]=[],right:ChildRef[]=[],groups:Group[]=[]
    if(prose==='top')regions.push(R('explanation','body',undefined,B(46,212,1828,144),'text'))
    else if(prose!=='none'){
      const box=B(prose==='left'?46:1194,top,prose==='left'?leftWidth:rightWidth,prose==='left'?184:232)
      regions.push(R('explanation','body',undefined,box,'text',1,1,{accepts:['text','module','action-list'].filter(type=>bundle.contracts[type])}))
      ;(prose==='left'?left:right).push(C('explanation'))
    }
    left.push(C('data',{flex:{grow:1,shrink:1}}));right.push(C('metrics',{flex:{grow:1,shrink:1}}))
    groups.push(G('data-column',B(46,top,leftWidth,height),'column',left,{gap:fixed(gap),align:'stretch'}),G('support-column',B(1194,top,rightWidth,height),'column',right,{gap:fixed(gap),align:'stretch'}))
    groups.push(G('body',B(46,top,1828,height),'row',[{kind:'group',id:'data-column'},{kind:'group',id:'support-column'}],{gap:fixed(gap),align:'stretch'}))
    const children:ChildRef[]=[C('title'),...prose==='top'?[C('explanation')]:[],{kind:'group',id:'body',flex:{grow:1,shrink:1}}]
    if(conclusion){regions.push(R('conclusion','conclusion',undefined,B(46,956,1828,96)));children.push(C('conclusion'))}
    groups.push(root(B(46,40,1828,1012),children,{gap:fixed(gap)}))
    states.push({...sideBase,id,modeId:id,regions,groups,adaptationNotes:['Stage 7: explicit data + support sidebar; mirror preserves all dimensions and gaps.']})
    tableVariants[id]={baseStateId:sideBase.id,kind:'data-sidebar',density,label:`Данные и боковая группа · ${metrics} ${metrics===1?'показатель':'показателя'}${prose==='top'?' + пояснение сверху':prose!=='none'?' + пояснение':''}${conclusion?' + вывод':''} · ${densityLabel[density]}`}
  }
  return {...bundle,states:[...bundle.states,...states],families:bundle.families.map(f=>({...f,modes:[...f.modes,...states.filter(s=>s.familyId===f.id).map(s=>({id:s.modeId,stateIds:[s.id]}))]}))}
}

const reflected=(r:{x:number;y:number;w:number;h:number})=>({...r,x:1920-r.x-r.w})
const edges=<T extends {edge:'left'|'right'|'top'|'bottom'}>(values?:T[])=>values?.map(e=>({...e,edge:e.edge==='left'?'right' as const:e.edge==='right'?'left' as const:e.edge}))
export function mirrorCandidate(candidate:Candidate):Candidate{
  const mirrored=!candidate.mirrored
  return {...candidate,mirrored,score:candidate.score+(mirrored?-60:60),id:mirrored?candidate.id+'/mirror':candidate.id.replace(/\/mirror$/,''),label:mirrored?candidate.label+' · зеркально':candidate.label.replace(/ · зеркально$/,''),
    ...(candidate.measuredFlow?{measuredFlow:candidate.measuredFlow.map(n=>{const parent=candidate.measuredFlow!.find(p=>p.id===n.parent);if(parent?.direction!=='row')return n;const siblings=candidate.measuredFlow!.filter(s=>s.parent===n.parent);return siblings[siblings.length-1-siblings.findIndex(s=>s.id===n.id)]})}:{}),
    slots:candidate.slots.map(s=>({...s,rect:reflected(s.rect),blocks:s.direction==='column'?[...s.blocks]:Array.from({length:Math.ceil(s.blocks.length/(s.direction==='row'?s.blocks.length:s.columns))},(_,i)=>{const cols=s.direction==='row'?s.blocks.length:s.columns;return s.blocks.slice(i*cols,(i+1)*cols).reverse()}).flat()})),
    ...(candidate.decorations?{decorations:candidate.decorations.map(d=>({...d,rect:reflected(d.rect)}))}:{}),
    ...(candidate.authored?{authored:{...candidate.authored,regions:Object.fromEntries(Object.entries(candidate.authored.regions).map(([id,r])=>[id,reflected(r)])),layers:candidate.authored.layers.map(l=>({...l,rect:reflected(l.rect),edges:edges(l.edges)}))}}:{})}
}

/** Position is checked even if the user specified only one side. Header and
 * footer bands do not participate in horizontal body relationships. */
export function respectsPlacement(candidate:Candidate,slide:ContentSlide){
  const boxes=new Map(candidate.slots.flatMap(s=>{
    const cols=s.direction==='row'?s.blocks.length:s.direction==='wrap'?Math.min(s.columns,s.blocks.length):1,rows=Math.ceil(s.blocks.length/cols),w=(s.rect.w-s.gap*(cols-1))/cols,h=(s.rect.h-s.gap*(rows-1))/rows
    return s.blocks.map((id,i)=>[id,{x:s.rect.x+(i%cols)*(w+s.gap),y:s.rect.y+Math.floor(i/cols)*(h+s.gap),w,h}] as const)
  }))
  const body=slide.blocks.filter(b=>b.role==='body')
  // Mirroring the canvas may swap columns, but cannot reverse a numbered
  // journey or a plain-text reading sequence.
  const ordered=candidate.mirrored&&body.every(b=>b.kind==='text')?body:body.filter(isStep)
  if(ordered.some((b,i)=>{
    if(!i)return false
    const a=boxes.get(ordered[i-1].id),c=boxes.get(b.id)
    return !!a&&!!c&&(c.y<a.y-4||Math.abs(c.y-a.y)<=4&&c.x<a.x-4)
  }))return false
  return slide.blocks.every(b=>{
    if(!b.placement)return true
    const box=boxes.get(b.id);if(!box)return false
    if(b.placement==='bottom')return body.filter(o=>o.id!==b.id&&o.placement!=='bottom').every(o=>{const other=boxes.get(o.id)!;return other.y+other.h<=box.y+1})
    if(b.placement==='top')return body.filter(o=>o.id!==b.id&&o.placement!=='top').every(o=>{const other=boxes.get(o.id)!;return box.y+box.h<=other.y+1})
    const peers=body.filter(o=>o.placement===(b.placement==='left'?'right':'left'))
    if(!peers.length)return b.placement==='left'?box.x+box.w/2<959:box.x+box.w/2>961
    return peers.every(o=>{const other=boxes.get(o.id)!;return b.placement==='left'?box.x+box.w<=other.x+1:other.x+other.w<=box.x+1})
  })
}

export function withMirrors(candidates:Candidate[],slide:ContentSlide){
  return candidates.flatMap(c=>{
    if(c.preserveReadingOrder)return respectsPlacement(c,slide)?[c]:[]
    const mirror=mirrorCandidate(c),changed=JSON.stringify(c.slots)!==JSON.stringify(mirror.slots)
    return [c,...changed?[mirror]:[]].filter(v=>respectsPlacement(v,slide))
  })
}
