import {assembleBackground} from '../lib/design-system/backgrounds'
import {graphicHtml} from '../lib/design-system/diagram-graph'
import type {StudioLibrary} from '../lib/presentations/studio/contract'
import type {BackgroundSelection} from '../lib/design-system/backgrounds'
const assets=new Map<string,Promise<string>>()
/** Store the observed graphic in the receipt itself, so the exported HTML
 * keeps the exact background without relying on a running local API. */
export async function studioBackground(library:StudioLibrary,selection:BackgroundSelection){
 return portableStudioAssets(graphicHtml(assembleBackground(library.backgrounds!,selection,{width:1920,height:1080}).elements,1920,1080,library.uploadId),library.uploadId)
}
export async function portableStudioAssets(html:string,uploadId:string){
 const el=document.createElement('div');el.innerHTML=html
 for(const image of el.querySelectorAll<SVGImageElement>('image')){
  const href=image.getAttribute('href')??'';if(!href.startsWith(`/api/uploads/${encodeURIComponent(uploadId)}/assets/`))continue
  let value=assets.get(href)
  if(!value){value=(async()=>{const response=await fetch(href);if(!response.ok)throw Error('Не удалось загрузить графику выбранной дизайн-системы.');const blob=await response.blob();return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Не удалось сохранить графику фона.'));reader.readAsDataURL(blob)})})();assets.set(href,value);void value.catch(()=>assets.delete(href))}
  image.setAttribute('href',await value)
 }
 return el.innerHTML
}
