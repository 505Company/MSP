import { z } from 'zod'
import { sha256 } from '../uploads/pptx-profiler'
import type { VisualPackage, SourceSnapshot } from './source-types'
import { TRANSFER_LIMITS } from '../uploads/transfer-limits'
import { nativeObjectSchema } from '../design-system/native-contract'

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/)
const boundedText = z.string().max(200000)
const assetSchema = z.object({ id: z.string().regex(/^asset-[a-f0-9]{24}$/), mime: z.enum(['image/png','image/jpeg','image/webp','image/svg+xml','application/octet-stream']), extension: z.enum(['png','jpg','webp','svg','bin']), origins: z.array(z.string().max(400)).max(500), base64: z.string().max(12000000) })
const snapshotSchema = z.object({
  schemaVersion:z.literal(1), sourceId:z.string().regex(/^[a-f0-9]{64}$/), name:z.string().max(500), slideCount:z.number().int().min(1).max(100),
  slides:z.array(z.object({id,number:z.number().int().min(1).max(100),width:z.number().positive().max(100000),height:z.number().positive().max(100000),part:z.string().max(400),text:boundedText,warnings:z.array(z.string().max(3000)).max(3000)})).max(100),
  elements:z.array(z.object({id,slide:z.number().int().min(1).max(100),kind:z.string().max(60),name:z.string().max(1000),properties:z.record(z.unknown()),parentId:id.optional()})).max(20000),
  assets:z.array(z.object({id,mime:z.string().max(100),byteLength:z.number().int().nonnegative().max(TRANSFER_LIMITS.resourceBytes),origins:z.array(z.string().max(400)).max(500)})).max(2000),
  colors:z.array(z.object({hex:z.string().regex(/^#[a-f0-9]{6}$/i),occurrences:z.number().int().positive()})).max(10000),
  fonts:z.array(z.object({family:z.string().max(200),sizes:z.array(z.number().positive().max(10000)).max(1000),occurrences:z.number().int().positive()})).max(1000),
  limitations:z.array(z.string().max(3000)).max(100),
})
const dataUrl = z.string().max(3000000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/)
export const parseSourceSnapshot = (raw: unknown): SourceSnapshot => snapshotSchema.parse(raw)
const packageSchema=z.object({renderer:z.enum(['drag-checkpoint-2026-09-24','msp-web-2026-09-25','msp-web-2026-09-29']),previewKind:z.literal('reconstruction'),snapshot:snapshotSchema,assets:z.array(assetSchema).max(2000),previews:z.array(z.object({id,dataUrl})).max(100),sheets:z.array(z.object({ids:z.array(id).min(1).max(12),dataUrl})).max(170)})
export function decodeDataUrl(url:string) {const [,mime,data]=/^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(url) ?? [];if(!data)throw new Error('Invalid preview');return {mime,bytes:Uint8Array.from(atob(data),c=>c.charCodeAt(0))}}
export async function validateVisualPackage(raw:unknown,sourceHash:string):Promise<VisualPackage>{
  const value=packageSchema.parse(raw)
  if(JSON.stringify(value).length>40_000_000)throw new Error('Visual package too large')
  validateReferences(value,sourceHash)
  for(const asset of value.assets){
    const bytes=Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0))
    if(`asset-${(await sha256(bytes)).slice(0,24)}`!==asset.id)throw new Error('Asset hash mismatch')
    const manifest=value.snapshot.assets.find(a=>a.id===asset.id)
    if(!manifest||manifest.byteLength!==bytes.length||manifest.mime!==asset.mime)throw new Error('Asset manifest mismatch')
    validateImageSignature(bytes,asset.mime)
  }
  return value as VisualPackage
}
function validateReferences(value:{snapshot:SourceSnapshot;assets:Array<{id:string;mime:string}>;previews:Array<{id:string}>;sheets:Array<{ids:string[]}>},sourceHash:string){
  const s=value.snapshot
  if(s.sourceId!==sourceHash||s.slides.length!==s.slideCount)throw new Error('Visual source mismatch')
  const slideIds=new Set(s.slides.map(x=>x.id)),elements=new Map(s.elements.map(e=>[e.id,e])),assets=new Set(value.assets.map(a=>a.id)),numbers=new Set(s.slides.map(s=>s.number))
  if(slideIds.size!==s.slides.length||elements.size!==s.elements.length||assets.size!==value.assets.length||numbers.size!==s.slides.length)throw new Error('Duplicate identity')
  if(new Set(value.previews.map(p=>p.id)).size!==value.previews.length||value.previews.some(p=>!slideIds.has(p.id)))throw new Error('Invalid preview reference')
  if(value.sheets.some(p=>p.ids.some(id=>!assets.has(id))))throw new Error('Invalid asset evidence')
  for(const e of s.elements){
    if(e.properties.native!==undefined)nativeObjectSchema.parse(e.properties.native)
    if(!numbers.has(e.slide)||!e.id.startsWith(`s${String(e.slide).padStart(2,'0')}-`))throw new Error('Invalid element slide')
    if(e.parentId&&(!elements.has(e.parentId)||elements.get(e.parentId)!.slide!==e.slide))throw new Error('Invalid ancestry')
    const seen=new Set([e.id]);let parent=e.parentId
    while(parent){if(seen.has(parent))throw new Error('Cyclic hierarchy');seen.add(parent);parent=elements.get(parent)?.parentId}
    if(e.properties.assetId!=null&&(!assets.has(String(e.properties.assetId))))throw new Error('Missing resource')
  }
  if(s.assets.length!==assets.size||new Set(s.assets.map(a=>a.id)).size!==assets.size||s.assets.some(a=>!assets.has(a.id)))throw new Error('Asset manifest mismatch')
  if(value.assets.some(a=>s.assets.find(m=>m.id===a.id)?.mime!==a.mime))throw new Error('Asset MIME mismatch')
}
export function validateImageSignature(bytes:Uint8Array,mime:string){
  if(mime==='image/png'&&!(bytes[0]===137&&bytes[1]===80)||mime==='image/jpeg'&&!(bytes[0]===255&&bytes[1]===216)||mime==='image/webp'&&new TextDecoder().decode(bytes.slice(8,12))!=='WEBP')throw new Error('Invalid image signature')
}
export type VisualManifest = { renderer:string; previewKind:'reconstruction'; snapshot:SourceSnapshot; previews:Array<{id:string;mime:string}>; assets:Array<{id:string;mime:string;extension:string;origins:string[]}>; sheets:Array<{id:string;ids:string[];mime:string}> }
const previewMime=z.enum(['image/png','image/jpeg'])
const manifestSchema=z.object({renderer:packageSchema.shape.renderer,previewKind:z.literal('reconstruction'),snapshot:snapshotSchema,
  assets:z.array(assetSchema.omit({base64:true})).max(2000),previews:z.array(z.object({id,mime:previewMime})).max(100),
  sheets:z.array(z.object({id:z.string().regex(/^sheet-[0-9]{1,3}$/),ids:z.array(id).min(1).max(12),mime:previewMime})).max(170)})
export function validateVisualManifest(raw:unknown,sourceHash:string):VisualManifest{
  const value=manifestSchema.parse(raw)
  validateReferences(value,sourceHash)
  if(new Set(value.sheets.map(s=>s.id)).size!==value.sheets.length)throw new Error('Duplicate sheet identity')
  return value
}
export async function storeVisualPackage(bucket:R2Bucket,jobId:string,value:VisualPackage){
  const prefix=`visual/${jobId}`
  const previews:VisualManifest['previews']=[],sheets:VisualManifest['sheets']=[]
  for(const a of value.assets)await bucket.put(`${prefix}/${a.id}`,Uint8Array.from(atob(a.base64),c=>c.charCodeAt(0)),{httpMetadata:{contentType:a.mime}})
  for(const p of value.previews){const {mime,bytes}=decodeDataUrl(p.dataUrl);await bucket.put(`${prefix}/preview-${p.id}`,bytes,{httpMetadata:{contentType:mime}});previews.push({id:p.id,mime})}
  for(const [i,s] of value.sheets.entries()){const {mime,bytes}=decodeDataUrl(s.dataUrl),id=`sheet-${i}`;await bucket.put(`${prefix}/${id}`,bytes,{httpMetadata:{contentType:mime}});sheets.push({id,ids:s.ids,mime})}
  const manifest:VisualManifest={renderer:value.renderer,previewKind:value.previewKind,snapshot:value.snapshot,assets:value.assets.map(({id,mime,extension,origins})=>({id,mime,extension,origins})),previews,sheets}
  if(!await bucket.head(`${prefix}/manifest.json`)){
    const {enableAutomaticRefinement}=await import('../design-system/refinement-storage')
    await enableAutomaticRefinement(bucket,jobId,manifest.snapshot.sourceId)
  }
  await bucket.put(`${prefix}/manifest.json`,JSON.stringify(manifest),{httpMetadata:{contentType:'application/json'}})
  return manifest
}
