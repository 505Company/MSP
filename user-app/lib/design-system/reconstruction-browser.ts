import {graphicParts,instantiateGraphicPart,GRAPHIC_COMPONENTS_VERSION,type GraphicPartsReport} from './graphic-components'
import {graphicHtml} from './diagram-graph'
import {fitDiagramText} from './diagram-text-fit'
import {renderSlidePreview} from '../../vendor/drag/src/formats/pptx/preview'
import {parsePageIR} from '../../vendor/drag/src/core/page-ir'
import {ensureSceneFonts,ensureUploadFonts} from '../../browser/fonts'
import {hydrateEditableHtml} from './editable-hydrate'
import {assemblePattern,patternSvg} from './pattern-geometry'
import {graphElements,diagramHtml} from './diagram-graph'
import type {ElementIR} from '../../vendor/drag/src/core/model'
import type {DesignProgressReporter} from '../uploads/design-progress'
import {flatten} from './compiler'
import {RECONSTRUCTION_VERSION,type ReconstructionResult,type ReconstructionState} from './reconstruction-contract'
export async function graphicPixels(url:string,width?:number,height?:number,signal?:AbortSignal){
 signal?.throwIfAborted()
 const image=new Image();image.src=url;const abort=()=>{image.src=''};signal?.addEventListener('abort',abort,{once:true});try{await image.decode()}finally{signal?.removeEventListener('abort',abort);signal?.throwIfAborted()}const ratio=Math.min(1,512/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=width??Math.max(24,Math.round(image.width*ratio));canvas.height=height??Math.max(24,Math.round(image.height*ratio));const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0,canvas.width,canvas.height);return ctx.getImageData(0,0,canvas.width,canvas.height)
}
export function compareGraphicPixels(a:ImageData,b:ImageData){
 if(a.width!==b.width||a.height!==b.height)throw Error('Размеры превью не совпадают')
 // Premultiplied RGBA makes transparent white pieces distinguishable from an
 // empty canvas; averaging over background alone cannot hide lost foreground.
 let error=0,foreground=0,matched=0
 const bg=[0,1,2].map(c=>a.data[c]*a.data[3]/255+220*(1-a.data[3]/255))
 const rgb=(data:Uint8ClampedArray,i:number)=>[0,1,2].map(c=>data[i+c]*data[i+3]/255+220*(1-data[i+3]/255))
 for(let i=0;i<a.data.length;i+=4){const ac=rgb(a.data,i),bc=rgb(b.data,i),diff=ac.reduce((n,v,c)=>n+Math.abs(v-bc[c]),0)/(3*255);error+=diff
  if(ac.some((v,c)=>Math.abs(v-bg[c])>24)){foreground++;if(diff<.12)matched++}
 }
 return {pixelError:error/(a.width*a.height),foregroundRecall:foreground?matched/foreground:0}
}
export async function scenePreview(elements:ElementIR[],width:number,height:number,uploadId:string,signal?:AbortSignal,maxEdge=512){
 signal?.throwIfAborted()
 const issues=await ensureSceneFonts(elements);signal?.throwIfAborted();if(issues.length)throw Error(issues[0].message)
 const assets=await Promise.all([...new Set(flatten(elements).flatMap(e=>e.kind==='raster'?[e.assetId]:[]))].map(async id=>{const r=await fetch(`/api/uploads/${uploadId}/assets/${id}`,{signal});if(!r.ok)throw Error('Исходная графика недоступна');return {id,bytes:new Uint8Array(await r.arrayBuffer())}}))
 signal?.throwIfAborted()
 return renderSlidePreview(parsePageIR({schemaVersion:1,id:'reconstruction-check',sourceIndex:0,width,height,elements,assets,degradations:[]}),maxEdge,undefined,true)
}
export async function qualifyGraphic(r:ReconstructionResult,uploadId:string,signal?:AbortSignal){
 signal?.throwIfAborted()
 const issues:string[]=[],qualification={version:RECONSTRUCTION_VERSION,passed:false,changed:false,issues,pixelError:1,foregroundRecall:0}
 const preview=(elements:ElementIR[],width:number,height:number,id:string)=>scenePreview(elements,width,height,id,signal)
 const pixels=(url:string,width?:number,height?:number)=>graphicPixels(url,width,height,signal)
 const host=document.createElement('div')
 try{
  const p=r.pattern,g=r.diagram;if(!p&&!g)throw Error('Нет редактируемой геометрии')
  if(g?.origin==='reconstructed'&&r.candidate.assetId){
   const image=await pixels(`/api/uploads/${uploadId}/assets/${r.candidate.assetId}`,g.width,g.height),candidate=structuredClone(g)
   const fitted=await fitDiagramText(candidate,image,r.fonts??[])
   for(const f of fitted){const node=candidate.nodes.find(n=>n.id===f.nodeId)!;node.elements=node.elements.flatMap(e=>e.id===f.sourceTextId?f.elements:[e])}
   if(fitted.length){
    const before=compareGraphicPixels(image,await pixels(await preview(graphElements(g),g.width,g.height,uploadId),g.width,g.height)),after=compareGraphicPixels(image,await pixels(await preview(graphElements(candidate),g.width,g.height,uploadId),g.width,g.height))
    if(after.pixelError<before.pixelError&&after.foregroundRecall>=before.foregroundRecall){Object.assign(g,candidate);r.textCalibration=fitted}
   }
  }
  const width=p?.width??g!.width,height=p?.height??g!.height,elements=p?assemblePattern(p,{width,height}):graphElements(g!)
  const url=await preview(elements,width,height,uploadId),actual=await pixels(url)
  const original=r.candidate.assetId?await pixels(`/api/uploads/${uploadId}/assets/${r.candidate.assetId}`,actual.width,actual.height):await pixels(await preview(g!.sourceElements!,width,height,uploadId),actual.width,actual.height)
  Object.assign(qualification,compareGraphicPixels(original,actual))
  if(qualification.pixelError>.025||qualification.foregroundRecall<.97)issues.push('Восстановление отличается от исходного изображения')
  host.innerHTML=p?patternSvg(p,{width,height}):diagramHtml(g!,uploadId);const fonts=await hydrateEditableHtml(host);issues.push(...fonts)
  if(host.querySelector('[data-native-overflow="true"]'))issues.push('Текст выходит за границы')
  if(p){for(const size of [{width:800,height:300},{width:300,height:800}])await preview(assemblePattern(p,{...size,mode:'fill',seed:3}),size.width,size.height,uploadId)}
  else{
   const node=g!.nodes.find(n=>n.kind==='block'&&n.bounds.x+n.bounds.width+8<width)
   if(!node)throw Error('Нет пространства для проверки перемещения')
   const text=flatten(node.elements).find(e=>e.kind==='text'),changes={nodes:{[node.id]:{x:node.bounds.x+8}},texts:text?.kind==='text'?{[text.id]:'73'}:{}}
   const changed=graphElements(g!,changes);await preview(changed,width,height,uploadId);host.innerHTML=diagramHtml(g!,uploadId,changes);issues.push(...await hydrateEditableHtml(host));if(host.querySelector('[data-native-overflow="true"]'))issues.push('Новые данные не помещаются')
  }
  qualification.changed=true;qualification.passed=!issues.length
 }catch(e){issues.push(e instanceof Error?e.message:'Не удалось проверить графику')}
 signal?.throwIfAborted()
 return qualification
}
/** Component operability is independent of the observed composition's pixels. */
export async function qualifyGraphicParts(result:ReconstructionResult,uploadId:string,signal?:AbortSignal):Promise<GraphicPartsReport>{
 signal?.throwIfAborted()
 const checks:GraphicPartsReport['checks']=[]
 for(const p of graphicParts(result)){
  signal?.throwIfAborted()
  const issues:string[]=[];let changed=false
  try{
   if(result.diagram?.warnings.some(w=>!/исходные линии сохранены/i.test(w)))throw Error('Распознавание содержит неоднозначность; требуется уточнение')
   const cases=[{width:p.scene.width,height:p.scene.height},{width:p.scene.width*1.5,height:p.scene.height*1.5,...(p.slots.length?{values:{[p.slots[0].id]:/^[\d\s.,%+-]+$/.test(p.slots[0].defaultText)?'73':'Новые данные'}}:{})},{width:p.scene.width*1.6,height:p.scene.height*1.25}]
   for(const options of cases){const scene=instantiateGraphicPart(p,options);await scenePreview(scene.elements,scene.width,scene.height,uploadId,signal);const host=document.createElement('div');host.innerHTML=graphicHtml(scene.elements,scene.width,scene.height,uploadId);issues.push(...await hydrateEditableHtml(host));if(host.querySelector('[data-native-overflow="true"]'))issues.push('Текст не помещается в компонент')}
   changed=true
  }catch(e){issues.push(e instanceof Error?e.message:'Компонент не прошёл проверку')}
  signal?.throwIfAborted()
  checks.push({id:p.id,passed:!issues.length,changed,issues:[...new Set(issues)]})
 }
 return {version:GRAPHIC_COMPONENTS_VERSION,checks}
}
export async function runGraphicReconstruction(uploadId:string,onProgress:(message:string)=>void,signal:AbortSignal,report?:DesignProgressReporter){
 const base=`/api/uploads/${uploadId}/reconstruction`,read=async()=>{const r=await fetch(base,{signal}),s=await r.json() as ReconstructionState&{error?:string};if(!r.ok)throw Error(s.error);return s}
 let state=await read()
 const reportRecognition=()=>report?.({step:'graphics',scope:'recognition',detail:'Выделяем схемы и детали паттернов',completed:state.completed,total:state.total})
 reportRecognition()
 while(state.pending.length){
  const candidate=state.pending[0];signal.throwIfAborted();onProgress(`Восстанавливаем графику: ${state.completed+1} из ${state.total}`)
  const pixels=candidate.assetId?await graphicPixels(`/api/uploads/${uploadId}/assets/${candidate.assetId}`,undefined,undefined,signal):null
  let rgba='';if(pixels){for(let i=0;i<pixels.data.length;i+=16384)rgba+=String.fromCharCode(...pixels.data.subarray(i,i+16384));rgba=btoa(rgba)}
  const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state.revision,candidateId:candidate.id,...(pixels?{pixels:{width:pixels.width,height:pixels.height,rgba}}:{})}),signal})
  const body=await response.text();if(!response.ok||!body.includes('"complete":true'))throw Error('Распознавание прервалось. Готовые результаты сохранены.')
  state=await read()
  reportRecognition()
 }
 const unchecked=state.results.filter(r=>r.status==='pending-check');let checked=0
 report?.({step:'graphics',scope:'visual-check',detail:'Сравниваем восстановленную графику с исходником',completed:0,total:unchecked.length})
 for(const r of unchecked){
  signal.throwIfAborted();onProgress('Сравниваем восстановленную графику с исходником…');const qualification=await qualifyGraphic(r,uploadId,signal)
  const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state.revision,candidateId:r.id,qualification,textCalibration:r.textCalibration??[]}),signal});if(!response.ok)throw Error('Не удалось сохранить проверку графики')
  report?.({step:'graphics',scope:'visual-check',detail:'Сравниваем восстановленную графику с исходником',completed:++checked,total:unchecked.length})
 }
 state=await read()
 const parts=state.results.filter(r=>(r.diagram||r.pattern)&&r.partsQualification?.version!==GRAPHIC_COMPONENTS_VERSION);let checkedParts=0
 report?.({step:'graphics',scope:'parts-check',detail:'Проверяем блоки, связи и детали паттернов',completed:0,total:parts.length})
 for(const result of parts){
  signal.throwIfAborted();onProgress('Проверяем блоки, связи и детали паттернов…');const partsQualification=await qualifyGraphicParts(result,uploadId,signal),response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state.revision,candidateId:result.id,partsQualification}),signal});if(!response.ok)throw Error('Не удалось сохранить проверку компонентов')
  report?.({step:'graphics',scope:'parts-check',detail:'Проверяем блоки, связи и детали паттернов',completed:++checkedParts,total:parts.length})
 }
 return (await read()).catalog
}

