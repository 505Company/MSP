import {graphicParts,GRAPHIC_COMPONENTS_VERSION} from './graphic-components'
import {readReconstructionCatalog} from './reconstruction'
import type { SourceSnapshot } from '../digital-designer/source-types'
import type { DesignAnalysis } from '../digital-designer/design-analysis'
import type { ComponentDefinition, SavedLibrary } from './types'
import type { CatalogComponent, CatalogItem, CatalogPage } from './catalog-types'
import { compileLibrary, flatten, visibleElements } from './compiler'
import { compileLibrary as compileLegacyLibrary } from './compiler-v1'
import { loadLibrary } from './storage'
import type { ComponentLibrary } from './types'
import type { SemanticMetadata } from './semantic-library'
import { readCalibratedCatalog } from './calibration'
import { CURATION_VERSION, curateComponents, sourceSlidePreviewOnDark } from './component-curation'
import { readEditableCatalog } from './editable-analysis'

const VERSION = 'web-catalog-3'
const SEMANTIC_CATALOG_VERSION = 'web-catalog-semantic-1'
const PAGE_SIZE = 24
const prefix=(uploadId:string)=>`component-catalogs/${uploadId}`
const json={httpMetadata:{contentType:'application/json'}}
type Index={id:string;version:string;name:string;items:CatalogItem[];notes:string[]}
type Source={snapshot:SourceSnapshot;analysis?:DesignAnalysis|null;legacy:SavedLibrary|null}
type Definition=Pick<CatalogComponent,'definitionId'|'component'>
export async function contentHash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('')}

async function readIndex(bucket:R2Bucket,id:string):Promise<Index|null>{
  const pointer=await bucket.get(`${prefix(id)}/current.json`)
  if(!pointer)return null
  const {catalogId}=await pointer.json<{catalogId:string}>()
  const file=await bucket.get(`${prefix(id)}/${catalogId}/index.json`)
  if(!file)throw new Error('Каталог сохранён не полностью')
  return file.json<Index>()
}

/** The source-system view must describe the user's current immutable catalog,
 * including historical compilers, instead of predicting different definitions. */
export async function catalogLibrary(bucket:R2Bucket,uploadId:string){
  const index=await readIndex(bucket,uploadId);if(!index)return null
  return libraryForIndex(bucket,uploadId,index)
}

async function libraryForIndex(bucket:R2Bucket,uploadId:string,index:Index):Promise<{catalogId:string;library:ComponentLibrary;semantic?:SemanticMetadata}>{
  if(index.version===SEMANTIC_CATALOG_VERSION){
    const file=await bucket.get(`${prefix(uploadId)}/${index.id}/library.json`)
    if(!file)throw new Error('Каталог сохранён не полностью')
    return {catalogId:index.id,...await file.json<{library:ComponentLibrary;semantic:SemanticMetadata}>()}
  }
  const file=await bucket.get(`${prefix(uploadId)}/${index.id}/source.json`)
  if(!file)throw new Error('Исходная сцена каталога недоступна')
  if(index.version!==VERSION&&index.version!=='web-catalog-2')throw new Error('Версия каталога не поддерживается')
  const source=await file.json<Source>(),compiler=index.version==='web-catalog-2'?compileLegacyLibrary:compileLibrary
  const library=compiler(source.snapshot,source.analysis,{maxComponents:Infinity})
  for(const old of source.legacy?.library.components??[]){const at=library.components.findIndex(c=>c.id===old.id);if(at>=0)library.components[at]=old;else library.components.push(old)}
  return {catalogId:index.id,library}
}

type SelectedItem=CatalogItem&{searchText:string}
/** A versioned view of immutable definitions, shared by old and new imports.
 * Keeping it separate preserves saved projects and direct source-ID lookups. */
