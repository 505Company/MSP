import type { SourceSnapshot } from '../digital-designer/source-types'
import type { DesignAnalysis } from '../digital-designer/design-analysis'
import { contentHash, catalogLibrary } from './catalog'
import { buildSourceSystem, SOURCE_SYSTEM_VERSION, type SourceSystem } from './source-system'

/** A derived cache, never the user's saved library or acceptance history. The
 * full normalized source and analysis participate in the key, not just PPTX SHA. */
export async function sourceSystem(bucket:R2Bucket,uploadId:string,snapshot:SourceSnapshot,analysis?:DesignAnalysis|null){
  const catalog=await catalogLibrary(bucket,uploadId)
  const derivationId=await contentHash({version:SOURCE_SYSTEM_VERSION,snapshot,analysis:analysis??null,catalogId:catalog?.catalogId??null})
  const key=`source-systems/${uploadId}/${derivationId}.json`,file=await bucket.get(key)
  if(file)return {derivationId,system:await file.json<SourceSystem>()}
  const system=buildSourceSystem(snapshot,analysis,catalog?.library)
  if(catalog&&'semantic' in catalog&&catalog.semantic){
    system.semantic=catalog.semantic
    system.rules=catalog.semantic.rules
    const decisions=new Map(catalog.semantic.decisions.map(d=>[d.elementId,d]))
    system.summary.semanticLinked=catalog.semantic.decisions.filter(d=>d.role!=='unresolved').length
    for(const row of system.ledger){const decision=decisions.get(row.elementId);if(decision?.role==='unresolved'){row.status='unresolved';row.reason=decision.reason??undefined}}
    system.summary.unresolved=system.ledger.filter(row=>row.status==='unresolved'||row.status==='invalid').length
    system.summary.accounted=system.ledger.length-system.summary.unresolved
  }
  await bucket.put(key,JSON.stringify(system),{httpMetadata:{contentType:'application/json'},onlyIf:{etagDoesNotMatch:'*'}})
  return {derivationId,system}
}
