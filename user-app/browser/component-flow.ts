import { toPng } from 'html-to-image'
import type { EditableTemplate, EditableData, EditableCatalog } from '../lib/design-system/editable-contract'
import { COMPONENT_FLOW_VERSION, flowCases, proposeComponentFlow, flowProfileKey, type ComponentFlow, type ComponentFlowReport } from '../lib/design-system/component-adaptation'
import { flowElements, flowGeometry, flowIssues, type FlowMeasurement } from '../lib/design-system/component-flow-layout'
import { renderTextSvg } from '../vendor/drag/src/formats/pptx/preview'
import { prepareLayoutFonts } from './layout-fonts'
import { ensureSceneFonts } from './fonts'
const esc=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))

export function decoration(t:EditableTemplate,p:ComponentFlow) {
  const cut=Math.min(t.width/3,t.height/3,p.padding/p.fontScale),xs=[0,cut,t.width-cut,t.width],ys=[0,cut,t.height-cut,t.height]
  return `<div aria-hidden="true" style="position:absolute;inset:0;display:grid;grid-template-columns:${cut*p.fontScale}px minmax(0,1fr) ${cut*p.fontScale}px;grid-template-rows:${cut*p.fontScale}px minmax(0,1fr) ${cut*p.fontScale}px;pointer-events:none;">${[0,1,2].flatMap(y=>[0,1,2].map(x=>`<svg width="100%" height="100%" viewBox="${xs[x]} ${ys[y]} ${xs[x+1]-xs[x]} ${ys[y+1]-ys[y]}" preserveAspectRatio="none" style="overflow:hidden">${t.sourceLayout!.graphic.replace('width="100%" height="100%"',`width="${t.width}" height="${t.height}"`)}</svg>`)).join('')}</div>`
}
/** Source artwork is nine-sliced; content is independently measured in a flow.
 * No source text is truncated, and the native template is never modified. */
