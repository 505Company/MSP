// Read-only acceptance against the local dev app. No model calls or source changes.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
const [id,sourcePath,output='outputs/independent-reference']=process.argv.slice(2)
if(!/^[a-f0-9-]{36}$/.test(id??'')||!sourcePath)throw new Error('Usage: node scripts/verify-local-import.mjs UPLOAD_ID SOURCE_PPTX')
const base=`http://localhost:5184/api/uploads/${id}`
const get=async url=>{const r=await fetch(url);if(!r.ok)throw new Error(`HTTP ${r.status}`);return r}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
await mkdir(output,{recursive:true})
const result=await(await get(`${base}/design-system`)).json(),catalog=await(await get(`${base}/catalog`)).json()
const items=[...catalog.items]
for(let page=2;page<=catalog.pages;page++)items.push(...(await(await get(`${base}/catalog?page=${page}`)).json()).items)
if(new Set(items.map(i=>i.id)).size!==catalog.total)throw new Error('Incomplete catalog pagination')
const original=await readFile(sourcePath),zip=await JSZip.loadAsync(original)
if(sha(original)!==result.visual.snapshot.sourceId)throw new Error('Wrong source')
const checks=[]
for(const asset of result.visual.assets){
  const parts=asset.origins.filter(o=>o.startsWith('ppt/media/'))
  if(!parts.length)continue
  const actual=sha(new Uint8Array(await(await get(`${base}/assets/${asset.id}`)).arrayBuffer()))
  for(const part of parts){const entry=zip.file(part);if(!entry||sha(await entry.async('uint8array'))!==actual)throw new Error(`Changed source image: ${part}`);checks.push({part,assetId:asset.id,sha256:actual})}
}
for(const slide of [1,3,7,8,13,18,20,25,30,38,50,52]){
  const key=`s${String(slide).padStart(2,'0')}`
  await writeFile(`${output}/web-${key}.jpg`,new Uint8Array(await(await get(`${base}/assets/preview-${key}`)).arrayBuffer()))
}
const metrics={uploadId:id,sourceBytes:original.length,sourceSha256:sha(original),slides:result.visual.snapshot.slideCount,
  objects:result.visual.snapshot.elements.length,resources:result.visual.assets.length,resourceBytes:result.visual.snapshot.assets.reduce((n,a)=>n+a.byteLength,0),
  originalPartsChecked:checks.length,candidates:catalog.total,availableComponents:items.filter(c=>c.available).length,limitedCandidates:items.filter(c=>!c.available).length,
  editableComponents:items.filter(c=>c.slotCount).length,originalChecks:checks}
await writeFile(`${output}/vk-import.json`,JSON.stringify(result))
await writeFile(`${output}/vk-catalog.json`,JSON.stringify({...catalog,items}))
await writeFile(`${output}/vk-verification.json`,JSON.stringify(metrics,null,2))
console.log(JSON.stringify({...metrics,originalChecks:undefined},null,2))
