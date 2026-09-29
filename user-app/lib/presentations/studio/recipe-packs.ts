import * as editorialPack from './authored/incoming/section-39-514.recipe'
import * as densePack from './authored/incoming/section-39-798.recipe'
import type {BlockContract,Bundle,FieldBinding,Flow,Insets,InternalNode,ItemLayout,NormalizedBlock,NormalizedValue,QwenContext,Range,Rect,Region,State,StructuralAssignment} from './authored/incoming/section-39-514.recipe'
import type {Candidate,ContentBlock,ContentSlide,Slot} from './contract'
import type {PrimitiveNode} from './recipes'
import {bindTextContract,type SourceField} from './field-bindings'
import {contentPressure,candidatePressure,searchAssignments,assignmentKey} from './assignment-search'
import {withTableVariants,tableVariants,mirrorCandidate,type RecipeVariant} from './recipe-variants'

/** Source files are immutable. Host variants have distinct IDs and provenance. */
export const incomingPacks=[editorialPack,densePack]
export const executablePacks=incomingPacks.map(pack=>{
  const bundle=withTableVariants(pack.bundle)
  const states=[...pack.canonicalStates,...bundle.states.filter(s=>!pack.states.some(source=>source.id===s.id))]
  return {pack,bundle,states}
})
export const incomingRecipeIds=new Set(executablePacks.flatMap(({bundle})=>bundle.states.map(s=>`${bundle.sourceSection}/${s.id}`)))
export type RecipeScope='all'|'new'
export type RecipeLayer={id:string;rect:Rect;surface?:string;edges?:{edge:'top'|'bottom'|'left'|'right';width:number}[]}
export const INCOMING_BINDING_POLICY='nested-fields-multiple-assignments-2'
export type PackExecution={bundleId:string;revision:string;stateId:string;sourceFrame:string;surface:string;primitives:Record<string,PrimitiveNode>;fieldBindings?:Record<string,Record<string,SourceField>>;layers:RecipeLayer[];regions:Record<string,Rect>;layouts?:Record<string,string>;variant?:RecipeVariant;tablePolicy?:'adaptive-table-1';bindingPolicy?:typeof INCOMING_BINDING_POLICY;adaptations?:string[]}
type Binding={block:NormalizedBlock;paths:Record<string,SourceField>;primitive?:PrimitiveNode;layoutId?:string;adaptation?:string}

const types:Record<ContentBlock['kind'],string[]>={
  text:['text','label','heading-body','passport','next-step'],
  metric:['metric','callout-fact','hero-fact','module','explanation'],
  step:['step','step-card','numbered-item','editorial-column','module','explanation','article-section','action-list'],
  feature:['module','explanation','editorial-column','principle','commentary','article-section','action-list','faq','next-step'],
  list:['module','explanation','editorial-column','article-section','action-list','thesis-list'],
  quote:['quote','quote-panel','quote-strip','quote-banner','cover-quote'],visual:['visual','evidence-table','comparison-table'],
}
const intersects=(a:Rect,b:Rect)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1
function allowedRole(block:ContentBlock,region:Region){
  if(block.role==='title')return region.role==='title'||region.accepts.includes('heading-body')||region.accepts.includes('passport')
  if(region.role==='title')return false
  if(block.role==='footer')return /footer|source|note|conclusion|comment/.test(region.role)
  // Model content is not publication metadata. Only an explicitly short text
  // can occupy an optional label; no date/status/page is fabricated.
  return !/^(page|year|date|year-large|status|version|format)$/.test(region.role)
}
function bindType(b:ContentBlock,region:Region,contract:BlockContract,index:number):Binding|null{
  let fields:Record<string,NormalizedValue>={},paths:Record<string,SourceField>={}
  if(b.data){
    if(contract.type==='visual'){
      // A native data table can occupy the same visual-data frame as a chart.
      // No picture is fabricated and the native table/data remain editable.
      if(!['chart','table'].includes(b.data.template.kind)||region.allowedVisualTypes&&!region.allowedVisualTypes.includes('diagram'))return null
      fields.assetRef={sourceRefs:[`${b.id}.data`]};fields.visualType='diagram'
    }else{
      if(b.data.template.kind!=='table'||!b.data.values.columns?.length||!b.data.values.rows?.length)return null
      b.data.values.columns.forEach((_,i)=>{fields[`h${i+1}`]={sourceRefs:[`${b.id}.h${i+1}`]}})
      fields.rows=b.data.values.rows.map((row,i)=>({sourceRefs:row.map((_,j)=>`${b.id}.r${i}c${j}`),fields:Object.fromEntries(row.map((_,j)=>[`c${j+1}`,{sourceRefs:[`${b.id}.r${i}c${j}`]}]))}))
    }
  }else{
    const bound=bindTextContract(b,contract);if(!bound)return null
    fields=bound.fields;paths=bound.paths
  }
  const refs=Object.values(fields).flatMap(v=>typeof v==='string'?[]:Array.isArray(v)?v.flatMap(i=>i.sourceRefs):(v as FieldBinding).sourceRefs)
  return {block:{id:b.id,type:contract.type,allowedRoles:[region.role],sequenceIndex:index,sourceRefs:refs,fields},paths}
}