async function selectedItems(bucket:R2Bucket,uploadId:string,index:Index):Promise<SelectedItem[]>{
  const calibrated = await readCalibratedCatalog(bucket, uploadId, index.id)
  if (calibrated) return calibrated.families.map(family => {
    const item = index.items.find(i => i.id === family.representativeId)!
    return { ...item, name: family.name, family, available: true, occurrenceIds: family.occurrenceIds, slides: family.slides, repeatCount: family.occurrenceIds.length,
      usage: { description: family.description, tags: family.tags, previewOnDark: family.previewOnDark },
      searchText: [family.name, ...family.occurrenceIds.flatMap(id => { const original = index.items.find(i => i.id === id); return original ? [original.name, original.text] : [] })].join(' ') }
  })
  const key=`${prefix(uploadId)}/${index.id}/${CURATION_VERSION}.json`
  const cached=await bucket.get(key)
  if(cached)return (await cached.json<{items:SelectedItem[]}>()).items
  const {library}=await libraryForIndex(bucket,uploadId,index),selection=curateComponents(library.components)
  const byId=new Map(index.items.map(item=>[item.id,item]))
  const items:SelectedItem[]=selection.components.flatMap(({id,occurrenceIds,slides,...usage})=>{
    const item=byId.get(id);if(!item)return []
    const examples=occurrenceIds.flatMap(key=>byId.get(key)??[])
    return [{...item,available:true,repeatCount:occurrenceIds.length,occurrenceIds,slides,usage,
      searchText:examples.map(e=>`${e.id} ${e.name} ${e.text}`).join(' ')}]
  })
  await bucket.put(key,JSON.stringify({version:CURATION_VERSION,items,omitted:selection.omitted}),{...json,onlyIf:{etagDoesNotMatch:'*'}})
  return items
}

// Compare observed appearance and text, omitting only identity and outer placement.
// Equal hashes mark exact repeats, never a semantic component family or a merged instance.
async function repetitionKey(component:ComponentDefinition){
  const root=flatten(component.scene.elements).find(e=>e.id===component.source.rootId)!
  const normalize=(value:unknown,outer=false):unknown=>{
    if(Array.isArray(value))return value.map(v=>normalize(v))
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['id','name','sourceRef','zIndex'].includes(k)).map(([k,v])=>[k,k==='bounds'&&outer?{...(v as object),x:0,y:0}:normalize(k==='children'&&Array.isArray(v)?[...v].sort((a,b)=>a.zIndex-b.zIndex):v)]))
    return value
  }
  // A nested ancestor can change rotation, clipping and opacity; include that context conservatively.
  const ancestors=flatten(component.scene.elements).filter(e=>component.source.ancestorIds.includes(e.id)).map(e=>({...e,children:undefined}))
  return contentHash([normalize(root,true),ancestors.map(e=>normalize(e,true))])
}

export async function initializeCatalog(bucket:R2Bucket,uploadId:string,snapshot:SourceSnapshot,analysis?:DesignAnalysis|null){
  const existing=await readIndex(bucket,uploadId)
  if(existing)return existing.id
  const legacy=await loadLibrary(bucket,uploadId)
  const source:Source={snapshot,analysis:analysis??null,legacy}
  const id=await contentHash({version:VERSION,source})
  const compiled=compileLibrary(snapshot,analysis,{maxComponents:Infinity})
  const legacyById=new Map(legacy?.library.components.map(c=>[c.id,c]))
  const definitions=compiled.components.map(c=>legacyById.get(c.id)??c)
  // Previously saved definitions are immutable and remain selectable even after a compiler change.
  for(const c of legacyById.values())if(!definitions.some(d=>d.id===c.id))definitions.push(c)
  definitions.sort((a,b)=>Number(b.issues.every(i=>i.severity==='warning'))-Number(a.issues.every(i=>i.severity==='warning'))||Number(b.kind==='compound')-Number(a.kind==='compound')||b.slots.length-a.slots.length)
  const keys=await Promise.all(definitions.map(repetitionKey)),counts=new Map<string,number>()
  for(const key of keys)counts.set(key,(counts.get(key)??0)+1)
  const items:CatalogItem[]=definitions.map((c,i)=>({id:c.id,name:c.name,kind:c.kind,slide:c.source.slide,elementCount:c.source.elementIds.length,slotCount:c.slots.length,text:flatten(c.scene.elements).filter(e=>e.kind==='text').map(e=>e.text).join(' · ').slice(0,300),repeatCount:counts.get(keys[i])!,available:true}))
  for(const excluded of compiled.excluded){
    if(items.some(i=>i.id===`cmp-${excluded.elementId}`))continue
    const e=snapshot.elements.find(e=>e.id===excluded.elementId)
    items.push({id:`cmp-${excluded.elementId}`,name:e?.name??excluded.elementId,kind:['group','chart','table'].includes(e?.kind??'')?'compound':'atom',slide:e?.slide??1,elementCount:0,slotCount:0,text:'',repeatCount:1,available:false,reason:excluded.reason})
  }
  const index:Index={id,version:VERSION,name:snapshot.name,items,notes:[...compiled.notes,'Каталог автоматически выделяет атомы и молекулы из исходных объектов и групп. Конструкции сложнее 250 объектов видны с причиной ограничения; вложенные группы доступны отдельно.','Совпадения означают одинаковую наблюдаемую структуру и текст. Они не объединяются автоматически.']}
  await bucket.put(`${prefix(uploadId)}/${id}/source.json`,JSON.stringify(source),{...json,onlyIf:{etagDoesNotMatch:'*'}})
  await bucket.put(`${prefix(uploadId)}/${id}/index.json`,JSON.stringify(index),{...json,onlyIf:{etagDoesNotMatch:'*'}})
  const committed=await bucket.put(`${prefix(uploadId)}/current.json`,JSON.stringify({catalogId:id}),{...json,onlyIf:{etagDoesNotMatch:'*'}})
  return committed?id:(await readIndex(bucket,uploadId))!.id
}