/** Upgrade only diagrams already present as native source objects. This path
 * cannot call recognition for an image or retry a paid model stage. */
export async function prepareNativeDiagrams(uploadId:string,initial:ReconstructionState,signal:AbortSignal){
 const base=`/api/uploads/${uploadId}/reconstruction`
 const read=async()=>{const r=await fetch(base,{signal}),body=await r.json() as ReconstructionState&{error?:string};if(!r.ok)throw Error(body.error||'Не удалось прочитать схемы');return body}
 const post=async(body:unknown)=>{const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal}),text=await r.text();if(!r.ok)throw Error('Не удалось сохранить проверку схемы');return text}
 let state=initial
 if(state.pending.some(c=>c.graph)||state.results.some(r=>r.candidate.graph&&(r.status==='pending-check'||r.partsQualification?.version!==GRAPHIC_COMPONENTS_VERSION)))await ensureUploadFonts(uploadId)
 for(const candidate of state.pending.filter(c=>c.graph)){
  const text=await post({revision:state.revision,candidateId:candidate.id,nativeOnly:true})
  if(!text.includes('"complete":true'))throw Error('Проверка схемы прервалась; готовые результаты сохранены')
 }
 if(state.pending.some(c=>c.graph))state=await read()
 let changed=false
 for(const result of state.results.filter(r=>r.candidate.graph&&r.diagram)){
  if(result.status==='pending-check'){
   const qualification=await qualifyGraphic(result,uploadId,signal)
   await post({revision:state.revision,candidateId:result.id,qualification});changed=true
  }
  if(result.partsQualification?.version!==GRAPHIC_COMPONENTS_VERSION){
   const partsQualification=await qualifyGraphicParts(result,uploadId,signal)
   await post({revision:state.revision,candidateId:result.id,partsQualification});changed=true
  }
 }
 return changed?read():state
}
