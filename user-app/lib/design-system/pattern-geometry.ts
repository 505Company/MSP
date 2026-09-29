import type {ElementIR,ShapeElementIR} from '../../vendor/drag/src/core/model'
import type {PatternDefinition,PatternPrimitive,PatternGeometry} from './pattern-contract'

const round=(n:number)=>Math.round(n*10000)/10000
const color=(hex:string)=>({r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255,a:1})
export function primitiveContains(p:PatternPrimitive,x:number,y:number,w:number,h:number){
 if(x<0||y<0||x>w||y>h)return false
 if(p.kind!=='rounded')return ((x/w-.5)*2)**2+((y/h-.5)*2)**2<=1&&(p.kind!=='sector'||!(x>w/2&&y<h/2))
 const r=p.corners.map(v=>v*Math.min(w,h)),corners=[[0,0],[w,0],[w,h],[0,h]]
 for(let i=0;i<4;i++){const [cx,cy]=corners[i],a=Math.abs(x-cx),b=Math.abs(y-cy);if(a<r[i]&&b<r[i]&&(a-r[i])**2+(b-r[i])**2>r[i]**2)return false}
 return true
}
export function primitivePath(p:PatternPrimitive,w:number,h:number){
 const f=(...v:number[])=>v.map(round).join(' '),k=.5522847498307936
 if(p.kind==='ellipse'||p.kind==='sector'){
  const rx=w/2,ry=h/2
  return `M ${f(w,ry)} C ${f(w,ry+k*ry,rx+k*rx,h,rx,h)} C ${f(rx-k*rx,h,0,ry+k*ry,0,ry)} C ${f(0,ry-k*ry,rx-k*rx,0,rx,0)} ${p.kind==='sector'?`L ${f(rx,ry)} L ${f(w,ry)}`:`C ${f(rx+k*rx,0,w,ry-k*ry,w,ry)}`} Z`
 }
 const [a,b,c,d]=p.corners.map(v=>v*Math.min(w,h))
 return `M ${f(a,0)} L ${f(w-b,0)} C ${f(w-b+k*b,0,w,b-k*b,w,b)} L ${f(w,h-c)} C ${f(w,h-c+k*c,w-c+k*c,h,w-c,h)} L ${f(d,h)} C ${f(d-k*d,h,0,h-d+k*d,0,h-d)} L ${f(0,a)} C ${f(0,a-k*a,a-k*a,0,a,0)} Z`
}
export function scalePath(path:string,sx:number,sy:number){if(path.replace(/[MLCQZ]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[\s,]/g,''))throw Error('Неподдержанный контур');let i=0;return path.replace(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g,v=>String(round(Number(v)*(i++%2?sy:sx))))}
/** Rotation belongs to the occurrence, so recolored/rotated copies share a part. */
export function canonicalPrimitive(primitive:PatternPrimitive,width:number,height:number){
 if(primitive.kind==='ellipse')return {primitive,rotation:0 as const,width,height}
 if(primitive.kind==='sector')return {primitive,rotation:0 as const,width,height}
 const candidates=[0,1,2,3].map(n=>({primitive:{kind:'rounded' as const,corners:primitive.corners.map((_,i)=>primitive.corners[(i+n)%4]) as [number,number,number,number]},rotation:(n*90) as 0|90|180|270,width:n%2?height:width,height:n%2?width:height}))
 return candidates.sort((a,b)=>JSON.stringify(a.primitive).localeCompare(JSON.stringify(b.primitive)))[0]
}
export function observedGap(g:Pick<PatternGeometry,'instances'>){
 const gaps:number[]=[]
 for(const a of g.instances)for(const b of g.instances){
  if(a===b)continue
  const gap=b.x-a.x-a.width
  if(gap>=0&&gap<Math.max(a.width,a.height)*.25&&Math.abs(a.y-b.y)<Math.max(a.height,b.height)*.1)gaps.push(gap/Math.max(a.width,a.height))
 }
 return gaps.length?Math.min(.2,gaps.sort((a,b)=>a-b)[Math.floor(gaps.length/2)]):.04
}
export type PatternPlacement={width:number;height:number;mode?:'source'|'fill';seed?:number;columns?:number;palette?:string[]}
export function assemblePattern(p:PatternDefinition,options:PatternPlacement):ElementIR[]{
 const {width,height}=options
 if(!Number.isFinite(width)||!Number.isFinite(height)||Math.min(width,height)<=0||Math.max(width,height)>10000)throw Error('Недопустимый размер паттерна')
 const palette=options.palette??p.palette
 if(palette.some(c=>!p.palette.includes(c))||!palette.length||options.palette&&!p.rules.allowRecolor)throw Error('Цвета не разрешены правилами паттерна')
 let instances=p.instances
 if(options.mode==='fill'){
  const cols=options.columns??Math.max(1,Math.round(Math.sqrt(width/height*12)))
  if(!Number.isInteger(cols)||cols<1||cols>24)throw Error('Недопустимая сетка паттерна')
  const rows=Math.max(1,Math.floor(height/(width/cols))),count=rows*cols
  if(count>128)throw Error('Слишком много деталей паттерна')
  const cw=width/cols,ch=height/rows,cell=Math.min(cw,ch)*(1-p.rules.gapRatio),seed=Math.abs(Math.trunc(options.seed??0))
  instances=Array.from({length:count},(_,i)=>{const part=p.parts[(i+seed)%p.parts.length],rotation=p.rules.rotations[(i+seed)%p.rules.rotations.length],aspect=part.aspect,w=cell*Math.min(1,aspect),h=cell/Math.max(1,aspect);return {partId:part.id,x:(i%cols+.5)*cw-w/2,y:(Math.floor(i/cols)+.5)*ch-h/2,width:w,height:h,color:p.rules.allowRecolor?palette[(i+seed)%palette.length]:p.instances.filter(v=>v.partId===part.id)[0].color,rotation}})
 }
 const scale=options.mode==='fill'?1:Math.min(width/p.width,height/p.height),ox=options.mode==='fill'?0:(width-p.width*scale)/2,oy=options.mode==='fill'?0:(height-p.height*scale)/2
 const base={opacity:1,visible:true,rotation:0}
 const result:ElementIR[]=p.background?[{...base,id:'pattern-background',name:'Фон паттерна',kind:'rectangle',bounds:{x:0,y:0,width,height},fill:{type:'solid',color:color(p.background)},zIndex:0}]:[]
 for(const [i,item] of instances.entries()){
  const part=p.parts.find(p=>p.id===item.partId);if(!part)throw Error('Неизвестная деталь паттерна')
  const w=item.width*scale,h=item.height*scale,paint=options.mode==='fill'?item.color:options.palette?palette[p.palette.indexOf(item.color)%palette.length]:item.color
  const shape:ShapeElementIR=part.primitive?{...base,id:`pattern-${i}`,name:'Деталь паттерна',kind:part.primitive.kind==='ellipse'?'ellipse':'path',bounds:{x:ox+item.x*scale,y:oy+item.y*scale,width:w,height:h},pathData:primitivePath(part.primitive,w,h),windingRule:'NONZERO',zIndex:i+1}:{...part.element!,id:`pattern-${i}`,bounds:{x:ox+item.x*scale,y:oy+item.y*scale,width:w,height:h},pathData:part.element?.pathData?scalePath(part.element.pathData,w,h):undefined,zIndex:i+1}
  shape.rotation=item.rotation;shape.centeredTransform={flipH:false,flipV:false};shape.fill={type:'solid',color:color(paint)};result.push(shape)
 }
 return result
}
export function patternSvg(p:PatternDefinition,options:PatternPlacement){
 const elements=assemblePattern(p,options),n=(v:number)=>round(v)
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(options.width)} ${n(options.height)}" width="100%" height="100%" role="img" aria-label="Геометрический паттерн">${elements.map(e=>{
  if(e.kind!=='path'&&e.kind!=='ellipse'&&e.kind!=='rectangle')return ''
  const b=e.bounds,c=e.fill!.color,fill='#'+[c.r,c.g,c.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join(''),path=e.pathData??(e.kind==='ellipse'?primitivePath({kind:'ellipse'},b.width,b.height):`M 0 0 L ${n(b.width)} 0 L ${n(b.width)} ${n(b.height)} L 0 ${n(b.height)} Z`)
  return `<g data-pattern-part="${e.id}" transform="translate(${n(b.x)} ${n(b.y)}) rotate(${e.rotation} ${n(b.width/2)} ${n(b.height/2)})"><path d="${path}" fill="${fill}"/></g>`
 }).join('')}</svg>`
}
