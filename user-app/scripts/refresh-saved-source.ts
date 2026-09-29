/** Rebuild derived catalogs from an exact local importer reread and immutable
 * saved model replies. --apply uses only the source-repair API, never Qwen. */
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {inventory,saveJson,digest} from './pixel-pilot-store'
import {prepareSourceRefresh} from '../lib/uploads/source-refresh'
import {contentHash} from '../lib/design-system/catalog'
import {SOURCE_REPAIR_VERSION} from '../lib/uploads/source-repair-contract'
import type {VisualManifest} from '../lib/digital-designer/visual-package'
import type {SourceSnapshot} from '../lib/digital-designer/source-types'
const [id,preparedPath,out,mode]=process.argv.slice(2)
assert.match(id??'',/^[a-f\d-]{36}$/);assert.ok(preparedPath&&out);assert.ok(!mode||mode==='--apply')
const rows=inventory(),byKey=new Map(rows.map(r=>[r.key,r.blob_id]))
const get=async(key:string)=>{
 const blob=byKey.get(key);if(!blob)return null
 const bytes=await readFile(`.wrangler/state/v3/r2/site-creator-r2/blobs/${blob}`),text=bytes.toString('utf8')
 return {etag:digest(text),json:async<T,>()=>JSON.parse(text) as T,text:async()=>text,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}
}
const bucket={get,head:get,list:async(options:R2ListOptions)=>({objects:rows.filter(r=>r.key.startsWith(options.prefix??'')),truncated:false}),put:async()=>{throw Error('Read-only application snapshot')}} as unknown as R2Bucket
const visual=await(await get(`visual/${id}/manifest.json`))!.json<VisualManifest>()
const prepared=JSON.parse(await readFile(preparedPath,'utf8')) as {snapshot:SourceSnapshot;assets:{id:string;base64:string}[];previews:{id:string;dataUrl:string}[]}
const plan=await prepareSourceRefresh(bucket,id,visual.snapshot,prepared.snapshot)
const previous=plan.previous.families.flatMap(f=>f.variants),next=plan.editable.families.flatMap(f=>f.variants)
const summary={sourceId:prepared.snapshot.sourceId,slides:prepared.snapshot.slides.length,sourceResources:prepared.snapshot.assets.filter(a=>a.origins.some(o=>o.startsWith('ppt/media/'))).length,sourceComponents:plan.compiled.library.components.length,families:plan.editable.families.length,variants:next.length,previousVariants:previous.length,lost:previous.filter(t=>!next.some(n=>n.id===t.id)).map(t=>({id:t.id,name:t.name,slide:t.slide,kind:t.kind})),added:next.filter(t=>!previous.some(n=>n.id===t.id)).map(t=>({id:t.id,name:t.name,slide:t.slide,kind:t.kind})),omissions:plan.editable.omissions,excluded:plan.editable.excluded,savedParts:plan.parts.length,modelRequests:0}
await saveJson(`${out}/prepared.json`,summary)
if(mode==='--apply'){
 const base=`http://127.0.0.1:5184/api/uploads/${id}/source-repair`,r=await fetch(base+'?refresh=appearance'),status=await r.json() as {revision:string;knownAssetIds:string[]}
 assert.ok(r.ok);assert.equal(status.revision,await contentHash(visual.snapshot),'Source changed since local verification')
 const patch={version:SOURCE_REPAIR_VERSION,refresh:true,revision:status.revision,snapshot:prepared.snapshot,previews:prepared.previews,assets:prepared.assets.filter(a=>!status.knownAssetIds.includes(a.id)).map(({id,base64})=>({id,base64}))}
 await saveJson(`${out}/request.json`,patch)
 const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}),body=await response.json()
 await saveJson(`${out}/response.json`,{status:response.status,body});assert.ok(response.ok,JSON.stringify(body));console.log(JSON.stringify(body))
}else console.log(JSON.stringify(summary))
