import { visibleElements, instantiateComponent } from '../lib/design-system/compiler'
import type { ComponentDefinition, RenderReport } from '../lib/design-system/types'
import { renderSlidePreview, measureTextBox } from '../vendor/drag/src/formats/pptx/preview'
import { parsePageIR } from '../vendor/drag/src/core/page-ir'
import { ensureSceneFonts } from './fonts'

export async function renderComponent(component:ComponentDefinition,values:Record<string,string>,assets:Array<{id:string;bytes:Uint8Array}>,transparent=true):Promise<RenderReport>{
  await document.fonts.ready
  const scene=instantiateComponent(component,values)
  const page=parsePageIR({schemaVersion:1,id:component.id,sourceIndex:component.source.slide-1,...scene,assets,degradations:[]})
  const issues=[...component.issues]
  const all=visibleElements(page.elements),texts=all.filter(e=>e.kind==='text')
  issues.push(...await ensureSceneFonts(page.elements))
  for(const text of texts){
    const m=await measureTextBox(text)
    if(m.overflow)issues.push({code:'text-overflow',elementId:text.id,message:`«${text.name}»: текст не помещается в исходное поле (${Math.round(m.width)} × ${Math.round(m.height)} вместо ${Math.round(text.bounds.width)} × ${Math.round(text.bounds.height)} px).`})
  }
  // Do not present a clipped version as the user's complete new text.
  const dataUrl=issues.some(i=>i.code==='text-overflow')?'':await renderSlidePreview(page,1024,undefined,transparent)
  return {dataUrl,issues,fits:issues.every(i=>i.severity==='warning')}
}
