import type {SourceSnapshot} from '../digital-designer/source-types'
import {contentHash,installSemanticCatalog} from '../design-system/catalog'
import {compileSemanticLibrary} from '../design-system/semantic-library'
import {readScanRun,type SemanticSystem} from '../design-system/semantic-scan'
import {compileLibrary,flatten} from '../design-system/compiler'
import {compileEditableSlides} from '../design-system/editable-analysis'
import {EDITABLE_VERSION,EDITABLE_COMPILER_VERSION,type EditableCatalog,type EditableReply} from '../design-system/editable-contract'
import {readRefinementRegistry} from '../design-system/refinement-storage'
import {preserveSourceCalibration,publishSourceCalibration} from './source-refresh-calibration'

export async function assertSourceRefreshIdle(bucket:R2Bucket,id:string){
 const file=await bucket.get(`processing-jobs/${id}.json`),job=file?await file.json<{status:string}>():null
 if(job&&['running','queued','retrying'].includes(job.status)||(await readRefinementRegistry(bucket,id)).pending)throw Error('Сначала дождитесь текущей обработки; исходник не изменён')
}

/** A new importer may add evidence, but must not reassign IDs used by saved
 * recognition or change source text. Refuse unsafe migrations before writing. */
export function validateSourceRefresh(before:SourceSnapshot,after:SourceSnapshot){
 if(before.sourceId!==after.sourceId||before.name!==after.name||before.slideCount!==after.slideCount||before.slides.length!==after.slides.length)throw Error('Повторное чтение относится к другому исходнику')
 for(const s of before.slides){const n=after.slides.find(n=>n.id===s.id);if(!n||['number','part','text','width','height'].some(k=>n[k as keyof typeof n]!==s[k as keyof typeof s]))throw Error('Повторное чтение изменило содержание слайда')}
 const next=new Map(after.elements.map(e=>[e.id,e]))
 for(const e of before.elements){const n=next.get(e.id);if(!n||e.kind!==n.kind||e.slide!==n.slide||e.parentId!==n.parentId||e.properties.text!==n.properties.text||JSON.stringify(e.properties.sourceRef)!==JSON.stringify(n.properties.sourceRef)||JSON.stringify(e.properties.native)!==JSON.stringify(n.properties.native))throw Error(`Изменилась идентичность исходного объекта: ${e.id}`)}
}

/** Prepare a local replay before publishing source changes. Provider replies,
 * saved catalog versions and manual adaptation rules are never rewritten. */