/** Explicit user-approved extension: only table internals depend on content.
 * The supplied files, region/group geometry, position and all other contracts
 * remain unchanged. The active DS table renderer measures the shared tracks. */
export function adaptIncomingTables(bundle:Bundle,slide:ContentSlide):Bundle{
  const table=slide.blocks.find(b=>b.data?.template.kind==='table')?.data?.values
  if(!table?.columns?.length||!table.rows?.length)return bundle
  const columns=table.columns.length,rows=table.rows.length,result=structuredClone(bundle)
  for(const type of ['evidence-table','comparison-table']){
    const contract=result.contracts[type];if(!contract)continue
    contract.fields={...Object.fromEntries(Array.from({length:columns},(_,i)=>[`h${i+1}`,{kind:'single' as const,required:true}])),rows:{kind:'list',required:true,minItems:1,maxItems:rows,itemFields:Object.fromEntries(Array.from({length:columns},(_,i)=>[`c${i+1}`,{required:true}]))}}
    const adapt=(n:InternalNode)=>{
      if(n.kind==='repeat'&&n.fieldPath==='rows'){n.minItems=1;n.maxItems=rows}
      if(n.kind==='group'&&['header-row','data-row'].includes(n.id)&&n.children?.length){
        const source=n.children,prefix=n.id==='header-row'?'h':'c'
        n.children=Array.from({length:columns},(_,i)=>{
          const copy=structuredClone(source[Math.min(i,source.length-1)])
          const rename=(c:InternalNode)=>{c.id=`${c.id}-track-${i}`;if(c.fieldPath?.match(/^[hc]\d+$/))c.fieldPath=`${prefix}${i+1}`;c.children?.forEach(rename)}
          rename(copy);if(copy.flex)copy.flex={...copy.flex,grow:1};return copy
        })
      }
      n.children?.forEach(adapt);if(n.item)adapt(n.item);if(n.tail)adapt(n.tail)
    }
    contract.primitiveLayouts.forEach(l=>adapt(l.root))
  }
  return result
}
function bindPrimitive(node:InternalNode,binding:Binding,region:Region,path=''):PrimitiveNode|null{
  if(node.kind==='ornament')throw Error(`Active DS ornament required: ${node.ornamentRole}`)
  if(node.kind==='field'){
    const field=binding.paths[path+(node.fieldPath??'')];if(!field)return null
    return {...field,role:binding.block.type==='text'?region.typographyRole??region.role:node.typographyRole,
      textAlign:node.textAlign,preferredWidth:node.preferredWidth,flex:node.flex,pushToEnd:node.pushToEnd}
  }
  let children:PrimitiveNode[]=[],tail:PrimitiveNode|null=null
  if(node.kind==='repeat'){
    const items=binding.block.fields[node.fieldPath??''];if(!Array.isArray(items))return null
    children=items.flatMap((_,i)=>{const child=bindPrimitive(node.item!,binding,region,`${node.fieldPath}.${i}.`);return child?[child]:[]})
    if(node.tail)tail=bindPrimitive(node.tail,binding,region)
  }else children=(node.children??[]).flatMap(n=>{const child=bindPrimitive(n,binding,region,path);return child?[child]:[]})
  if(!children.length)return null
  const result:PrimitiveNode={direction:node.direction??'column',gap:node.gap?.preferred??0,insets:node.padding,justify:node.justify,align:node.align,
    heightMode:node.heightMode,flex:node.flex,pushToEnd:node.pushToEnd,preferredWidth:node.preferredWidth,columns:node.columns,
    surface:node.surfaceRole,edges:node.decorations?.map(d=>({edge:d.edge,width:d.preferredThicknessPx})),children}
  if(node.kind==='repeat'){
    const columns=Math.min(node.columns??1,children.length)
    // Same lane distribution as the supplied compilePrimitivePlan: the
    // conclusion follows the last item in the final lane. CSS row-major grid
    // would reorder the source items and misplace the tail.
    if(columns>1)return {...result,direction:'row',align:'start',columns:undefined,children:Array.from({length:columns},(_,column)=>{
      const q=Math.floor(children.length/columns),remainder=children.length%columns,from=q*column+Math.min(column,remainder),to=from+q+(column<remainder?1:0)
      const items=node.readingOrder==='column-major'?children.slice(from,to):children.filter((_,i)=>i%columns===column)
      if(column===columns-1&&tail)items.push(tail)
      return {direction:'column',gap:result.gap,heightMode:'hug',flex:{grow:1,shrink:1,basis:0},children:items}
    })}
    result.columns=undefined
    if(tail)result.children=[...children,tail]
  }
  return result
}
function bindingsFor(b:ContentBlock,r:Region,bundle:Bundle,index:number):Binding[]{
  if(!allowedRole(b,r))return []
  // Prefer literal type matches. A different name is admissible only if the
  // unchanged contract consumes every source field exactly once and all its
  // required fields can be supplied. Geometry/cardinality are still validated.
  const eligible=r.accepts.filter(type=>types[b.kind].includes(type)||!b.data&&!['visual','evidence-table','comparison-table'].includes(type))
    .sort((a,c)=>Number(types[b.kind].includes(c))-Number(types[b.kind].includes(a)))
  return eligible.flatMap(type=>{
    const binding=bindType(b,r,bundle.contracts[type],index);if(!binding)return []
    if(!types[b.kind].includes(type))binding.adaptation=`${b.id}: ${b.kind} → ${type}; исходные поля сохранены`
    if(b.data?.template.kind==='table'&&type==='visual')binding.adaptation=`${b.id}: нативная таблица в области данных`
    if(b.data)return [binding]
    const layouts=editorialPack.eligiblePrimitiveLayouts(bundle,binding.block,r)
    return layouts.flatMap(layout=>{try{const primitive=bindPrimitive(layout.root,binding,r);return primitive?[{...binding,primitive,layoutId:layout.id}]:[]}catch{return []}})
  })
}