export async function listCatalog(bucket:R2Bucket,uploadId:string,query:URLSearchParams):Promise<CatalogPage|null>{
  const index=await readIndex(bucket,uploadId);if(!index)return null
  let curated=await selectedItems(bucket,uploadId,index)
  const calibrated=await readCalibratedCatalog(bucket,uploadId,index.id),editable=await readEditableCatalog(bucket,uploadId,index.id)
  // Destination follows source leaves, not a model label: a paragraph called
  // "metric" is typography; an empty ring belongs to graphics.
  const destinationKey=`${prefix(uploadId)}/${index.id}/destinations-2.json`,savedDestinations=await bucket.get(destinationKey)
  let destinations:Record<string,string>
  if(savedDestinations)destinations=await savedDestinations.json<Record<string,string>>()
  else{
    const {library}=await libraryForIndex(bucket,uploadId,index)
    destinations=Object.fromEntries(library.components.map(c=>{
      const nodes=visibleElements(c.scene.elements),leaves=nodes.filter(e=>!('children'in e))
      return [c.id,leaves.length&&leaves.every(e=>e.kind==='text')?'typography':leaves.length&&leaves.every(e=>e.kind!=='text')&&!nodes.some(e=>e.kind==='chart'||e.kind==='table')?'graphics':'components']
    }))
    await bucket.put(destinationKey,JSON.stringify(destinations),json)
  }
  const members=(item:SelectedItem)=>item.family?.occurrenceIds??item.occurrenceIds??[item.id]
  const section=query.get('section')
  if(section==='graphics'&&calibrated){
    // Calibration decides whether a component can accept NEW content. A raster
    // chart can fail that test while still being valid original artwork. Keep
    // that source view separate; do not modify the calibrated/generation catalog.
    const {library}=await libraryForIndex(bucket,uploadId,index),shown=new Set(curated.flatMap(members))
    const originals=curateComponents(library.components.filter(c=>destinations[c.id]==='graphics'&&!c.slots.length&&!c.fixedTextIds.length))
    const visualFile=await bucket.get(`visual/${uploadId}/manifest.json`),visual=visualFile?await visualFile.json<{snapshot:SourceSnapshot}>():null
    for(const {id,occurrenceIds,slides,...usage} of originals.components){
      if(occurrenceIds.some(id=>shown.has(id)))continue
      const item=index.items.find(i=>i.id===id)
      if(!item?.available)continue
      curated.push({...item,occurrenceIds,slides,repeatCount:occurrenceIds.length,usage:{...usage,previewOnDark:usage.previewOnDark||!!visual&&sourceSlidePreviewOnDark(visual.snapshot,item.slide)},sourceOnly:true,searchText:[item.name,item.text,...usage.tags].join(' ')})
    }
  }
  if(section==='components'||section==='graphics')curated=curated.flatMap(item=>{
    // Historical semantic families can mix a paragraph with a raster number.
    // Route each occurrence, then choose a representative from the destination;
    // keeping the whole family would leave that paragraph in Components.
    const occurrenceIds=members(item).filter(id=>(destinations[id]??'components')===section)
    if(!occurrenceIds.length)return []
    const selected=new Set(occurrenceIds),variants=item.family?.variants.flatMap(v=>{
      const memberIds=v.memberIds.filter(id=>selected.has(id))
      return memberIds.length?[{...v,id:selected.has(v.id)?v.id:memberIds[0],memberIds}]:[]
    })
    const id=variants?.[0]?.id??(selected.has(item.id)?item.id:occurrenceIds[0]),representative=index.items.find(i=>i.id===id)
    if(!representative)return []
    const slides=[...new Set(occurrenceIds.flatMap(id=>index.items.find(i=>i.id===id)?.slide??[]))].sort((a,b)=>a-b)
    const family=item.family?{...item.family,representativeId:id,memberIds:item.family.memberIds.filter(id=>selected.has(id)),occurrenceIds,variants:variants!,slides}:undefined
    return [{...item,...representative,name:item.name,occurrenceIds,repeatCount:occurrenceIds.length,slides,family}]
  })
  else curated=curated.filter(item=>!members(item).every(id=>destinations[id]==='graphics'))
  if(editable&&query.get('section')!=='graphics'){
    const passed=new Set(editable.qualification?.checks.filter(c=>c.passed).map(c=>c.id)??[])
    const covered=new Set(editable.families.flatMap(f=>f.variants.every(v=>passed.has(v.id))?f.sourceIds:f.variants.filter(v=>passed.has(v.id)).flatMap(v=>v.sourceIds))),{library}=await libraryForIndex(bucket,uploadId,index)
    const replaced=new Set(library.components.filter(c=>covered.has(c.source.rootId)||(c.slots.length>0&&c.slots.every(s=>covered.has(s.elementId)))).map(c=>c.id))
    curated=curated.filter(item=>!(item.family?item.family.variants.flatMap(v=>v.memberIds):item.occurrenceIds??[item.id]).every(id=>replaced.has(id)))
  }
  if(query.get('section')==='graphics'){const r=await readReconstructionCatalog(bucket,uploadId,index.id),replaced=new Set(r?.results.filter(r=>r.status==='ready'&&r.pattern).flatMap(r=>r.candidate.componentIds)??[]);curated=curated.filter(item=>!(item.occurrenceIds??[item.id]).every(id=>replaced.has(id)))}
  if(query.get('section')!=='graphics'){const r=await readReconstructionCatalog(bucket,uploadId,index.id);if(r){const covered=new Set(r.results.flatMap(r=>{const checked=new Set(r.partsQualification?.version===GRAPHIC_COMPONENTS_VERSION?r.partsQualification.checks.filter(c=>c.passed).map(c=>c.id):[]);return graphicParts(r).filter(p=>checked.has(p.id)).flatMap(p=>p.source.elementIds)})),{library}=await libraryForIndex(bucket,uploadId,index),replaced=new Set(library.components.filter(c=>c.source.elementIds.length&&c.source.elementIds.every(id=>covered.has(id))).map(c=>c.id));curated=curated.filter(item=>!(item.occurrenceIds??[item.id]).every(id=>replaced.has(id)))}}
  const search=(query.get('q')??'').slice(0,200).trim().toLocaleLowerCase('ru'),slide=Number(query.get('slide')??0),kind=query.get('kind')
  const filtered=curated.filter(i=>(!slide||i.slides?.includes(slide))&&(!kind||i.kind===kind)&&(!search||`${i.searchText} ${i.usage?.description} ${i.usage?.tags.join(' ')}`.toLocaleLowerCase('ru').includes(search)))
  const focused=filtered.findIndex(item=>item.occurrenceIds?.includes(query.get('component')??''))
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)),requested=Number(query.get('page')??(focused<0?1:Math.floor(focused/PAGE_SIZE)+1)),page=Math.max(1,Math.min(pages,Number.isFinite(requested)?Math.floor(requested):1))
  // Project only catalog fields: old index files can contain retired review statuses.
  const items=filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(({id,name,kind,slide,elementCount,slotCount,text,repeatCount,available,usage,occurrenceIds,slides,family,sourceOnly})=>({id,name,kind,slide,elementCount,slotCount,text,repeatCount,available,usage,occurrenceIds,slides,family,...(sourceOnly?{sourceOnly:true}:{})}))
  return {catalogId:index.id,name:index.name,total:curated.length,filtered:filtered.length,page,pages,items,
    counts:{atoms:curated.filter(i=>i.kind==='atom').length,molecules:curated.filter(i=>i.kind==='compound').length},
    slides:[...new Set(curated.flatMap(i=>i.slides??[i.slide]))].sort((a,b)=>a-b),notes:[...index.notes,'Рабочий каталог объединяет одинаковые конструкции и исключает однотонные фоны и неподдержанные определения. Исходные определения сохранены.'],
    ...(focused>=0?{focusedId:filtered[focused].id}:{}),
    ...(calibrated ? {calibration:{id:calibrated.id,checked:calibrated.qualifiedCount,excluded:calibrated.excluded.length,variants:curated.reduce((n,f)=>n+(f.family?.variants.length??1),0)}} : {})}
}

