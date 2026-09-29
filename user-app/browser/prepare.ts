import { readPresentation } from './presentation-source'
import type { PreparedPresentation } from '../lib/digital-designer/source-types'
export { renderComponent } from './component-execution'
export { renderNewSlide, exportNewSlide } from './slide-execution'
export { prepareDeckEvidence, renderDeckSlide } from './deck-execution'
export { qualifyComponent } from './component-qualification'
export const executionVersion = 15 as const
export async function rereadSourceSlides(bytes: Uint8Array, name: string, slides: number[], signal?: AbortSignal) {
  return readPresentation(bytes, name, signal, undefined, slides)
}
export const transferVersion = 2 as const
export async function preparePresentation(bytes: Uint8Array, name: string, onProgress?: (current:number,total:number)=>void):Promise<PreparedPresentation> {
  if(/\.pdf$/i.test(name)){
    const scope=window as typeof window&{MspPdfReader?:{executionVersion:number;preparePdf(bytes:Uint8Array,name:string,progress?:typeof onProgress):Promise<PreparedPresentation>}}
    if(scope.MspPdfReader?.executionVersion!==2)await new Promise<void>((resolve,reject)=>{const script=document.createElement('script');script.src='/pdf-reader.js?v=binary-2';script.onload=()=>resolve();script.onerror=()=>reject(new Error('Не удалось загрузить PDF-читатель'));document.head.appendChild(script)})
    if(scope.MspPdfReader?.executionVersion!==2)throw new Error('PDF-читатель недоступен')
    return scope.MspPdfReader.preparePdf(bytes,name,onProgress)
  }
  const result = await readPresentation(bytes, name, undefined, onProgress)
  const originals = result.assets.filter(a=>a.origins.some(o=>/^ppt\/media\//.test(o)))
  const sheets: { ids:string[];dataUrl:string }[]=[]
  for(let start=0;start<originals.length;start+=12){
    const batch=originals.slice(start,start+12), canvas=document.createElement('canvas');canvas.width=1200;canvas.height=Math.ceil(batch.length/4)*210
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#e5e7eb';ctx.fillRect(0,0,canvas.width,canvas.height)
    const ids:string[]=[]
    for(const [i,asset] of batch.entries()){
      if(!['image/png','image/jpeg','image/webp'].includes(asset.mime))continue
      const url=URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)],{type:asset.mime}))
      try {
        const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url})
        const scale=Math.min(285/image.width,175/image.height),x=i%4*300,y=Math.floor(i/4)*210
        ctx.fillStyle='#888';ctx.fillRect(x,y+24,294,180);ctx.drawImage(image,x+(294-image.width*scale)/2,y+24+(180-image.height*scale)/2,image.width*scale,image.height*scale)
        ctx.fillStyle='#111';ctx.font='bold 21px Arial';ctx.fillText(`image${String(start+i+1).padStart(2,'0')}`,x+3,y+20);ids.push(asset.id)
      } catch { /* Unsupported resources remain downloadable without visual claims. */ }
      finally { URL.revokeObjectURL(url) }
    }
    if(ids.length)sheets.push({ids,dataUrl:canvas.toDataURL('image/jpeg',.85)})
    canvas.width=canvas.height=1
  }
  return { ...result, sheets, renderer: 'msp-web-2026-09-29', previewKind:'reconstruction' }
}
