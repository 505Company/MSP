import type {TextElementIR} from '../../vendor/drag/src/core/model'
import {renderTextSvg} from '../../vendor/drag/src/formats/pptx/preview'
import {ensureSceneFonts} from '../../browser/fonts'
import {scaleText} from '../../vendor/drag/src/core/text-flow'
const glyphChecks=new Map<string,Promise<{r:number;g:number;b:number;a:number}>>()
/** Recovery is limited to an isolated translucent/transparent glyph image.
 * Opaque photographs and multicoloured illustrations cannot pass this gate. */
export function glyphInk(url:string){
 let check=glyphChecks.get(url)
 if(!check){check=(async()=>{
  const image=new Image();image.src=url;await image.decode()
  const canvas=document.createElement('canvas');canvas.width=Math.min(512,image.naturalWidth);canvas.height=Math.max(1,Math.round(canvas.width*image.naturalHeight/image.naturalWidth))
  if(canvas.height>2048)throw Error('Изображение значения требует отдельного распознавания')
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0,canvas.width,canvas.height)
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,channels:[number[],number[],number[]]=[[],[],[]];let transparent=0
  for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]<30)transparent++;if(pixels[i+3]>180)for(let c=0;c<3;c++)channels[c].push(pixels[i+c])}
  if(transparent/(pixels.length/4)<.15||!channels[0].length)throw Error('Значение не подтверждено как отдельное изображение текста')
  for(const values of channels){values.sort((a,b)=>a-b);if(values[Math.floor(values.length*.95)]-values[Math.floor(values.length*.05)]>115)throw Error('Сложная графика сохранена без преобразования в число')}
  return {r:channels[0][Math.floor(channels[0].length/2)]/255,g:channels[1][Math.floor(channels[1].length/2)]/255,b:channels[2][Math.floor(channels[2].length/2)]/255,a:1}
 })();glyphChecks.set(url,check);void check.catch(()=>glyphChecks.delete(url))}
 return check
}
/** Hydrate measured native text without rasterizing it. Shape geometry stays in SVG. */
export async function hydrateEditableHtml(root:HTMLElement,options:{loadFonts?:boolean}={}){
 const nodes=[...root.querySelectorAll<SVGSVGElement>('[data-native-text]')]
 const sources=nodes.map(node=>JSON.parse(node.dataset.nativeText!) as TextElementIR)
 const recoveryIssues:string[]=[]
 for(const [i,node]of nodes.entries())if(node.dataset.recoveredMetric){try{
  const ink=await glyphInk(node.dataset.recoveredMetric);sources[i].colorRuns=[{start:0,end:sources[i].text.length,fill:{type:'solid',color:ink}}]
 }catch(error){recoveryIssues.push(error instanceof Error?error.message:'Не удалось проверить изображение значения')}}
 const fontIssues=options.loadFonts===false?[]:await ensureSceneFonts(sources)
 const viewports=new Map<HTMLElement,{left:number;top:number;right:number;bottom:number}>()
 for(const [i,node] of nodes.entries()){
  const original=JSON.parse(node.dataset.nativeSource!) as TextElementIR
  const fit=sources[i].text!==original.text&&sources[i].flow?.autoFit==='SHRINK'
  // A source frame may intentionally be smaller than its ink (large metrics).
  // Try the original font size first; fitting uses the permitted source ink,
  // not the frame's flow height, so an equally short new number stays the same size.
  const measured=fit?{...sources[i],flow:{...sources[i].flow!,autoFit:'NONE' as const}}:sources[i]
  let result=await renderTextSvg(measured)
  // PPTX bottom-anchored large numbers can intentionally extend above their
  // text frame. Retain that measured source ink area, but reject NEW overflow.
  const source=node.dataset.nativeText===node.dataset.nativeSource?result:await renderTextSvg(original)
  const b=original.bounds,allowed={left:Math.min(0,source.ink.left),top:Math.min(0,source.ink.top),right:Math.max(b.width,source.ink.right),bottom:Math.max(b.height,source.ink.bottom)}
  const frame=node.parentElement as unknown as SVGSVGElement,view=frame.viewBox.baseVal
  const layout=node.closest<HTMLElement>('[data-native-layout]')
  // Native text frames are flow boxes, not glyph bounds. Detached large
  // numbers may paint beyond them in PPTX; include that measured SOURCE ink
  // in the component viewport without granting extra space to changed text.
  const sourceBounds={left:Math.min(view.x,b.x+source.ink.left),top:Math.min(view.y,b.y+source.ink.top),right:Math.max(view.x+view.width,b.x+source.ink.right),bottom:Math.max(view.y+view.height,b.y+source.ink.bottom)}
  if(layout){const old=viewports.get(layout);viewports.set(layout,old?{left:Math.min(old.left,sourceBounds.left),top:Math.min(old.top,sourceBounds.top),right:Math.max(old.right,sourceBounds.right),bottom:Math.max(old.bottom,sourceBounds.bottom)}:sourceBounds)}
  const outside=(ink:typeof result.ink)=>ink.left<allowed.left-3||ink.top<allowed.top-3||ink.right>allowed.right+3||ink.bottom>allowed.bottom+3||b.x+ink.left<sourceBounds.left-3||b.y+ink.top<sourceBounds.top-3||b.x+ink.right>sourceBounds.right+3||b.y+ink.bottom>sourceBounds.bottom+3
  // Flow metrics can fit while a substituted font's actual glyph ink protrudes.
  // Fit changed content using measured ink; preserve the original source style.
  if(fit)for(let scale=.94;outside(result.ink)&&scale>=.45;scale-=.06)result=await renderTextSvg(scaleText(measured,scale))
  node.innerHTML=result.svg;node.dataset.nativeOverflow=String(outside(result.ink))
 }
 for(const [layout,b] of viewports){
  const width=b.right-b.left,height=b.bottom-b.top
  layout.style.aspectRatio=`${width} / ${height}`
  for(const layer of [...layout.children].filter(e=>e.tagName.toLowerCase()==='svg'))layer.setAttribute('viewBox',`${b.left} ${b.top} ${width} ${height}`)
 }
 root.dataset.fontWarnings=JSON.stringify(fontIssues.filter(i=>i.severity==='warning').map(i=>i.message))
 return [...recoveryIssues,...fontIssues.filter(i=>i.severity!=='warning').map(i=>i.message)]
}