export async function getCatalogComponent(bucket:R2Bucket,uploadId:string,componentId:string):Promise<CatalogComponent>{
  const index=await readIndex(bucket,uploadId),item=index?.items.find(i=>i.id===componentId)
  if(!index||!item)throw new Error('Компонент не найден')
  if(!item.available)throw new Error(item.reason)
  const base=`${prefix(uploadId)}/${index.id}`,key=`${base}/definitions/${componentId}.json`
  let file=await bucket.get(key),definition:Definition
  if(file)definition=await file.json<Definition>()
  else{
    if(index.version!==VERSION&&index.version!=='web-catalog-2')throw new Error('Для этой версии каталога требуется прежний исполнитель')
    file=await bucket.get(`${base}/source.json`)
    if(!file)throw new Error('Исходная сцена недоступна')
    const source=await file.json<Source>(),old=source.legacy?.library.components.find(c=>c.id===componentId)
    const compiler=index.version==='web-catalog-2'?compileLegacyLibrary:compileLibrary
    const component=old??compiler(source.snapshot,source.analysis,{maxComponents:Infinity,componentId}).components[0]
    if(!component)throw new Error('Не удалось собрать определение')
    definition={component,definitionId:await contentHash(component)}
    await bucket.put(key,JSON.stringify(definition),{...json,onlyIf:{etagDoesNotMatch:'*'}})
  }
  // Historical decisions are archival. Source defaults and definitions are immutable;
  // content substitutions belong to presentation instances, never to the style bank.
  return {catalogId:index.id,component:definition.component,definitionId:definition.definitionId}
}

