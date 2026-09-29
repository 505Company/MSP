import type { PreparedPresentation } from './source-types'
import type { ComponentQualification } from '../design-system/calibration-contract'
import type { ComponentDefinition, RenderReport } from '../design-system/types'
import type { BoundScene, DeckEvidence, RenderedDeckSlide, SceneInput } from '../presentations/deck-contract'
type Assets = Array<{id:string;bytes:Uint8Array}>
type Reader={rereadSourceSlides(bytes:Uint8Array,name:string,slides:number[],signal?:AbortSignal):Promise<Pick<PreparedPresentation,'snapshot'|'assets'|'previews'>>;transferVersion:2;executionVersion:15;qualifyComponent(component:ComponentDefinition,assets:Assets):Promise<ComponentQualification>;preparePresentation(bytes:Uint8Array,name:string,onProgress?:(current:number,total:number)=>void):Promise<PreparedPresentation>;renderComponent(component:ComponentDefinition,values:Record<string,string>,assets:Assets):Promise<RenderReport>;renderNewSlide(scene:ComponentDefinition,assets:Assets):Promise<RenderReport>;exportNewSlide(scene:ComponentDefinition,assets:Assets):Promise<Uint8Array>;
prepareDeckEvidence(resources:ComponentDefinition[],families:string[],assets:Assets):Promise<DeckEvidence>;renderDeckSlide(scene:BoundScene,input:SceneInput,sceneHash:string,assets:Assets):Promise<RenderedDeckSlide>}
let pending:Promise<Reader>|null=null
export function loadPresentationReader():Promise<Reader>{
  const scope=window as typeof window & {MspPptxReader?:Reader}
  if(scope.MspPptxReader?.transferVersion===2&&scope.MspPptxReader.executionVersion===15)return Promise.resolve(scope.MspPptxReader)
  if(pending)return pending
  pending=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='/pptx-reader.js?v=msp-execution-v15-2026-09-29';script.async=true
    script.onload=()=>{
      if(scope.MspPptxReader?.transferVersion===2&&scope.MspPptxReader.executionVersion===15)resolve(scope.MspPptxReader)
      else{pending=null;script.remove();reject(new Error('Не удалось подключить читатель PPTX'))}
    }
    script.onerror=()=>{pending=null;script.remove();reject(new Error('Не удалось загрузить читатель PPTX. Проверьте соединение.'))}
    document.head.appendChild(script)
  })
  return pending
}
