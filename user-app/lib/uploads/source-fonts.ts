import type { UploadJob } from './domain'
import { extractEmbeddedFonts } from './embedded-fonts'
export type SourceFontManifest = {version:2;requested:{family:string;style:string}[];fonts:{id:string;family:string;style:string;key:string;mime:string}[]}
export async function sourceFonts(bucket:R2Bucket,upload:UploadJob):Promise<SourceFontManifest>{
  const prefix=`source-fonts/${upload.id}/v2`,cached=await bucket.get(`${prefix}/manifest.json`)
  if(cached)return cached.json<SourceFontManifest>()
  if(!upload.sourceObjectKey||!upload.fileName.toLowerCase().endsWith('.pptx'))return {version:2,fonts:[],requested:[]}
  const source=await bucket.get(upload.sourceObjectKey);if(!source)throw Error('Исходник не найден')
  const fonts=extractEmbeddedFonts(new Uint8Array(await source.arrayBuffer())),manifest:SourceFontManifest={version:2,fonts:[],requested:[]}
  const visual=await bucket.get(`visual/${upload.id}/manifest.json`)
  if(visual){
    const {snapshot}=await visual.json<{snapshot:import('../digital-designer/source-types').SourceSnapshot}>()
    const faces=new Map<string,{family:string;style:string}>()
    for(const e of snapshot.elements.filter(e=>e.kind==='text'))for(const r of [e.properties,...(e.properties.styleRuns as Record<string,unknown>[]??[])])if(typeof r.fontFamily==='string'){
      const face={family:r.fontFamily,style:typeof r.fontStyle==='string'?r.fontStyle:'Regular'};faces.set(`${face.family}:${face.style}`,face)
    }
    manifest.requested=[...faces.values()]
  }
  for(const font of fonts){const key=`${prefix}/${font.id}`;await bucket.put(key,font.bytes,{httpMetadata:{contentType:font.mime}});manifest.fonts.push({id:font.id,family:font.family,style:font.style,key,mime:font.mime})}
  await bucket.put(`${prefix}/manifest.json`,JSON.stringify(manifest),{httpMetadata:{contentType:'application/json'}})
  return manifest
}