function pad(rect:Rect,p:Insets):Rect{return {x:rect.x+p.left,y:rect.y+p.top,w:rect.w-p.left-p.right,h:rect.h-p.top-p.bottom}}
const snap=(n:number)=>Math.floor(n/4)*4
/** Execute the supplied parent/child flow, not a union of authored rectangles.
 * Bounds and elastic gaps are taken directly from the immutable contract. */
export function resolvePackFlow(state:State,needs:Record<string,{width?:number;height?:number}>={}){
  const regions:Record<string,Rect>={},layers:RecipeLayer[]=[],tree=editorialPack.compileFlowTree(state)
  const limits=new Map<string,{width:Range;height:Range}>()
  const constrain=(node:Flow):{width:Range;height:Range}=>{
    const spec=node.group??node.region!,size=structuredClone(spec.size)
    const requested={width:needs[node.id]?.width??0,height:needs[node.id]?.height??0}
    if(node.group){
      const g=node.group,horizontal=g.direction==='row',axis=horizontal?'width':'height',cross=horizontal?'height':'width'
      let main=0,other=0
      for(const child of node.children??[]){
        if(child.kind==='gap'){main+=child.range!.min;continue}
        if(child.kind==='ornament'){main+=child.ornament![axis];other=Math.max(other,child.ornament![cross]);continue}
        const lim=constrain(child);main+=lim[axis].min;other=Math.max(other,lim[cross].min+(child.childPolicy?.marginBeforeCrossPx??0))
      }
      requested[axis]=Math.max(requested[axis],main+(horizontal?g.padding.left+g.padding.right:g.padding.top+g.padding.bottom))
      requested[cross]=Math.max(requested[cross],other+(horizontal?g.padding.top+g.padding.bottom:g.padding.left+g.padding.right))
    }
    for(const key of ['width','height'] as const){
      const minimum=Math.max(size[key].min,requested[key]>size[key].min?Math.ceil(requested[key]/4)*4:requested[key])
      if(minimum>size[key].max+.1)throw Error(`Измеренное содержание превышает предел ${node.id}.${key}`)
      size[key].min=minimum;size[key].preferred=Math.max(size[key].preferred,minimum)
    }
    limits.set(node.id,size);return size
  }
  constrain(tree)
  const visit=(node:Flow,box:Rect)=>{
    if(box.w<=0||box.h<=0)throw Error('Пустая область рецепта')
    if(node.region){regions[node.id]=box;return}
    if(!node.group)return
    const group=node.group,inner=pad(box,group.padding),horizontal=group.direction==='row',axis=horizontal?'w':'h',cross=horizontal?'h':'w'
    layers.push({id:node.id,rect:box,surface:group.surfaceRole,edges:group.decorations.map(d=>({edge:d.edge,width:d.preferredThicknessPx}))})
    const entries=(node.children??[]).map(child=>{
      if(child.kind==='gap')return {child,bounds:child.range!,requested:child.range!.preferred,shrinkPriority:0,growPriority:99}
      if(child.kind==='ornament'){const value=child.ornament![horizontal?'width':'height'];return {child,bounds:editorialPack.fixed(value),requested:value,shrinkPriority:99,growPriority:99}}
      const bounds=limits.get(child.id)![horizontal?'width':'height']
      return {child,bounds,requested:bounds.preferred,shrinkPriority:child.childPolicy?.flex?.shrinkPriority??1,growPriority:child.childPolicy?.flex?.growPriority??1}
    })
    const allocation=editorialPack.allocateAxis(inner[axis],entries.map(e=>({...e,id:e.child.id})))
    let slack=allocation.slack
    for(const e of [...entries].sort((a,b)=>a.growPriority-b.growPriority)){
      if(!e.child.childPolicy?.flex?.grow)continue
      const current=allocation.sizes[e.child.id],value=Math.min(snap(current+slack),Math.floor(e.bounds.max/4)*4)
      if(value>current){allocation.sizes[e.child.id]=value;slack-=value-current}
    }
    let cursor=inner[horizontal?'x':'y']+(group.justify==='center'?slack/2:group.justify==='end'?slack:0)
    const live=entries.filter(e=>e.child.kind==='group'||e.child.kind==='region'),push=live.find(e=>e.child.childPolicy?.pushToEnd)
    for(const e of entries){
      const child=e.child,size=allocation.sizes[child.id]
      if(child.kind==='gap'){cursor+=size;continue}
      if(child===push?.child){cursor+=slack;slack=0}
      if(child.kind==='ornament'){
        layers.push({id:child.id,rect:{x:horizontal?cursor:inner.x,y:horizontal?inner.y+(inner.h-child.ornament!.height)/2:cursor,w:child.ornament!.width,h:child.ornament!.height},surface:'rule'});cursor+=size;continue
      }
      const lim=limits.get(child.id)![horizontal?'height':'width'],margin=child.childPolicy?.marginBeforeCrossPx??0,available=inner[cross]-margin
      const align=child.childPolicy?.alignSelf??group.align
      const requested=align==='stretch'?available:Math.min(lim.preferred,available)
      if(available<lim.min-.1)throw Error(`Недостаточно места в ${child.id}`)
      const value=requested===lim.preferred?requested:editorialPack.fitDimension(Math.min(lim.max,requested),lim)
      const crossStart=inner[horizontal?'y':'x']+margin+(align==='end'?available-value:align==='center'?(available-value)/2:0)
      visit(child,{x:horizontal?cursor:crossStart,y:horizontal?crossStart:cursor,w:horizontal?size:value,h:horizontal?value:size})
      cursor+=size
      if(group.justify==='space-between'&&live.length>1)cursor+=slack/(live.length-1)
    }
  }
  visit(tree,{...tree.group!.preferredRect})
  return {regions,layers}
}

