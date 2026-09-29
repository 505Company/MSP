import * as editorial from './authored/editorial'
import * as content from './authored/content'
import * as structured from './authored/structured'
import type { Candidate, ContentBlock, ContentSlide, Recipe, Region, Slot } from './contract'
import {compositionsFor} from './compositions'
import {incomingCandidates,type RecipeScope} from './recipe-packs'
import {candidatePressure,contentPressure,searchAssignments} from './assignment-search'
import {withMirrors} from './recipe-variants'
import {factPrimitive,listPrimitive,repeatedTextPrimitive,structuredPrimitive} from './field-bindings'
import {structuredCompositions} from './structured-compositions'
import {sourceGroupCandidates} from './group-layout'

const sections = [editorial, content, structured]
/** Namespaced IDs keep all 33 reviewed frames available without collisions. */
export const studioRecipes: Recipe[] = sections.flatMap(section => section.states.map(state => ({
  id: `${section.SOURCE_SECTION}/${state.id}`, source: section.RECIPE_ID, mode: state.modeId,
  regions: state.regions.map(r => ({ id: r.id, rect: { ...r.preferredRect }, role: r.content.role,
    accepts: [...r.content.accepts], required: r.content.required, min: r.content.minItems, max: r.content.maxItems,
    typographyRole: 'primitiveTypographyRole' in r.content ? r.content.primitiveTypographyRole : undefined,
    primitiveFirst: r.content.componentPriority === 'primitive-first',
    layouts: r.content.group?.allowedLayouts.map(l => ({ id: l.id, direction: l.direction === 'mosaic' ? 'wrap' as const : l.direction,
      columns: l.columns, min: l.minItems, max: l.maxItems, gap: l.gapX.preferred || l.gapY.preferred })) ?? [],
  })),
})))
function compatible(block: ContentBlock, region: Region) {
  if (block.role === 'title') return region.role === 'title'
  if (block.role === 'footer') return region.role === 'footer'
  if (['title','footer','context','year','page','tag','format','metadata'].includes(region.role)) return false
  // A metric is a concrete fact. Keep its immutable value/caption fields;
  // only adapt the slot semantics, never turn it into an undifferentiated text.
  const types = block.kind === 'feature' ? ['column-item','explanation','article','feature'] : block.kind === 'metric' ? ['metric','fact'] : [block.kind]
  return types.some(t => region.accepts.includes(t))
}
function authoredCandidates(recipe: Recipe, slide: ContentSlide): Candidate[] {
  const extraTitle = !recipe.regions.some(r=>r.role==='title') ? slide.blocks.filter(b=>b.role==='title') : []
  // Source frames with only a context label need a real heading area. Likewise,
  // a concluding statement is not a 27px source citation. Fit the authored main
  // group between these areas, bounded by the recipe's 30% adaptation allowance.
  const extraFooter = slide.blocks.filter(b=>b.role==='footer'&&(b.placement==='bottom'||b.source.length>110))
  const additions = new Set([...extraTitle,...extraFooter])
  const allocations=searchAssignments(slide.blocks.filter(b=>!additions.has(b)).map(block=>({block,choices:recipe.regions.filter(r=>compatible(block,r)).map(r=>({region:r.id,value:r.id,cost:contentPressure(block,r.rect)}))})),recipe.regions.map(r=>({id:r.id,min:r.required?r.min:0,max:r.max,valid:(count:number)=>(!r.required||count>=r.min)&&(!count||!r.layouts.length||r.layouts.some(l=>count>=l.min&&count<=l.max))})))
  return allocations.flatMap((allocation,assignmentIndex)=>{
  const assigned=new Map(recipe.regions.map(r=>[r.id,slide.blocks.filter(b=>allocation.get(b.id)===r.id)]))
  const section = sections.find(s => s.RECIPE_ID === recipe.source)!
  const state = section.states.find(s => recipe.id.endsWith('/'+s.id))!
  // All three contracts share presence semantics, including footer/page coupling.
  const resolver = section.resolvePresentState as (s: unknown, ids: string[]) => { regions: { id: string; preferredRect: {x:number;y:number;w:number;h:number} }[] }
  const present = resolver(state, [...assigned].filter(([,b])=>b.length).map(([id])=>id))
  const slots: Slot[] = recipe.regions.flatMap(r => {
    const blocks = assigned.get(r.id)?.sort((a,b)=>slide.blocks.indexOf(a)-slide.blocks.indexOf(b))
    if (!blocks?.length) return []
    const layout = r.layouts.find(l=>blocks.length>=l.min&&blocks.length<=l.max)
    const resolved = present.regions.find(p=>p.id===r.id)
    return [{ region:r.id,blocks:blocks.map(b=>b.id),rect:resolved?.preferredRect ?? r.rect,direction:layout?.direction??'column',columns:layout?.columns??1,gap:layout?.gap??24,
      presentation:{typographyRole:r.typographyRole,primitiveFirst:r.primitiveFirst,...r.typographyRole==='display'?{align:'end' as const}:{}} }]
  })
  if(additions.size){
    if(!slots.length)return []
    const main=slots.filter(s=>s.blocks.some(id=>slide.blocks.find(b=>b.id===id)?.role==='body'))
    if(!main.length)return []
    const y=Math.min(...main.map(s=>s.rect.y)),end=Math.max(...main.map(s=>s.rect.y+s.rect.h))
    const top=extraTitle.length?248:y,bottom=extraFooter.length?928:end
    const scale=(bottom-top)/(end-y)
    if(scale<.7||scale>1.3)return []
    for(const slot of main)slot.rect={...slot.rect,y:top+(slot.rect.y-y)*scale,h:slot.rect.h*scale}
    for(const b of extraTitle)slots.push({region:'supplement-title',blocks:[b.id],rect:{x:46,y:48,w:1828,h:168},direction:'column',columns:1,gap:0})
    extraFooter.forEach((b,i)=>slots.push({region:'supplement-takeaway',blocks:[b.id],rect:{x:46,y:960+i*72/extraFooter.length,w:1828,h:72/extraFooter.length},direction:'column',columns:1,gap:0}))
  }
  // Visual source rectangles may intentionally overlap in Figma. Such a state
  // cannot enter the no-overlap web mode; mixed flex recipes remain available.
  if (slots.some((a,i)=>slots.slice(i+1).some(b=>Math.min(a.rect.x+a.rect.w,b.rect.x+b.rect.w)-Math.max(a.rect.x,b.rect.x)>1&&Math.min(a.rect.y+a.rect.h,b.rect.y+b.rect.h)-Math.max(a.rect.y,b.rect.y)>1))) return []
  const topologies=[slots,...slots.flatMap((slot,i)=>recipe.regions.find(r=>r.id===slot.region)?.layouts.filter(l=>slot.blocks.length>=l.min&&slot.blocks.length<=l.max&&(l.direction!==slot.direction||l.columns!==slot.columns||l.gap!==slot.gap)).map(l=>slots.map((s,j)=>i===j?{...s,direction:l.direction,columns:l.columns,gap:l.gap}:s))??[])].slice(0,4)
  return topologies.map((slots,topologyIndex)=>{
    const candidate:Candidate={id:recipe.id+(assignmentIndex?`/assignment-${assignmentIndex}`:'')+(topologyIndex?`/topology-${topologyIndex}`:''),recipeId:recipe.id,label:recipe.mode+(additions.size?' · с заголовком/выводом':''),slots,score:100-topologyIndex}
    candidate.score-=candidatePressure(candidate,slide)
    return candidate
  })
  })
}

