import {createTextFields} from './text-fields'
import {z} from 'zod'
import type {ElementIR,BoundsIR} from '../../vendor/drag/src/core/model'
import type {ComponentDefinition} from './types'
import type {ReconstructionResult,ReconstructionCatalog} from './reconstruction-contract'
import type {DiagramGraph,DiagramEdge} from './diagram-graph'
import {graphElements} from './diagram-graph'
import {assemblePattern,scalePath} from './pattern-geometry'
import {samePatternPart} from './pattern-families'
import {flatten,instantiateComponent} from './compiler'
import type {PatternPart} from './pattern-contract'

export const GRAPHIC_COMPONENTS_VERSION='graphic-components-3'
export type GraphicPart=ComponentDefinition&{role:'block'|'connector'|'pattern-piece';key:string;palette:string[];patternPart?:PatternPart;edge?:Pick<DiagramEdge,'arrow'|'color'|'width'>;sourcePartId:string;sourceSurface?:string}
export type PartCheck={id:string;passed:boolean;changed:boolean;issues:string[]}
export type GraphicPartsReport={version:string;checks:PartCheck[]}
export type GraphicGroup={id:string;name:string;kind:'diagram'|'pattern';componentIds:string[];sourceResultIds:string[];sourceSurface?:string}
export type GraphicSystem={version:string;components:GraphicPart[];groups:GraphicGroup[];compositions:{id:string;groupId:string;resultId:string;references:Record<string,string>;complete:boolean}[]}
export const diagramContentSchema=z.object({nodes:z.array(z.object({id:z.string().regex(/^[\w-]{1,80}$/),text:z.string().max(1000)}).strict()).min(1).max(32),edges:z.array(z.object({from:z.string().max(80),to:z.string().max(80)}).strict()).max(96)}).strict()
export type DiagramContent=z.infer<typeof diagramContentSchema>
const hex=(c:{r:number;g:number;b:number})=>'#'+[c.r,c.g,c.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('')
const round=(v:number)=>Math.round(v*20)/20
function signature(elements:ElementIR[],width:number,height:number):string{
 return JSON.stringify(elements.map(e=>{
  const b=e.bounds,base={kind:e.kind,x:round(b.x/width),y:round(b.y/height),w:round(b.width/width),h:round(b.height/height)}
  if('children' in e)return {...base,children:signature(e.children,b.width||1,b.height||1)}
  if(e.kind==='text')return {...base,font:e.fontFamily,style:e.fontStyle,align:e.textBox?.align}
  if(e.kind==='raster')return {...base,assetId:e.assetId}
  return {...base,path:e.kind==='path'?scalePath(e.pathData??'',1/(b.width||1),1/(b.height||1)).replace(/[+-]?(?:\d+\.?\d*|\.\d+)/g,v=>String(round(Number(v)))):undefined}
 }))
}
function part(result:ReconstructionResult,sourcePartId:string,role:GraphicPart['role'],name:string,width:number,height:number,elements:ElementIR[]):GraphicPart{
 const leaves=flatten(elements),texts=leaves.filter(e=>e.kind==='text'),palette=[...new Set(leaves.flatMap(e=>[...('fill' in e&&e.fill?[hex(e.fill.color)]:[]),...('stroke' in e&&e.stroke?[hex(e.stroke.paint.color)]:[])]))]
 return {id:`${result.id}-${sourcePartId}`,sourcePartId,name,role,key:signature(elements,width,height),palette,kind:role==='block'?'compound':'atom',scene:{width,height,elements},source:{slide:result.candidate.slides[0],rootId:sourcePartId,elementIds:leaves.map(e=>e.id),ancestorIds:[],assetIds:[...new Set(leaves.flatMap(e=>e.kind==='raster'?[e.assetId]:[]))]},slots:texts.flatMap(e=>createTextFields(e,'Текст')),fixedTextIds:[],issues:[],semantics:[{findingId:result.id,name,role,basis:result.diagram?.origin??result.pattern?.origin??'reconstructed'}]}
}
/** Components are independent of the observed composition. A failed arrangement
 * must not erase reusable blocks, connectors or a pattern's shape alphabet. */
export function graphicParts(result:ReconstructionResult):GraphicPart[]{
 const out:GraphicPart[]=[]
 if(result.pattern){const p=result.pattern;for(const shape of p.parts){const occurrence=p.instances.find(i=>i.partId===shape.id)!;const w=120*Math.min(1,shape.aspect),h=120/Math.max(1,shape.aspect),single={...p,width:w,height:h,background:null,instances:[{...occurrence,x:0,y:0,width:w,height:h,rotation:0 as const}]};const item=part(result,shape.id,'pattern-piece','Деталь паттерна',w,h,assemblePattern(single,{width:w,height:h}));item.patternPart=shape;item.palette=p.palette;out.push(item)}}
 if(result.diagram){const g=result.diagram;for(const node of g.nodes.filter(n=>n.kind==='block')){
  const elements=structuredClone(node.elements),name=flatten(elements).some(e=>e.kind==='text')?'Блок с текстом':'Блок с графикой'
  out.push(part(result,node.id,'block',name,node.bounds.width,node.bounds.height,elements))
 }
 const seen=new Set<string>();for(const edge of g.edges){if(seen.has(edge.arrow))continue;seen.add(edge.arrow)
  const direction=edge.arrow==='start'?'end':edge.arrow
  const graph:DiagramGraph={width:160,height:40,origin:'native',warnings:[],decoration:[],sourceIds:[],nodes:[{id:'from',kind:'junction',bounds:{x:10,y:20,width:0,height:0},elements:[],sourceIds:[]},{id:'to',kind:'junction',bounds:{x:150,y:20,width:0,height:0},elements:[],sourceIds:[]}],edges:[{...edge,arrow:direction,id:'connector',from:{nodeId:'from',u:0,v:0},to:{nodeId:'to',u:0,v:0},points:[{x:10,y:20},{x:150,y:20}],original:undefined}]}
  const item=part(result,`connector-${edge.arrow}`,'connector',edge.arrow==='none'?'Соединительная линия':'Стрелка',160,40,graphElements(graph));item.key=direction;item.edge={arrow:direction,color:edge.color,width:edge.width};out.push(item)
 }}
 return out.map(p=>result.diagram?.sourceSurface?{...p,sourceSurface:result.diagram.sourceSurface}:p)
}
export function buildGraphicSystem(catalog:Pick<ReconstructionCatalog,'results'>):GraphicSystem{
 const system:GraphicSystem={version:GRAPHIC_COMPONENTS_VERSION,components:[],groups:[],compositions:[]}
 for(const r of catalog.results){const parts=graphicParts(r),checks=new Set(r.partsQualification?.version===GRAPHIC_COMPONENTS_VERSION?r.partsQualification.checks.filter(c=>c.passed&&c.changed&&!c.issues.length).map(c=>c.id):[]),kind=r.pattern?'pattern':'diagram',refs:Record<string,string>={}
  for(const p of parts.filter(p=>checks.has(p.id))){const previous=system.components.find(c=>c.role===p.role&&c.sourceSurface===p.sourceSurface&&(c.patternPart&&p.patternPart?samePatternPart(c.patternPart,p.patternPart):c.key===p.key));if(previous){previous.palette=[...new Set([...previous.palette,...p.palette])];refs[p.sourcePartId]=previous.id}else{system.components.push(p);refs[p.sourcePartId]=p.id}}
  if(!Object.keys(refs).length)continue
  // A group is a set of compatible components. Observed arrangements belong to
  // compositions; their coordinates and repetitions do not create new parts.
  let group=system.groups.find(g=>g.kind===kind&&g.sourceSurface===r.diagram?.sourceSurface&&(kind==='diagram'||Object.values(refs).every(id=>g.componentIds.includes(id))||g.componentIds.every(id=>Object.values(refs).includes(id))))
  if(!group){group={id:`group-${r.id}`,name:kind==='pattern'?'Детали фирменного паттерна':'Блоки и связи',kind,componentIds:[],sourceResultIds:[],...(r.diagram?.sourceSurface?{sourceSurface:r.diagram.sourceSurface}:{})};system.groups.push(group)}
  group.componentIds=[...new Set([...group.componentIds,...Object.values(refs)])];group.sourceResultIds.push(r.id)
  system.compositions.push({id:`composition-${r.id}`,groupId:group.id,resultId:r.id,references:refs,complete:parts.every(p=>checks.has(p.id))})
 }
 return system
}
/** Scaling and data binding remain in our IR; there is no model-authored HTML. */
export function instantiateGraphicPart(p:GraphicPart,options:{width:number;height:number;text?:string;values?:Record<string,string>;color?:string}){
 const {width,height}=options;if(!Number.isFinite(width)||!Number.isFinite(height)||Math.min(width,height)<8||Math.max(width,height)>10000)throw Error('Недопустимый размер компонента')
 if(options.color&&!p.palette.includes(options.color))throw Error('Цвет вне палитры компонента')
 const values:Record<string,string>={...options.values};if(options.text!==undefined){if(p.slots.length!==1)throw Error('Укажите отдельные текстовые поля компонента');values[p.slots[0].id]=options.text}
 const ink=options.color?{type:'solid' as const,color:{r:parseInt(options.color.slice(1,3),16)/255,g:parseInt(options.color.slice(3,5),16)/255,b:parseInt(options.color.slice(5,7),16)/255,a:1}}:undefined
 const scene=instantiateComponent(p,values),sx=width/scene.width,sy=height/scene.height,k=Math.min(sx,sy)
 const resize=(e:ElementIR):ElementIR=>{
  const b=e.bounds,scaled:BoundsIR={x:b.x*sx,y:b.y*sy,width:b.width*sx,height:b.height*sy},base={...e,bounds:scaled}
  if('children' in e)return {...base,children:e.children.map(resize)} as ElementIR
  if(e.kind==='text')return {...e,bounds:scaled,fontSize:e.fontSize*k,styleRuns:e.styleRuns?.map(r=>({...r,fontSize:r.fontSize*k})),paragraphs:e.paragraphs?.map(r=>({...r,fontSize:r.fontSize*k,left:r.left*sx,right:r.right*sx,before:r.before*sy,after:r.after*sy,indent:r.indent*sx,lineHeight:r.lineHeight?.unit==='PIXELS'?{...r.lineHeight,value:r.lineHeight.value*k}:r.lineHeight}))}
  if(e.kind==='raster')return base
  return {...e,bounds:scaled,pathData:e.pathData?scalePath(e.pathData,sx,sy):undefined,stroke:e.stroke?{...e.stroke,width:e.stroke.width*k,...(ink&&p.role==='connector'?{paint:ink}:{})}:undefined,...(ink&&e.fill?{fill:ink}:{})}
 }
 return {width,height,elements:scene.elements.map(resize)}
}
/** A fresh composition from explicit user data, not a resized source slide.
 * Edges retain supplied meaning. Long labels increase the row height. */
export function composeDiagram(system:GraphicSystem,data:DiagramContent):DiagramGraph{
 data=diagramContentSchema.parse(data)
 const ids=new Set(data.nodes.map(n=>n.id));if(!ids.size||ids.size!==data.nodes.length||ids.size>32||data.edges.length>96||data.nodes.some(n=>!n.id||n.text.length>1000)||data.edges.some(e=>!ids.has(e.from)||!ids.has(e.to)||e.from===e.to))throw Error('Некорректные узлы или связи')
 const group=system.groups.find(g=>g.kind==='diagram'),parts=system.components.filter(c=>group?.componentIds.includes(c.id)),block=parts.filter(p=>p.role==='block'&&p.slots.length===1&&!p.source.assetIds.length).sort((a,b)=>b.scene.width/b.scene.height-a.scene.width/a.scene.height)[0],connector=parts.find(p=>p.edge?.arrow==='end')??parts.find(p=>p.edge)
 if(!block||!connector?.edge)throw Error('В шаблоне нет проверенных блоков и связей')
 // Collapse strongly connected nodes before assigning columns. A feedback
 // loop stays an explicit connection and never turns into an invented sequence.
 const reachable=(start:string)=>{const seen=new Set<string>(),todo=[start];while(todo.length){const at=todo.pop()!;if(seen.has(at))continue;seen.add(at);todo.push(...data.edges.filter(e=>e.from===at).map(e=>e.to))}return seen},reach=new Map(data.nodes.map(n=>[n.id,reachable(n.id)])),clusters:string[][]=[]
 for(const n of data.nodes){if(clusters.some(c=>c.includes(n.id)))continue;clusters.push(data.nodes.filter(p=>reach.get(n.id)!.has(p.id)&&reach.get(p.id)!.has(n.id)).map(p=>p.id))}
 const clusterOf=(id:string)=>clusters.findIndex(c=>c.includes(id)),links=[...new Set(data.edges.filter(e=>clusterOf(e.from)!==clusterOf(e.to)).map(e=>`${clusterOf(e.from)}:${clusterOf(e.to)}`))].map(s=>s.split(':').map(Number)),incoming=clusters.map((_,i)=>links.filter(e=>e[1]===i).length),queue=clusters.map((_,i)=>i).filter(i=>!incoming[i]),columns=clusters.map(()=>0)
 while(queue.length){const at=queue.shift()!;for(const [,to] of links.filter(e=>e[0]===at)){columns[to]=Math.max(columns[to],columns[at]+1);if(!--incoming[to])queue.push(to)}}
 const levels=new Map(data.nodes.map(n=>[n.id,columns[clusterOf(n.id)]]))
 const perLevel=Math.max(...[...new Set(levels.values())].map(l=>data.nodes.filter(n=>levels.get(n.id)===l).length)),w=210,h=Math.max(70,Math.min(360,Math.ceil(Math.max(...data.nodes.map(n=>n.text.length))/18)*22+24)),width=(Math.max(...levels.values())+1)*280+40,height=perLevel*(h+50)+40
 if(width>4000||height>4000)throw Error('Схема слишком велика для одного слайда')
 const nodes=data.nodes.map(n=>{const level=levels.get(n.id)!,peers=data.nodes.filter(p=>levels.get(p.id)===level),index=peers.indexOf(n),bounds={x:40+level*280,y:(height-peers.length*(h+50))/2+index*(h+50),width:w,height:h},scene=instantiateGraphicPart(block,{width:w,height:h,text:n.text});return {id:n.id,kind:'block' as const,bounds,elements:scene.elements.map(e=>prefix(e,n.id)),sourceIds:block.source.elementIds}})
 const edges:DiagramEdge[]=data.edges.map((e,i)=>{const a=nodes.find(n=>n.id===e.from)!,b=nodes.find(n=>n.id===e.to)!,feedback=levels.get(e.from)===levels.get(e.to),from={x:a.bounds.x+w,y:a.bounds.y+h/2},to={x:b.bounds.x+(feedback?w:0),y:b.bounds.y+h/2},mid=feedback?from.x+18+(i%4)*10:(from.x+to.x)/2;return {id:`edge-${i}`,from:{nodeId:e.from,u:1,v:.5},to:{nodeId:e.to,u:feedback?1:0,v:.5},points:[from,{x:mid,y:from.y},{x:mid,y:to.y},to],...connector.edge!,sourceIds:connector.source.elementIds}})
 return {width,height,...(group?.sourceSurface?{sourceSurface:group.sourceSurface}:{}),nodes,edges,sourceIds:[...block.source.elementIds,...connector.source.elementIds],decoration:[],origin:'native',warnings:[]}
}
function prefix(e:ElementIR,id:string):ElementIR{return {...e,id:`${id}-${e.id}`,...('children' in e?{children:e.children.map(c=>prefix(c,id))}:{})} as ElementIR}