export async function renderComponentFlow(node:HTMLElement,t:EditableTemplate,data:EditableData,width:number,step=0,forceStack=false):Promise<FlowMeasurement> {
  const p=proposeComponentFlow(t);if(!p)throw Error('UNSUPPORTED_COMPONENT_FLOW')
  node.style.cssText=`position:relative;width:${width}px;min-width:0;`
  const elements=flowElements(t,data,p,step),layout=flowGeometry(p,width,[0,0],forceStack?'stack':undefined),renders: {render:Awaited<ReturnType<typeof renderTextSvg>>;top:number;height:number}[]=[]
  for(const [i,e] of elements.entries()) {
    e.bounds={x:0,y:0,width:layout.boxes[i].width,height:10000}
    e.textBox={align:'LEFT',...e.textBox,vertical:'TOP',wrap:i!==p.metric}
    const render=await renderTextSvg(e),top=Math.min(0,render.ink.top)
    renders.push({render,top,height:Math.max(e.fontSize*1.12,render.ink.bottom-top)})
  }
  if(layout.direction==='row' && (renders[p.metric].render.ink.right>layout.boxes[p.metric].width+1 || Math.max(...renders.map(r=>r.height))+p.padding*2>p.maxHeight))return renderComponentFlow(node,t,data,width,step,true)
  const geometry=flowGeometry(p,width,renders.map(r=>r.height),layout.direction)
  node.style.height=`${geometry.height}px`
  const measurement:FlowMeasurement={width,height:geometry.height,fontStep:step,direction:geometry.direction,fields:elements.map((e,i)=>{
    const {render,top}=renders[i],box=geometry.boxes[i]
    return {sourceId:e.id,text:e.text,fontSize:Math.min(e.fontSize,...e.styleRuns?.map(r=>r.fontSize)??[]),box,ink:{x:box.x+render.ink.left,y:box.y+render.ink.top-top,width:render.ink.right-render.ink.left,height:render.ink.bottom-render.ink.top}}
  })}
  node.innerHTML=decoration(t,p)+elements.map((e,i)=>{const b=geometry.boxes[i],r=renders[i];return `<svg data-flow-text="${esc(e.id)}" data-adaptive-native-text="${esc(e.id)}" style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;overflow:visible" viewBox="0 0 ${b.width} ${b.height}" aria-label="${esc(e.text)}"><g transform="translate(0 ${-r.top})">${r.render.svg}</g></svg>`}).join('')
  return measurement
}
async function pixels(src:string) {const im=new Image();im.src=src;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(im,0,0);return {width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height).data}}
export async function flowPixelEvidence(node:HTMLElement,m:FlowMeasurement,capture=()=>toPng(node,{cacheBust:false,pixelRatio:1,skipFonts:false})) {
  const visible=await capture(),nodes=[...node.querySelectorAll<SVGSVGElement>('[data-flow-text]')]
  let hidden:string
  try{nodes.forEach(n=>n.style.visibility='hidden');hidden=await capture()}finally{nodes.forEach(n=>n.style.removeProperty('visibility'))}
  const a=await pixels(visible),b=await pixels(hidden)
  if(a.width!==b.width||a.height!==b.height)throw Error('FLOW_PIXEL_DIMENSIONS')
  return {preview:visible,pixels:m.fields.map(f=>{let count=0;for(let y=Math.max(0,Math.floor(f.ink.y));y<Math.min(a.height,Math.ceil(f.ink.y+f.ink.height));y++)for(let x=Math.max(0,Math.floor(f.ink.x));x<Math.min(a.width,Math.ceil(f.ink.x+f.ink.width));x++){const at=(y*a.width+x)*4;if([0,1,2].some(c=>Math.abs(a.data[at+c]-b.data[at+c])>25))count++}return count})}
}
function setSlot(t:EditableTemplate,data:EditableData,index:number,value:string) {
  const b=t.sourceLayout!.text[index].binding
  if(b.field==='metric'){data.value=value;data.unit=''}else if(b.field==='item'){const i=b.id?data.items!.find(i=>i.id===b.id)!:data.items![b.index??0];i[b.part??'text']=value}else data[b.field]=value
}
export async function qualifyComponentFlows(catalog:EditableCatalog,signal?:AbortSignal,onProgress?:(done:number,total:number)=>void,uploadId?:string):Promise<ComponentFlowReport> {
  const checks:ComponentFlowReport['checks']=[],passed=new Set(catalog.qualification?.checks.filter(c=>c.passed).map(c=>c.id)),templates=catalog.families.flatMap(f=>f.variants).filter(t=>passed.has(t.id)&&proposeComponentFlow(t))
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-20000px;top:0;pointer-events:none';host.setAttribute('aria-hidden','true');document.body.appendChild(host)
  try{for(const t of templates){signal?.throwIfAborted();const p=proposeComponentFlow(t)!,cases:ComponentFlowReport['checks'][number]['cases']=[],issues:string[]=[]
    let fontCss=''
    if(uploadId){const families=[...new Set(t.sourceLayout!.text.flatMap(s=>[s.element.fontFamily,...s.element.styleRuns?.map(r=>r.fontFamily)??[]]))];try{const exact=await prepareLayoutFonts({uploadId,fonts:families.map((family,i)=>({id:`flow-${i}`,family}))});fontCss=Object.values(exact.css).join('\n');if(exact.fontTokens.length!==families.length)issues.push('Исходный шрифт недоступен для экспорта')}catch{issues.push('Исходный шрифт недоступен для экспорта')}}
    const fonts=await ensureSceneFonts(t.sourceLayout!.text.map(s=>s.element));issues.push(...fonts.filter(f=>f.severity!=='warning').map(f=>f.message))
    for(const c of flowCases){signal?.throwIfAborted();const data=structuredClone(t.data);setSlot(t,data,p.metric,c.value);setSlot(t,data,p.caption,c.caption)
      let m:FlowMeasurement|undefined,errors:string[]=[]
      for(let step=0;step<=4;step++){m=await renderComponentFlow(host,t,data,c.width,step);errors=flowIssues(m,t,data,p);if(!errors.length)break}
      const evidence=c.expected&& !errors.length?await flowPixelEvidence(host,m!,()=>toPng(host,{pixelRatio:1,fontEmbedCSS:fontCss})):{pixels:[]}
      if(c.expected&&evidence.pixels.some(n=>n<3))errors.push('text-pixels-missing')
      cases.push({name:c.name,width:c.width,height:m!.height,passed:!errors.length,expected:c.expected,issues:errors,pixels:evidence.pixels})
    }
    checks.push({id:t.id,name:t.name,profile:await flowProfileKey(t),passed:!issues.length&&cases.every(c=>c.passed===c.expected),cases,issues});onProgress?.(checks.length,templates.length)
  }}finally{host.remove()}
  return {version:COMPONENT_FLOW_VERSION,catalogId:catalog.id,checks}
}
