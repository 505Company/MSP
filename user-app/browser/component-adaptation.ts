import { ensureUploadFonts } from './fonts'
import { qualifyComponentFlows } from './component-flow'
import type { EditableCatalog } from '../lib/design-system/editable-contract'
import type { ComponentFlowReport } from '../lib/design-system/component-adaptation'
const flights=new Map<string,Promise<ComponentFlowReport>>()
/** A separate immutable capability report; no model call and no source rewrite. */
export function ensureComponentAdaptation(uploadId:string,signal?:AbortSignal) {
 const saved=flights.get(uploadId);if(saved)return saved
 const run=async()=>{
  const url=`/api/uploads/${uploadId}/editable-system/adaptation`,r=await fetch(url,{signal,cache:'no-store'}),state=await r.json() as {report:ComponentFlowReport|null;catalog?:EditableCatalog;error?:string}
  if(!r.ok)throw Error(state.error??'Не удалось прочитать возможности компонентов')
  if(state.report)return state.report
  await ensureUploadFonts(uploadId)
  const report=await qualifyComponentFlows(state.catalog!,signal,undefined,uploadId)
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report),signal}),value=await response.json() as {report:ComponentFlowReport;error?:string}
  if(!response.ok)throw Error(value.error??'Не удалось сохранить проверку адаптации')
  return value.report
 }
 const flight=run().finally(()=>flights.delete(uploadId));flights.set(uploadId,flight);return flight
}
