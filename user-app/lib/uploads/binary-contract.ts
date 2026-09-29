import { z } from 'zod'
import { validateVisualManifest, type VisualManifest } from '../digital-designer/visual-package'
import { TRANSFER_LIMITS } from './transfer-limits'

export type TransferObject = { key:string; mime:string; sizeBytes:number; sha256:string }
export type ImportDescriptor = { fileName:string; sizeBytes:number; sourceHash:string; visual:VisualManifest; objects:TransferObject[] }
const hash=z.string().regex(/^[a-f0-9]{64}$/)
const schema=z.object({fileName:z.string().min(1).max(500).regex(/\.(pptx|pdf)$/i),sizeBytes:z.number().int().positive().max(TRANSFER_LIMITS.sourceBytes),
  sourceHash:hash,visual:z.unknown(),objects:z.array(z.object({key:z.string().regex(/^(?:asset-[a-f0-9]{24}|preview-[a-zA-Z0-9_-]{1,120}|sheet-[0-9]{1,3})$/),
    mime:z.string().max(100),sizeBytes:z.number().int().positive().max(TRANSFER_LIMITS.resourceBytes),sha256:hash})).max(2270)})

export function validateImportDescriptor(raw:unknown):ImportDescriptor {
  const value=schema.parse(raw), visual=validateVisualManifest(value.visual,value.sourceHash)
  const objects=new Map(value.objects.map(o=>[o.key,o]))
  if(objects.size!==value.objects.length)throw new Error('Duplicate transfer object')
  if(value.objects.reduce((sum,o)=>sum+o.sizeBytes,0)>TRANSFER_LIMITS.totalResourceBytes)throw new Error('Суммарный объём ресурсов превышает 512 МБ')
  const expected=[...visual.assets.map(a=>({key:a.id,mime:a.mime,size:visual.snapshot.assets.find(s=>s.id===a.id)!.byteLength})),
    ...visual.previews.map(p=>({key:`preview-${p.id}`,mime:p.mime,size:null})),...visual.sheets.map(s=>({key:s.id,mime:s.mime,size:null}))]
  if(expected.length!==objects.size)throw new Error('Transfer manifest mismatch')
  for(const e of expected){
    const o=objects.get(e.key)
    if(!o||o.mime!==e.mime||(e.size!==null&&o.sizeBytes!==e.size))throw new Error('Transfer manifest mismatch')
    if(e.size===null&&o.sizeBytes>TRANSFER_LIMITS.previewBytes)throw new Error('Preview too large')
    if(e.key.startsWith('asset-')&&e.key!==`asset-${o.sha256.slice(0,24)}`)throw new Error('Asset identity mismatch')
  }
  return {...value,visual}
}

export class TransferError extends Error {constructor(message:string,readonly status=400){super(message)}}

/** Bound the bytes actually read; Content-Length alone is neither required nor trusted. */
export async function readLimitedBody(request:Request,limit:number):Promise<Uint8Array>{
  const declared=Number(request.headers.get('content-length'))
  if(Number.isFinite(declared)&&declared>limit)throw new TransferError('Часть загрузки превышает допустимый размер',413)
  if(!request.body)return new Uint8Array()
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength
      if(size>limit){await reader.cancel();throw new TransferError('Часть загрузки превышает допустимый размер',413)}
      chunks.push(value)
    }
  }finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return bytes
}
