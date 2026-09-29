import {catalogLibrary,contentHash} from '../design-system/catalog'
import {readCalibratedCatalog} from '../design-system/calibration'
import {CALIBRATION_VERSION,QUALIFICATION_VERSION,type CalibratedCatalog} from '../design-system/calibration-contract'
import type {ComponentLibrary} from '../design-system/types'

/** Reuse a qualification only for an identical definition. Changed artwork is
 * still shown as source-only by the catalog, never granted an old admission. */
export async function preserveSourceCalibration(bucket:R2Bucket,id:string,library:ComponentLibrary){
 const previous=await catalogLibrary(bucket,id)
 if(!previous)return null
 const catalog=await readCalibratedCatalog(bucket,id,previous.catalogId)
 if(!catalog)return null
 const definitions=new Map(library.components.map(c=>[c.id,c])),stable=new Set<string>()
 for(const component of previous.library.components){const next=definitions.get(component.id);if(next&&await contentHash(next)===await contentHash(component))stable.add(component.id)}
 const families=catalog.families.flatMap(f=>{
  const variants=f.variants.flatMap(v=>{const memberIds=v.memberIds.filter(id=>stable.has(id));return memberIds.length?[{...v,id:stable.has(v.id)?v.id:memberIds[0],memberIds}]:[]})
  if(!variants.length)return []
  const occurrenceIds=f.occurrenceIds.filter(id=>stable.has(id))
  return [{...f,memberIds:f.memberIds.filter(id=>stable.has(id)),variants,representativeId:variants[0].id,occurrenceIds,slides:[...new Set(occurrenceIds.map(id=>definitions.get(id)!.source.slide))].sort((a,b)=>a-b)}]
 })
 const lost=catalog.families.flatMap(f=>f.variants.flatMap(v=>v.memberIds)).filter(id=>definitions.has(id)&&!stable.has(id))
 const reports:{id:string;value:string}[]=[]
 for(const componentId of stable){const f=await bucket.get(`component-calibration/${id}/${previous.catalogId}/${CALIBRATION_VERSION}/${QUALIFICATION_VERSION}/${componentId}.json`);if(f)reports.push({id:componentId,value:await f.text()})}
 return {catalog,sourceCatalogId:previous.catalogId,families,reports,excluded:[...catalog.excluded.filter(e=>definitions.has(e.id)),...lost.map(id=>({id,reason:'После обновления чтения изменилось оформление; требуется новая проверка. Исходная графика сохранена.'}))]}
}
export async function publishSourceCalibration(bucket:R2Bucket,id:string,catalogId:string,sourceCount:number,plan:Awaited<ReturnType<typeof preserveSourceCalibration>>){
 if(!plan)return
 const prefix=`component-calibration/${id}/${catalogId}/${CALIBRATION_VERSION}`,json={httpMetadata:{contentType:'application/json'}}
 for(const r of plan.reports)await bucket.put(`${prefix}/${QUALIFICATION_VERSION}/${r.id}.json`,r.value,{...json,onlyIf:{etagDoesNotMatch:'*'}})
 const {qualificationHash:_old,...previous}=plan.catalog;void _old
 const catalog:CalibratedCatalog={...previous,id:await contentHash({sourceRefresh:plan.catalog.id,catalogId,families:plan.families,excluded:plan.excluded}),catalogId,createdAt:new Date().toISOString(),families:plan.families,excluded:plan.excluded,sourceCount,qualifiedCount:plan.reports.filter(r=>JSON.parse(r.value).ready).length,replayedFrom:{catalogId:plan.sourceCatalogId,id:plan.catalog.id}}
 await bucket.put(`${prefix}/catalogs/${catalog.id}.json`,JSON.stringify(catalog),{...json,onlyIf:{etagDoesNotMatch:'*'}})
 await bucket.put(`${prefix}/current.json`,JSON.stringify({id:catalog.id}),{...json,onlyIf:{etagDoesNotMatch:'*'}})
}
