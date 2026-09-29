import type { EditableCatalog } from './editable-contract'
import { COMPONENT_FLOW_VERSION, flowCases, componentFlowReportSchema, proposeComponentFlow, flowProfileKey, type ComponentFlowReport } from './component-adaptation'
const key=(uploadId:string,catalogId:string)=>`component-adaptations/${uploadId}/${catalogId}/${COMPONENT_FLOW_VERSION}.json`
export async function readComponentAdaptation(bucket:R2Bucket,uploadId:string,catalogId:string) {
  return (await bucket.get(key(uploadId,catalogId)))?.json<ComponentFlowReport>()
}
export async function validateComponentAdaptation(raw:unknown,catalog:EditableCatalog) {
  const report=componentFlowReportSchema.parse(raw),passed=new Set(catalog.qualification?.checks.filter(c=>c.passed).map(c=>c.id)),templates=catalog.families.flatMap(f=>f.variants).filter(t=>passed.has(t.id)&&proposeComponentFlow(t))
  if(report.catalogId!==catalog.id||report.checks.length!==templates.length||new Set(report.checks.map(c=>c.id)).size!==templates.length)throw Error('Неполная проверка адаптации')
  const names=flowCases.map(c=>c.name),widths=flowCases.map(c=>c.width)
  for(const check of report.checks){const t=templates.find(t=>t.id===check.id)
    if(!t||check.profile!==await flowProfileKey(t)||check.name!==t.name||check.cases.length!==names.length||check.cases.some((c,i)=>c.name!==names[i]||c.width!==widths[i]||c.expected!==flowCases[i].expected||c.passed!==!c.issues.length||c.passed&&(c.height<1||c.height>720||c.pixels.length!==2||c.pixels.some(n=>n<3)))||check.passed!==(!check.issues.length&&check.cases.every(c=>c.passed===c.expected)))throw Error('Некорректное доказательство адаптации')
  }
  return report
}
export async function saveComponentAdaptation(bucket:R2Bucket,uploadId:string,catalog:EditableCatalog,raw:unknown) {
  const report=await validateComponentAdaptation(raw,catalog)
  await bucket.put(key(uploadId,catalog.id),JSON.stringify(report),{httpMetadata:{contentType:'application/json'},onlyIf:{etagDoesNotMatch:'*'}})
  return (await readComponentAdaptation(bucket,uploadId,catalog.id))!
}
