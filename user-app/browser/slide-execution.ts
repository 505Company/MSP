import { materializeFontSubstitutions } from './fonts'
import { renderComponent } from './component-execution'
import { pptxExportIssues, writeEditablePptx } from '../lib/slides/pptx'
import type { ComponentDefinition, RenderReport } from '../lib/design-system/types'

export async function renderNewSlide(scene:ComponentDefinition,assets:Array<{id:string;bytes:Uint8Array}>):Promise<RenderReport>{
  const rendered=await renderComponent(scene,{},assets,false),issues=[...rendered.issues,...pptxExportIssues(scene)]
  return {...rendered,issues,fits:issues.every(i=>i.severity==='warning')}
}
export async function exportNewSlide(scene:ComponentDefinition,assets:Array<{id:string;bytes:Uint8Array}>):Promise<Uint8Array>{
  const report=await renderNewSlide(scene,assets)
  if(!report.fits)throw new Error(report.issues.filter(i=>i.severity!=='warning').map(i=>i.message).join('\n'))
  return writeEditablePptx(materializeFontSubstitutions(scene),assets)
}
