import { normalizeText } from '../../lib/presentations/studio/material'
import { candidatesFor } from '../../lib/presentations/studio/recipes'
import { componentBindings, fastPlan } from '../../lib/presentations/studio/bindings'
import { STUDIO_VERSION, type GenerationMode, type StudioRun, type StudioLibrary } from '../../lib/presentations/studio/contract'
import {draftOptions} from '../../lib/presentations/studio/options'
export const studioText=`# Путешествия становятся проще

76%
поездок пользователи планируют самостоятельно

01 — Понять гостя
Помочь человеку решить его конкретную задачу.

02 — Дать свободу
Предложить понятный выбор.

По данным аналитики, 2026 год.
---
# Сервис начинается с внимания

Понятные рекомендации
Маршруты, размещение и активности в одном месте.`
export function studioFixture(mode:GenerationMode='fast',text=studioText):StudioRun{
  const library:StudioLibrary={id:'a'.repeat(64),uploadId:'a7e332ce-47fa-44e8-94bc-ddf9845afed2',name:'Независимая дизайн-система',tokens:{fonts:[{family:'Play',sizes:[28,36,64],occurrences:5}],colors:[{hex:'#FFFFFF',occurrences:5},{hex:'#162D40',occurrences:5},{hex:'#00805E',occurrences:2}]},rules:[],prepared:{},editable:[]}
  const slides=normalizeText(text).map(content=>({content,candidates:candidatesFor(content),bindings:Object.fromEntries(content.blocks.map(b=>[b.id,componentBindings(b,library)]))}))
  return {version:STUDIO_VERSION,id:'b'.repeat(64),projectId:'e701794b-e9bd-4a4c-97aa-2c0d73b1d07a',revision:'89956822-26f0-4f78-9d86-9715795a3137',createdAt:'2026-09-28T00:00:00Z',mode,library,slides:slides.map((s,i)=>({...s,...mode==='fast'?{plan:fastPlan(s,i)}:{}})),status:mode==='fast'?'rendering':'planning',results:{},modelRequests:0,modelRunIds:[]}
}
/** Browser-free receipts for storage/model contract tests only. Real geometry
 * and pixels are checked by the browser suite, never asserted from these. */
export function measuredStudioFixture(mode:GenerationMode='smart'){
  const run=studioFixture(mode);run.status='planning'
  for(const s of run.slides){
    delete s.plan;s.contentKey=`content-${s.content.id}`;s.history=[]
    s.options=draftOptions(s,run.library).slice(0,3).map(o=>({...o,receipt:{slideId:s.content.id,optionId:o.id,candidateId:o.plan.candidateId,passed:true,preview:'data:image/png;base64,'+Buffer.from(o.id).toString('base64'),html:`<main>${o.id}</main>`,blockIds:s.content.blocks.map(b=>b.id),issues:[],warnings:[],elapsedMs:1,components:[],text:s.content.blocks.flatMap(b=>Object.entries(b.fields).map(([field,value])=>({blockId:b.id,field,value,size:b.role==='title'||field==='value'?64:32,x:0,y:0,width:100,height:80,font:'Play',color:'#162D40',weight:400})))}}))
  }
  return run
}