/** Authored blocks can also be mixed inside a bounded flex composition. This
 * explicit extra recipe handles arbitrary counts; it is never labelled a Figma frame. */
export function candidatesFor(slide: ContentSlide, scope:RecipeScope='all'): Candidate[] {
  const incoming=incomingCandidates(slide)
  if(scope==='new')return withMirrors(incoming,slide).sort((a,b)=>b.score-a.score)
  const authored = studioRecipes.flatMap(r=>authoredCandidates(r,slide))
  // A text frame accepts paragraphs. Keep their original blocks/fields in the
  // receipt while allocating the frame as one contiguous flow, rather than
  // rejecting a title/support recipe because the brief contains blank lines.
  const paragraphs=slide.blocks.filter(b=>b.role==='body')
  if(paragraphs.length>1&&paragraphs.every(b=>b.kind==='text'&&!b.data&&!b.placement&&Object.keys(b.fields).length===1&&b.fields.text)){
    const first=paragraphs[0],text=paragraphs.map(b=>b.fields.text).join('\n\n')
    const grouped={...slide,blocks:slide.blocks.filter(b=>!paragraphs.includes(b)||b===first).map(b=>b===first?{...first,fields:{text},source:text}:b)}
    authored.push(...studioRecipes.flatMap(r=>authoredCandidates(r,grouped)).map(c=>({...c,id:c.id+'/paragraph-flow',slots:c.slots.map(s=>s.blocks.includes(first.id)?{...s,gap:Math.max(s.gap,48),blocks:s.blocks.flatMap(id=>id===first.id?paragraphs.map(b=>b.id):[id])}:s)})))
  }
  // Preserve the original reference frame and offer an explicit larger
  // paragraph area when several paragraphs compete with a display headline.
  const display=authored.find(c=>c.recipeId==='6:185/title-support-02')
  if(display&&paragraphs.length>=2&&paragraphs.every(b=>b.kind==='text'&&!b.data&&!b.placement))authored.push({...display,id:display.id+'/balanced-flow',recipeId:'6:185/title-support-balanced',label:'Крупный заголовок и читаемые абзацы',slots:display.slots.map(s=>({...s,gap:48,presentation:{...s.presentation,maxTypeSize:s.presentation?.typographyRole==='display'?144:64},rect:s.presentation?.typographyRole==='display'?{x:80,y:128,w:1760,h:344}:{x:80,y:544,w:1760,h:488}}))})
  const title = slide.blocks.filter(b=>b.role==='title'), footer=slide.blocks.filter(b=>b.role==='footer'), body=slide.blocks.filter(b=>b.role==='body')
  if (!body.length) return withMirrors([...incoming,...authored],slide).sort((a,b)=>b.score-a.score)
  const takeaway=footer.some(b=>b.placement==='bottom'||b.source.length>110)
  const top = title.length ? 248 : 48, bottom = footer.length ? takeaway?928:980 : 1032
  const base: Slot[] = [
    ...title.map(b=>({region:'title',blocks:[b.id],direction:'column' as const,columns:1,gap:0,rect:{x:48,y:48,w:1824,h:168}})),
    ...footer.map((b,i)=>({region:`footer-${i}`,blocks:[b.id],direction:'column' as const,columns:1,gap:0,rect:{x:48,y:(takeaway?960:1000)+i*(takeaway?72:32)/footer.length,w:1824,h:(takeaway?72:32)/footer.length}})),
  ]
  const mixed: Candidate[]=[]
  for (const columns of [2,3,1]) {
    if (columns>body.length) continue
    mixed.push({id:`flex-mix-${columns}`,recipeId:'flex-mix',label:`Блоки рецептов · ${columns} колонки`,score:50-Math.abs(columns-2)*5,
      slots:[...base,{region:'body',blocks:body.map(b=>b.id),direction:columns===1?'column':'wrap',columns,gap:28,rect:{x:48,y:top,w:1824,h:bottom-top}}]})
  }
  const metrics=body.filter(b=>b.kind==='metric'),rest=body.filter(b=>b.kind!=='metric')
  if (metrics.length && rest.length) mixed.unshift({id:'flex-mix-evidence',recipeId:'flex-mix',label:'Основное содержание + показатели',score:65,slots:[...base,
    {region:'narrative',blocks:rest.map(b=>b.id),direction:'column',columns:1,gap:24,rect:{x:48,y:top,w:1160,h:bottom-top}},
    {region:'metrics',blocks:metrics.map(b=>b.id),direction:'column',columns:1,gap:24,rect:{x:1240,y:top,w:632,h:bottom-top}}]})
  const left=body.filter(b=>b.placement==='left'),right=body.filter(b=>b.placement==='right')
  if(left.length&&right.length&&left.length+right.length===body.length)mixed.push({id:'flex-mix-directed',recipeId:'flex-mix',label:'Акцент слева · пояснения справа',score:70,slots:[...base,
    {region:'left',blocks:left.map(b=>b.id),direction:'column',columns:1,gap:24,rect:{x:48,y:top,w:760,h:bottom-top}},
    {region:'right',blocks:right.map(b=>b.id),direction:'column',columns:1,gap:24,rect:{x:836,y:top,w:1036,h:bottom-top}},
  ]})
  if(body.length>1&&body.every(b=>b.kind==='metric')&&body.every(b=>b.placement===body[0].placement)&&['left','right'].includes(body[0].placement??'')){
    const left=body[0].placement==='left'
    mixed.unshift({id:'composition/side-facts',recipeId:'composition/side-facts',label:'Показатели · заданная сторона',score:310,slots:[
      ...title.map(b=>({region:'title',blocks:[b.id],direction:'column' as const,columns:1,gap:0,rect:{x:left?984:48,y:48,w:888,h:300},presentation:{components:'bare' as const}})),
      {region:'facts',blocks:body.map(b=>b.id),direction:'column',columns:1,gap:28,rect:{x:left?48:984,y:48,w:888,h:984},presentation:{density:'compact'}},
      ...footer.map(b=>({region:'footer',blocks:[b.id],direction:'column' as const,columns:1,gap:0,rect:{x:left?984:48,y:400,w:888,h:632}}))]})
    if(footer.length===1)mixed.unshift({id:'composition/side-facts-bottom',recipeId:'composition/side-facts',label:'Показатели сбоку · вывод снизу',score:312,slots:[
      ...title.map(b=>({region:'title',blocks:[b.id],direction:'column' as const,columns:1,gap:0,rect:{x:left?984:48,y:48,w:888,h:756},presentation:{components:'bare' as const}})),
      {region:'facts',blocks:body.map(b=>b.id),direction:'column',columns:1,gap:28,rect:{x:left?48:984,y:48,w:888,h:756},presentation:{density:'compact'}},
      {region:'footer',blocks:[footer[0].id],direction:'column',columns:1,gap:0,rect:{x:48,y:852,w:1824,h:180}},
    ]})
  }
  if(body.length===1&&body[0].data?.template.kind==='chart'){
    const chart=body[0],side=chart.placement==='left'||chart.placement==='right'
    mixed.unshift({id:'composition/chart-header',recipeId:'composition/chart-header',label:'Крупный график · заголовок сверху',score:360,slots:[...base,{region:'chart',blocks:[chart.id],direction:'column',columns:1,gap:0,rect:{x:chart.placement==='right'?120:48,y:top,w:side?1752:1824,h:bottom-top}}]})
    mixed.unshift({id:'composition/chart-focus',recipeId:'composition/chart-focus',label:'График · широкая область',score:350,slots:side?[
      {region:'chart',blocks:[chart.id],direction:'column',columns:1,gap:0,rect:{x:chart.placement==='left'?48:656,y:48,w:1216,h:984}},
      ...title.map(b=>({region:'title',blocks:[b.id],direction:'column' as const,columns:1,gap:0,rect:{x:chart.placement==='left'?1312:48,y:48,w:560,h:footer.length?760:984},presentation:{components:'bare' as const,typeScale:.875,requiresNestedFields:true}})),
      ...footer.map(b=>({region:'footer',blocks:[b.id],direction:'column' as const,columns:1,gap:0,rect:{x:chart.placement==='left'?1312:48,y:840,w:560,h:192}})),
    ]:[...base,{region:'chart',blocks:[chart.id],direction:'column',columns:1,gap:0,rect:{x:48,y:top,w:1824,h:bottom-top}}]})
  }
  if(body.length===4&&body.every(b=>b.kind==='step'))mixed.unshift({id:'composition/dense-journey-columns',recipeId:'composition/dense-journey',label:'Четыре этапа · компактная иерархия',score:340,slots:[
    ...title.map(b=>({region:'title',blocks:[b.id],direction:'column' as const,columns:1,gap:0,rect:{x:48,y:48,w:1824,h:124},presentation:{requiresNestedFields:true,typeScale:.75}})),
    ...body.map((b,i)=>({region:b.id,blocks:[b.id],direction:'column' as const,columns:1,gap:0,rect:{x:48+i*464,y:204,w:432,h:footer.length?696:828},presentation:{requiresNestedFields:true,typeScale:.75}})),
    ...footer.map(b=>({region:'footer',blocks:[b.id],direction:'column' as const,columns:1,gap:0,rect:{x:48,y:932,w:1824,h:100},presentation:{requiresNestedFields:true}}))]})
  if(body.length===4&&body.every(b=>b.kind==='step'))for(const upper of [480,520]){
    const end=footer.length?928:1032
    mixed.unshift({id:`composition/dense-journey-${upper}`,recipeId:'composition/dense-journey',label:'Четыре этапа · две широкие колонки',score:320,slots:[...base,...body.map((b,i)=>({region:b.id,blocks:[b.id],direction:'column' as const,columns:1,gap:0,rect:{x:48+(i%2)*936,y:i<2?248:248+upper+28,w:888,h:i<2?upper:end-248-upper-28},presentation:{requiresNestedFields:true,density:'compact' as const}}))]})
  }
  return withMirrors([...structuredCompositions(slide),...sourceGroupCandidates(slide),...compositionsFor(slide),...incoming,...authored,...mixed],slide).sort((a,b)=>b.score-a.score)
}

