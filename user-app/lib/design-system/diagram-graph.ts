import {z} from 'zod'
import type {BoundsIR,ElementIR,TextElementIR,ShapeElementIR} from '../../vendor/drag/src/core/model'
import {primitivePath} from './pattern-geometry'
import {nativeBoundText,renderNativeLayout} from './editable-native-layout'
import type {EditableData} from './editable-contract'
import {parseSceneElements} from '../../vendor/drag/src/core/page-ir'

export const RECONSTRUCTION_VERSION='graphic-reconstruction-1'
const num=z.number().finite(),id=z.string().regex(/^[\w-]{1,120}$/),hex=z.string().regex(/^#[\da-f]{6}$/i)
const point=z.object({x:num.min(0).max(10000),y:num.min(0).max(10000)}).strict()
const bounds=point.extend({width:num.positive().max(10000),height:num.positive().max(10000)})
const port=z.object({nodeId:id,u:num.min(0).max(1),v:num.min(0).max(1)}).strict()
/** Untrusted visual recognition returns data, never HTML, scripts or SVG paths. */
export const diagramRecognitionSchema=z.object({kind:z.literal('diagram'),name:z.string().min(1).max(100),description:z.string().max(240),width:num.positive().max(10000),height:num.positive().max(10000),background:hex,
 nodes:z.array(z.object({id,bounds,shape:z.enum(['rectangle','ellipse','capsule','diamond']),fill:hex,stroke:hex.nullable(),strokeWidth:num.min(0).max(20),text:z.string().max(2000),textColor:hex,fontSize:num.min(6).max(300),font:z.string().max(120)}).strict()).min(2).max(64),
 edges:z.array(z.object({id,from:port,to:port,points:z.array(point).min(2).max(16),arrow:z.enum(['none','start','end','both']),color:hex,width:num.positive().max(20)}).strict()).min(1).max(128),
 // A source patch is retained for icons/complex artwork. It is never called editable.
 patches:z.array(z.object({id,bounds,nodeId:id.nullable()}).strict()).max(32),
 uncertain:z.array(z.string().max(240)).max(30),
}).strict()
export type DiagramRecognition=z.infer<typeof diagramRecognitionSchema>
export type GraphPort={nodeId:string;u:number;v:number;dx?:number;dy?:number}
export type DiagramNode={id:string;bounds:BoundsIR;elements:ElementIR[];sourceIds:string[];kind:'block'|'junction'}
export type DiagramEdge={id:string;from:GraphPort;to:GraphPort;points:{x:number;y:number}[];arrow:'none'|'start'|'end'|'both';color:string;width:number;sourceIds:string[];original?:ElementIR[]}
export type DiagramGraph={width:number;height:number;background?:string;sourceSurface?:string;nodes:DiagramNode[];edges:DiagramEdge[];origin:'native'|'reconstructed';sourceIds:string[];warnings:string[];decoration:ElementIR[];sourceElements?:ElementIR[]}
const paint=(hex:string)=>({type:'solid' as const,color:{r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255,a:1}})
const base={rotation:0,opacity:1,visible:true,zIndex:0}
export function validateGraph(g:DiagramGraph){
 if(g.sourceSurface&&!/^#[\da-f]{6}$/i.test(g.sourceSurface))throw Error('Недопустимая поверхность исходной схемы')
 if(!Number.isFinite(g.width)||!Number.isFinite(g.height)||Math.min(g.width,g.height)<=0||Math.max(g.width,g.height)>10000||g.nodes.length>192||g.edges.length>512)throw Error('Недопустимый размер схемы')
 const ids=new Set(g.nodes.map(n=>n.id));if(ids.size!==g.nodes.length||new Set(g.edges.map(e=>e.id)).size!==g.edges.length)throw Error('Повторяющиеся ID схемы')
 for(const n of g.nodes){if(![n.bounds.x,n.bounds.y,n.bounds.width,n.bounds.height].every(Number.isFinite)||n.bounds.width<0||n.bounds.height<0||n.bounds.x<-.1||n.bounds.y<-.1||n.bounds.x+n.bounds.width>g.width+.1||n.bounds.y+n.bounds.height>g.height+.1)throw Error('Узел вне схемы');parseSceneElements(n.elements)}
 for(const e of g.edges){if(!ids.has(e.from.nodeId)||!ids.has(e.to.nodeId)||e.from.nodeId===e.to.nodeId)throw Error('Разорванная связь схемы');for(const p of [e.from,e.to])if(![p.u,p.v,p.dx??0,p.dy??0].every(Number.isFinite)||p.u<0||p.u>1||p.v<0||p.v>1)throw Error('Некорректный порт');if(!/^#[\da-f]{6}$/i.test(e.color)||!Number.isFinite(e.width)||e.width<=0||e.width>20||e.points.length<2||e.points.length>32||e.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<-.1||p.y<-.1||p.x>g.width+.1||p.y>g.height+.1))throw Error('Некорректное ребро')}
 return g
}
export function recognizedDiagram(raw:unknown,assetId:string,availableFonts:string[]):DiagramGraph{
 const d=diagramRecognitionSchema.parse(raw),ids=new Set(d.nodes.map(n=>n.id))
 const imageNodes=d.patches.filter(p=>p.nodeId&&!ids.has(p.nodeId))
 if(new Set(imageNodes.map(p=>p.nodeId)).size!==imageNodes.length||imageNodes.some(p=>!d.edges.some(e=>e.from.nodeId===p.nodeId||e.to.nodeId===p.nodeId)))throw Error('Неизвестный узел изображения')
 const nodes:DiagramNode[]=d.nodes.map(n=>{
  const {width:w,height:h}=n.bounds,path=n.shape==='diamond'?`M ${w/2} 0 L ${w} ${h/2} L ${w/2} ${h} L 0 ${h/2} Z`:n.shape==='capsule'?primitivePath({kind:'rounded',corners:[.5,.5,.5,.5]},w,h):undefined
  const shape:ShapeElementIR={...base,id:n.id+'-shape',name:'Блок схемы',windingRule:'NONZERO',kind:n.shape==='ellipse'?'ellipse':path?'path':'rectangle',bounds:{x:0,y:0,width:w,height:h},fill:paint(n.fill),...(path?{pathData:path}:{}),...(n.stroke?{stroke:{paint:paint(n.stroke),width:n.strokeWidth}}:{})}
  const font=availableFonts.includes(n.font)?n.font:availableFonts[0]??'Arial'
  const elements:ElementIR[]=[shape]
  const text=n.text.replaceAll('\\n','\n')
  if(text)elements.push({...base,id:n.id+'-text',name:'Текст схемы',kind:'text',bounds:{x:4,y:2,width:Math.max(1,w-8),height:Math.max(1,h-4)},text,fontFamily:font,fontSize:n.fontSize,colorRuns:[{start:0,end:text.length,fill:paint(n.textColor)}],textBox:{align:'CENTER',vertical:'CENTER',wrap:true},zIndex:1})
  return {id:n.id,kind:'block',bounds:n.bounds,elements,sourceIds:[]}
 })
 for(const p of imageNodes)nodes.push({id:p.nodeId!,bounds:p.bounds,elements:[],sourceIds:[assetId],kind:'block'})
 if(new Set(d.patches.map(p=>p.id)).size!==d.patches.length)throw Error('Повторяющиеся ID фрагментов')
 const decoration:ElementIR[]=[]
 for(const p of d.patches){
  const owner=nodes.find(n=>n.id===p.nodeId),ox=owner?.bounds.x??0,oy=owner?.bounds.y??0,b=p.bounds
  if(b.x<0||b.y<0||b.x+b.width>d.width||b.y+b.height>d.height)throw Error('Область изображения вне источника')
  const e:ElementIR={...base,id:p.id,name:'Исходная графика',kind:'group',bounds:{x:b.x-ox,y:b.y-oy,width:b.width,height:b.height},clipsContent:true,children:[{...base,id:p.id+'-image',name:'Исходный фрагмент',kind:'raster',bounds:{x:-b.x,y:-b.y,width:d.width,height:d.height},assetId,reason:'Сложная графика сохранена из исходника'}],zIndex:2}
  if(owner)owner.elements.push(e);else decoration.push(e)
 }
 return validateGraph({width:d.width,height:d.height,background:d.background,nodes,edges:d.edges.map(e=>({...e,sourceIds:[]})),origin:'reconstructed',sourceIds:[assetId],warnings:d.uncertain,decoration})
}
const anchor=(n:DiagramNode,p:GraphPort)=>({x:n.bounds.x+n.bounds.width*p.u+(p.dx??0),y:n.bounds.y+n.bounds.height*p.v+(p.dy??0)})
export type DiagramChanges={nodes?:Record<string,Partial<BoundsIR>>;texts?:Record<string,string>}
/** Ports and route points remain separate. A moved block gets a new connected
 * orthogonal route; unchanged edges retain their exact source geometry. */
export function graphElements(graph:DiagramGraph,changes:DiagramChanges={}):ElementIR[]{
 validateGraph(graph)
 const g=structuredClone(graph)
 for(const [id,b] of Object.entries(changes.nodes??{})){const n=g.nodes.find(n=>n.id===id);if(!n||n.kind!=='block')throw Error('Неизвестный блок');if(b.width!==undefined&&b.width!==n.bounds.width||b.height!==undefined&&b.height!==n.bounds.height)throw Error('Изменение размеров требует повторной проверки вёрстки');Object.assign(n.bounds,b)}
 validateGraph(g)
 if(g.sourceElements&&!Object.keys(changes.nodes??{}).length){const edit=(e:ElementIR):ElementIR=>'children' in e?{...e,children:e.children.map(edit)}:e.kind==='text'&&changes.texts?.[e.id]!==undefined?nativeBoundText({element:e,binding:{field:'text'}},{text:changes.texts[e.id]}):e;return g.sourceElements.map(edit)}
 const result:ElementIR[]=g.background?[{...base,id:'diagram-background',name:'Фон',kind:'rectangle',bounds:{x:0,y:0,width:g.width,height:g.height},fill:paint(g.background)}]:[]
 for(const e of g.edges){
  const from=g.nodes.find(n=>n.id===e.from.nodeId)!,to=g.nodes.find(n=>n.id===e.to.nodeId)!,changed=Boolean(changes.nodes?.[from.id]||changes.nodes?.[to.id])
  if(!changed&&e.original){result.push(...e.original);continue}
  const a=anchor(from,e.from),b=anchor(to,e.to)
  const horizontal=Math.abs(e.points[1].x-e.points[0].x)>=Math.abs(e.points[1].y-e.points[0].y)
  const pts=changed?(Math.abs(a.x-b.x)<.01||Math.abs(a.y-b.y)<.01?[a,b]:horizontal?[a,{x:(a.x+b.x)/2,y:a.y},{x:(a.x+b.x)/2,y:b.y},b]:[a,{x:a.x,y:(a.y+b.y)/2},{x:b.x,y:(a.y+b.y)/2},b]):e.points
  const x=Math.min(...pts.map(p=>p.x)),y=Math.min(...pts.map(p=>p.y)),w=Math.max(...pts.map(p=>p.x))-x,h=Math.max(...pts.map(p=>p.y))-y
  result.push({...base,id:e.id,name:'Связь схемы',kind:'path',windingRule:'NONZERO',bounds:{x,y,width:w,height:h},pathData:pts.map((p,i)=>`${i?'L':'M'} ${p.x-x} ${p.y-y}`).join(' '),stroke:{paint:paint(e.color),width:e.width}})
  for(const end of [0,1])if(e.arrow==='both'||e.arrow===(end?'end':'start')){
   const p=end?pts.at(-1)!:pts[0],prev=end?pts.at(-2)!:pts[1],angle=Math.atan2(p.y-prev.y,p.x-prev.x),size=Math.max(4,e.width*4),points=[[0,0],[-size,-size/2],[-size,size/2]].map(([dx,dy])=>({x:p.x+dx*Math.cos(angle)-dy*Math.sin(angle),y:p.y+dx*Math.sin(angle)+dy*Math.cos(angle)}))
   const ax=Math.min(...points.map(p=>p.x)),ay=Math.min(...points.map(p=>p.y));result.push({...base,id:e.id+'-arrow-'+end,name:'Направление связи',kind:'path',windingRule:'NONZERO',bounds:{x:ax,y:ay,width:Math.max(...points.map(p=>p.x))-ax,height:Math.max(...points.map(p=>p.y))-ay},pathData:points.map((p,i)=>`${i?'L':'M'} ${p.x-ax} ${p.y-ay}`).join(' ')+' Z',fill:paint(e.color)})
  }
 }
 for(const n of g.nodes)if(n.kind==='block'){
  const edit=(e:ElementIR):ElementIR=>{if('children' in e)return {...e,children:e.children.map(edit)};if(e.kind==='text'&&changes.texts?.[e.id]!==undefined)return nativeBoundText({element:e,binding:{field:'text'}},{text:changes.texts[e.id]});return e}
  result.push({...base,id:n.id+'-node',name:'Узел схемы',kind:'group',bounds:n.bounds,children:n.elements.map(edit),zIndex:result.length+1})
 }
 return [...result,...g.decoration]
}
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const color=(c?:{r:number;g:number;b:number})=>c?'#'+[c.r,c.g,c.b].map(n=>Math.round(n*255).toString(16).padStart(2,'0')).join(''):'none'
/** One IR renderer for both reconstruction adapters; source patches stay images. */
export function graphicHtml(elements:ElementIR[],width:number,height:number,uploadId:string,data:EditableData={}){
 const texts:{element:TextElementIR;binding:{field:'item';id:string;part:'text'}}[]=[]
 const draw=(e:ElementIR,tx=0,ty=0):string=>{
  if(!e.visible||!e.opacity)return ''
  const b=e.bounds,x=b.x,y=b.y
  if(e.kind==='text'){if(e.rotation)throw Error('Повёрнутый текст пока не поддержан восстановлением');texts.push({element:{...e,bounds:{...b,x:tx+x,y:ty+y}},binding:{field:'item',id:e.id,part:'text'}});return ''}
  const transform=e.centeredTransform?`translate(${x+b.width/2} ${y+b.height/2}) rotate(${e.rotation}) scale(${e.centeredTransform.flipH?-1:1} ${e.centeredTransform.flipV?-1:1}) translate(${-b.width/2} ${-b.height/2})`:`translate(${x} ${y}) rotate(${e.rotation})`
  let defs='',fill='fill' in e?color(e.fill?.color):'none'
  if('gradient' in e&&e.gradient){
   const g=e.gradient,gid=`gradient-${Array.from(`${uploadId}:${e.id}`).map(c=>c.codePointAt(0)!.toString(16)).join('-')}`
   const stops=g.stops.map(s=>`<stop offset="${s.position}" stop-color="${color(s.color)}" stop-opacity="${s.color.a}"/>`).join('')
   defs=g.type==='linear'?`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${g.start.x*b.width}" y1="${g.start.y*b.height}" x2="${g.end.x*b.width}" y2="${g.end.y*b.height}">${stops}</linearGradient>`:`<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="0.5" cy="0.5" r="0.5" gradientTransform="translate(${g.start.x*b.width} ${g.start.y*b.height}) scale(${(g.end.x-g.start.x)*b.width} ${(g.end.y-g.start.y)*b.height})">${stops}</radialGradient>`
   fill=`url(#${gid})`
  }
  let body='';if('children' in e){body=e.children.map(c=>draw(c,tx+x,ty+y)).join('');if(e.clipsContent){body=`<svg width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}" overflow="hidden">${body}</svg>`}}
  else if(e.kind==='raster')body=`<image href="/api/uploads/${encodeURIComponent(uploadId)}/assets/${encodeURIComponent(e.assetId)}" width="${b.width}" height="${b.height}" preserveAspectRatio="none"/>`
  else {const attrs=`fill="${fill}" fill-opacity="${e.gradient?1:e.fill?.color.a??1}" fill-rule="${e.windingRule==='EVENODD'?'evenodd':'nonzero'}" stroke="${color(e.stroke?.paint.color)}" stroke-opacity="${e.stroke?.paint.color.a??1}" stroke-width="${e.stroke?.width??0}" stroke-dasharray="${e.stroke?.dash?.join(' ')??'none'}" stroke-linecap="${e.stroke?.cap==='ROUND'?'round':e.stroke?.cap==='SQUARE'?'square':'butt'}" stroke-linejoin="${e.stroke?.join?.toLowerCase()??'miter'}"`;body=e.kind==='ellipse'?`<ellipse cx="${b.width/2}" cy="${b.height/2}" rx="${b.width/2}" ry="${b.height/2}" ${attrs}/>`:e.kind==='path'?`<path d="${esc(e.pathData)}" ${attrs}/>`:e.kind==='line'?`<path d="M0 0 L${b.width} ${b.height}" ${attrs}/>`:`<rect width="${b.width}" height="${b.height}" ${attrs}/>`}
  return `<g data-source-object="${esc(e.id)}" transform="${transform}" opacity="${e.opacity}">${defs?`<defs>${defs}</defs>`:''}${body}</g>`
 }
 const body=elements.map(e=>draw(e)).join(''),items=texts.map(t=>({id:t.element.id,text:data.items?.find(i=>i.id===t.element.id)?.text??t.element.text}))
 return renderNativeLayout({graphic:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">${body}</svg>`,text:texts,graphicIds:[]},{items},width,height)
}
export function diagramHtml(g:DiagramGraph,uploadId:string,changes:DiagramChanges={}){return graphicHtml(graphElements(g,changes),g.width,g.height,uploadId)}