export async function prepareSourceRefresh(bucket:R2Bucket,id:string,before:SourceSnapshot,after:SourceSnapshot){
 await assertSourceRefreshIdle(bucket,id)
 const registry=await readRefinementRegistry(bucket,id)
 if(registry.history.length)throw Error('У библиотеки есть опубликованные дополнения. Требуется отдельное сохранение их цепочки перед обновлением исходника')
 validateSourceRefresh(before,after)
 const scan=await readScanRun(bucket,id),systemFile=scan?.resultKey?await bucket.get(scan.resultKey):null
 const root=`editable-systems/${id}/${EDITABLE_VERSION}`,pointer=await bucket.get(`${root}/current.json`)
 if(!systemFile||!pointer)throw Error('Для обновления нужен завершённый сохранённый разбор')
 const system=await systemFile.json<SemanticSystem>(),p=await pointer.json<{key:string}>(),catalogFile=await bucket.get(p.key)
 if(!catalogFile)throw Error('Сохранённый каталог не найден')
 const previous=await catalogFile.json<EditableCatalog>(),oldPrefix=`${root}/${previous.sourceRevision}`
 const records:{key:string;value:string}[]=[];let cursor:string|undefined
 do{const page=await bucket.list({prefix:oldPrefix+'/',cursor});for(const o of page.objects.filter(o=>/\/(parts|plans)\//.test(o.key))){const file=await bucket.get(o.key);if(file)records.push({key:o.key.slice(oldPrefix.length),value:await file.text()})}cursor=page.truncated?page.cursor:undefined}while(cursor)
 const parts=records.filter(r=>r.key.startsWith('/parts/')).map(r=>JSON.parse(r.value) as {reply:EditableReply;omissions?:EditableCatalog['omissions']})
 const slides=parts.flatMap(p=>p.reply.slides)
 if(new Set(slides.map(s=>s.slide)).size!==after.slides.length)throw Error('Сохранённый разбор не покрывает все слайды; автоматический платный повтор не запущен')
 const compiled=await compileSemanticLibrary(after,{...system,sourceRevision:await contentHash(after)})
 // New native image-filled shapes have no old model assignment. Retain them
 // as source graphics; do not invent editable text or semantic meaning.
 const oldIds=new Set(before.elements.map(e=>e.id)),covered=new Set(compiled.library.components.flatMap(c=>c.source.elementIds))
 const additions=compileLibrary(after,null,{maxComponents:Infinity}).components.filter(c=>!oldIds.has(c.source.rootId)&&c.source.assetIds.length&&!c.slots.length&&!c.fixedTextIds.length&&!flatten(c.scene.elements).some(e=>e.kind==='text'))
 for(const c of additions.sort((a,b)=>b.source.elementIds.length-a.source.elementIds.length))if(!c.source.elementIds.some(id=>covered.has(id))){compiled.library.components.push(c);c.source.elementIds.forEach(id=>covered.add(id))}
 const editable=await compileEditableSlides(after,slides,id)
 const calibration=await preserveSourceCalibration(bucket,id,compiled.library)
 return {compiled,editable,previous,records,parts,calibration,previousPointerKey:p.key}
}

export async function publishSourceRefresh(bucket:R2Bucket,id:string,after:SourceSnapshot,plan:Awaited<ReturnType<typeof prepareSourceRefresh>>){
 await assertSourceRefreshIdle(bucket,id)
 const pointerKey=`editable-systems/${id}/${EDITABLE_VERSION}/current.json`,pointer=await bucket.get(pointerKey)
 if(!pointer)throw Error('Каталог удалён во время обновления исходника')
 const currentPointer=await pointer.json<{key:string}>()
 // Retry can finish the same publication, but may never replace another run.
 if(currentPointer.key!==plan.previousPointerKey){
  const file=await bucket.get(currentPointer.key),current=file?await file.json<EditableCatalog>():null
  if(!current||current.sourceRevision!==await contentHash({version:EDITABLE_VERSION,snapshot:after,catalogId:current.catalogId}))throw Error('Каталог изменился во время обновления исходника')
  return {sourceCatalogId:current.catalogId,editableCatalogId:current.id,variants:current.families.reduce((n,f)=>n+f.variants.length,0),modelRequests:0}
 }
 const json={httpMetadata:{contentType:'application/json'}},catalogId=await installSemanticCatalog(bucket,id,plan.compiled.library,plan.compiled.metadata)
 await publishSourceCalibration(bucket,id,catalogId,plan.compiled.library.components.length,plan.calibration)
 const sourceRevision=await contentHash({version:EDITABLE_VERSION,snapshot:after,catalogId}),root=`editable-systems/${id}/${EDITABLE_VERSION}`,prefix=`${root}/${sourceRevision}`
 for(const r of plan.records)await bucket.put(prefix+r.key,r.value,{...json,onlyIf:{etagDoesNotMatch:'*'}})
 const {families,coverage,excluded,omissions}=plan.editable,allOmissions=[...plan.parts.flatMap(p=>p.omissions??[]),...omissions]
 const catalog:EditableCatalog={...plan.previous,compilerVersion:EDITABLE_COMPILER_VERSION,catalogId,sourceRevision,createdAt:new Date().toISOString(),id:await contentHash({version:EDITABLE_VERSION,compilerVersion:EDITABLE_COMPILER_VERSION,revision:sourceRevision,families,coverage,...(allOmissions.length?{omissions:allOmissions}:{})}),families,coverage,excluded,...(allOmissions.length?{omissions:allOmissions}:{})}
 delete catalog.qualification
 delete catalog.designIntent
 delete catalog.refinement
 const key=`${prefix}/catalogs/${catalog.id}.json`;await bucket.put(key,JSON.stringify(catalog),{...json,onlyIf:{etagDoesNotMatch:'*'}})
 if(!await bucket.put(`${root}/current.json`,JSON.stringify({key}),{...json,onlyIf:{etagMatches:pointer.etag}}))throw Error('Каталог обновился параллельно. Подготовленная версия сохранена.')
 return {sourceCatalogId:catalogId,editableCatalogId:catalog.id,variants:families.reduce((n,f)=>n+f.variants.length,0),modelRequests:0}
}