export type PrimitiveNode={field?:string;sourceRange?:{start:number;end:number};role?:string;direction?:'row'|'column';gap?:number;padding?:number;justify?:string;children?:PrimitiveNode[]
  insets?:{top:number;right:number;bottom:number;left:number};align?:string;heightMode?:'hug'|'fill';flex?:{grow?:number;shrink?:number;basis?:number|'auto'};pushToEnd?:boolean;preferredWidth?:number;textAlign?:string;columns?:number;surface?:string;edges?:{edge:'top'|'bottom'|'left'|'right';width:number}[]}
/** Use the reviewed field hierarchy, rather than flattening a card into text. */
export function primitiveFor(block: ContentBlock, candidate: Candidate, region: string): PrimitiveNode {
  if(candidate.authored){const node=candidate.authored.primitives[block.id];if(!node)throw Error('Нет внутренней структуры нового рецепта для '+block.id);return node}
  if(['composition/dense-journey','composition/source-groups'].includes(candidate.recipeId)&&block.kind==='step')return {direction:'column',gap:20,children:[{direction:'row',gap:16,children:[{field:'marker',role:'marker',preferredWidth:52,flex:{grow:0,shrink:0,basis:52}},{field:'heading',role:'column-heading',flex:{grow:1,shrink:1,basis:0}}]},{field:'body',role:'body'}]}
  if(candidate.recipeId==='composition/journey'&&block.kind==='feature')return {direction:'column',gap:28,children:[{field:'heading',role:'marker'},{field:'body',role:'column-heading'}]}
  const presentation=candidate.slots.find(s=>s.region===region)?.presentation
  const columns=presentation?.repeatColumns
  if(presentation?.contentTreatment)return structuredPrimitive(block,presentation.contentTreatment,columns??1)
  if(presentation?.factLayout){const facts=factPrimitive(block,columns??1,presentation.factLayout);if(facts)return facts}
  if(columns){const repeated=repeatedTextPrimitive(block,columns);if(repeated)return repeated}
  const list=listPrimitive(block);if(list)return list
  const [sectionId] = candidate.recipeId.split('/')
  const section = sections.find(s=>s.SOURCE_SECTION===sectionId)
  const state = section?.states.find(s=>candidate.recipeId.endsWith('/'+s.id))
  const original = state?.regions.find(r=>r.id===region)
  const layouts = original && 'primitiveLayouts' in original.content ? original.content.primitiveLayouts as Record<string,{root:content.FlexNode}> : undefined
  if (layouts?.[block.kind]) {
    const convert=(n:content.FlexNode):PrimitiveNode=>n.kind==='field'?{field:n.field,role:n.typographyRole}:{direction:'column',gap:'gap' in n?n.gap.preferred:24,justify:'justify' in n?n.justify:'start',children:'children' in n?n.children.map(convert):[]}
    return convert(layouts[block.kind].root)
  }
  if(candidate.recipeId==='composition/metric-grid'&&block.kind==='feature')return {direction:'column',gap:36,justify:'center',children:[{field:'heading',role:'metric-value'},{field:'body',role:'support'}]}
  if(['composition/metric-focus','composition/metric-grid'].includes(candidate.recipeId)&&block.kind==='metric')return {direction:'column',gap:36,justify:'center',children:[{field:'value',role:'metric-value'},{field:'caption',role:'support'}]}
  if (block.kind==='metric'||block.kind==='step') {
    const convert=(n:structured.InternalNodeSpec):PrimitiveNode=>n.kind==='field'?{field:n.fieldPath,role:n.typographyRole}:{direction:n.direction==='row'?'row':'column',gap:n.gap?.preferred??20,padding:n.padding?.left,justify:n.justify,children:n.children?.map(convert)}
    return convert(structured.semanticBlockContracts[block.kind].primitiveLayouts[0].root)
  }
  const roles:Record<string,string>={text:candidate.slots.find(s=>s.region===region)?.presentation?.typographyRole??(block.role==='title'?'title':block.role==='footer'?block.placement==='bottom'?'takeaway':'footer':'body'),heading:'column-heading',body:'body',quote:'quote',author:'quote-author'}
  return {direction:'column',gap:20,children:Object.keys(block.fields).map(field=>({field,role:roles[field]??'body'}))}
}