/** Browser measurements may consume the recipe's own adaptation reserve. The
 * fixed topology, content, components and original region bounds are retained. */
export function fitIncomingCandidate(original:Candidate,measured:Record<string,{width?:number;height?:number}>):Candidate|null{
  if(!original.authored)return null
  if(original.mirrored){const fitted=fitIncomingCandidate(mirrorCandidate(original),measured);return fitted?mirrorCandidate(fitted):null}
  const execution=executablePacks.find(p=>p.bundle.id===original.authored!.bundleId),pack=execution?.pack,state=execution?.bundle.states.find(s=>s.id===original.authored!.stateId)
  if(!pack||!state)return null
  const present=pack.resolvePresentState(state,Object.keys(original.authored.regions))
  const layouts=present.regions.map(region=>{const slots=original.slots.filter(s=>s.region===region.id),ids=slots.flatMap(s=>s.blocks);return {region,ids,slots,options:region.layouts.filter(l=>ids.length>=l.minItems&&ids.length<=l.maxItems).sort((a,b)=>Number(b.id===region.preferredLayoutId)-Number(a.id===region.preferredLayoutId))}})
  const variants=[layouts.map(r=>r.options[0]),...layouts.flatMap((r,i)=>r.options.slice(1).map(l=>layouts.map((x,j)=>i===j?l:x.options[0])))]
  const selected=original.authored.layouts?layouts.map(r=>r.options.find(l=>l.id===original.authored!.layouts![r.region.id])!):variants[Number(original.id.match(/topology-(\d+)$/)?.[1]??0)]
  if(!selected||selected.some(l=>!l))return null
  const needs:Record<string,{width?:number;height?:number}>={}
  layouts.forEach((r,i)=>{
    const h=Math.max(0,...r.slots.map(s=>(measured[s.blocks[0]]?.height??0)-s.rect.h)),w=Math.max(0,...r.slots.map(s=>(measured[s.blocks[0]]?.width??0)-s.rect.w))
    if(!h&&!w)return
    const box=original.authored!.regions[r.region.id],cols=Math.min(selected[i].columns,r.ids.length),rows=Math.ceil(r.ids.length/cols)
    needs[r.region.id]={...(h?{height:box.h+h*rows}:{}),...(w?{width:box.w+w*cols}:{})}
  })
  if(!Object.keys(needs).length)return null
  try{
    const flow=resolvePackFlow(present,needs),items=layouts.map((r,i)=>regionSlots(r.region,flow.regions[r.region.id],r.ids,selected[i])),slots=items.flatMap(i=>i.slots)
    for(const slot of slots)slot.presentation=original.slots.find(s=>s.blocks[0]===slot.blocks[0])?.presentation
    if(slots.some((s,i)=>slots.slice(i+1).some(t=>intersects(s.rect,t.rect))))return null
    return {...original,slots,authored:{...original.authored,regions:flow.regions,layers:[...flow.layers,...items.flatMap(i=>i.layers)]}}
  }catch{return null}
}