/** Publish only after all model packages have passed validation. Old versions
 * and project definitions remain immutable and retrievable by their own keys. */
export async function installSemanticCatalog(bucket:R2Bucket,uploadId:string,library:ComponentLibrary,semantic:SemanticMetadata){
  const currentKey=`${prefix(uploadId)}/current.json`,previous=await bucket.get(currentKey)
  const id=await contentHash({version:SEMANTIC_CATALOG_VERSION,library,semantic})
  const previousId=previous?(await previous.json<{catalogId:string}>()).catalogId:null
  if(previousId===id)return id
  const items:CatalogItem[]=library.components.map(c=>({id:c.id,name:c.name,kind:c.kind,slide:c.source.slide,elementCount:c.source.elementIds.length,slotCount:c.slots.length,
    text:flatten(c.scene.elements).filter(e=>e.kind==='text').map(e=>e.text).join(' · ').slice(0,300),repeatCount:1,
    available:!c.issues.some(i=>i.severity!=='warning'),...(c.issues.some(i=>i.severity!=='warning')?{reason:c.issues.find(i=>i.severity!=='warning')!.message}:{})}))
  const base=`${prefix(uploadId)}/${id}`
  for(const component of library.components)await bucket.put(`${base}/definitions/${component.id}.json`,JSON.stringify({component,definitionId:await contentHash(component)} satisfies Definition),{...json,onlyIf:{etagDoesNotMatch:'*'}})
  await bucket.put(`${base}/library.json`,JSON.stringify({library,semantic}),{...json,onlyIf:{etagDoesNotMatch:'*'}})
  const index:Index={id,version:SEMANTIC_CATALOG_VERSION,name:library.name,items,notes:library.notes}
  await bucket.put(`${base}/index.json`,JSON.stringify(index),{...json,onlyIf:{etagDoesNotMatch:'*'}})
  const committed=await bucket.put(currentKey,JSON.stringify({catalogId:id,previousCatalogId:previousId}),{...json,onlyIf:previous?{etagMatches:previous.etag}:{etagDoesNotMatch:'*'}})
  if(!committed)throw new Error('Каталог обновился параллельно. Подготовленная версия сохранена.')
  return id
}
