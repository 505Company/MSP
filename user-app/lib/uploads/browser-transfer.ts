import type { PreparedPresentation } from '../digital-designer/source-types'
import type { VisualManifest } from '../digital-designer/visual-package'
import type { ImportDescriptor,TransferObject } from './binary-contract'
import { SOURCE_SIZE_LABEL,TRANSFER_LIMITS } from './transfer-limits'

export async function uploadPreparedPresentation(file:File,prepared:PreparedPresentation,onProgress:(message:string)=>void,onTransfer?:(completed:number,total:number)=>void):Promise<Response>{
  if(file.size>TRANSFER_LIMITS.sourceBytes)throw new Error(`Выберите PPTX до ${SOURCE_SIZE_LABEL}`)
  const payloads=new Map<string,Blob>(),objects:TransferObject[]=[]
  const add=async(key:string,blob:Blob)=>{
    const limit=key.startsWith('asset-')?TRANSFER_LIMITS.resourceBytes:TRANSFER_LIMITS.previewBytes
    if(blob.size>limit)throw new Error(`Ресурс ${key} превышает ${limit/1024/1024} МБ`)
    payloads.set(key,blob)
    const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('')
    objects.push({key,mime:blob.type,sizeBytes:blob.size,sha256})
  }
  const visual:VisualManifest={renderer:prepared.renderer,previewKind:prepared.previewKind,snapshot:prepared.snapshot,
    assets:prepared.assets.map(({id,mime,extension,origins})=>({id,mime,extension,origins})),previews:[],sheets:[]}
  for(const asset of prepared.assets)await add(asset.id,new Blob([asset.bytes as Uint8Array<ArrayBuffer>],{type:asset.mime}))
  for(const p of prepared.previews){const blob=dataUrlBlob(p.dataUrl);await add(`preview-${p.id}`,blob);visual.previews.push({id:p.id,mime:blob.type})}
  for(const [index,s] of prepared.sheets.entries()){
    const id=`sheet-${index}`,blob=dataUrlBlob(s.dataUrl);await add(id,blob);visual.sheets.push({id,ids:s.ids,mime:blob.type})
  }
  if(objects.reduce((sum,o)=>sum+o.sizeBytes,0)>TRANSFER_LIMITS.totalResourceBytes)throw new Error('Суммарный объём ресурсов превышает 512 МБ')
  const descriptor:ImportDescriptor={fileName:file.name,sizeBytes:file.size,sourceHash:prepared.snapshot.sourceId,visual,objects}
  const body=JSON.stringify(descriptor)
  if(new Blob([body]).size>TRANSFER_LIMITS.manifestBytes)throw new Error('Структура шаблона слишком сложная: описание превышает 8 МБ')
  const created=await fetch('/api/uploads/binary',{method:'POST',headers:{'Content-Type':'application/json'},body})
  const session=await created.json() as {id:string;partBytes:number;error?:string}
  if(!created.ok)throw new Error(session.error??'Не удалось начать загрузку')
  const total=file.size+objects.reduce((sum,o)=>sum+o.sizeBytes,0);let done=0
  const progress=()=>{onProgress(`Сохраняем шаблон: ${Math.round(done/total*100)}%`);onTransfer?.(done,total)}
  progress()
  for(let start=0,n=1;start<file.size;start+=session.partBytes,n++){
    const part=file.slice(start,start+session.partBytes)
    await putWithRetry(`/api/uploads/binary/${session.id}/parts/${n}`,part)
    done+=part.size;progress()
  }
  for(const [key,blob] of payloads){await putWithRetry(`/api/uploads/binary/${session.id}/assets/${key}`,blob);done+=blob.size;progress()}
  onProgress('Проверяем целостность шаблона')
  return fetch(`/api/uploads/binary/${session.id}/complete`,{method:'POST'})
}

async function putWithRetry(url:string,body:Blob){
  for(let attempt=0;attempt<3;attempt++){
    let response:Response
    try{response=await fetch(url,{method:'PUT',body})}
    catch(error){if(attempt===2)throw error;await pause(attempt);continue}
    if(response.ok)return
    if(response.status>=500&&attempt<2){await response.body?.cancel();await pause(attempt);continue}
    const data=await response.json().catch(()=>({})) as {error?:string}
    throw new Error(data.error??'Не удалось передать часть шаблона')
  }
}
const pause=(attempt:number)=>new Promise(resolve=>setTimeout(resolve,300*(attempt+1)))
function dataUrlBlob(url:string){
  const [,mime,base64]=/^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(url)??[]
  if(!base64)throw new Error('Некорректное превью слайда')
  return new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:mime})
}