function regionSlots(region:Region,box:Rect,ids:string[],layout:ItemLayout){
  // compileRegionSlots supplies the authored row/column order, item insets,
  // rules and unequal track weights. No per-fixture grid is introduced here.
  const [compiled]=densePack.compileRegionSlots({regions:[{regionId:region.id,layout,blocks:ids.map(blockId=>({blockId}))}]})
  const inner=pad(box,compiled.padding),rows=compiled.rows,cols=compiled.columns,gx=layout.gapX.preferred,gy=layout.gapY.preferred
  const sum=Array.from({length:cols},(_,i)=>layout.preferredWeights?.[i]??1).reduce((a,b)=>a+b,0)
  const widths=Array.from({length:cols},(_,i)=>(inner.w-gx*(cols-1))*(layout.preferredWeights?.[i]??1)/sum)
  const rowHeight=(inner.h-gy*(rows-1))/rows
  const h=layout.cellHeight?.mode==='reference'?Math.min(rowHeight,layout.cellHeight.preferred??rowHeight):rowHeight
  const offset=layout.align==='end'?inner.h-(h*rows+gy*(rows-1)):layout.align==='center'?(inner.h-(h*rows+gy*(rows-1)))/2:0
  const layers:RecipeLayer[]=[{id:region.id,rect:box,edges:compiled.decorations.map(d=>({edge:d.edge,width:d.preferredThicknessPx}))}]
  const slots:Slot[]=compiled.slots.map(s=>{
    const cell={x:inner.x+widths.slice(0,s.column).reduce((a,b)=>a+b,0)+gx*s.column,y:inner.y+offset+s.row*(h+gy),w:widths[s.column],h}
    layers.push({id:s.id,rect:cell,edges:s.decorations.map(d=>({edge:d.edge,width:d.preferredThicknessPx}))})
    return {region:region.id,blocks:[s.block.blockId],rect:pad(cell,s.padding),direction:'column',columns:1,gap:0,presentation:{components:region.priority==='primitive-first'?'bare':'any',primitiveFirst:region.priority==='primitive-first',typographyRole:region.typographyRole}}
  })
  return {slots,layers}
}

export function incomingCandidates(slide:ContentSlide):Candidate[]{
  return executablePacks.flatMap(({pack,bundle:baseBundle,states})=>{
    const bundle=adaptIncomingTables(baseBundle,slide)
    return states.flatMap(state=>{
      const variant=tableVariants[state.id]
      if(variant&&!slide.blocks.some(b=>variant.kind==='table-content'?b.data?.template.kind==='table':b.data))return []
      const entries=slide.blocks.map((block,index)=>({block,choices:state.regions.flatMap(region=>bindingsFor(block,region,bundle,index).map(binding=>({region:region.id,value:{region,binding},cost:contentPressure(block,region.preferredRect)+(binding.adaptation?1:0)})))}))
      const allocations=searchAssignments(entries,state.regions.map(r=>({id:r.id,min:r.minItems,max:r.maxItems,valid:(n:number)=>n>=r.minItems&&(!n||r.layouts.some(l=>n>=l.minItems&&n<=l.maxItems))})),assigned=>{
        const blocks=slide.blocks.map(b=>assigned.get(b.id)!.binding.block)
        const assignment:StructuralAssignment={familyId:state.familyId,modeId:state.modeId,assignments:slide.blocks.map(b=>{const r=assigned.get(b.id)!.region;return {blockId:b.id,regionId:r.id,emphasis:r.emphasis.includes('secondary')?'secondary':'primary'}})}
        const ctx:QwenContext={contentRevision:'immutable-content',designSystemId:'active-ds',designSystemRevision:'pinned',blocks,sourceRefs:blocks.flatMap(b=>b.sourceRefs),componentIds:[],componentFieldPaths:{},componentVariants:[],fallbackEvidence:[],visualAssets:blocks.filter(b=>b.type==='visual').map(b=>({blockId:b.id,sourceRef:b.sourceRefs[0],assetId:b.sourceRefs[0],visualType:'diagram'}))}
        try{return pack.validateStructuralAssignment(bundle,assignment,ctx).compatibleStateIds.includes(state.id)}catch{return false}
      })
      return allocations.flatMap((assigned,assignmentIndex)=>{
        let present:State,flow:ReturnType<typeof resolvePackFlow>
        try{present=pack.resolvePresentState(state,[...new Set([...assigned.values()].map(a=>a.region.id))]);flow=resolvePackFlow(present)}catch{return []}
        const layouts=present.regions.map(region=>{const ids=slide.blocks.filter(b=>assigned.get(b.id)!.region.id===region.id).map(b=>b.id);return {region,ids,options:region.layouts.filter(l=>ids.length>=l.minItems&&ids.length<=l.maxItems).sort((a,b)=>Number(b.id===region.preferredLayoutId)-Number(a.id===region.preferredLayoutId))}})
        const variants=[layouts.map(r=>r.options[0]),...layouts.flatMap((r,i)=>r.options.slice(1).map(l=>layouts.map((x,j)=>i===j?l:x.options[0])))].slice(0,4)
        return variants.flatMap((selected,index)=>{
          if(selected.some(l=>!l))return []
          const items=layouts.map((r,i)=>regionSlots(r.region,flow.regions[r.region.id],r.ids,selected[i])),slots=items.flatMap(i=>i.slots)
          for(const slot of slots)if(Object.entries(assigned.get(slot.blocks[0])!.binding.paths).some(([path,source])=>path.includes('.')||source.sourceRange))slot.presentation={...slot.presentation,requiresNestedFields:true}
          if(variant)for(const slot of slots)if(slot.region==='metrics')slot.presentation={...slot.presentation,density:variant.density}
          if(slots.some(s=>s.rect.w<=0||s.rect.h<=0||s.rect.x<0||s.rect.y<0||s.rect.x+s.rect.w>1921||s.rect.y+s.rect.h>1081)||slots.some((s,i)=>slots.slice(i+1).some(t=>intersects(s.rect,t.rect))))return []
          const recipeId=`${pack.bundle.sourceSection}/${state.id}`,family=bundle.families.find(f=>f.id===state.familyId)!
          const adaptations=[...assigned.values()].flatMap(v=>v.binding.adaptation?[v.binding.adaptation]:[])
          const key=assignmentKey([...assigned].map(([id,v])=>[id,v.region.id,v.binding.block.type,v.binding.layoutId]))
          const candidate:Candidate={id:`${recipeId}${assignmentIndex?'/assignment-'+key:''}/topology-${index}`,recipeId,label:variant?.label??`${family.name} · ${state.modeId}`,score:105-index-adaptations.length*4+(variant?.kind==='table-content'?42:variant?12:0),
            sources:[pack.bundle.sourceSection,state.sourceFrame],slots,authored:{bundleId:pack.bundle.id,revision:pack.bundle.revision,stateId:state.id,sourceFrame:state.sourceFrame,surface:state.surfaceRole,
              primitives:Object.fromEntries([...assigned].flatMap(([id,v])=>v.binding.primitive?[[id,v.binding.primitive]]:[])),fieldBindings:Object.fromEntries([...assigned].map(([id,v])=>[id,v.binding.paths])),layouts:Object.fromEntries(layouts.map((r,i)=>[r.region.id,selected[i].id])),
              layers:[...flow.layers,...items.flatMap(i=>i.layers)],regions:flow.regions,bindingPolicy:INCOMING_BINDING_POLICY,adaptations,...variant?{variant}:{},...bundle!==baseBundle?{tablePolicy:'adaptive-table-1' as const}:{}}}
          candidate.score-=candidatePressure(candidate,slide)
          return [candidate]
        })
      })
    })
  })
}

export function incomingCapacityMessage(slide:ContentSlide){
  const table=slide.blocks.find(b=>b.data?.template.kind==='table')
  return 'Новые рецепты не содержат совместимой конструкции для всех смысловых блоков этого слайда. '+(table?'Число строк и колонок таблицы адаптируется внутри блока, но для остальных блоков также нужны подходящие области. ':'')+'Переход к прежним рецептам отключён.'
}
