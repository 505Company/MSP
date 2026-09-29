import { z } from 'zod'
import { getProject, workspaceId } from '../../workspace/storage'
import { createStudioRun,studioSlides } from './context'
import { STUDIO_VERSION,canReflowRecipes, type StudioRun, type RenderReceipt, type DesignOption } from './contract'
import {draftOptions,fastOption,optionSignature} from './options'
import {readStudioHistory,recordStudioHistory} from './history'
import {refreshStudioStatus} from './compact-task'
import {revalidateComponentResponses} from './component-recovery'
import {revalidateCompactResponses} from './compact-recovery'
import {designQuality} from './design-quality'
import {minimumReadableSize} from './readability'
import {incomingRecipeIds} from './recipe-packs'
import {receiptPreservesFields} from './field-bindings'
import {COLOR_ZONE_VERSION,paletteColors,zoneRect,contrast} from './color-zones'
import {BRAND_ACCENTS_VERSION,accentPalette,textContrastMinimum} from './brand-accents'
import {contentHash} from '../../design-system/catalog'
const json={httpMetadata:{contentType:'application/json'}}
export const studioKey=(project:string,revision:string)=>`presentation-studio/${workspaceId.parse(project)}/${workspaceId.parse(revision)}/run.json`
export const studioCancellationKey=(project:string,revision:string)=>studioKey(project,revision).replace('/run.json','/cancelled.json')
export async function readStudioRun(bucket:R2Bucket,project:string,revision:string):Promise<StudioRun|null>{return (await bucket.get(studioKey(project,revision)))?.json<StudioRun>()??null}
export async function assertStudioProject(bucket:R2Bucket,run:StudioRun,recipeUpgrade=false){
  if(run.status==='cancelled'||await bucket.head(studioCancellationKey(run.projectId,run.revision)))throw Error('Генерация остановлена.')
  if(run.version!==STUDIO_VERSION&&!(recipeUpgrade&&canReflowRecipes(run)))throw Error('Вёрстка обновлена. Нажмите «Сгенерировать слайды», чтобы собрать новую версию.')
  const p=await getProject(bucket,run.projectId)
  // Each run owns an immutable content/library snapshot under its revision.
  // Editing the project or starting another mode must not cancel this job.
  if(!p||p.archivedAt)throw Error('Проект не найден или находится в архиве.')
}
export async function startStudioRun(bucket:R2Bucket,project:string,revision:string){
  const p=await getProject(bucket,project);if(!p||p.archivedAt||p.revision!==revision)throw Error('Проект изменился. Обновите страницу.')
  const previous=await readStudioRun(bucket,project,revision);if(previous)return previous
  const run=await createStudioRun(bucket,project,revision)
  await assertStudioProject(bucket,run)
  await bucket.put(studioKey(project,revision),JSON.stringify(run),{...json,onlyIf:{etagDoesNotMatch:'*'}})
  return (await readStudioRun(bucket,project,revision))!
}
/** Explicit local retry: keep completed slides and Qwen's immutable content,
 * rebuild only failed recipe candidates with the current host policy. */
export async function reflowStudioRun(bucket:R2Bucket,project:string,revision:string){
  const run=await readStudioRun(bucket,project,revision)
  if(!run)throw Error('Генерация ещё не начата.')
  await assertStudioProject(bucket,run,true)
  if(run.status==='complete')return run
  if(run.semantic?.strategy==='components'){
    const recovered=await revalidateComponentResponses(bucket,run)
    const {refinedStudioWork}=await import('./refine')
    return mutateStudioRun(bucket,project,revision,next=>{next.version=STUDIO_VERSION;for(const result of recovered){if(next.results[result.work.content.id]?.passed)continue
      const unit=next.semantic!.units!.find(u=>u.id===result.work.content.id)!;unit.status='complete';unit.proof=result.proof;unit.revalidatedResponse=result.response;delete unit.error
      next.slides=next.slides.filter(s=>s.content.id!==result.work.content.id).concat(result.work).sort((a,b)=>Number(a.content.id.split('-')[1])-Number(b.content.id.split('-')[1]))
    }next.slides=next.slides.map(work=>next.results[work.content.id]?.passed?work:refinedStudioWork(work,next.library));refreshStudioStatus(next)},true)
  }
  const recovered=await revalidateCompactResponses(bucket,run)
  const content=run.slides.filter(s=>!run.results[s.content.id]?.passed&&(!run.semantic?.units||run.semantic.units.find(u=>u.id===s.content.id)?.status==='complete')).map(s=>recovered.find(r=>r.content.id===s.content.id)?.content??s.content)
  for(const r of recovered)if(!content.some(c=>c.id===r.content.id))content.push(r.content)
  const replacements=await studioSlides(bucket,project,run.library,content,run.recipeScope)
  return mutateStudioRun(bucket,project,revision,next=>{
    next.version=STUDIO_VERSION
    for(const work of replacements){
      if(next.results[work.content.id]?.passed||next.semantic?.units?.find(u=>u.id===work.content.id)?.status==='running')continue
      const index=next.slides.findIndex(s=>s.content.id===work.content.id);if(index>=0)next.slides[index]=work;else next.slides.push(work)
      const r=recovered.find(r=>r.content.id===work.content.id),unit=next.semantic?.units?.find(u=>u.id===work.content.id)
      if(r&&unit){unit.status='complete';unit.proof=r.proof;unit.revalidatedResponse=r.response;delete unit.error}
    }
    next.slides.sort((a,b)=>Number(a.content.id.split('-')[1])-Number(b.content.id.split('-')[1]))
    if(next.semantic?.units)refreshStudioStatus(next)
    else if(replacements.length){next.status='preparing';delete next.error}
  },true)
}
export async function mutateStudioRun(bucket:R2Bucket,project:string,revision:string,mutate:(run:StudioRun)=>void,recipeUpgrade=false){
  const key=studioKey(project,revision)
  for(let i=0;i<12;i++){
    const file=await bucket.get(key);if(!file)throw Error('Генерация ещё не начата.')
    const run=await file.json<StudioRun>();await assertStudioProject(bucket,run,recipeUpgrade);mutate(run)
    if(await bucket.put(key,JSON.stringify(run),{...json,onlyIf:{etagMatches:file.etag}}))return run
  }
  throw Error('Состояние изменилось в другой вкладке. Обновите страницу.')
}
const number=z.number().finite(),short=z.string().max(500)
export const receiptSchema=z.object({slideId:short,candidateId:short,passed:z.boolean(),preview:z.string().max(4000000).startsWith('data:image/png;base64,'),html:z.string().max(4000000),
  optionId:short.optional(),quality:z.object({score:number.min(0).max(100),reasons:z.array(short).max(30)}).strict().optional(),
  colorZone:z.object({version:z.literal(COLOR_ZONE_VERSION),axis:z.enum(['vertical','horizontal']),fraction:z.union([z.literal(.5),z.literal(.4),z.literal(.25)]),side:z.enum(['start','end']),color:z.string().regex(/^#[\dA-F]{6}$/),rect:z.object({x:number,y:number,w:number,h:number}).strict(),minContrast:number.min(4.5).max(21)}).strict().optional(),
  brandAccents:z.object({version:z.literal(BRAND_ACCENTS_VERSION),colors:z.array(z.string().regex(/^#[\dA-F]{6}$/)).max(32),panel:z.object({blockId:short,color:z.string().regex(/^#[\dA-F]{6}$/),rect:z.object({x:number.min(24),y:number.min(24),w:number.min(400),h:number.min(360)}).strict(),emptyRatio:number.min(.7).max(1),minContrast:number.min(3).max(21)}).strict().optional()}).strict().optional(),
  layout:z.record(z.object({x:number,y:number,w:number.positive(),h:number.positive()}).strict()).optional(),
  dataValues:z.array(z.object({blockId:short,templateId:short,values:z.unknown()}).strict()).max(30).optional(),
  blockIds:z.array(short).max(150),issues:z.array(short).max(200),warnings:z.array(short).max(200),elapsedMs:number.nonnegative(),
  components:z.array(z.object({blockId:short,componentId:short,kind:z.enum(['prepared','editable']),width:number.positive(),height:number.positive(),state:z.enum(['vertical','horizontal','compact']).optional()}).strict()).max(150),
  text:z.array(z.object({blockId:short,field:short,value:z.string().max(100000),sourceRange:z.object({start:number.int().nonnegative(),end:number.int().nonnegative()}).strict().optional(),size:number.positive(),x:number,y:number,width:number.nonnegative(),height:number.nonnegative(),font:short,color:short,weight:number}).strict()).max(1000),
}).strict()
export function validateReceipt(run:StudioRun,raw:unknown,preflight=false):RenderReceipt{
  const r=receiptSchema.parse(raw) as RenderReceipt,slide=run.slides.find(s=>s.content.id===r.slideId)
  if(r.colorZone&&(!paletteColors(run.library).includes(r.colorZone.color)||r.colorZone.axis==='vertical'&&r.colorZone.fraction!==.5||JSON.stringify(r.colorZone.rect)!==JSON.stringify(zoneRect(r.colorZone.axis,r.colorZone.fraction,r.colorZone.side))))throw Error('Цветовая зона не соответствует палитре или разрешённому делению слайда.')
  if(r.brandAccents){
    if(r.colorZone||r.brandAccents.colors.some(c=>c!=='#FFFFFF'&&!paletteColors(run.library).includes(c)))throw Error('Акценты не соответствуют палитре дизайн-системы.')
    const p=r.brandAccents.panel
    if(p){
      const fields=r.text.filter(t=>t.blockId===p.blockId),ratio=contrast('#FFFFFF',p.color)
      if(!accentPalette(run.library).includes(p.color)||p.rect.x+p.rect.w>1896||p.rect.y+p.rect.h>1056||!fields.length||Math.abs(p.minContrast-ratio)>.01||fields.some(t=>t.color!=='#FFFFFF'||ratio<textContrastMinimum(t.size,t.weight)))throw Error('Акцентная плашка должна быть яркой и содержать читаемый белый текст.')
    }
  }
  if(run.version!==STUDIO_VERSION||!slide||!preflight&&!slide.plan||!slide.candidates.some(c=>c.id===r.candidateId))throw Error('Измерение относится к другому рецепту.')
  if(run.recipeScope==='new'&&!slide.fallback&&!incomingRecipeIds.has(slide.candidates.find(c=>c.id===r.candidateId)!.recipeId))throw Error('В этой проверке разрешены только новые рецепты.')
  if(r.blockIds.length!==slide.content.blocks.length||new Set(r.blockIds).size!==r.blockIds.length||slide.content.blocks.some(b=>!r.blockIds.includes(b.id)))throw Error('Нарушена сохранность содержания.')
  if(r.passed&&r.issues.length)throw Error('Слайд с переполнением не может быть готов.')
  for(const b of slide.content.blocks)if(r.passed&&!receiptPreservesFields(b,r.text))throw Error('Потеря поля содержания или повтор исходного фрагмента.')
  for(const b of slide.content.blocks.filter(b=>b.data))if(r.passed&&!r.dataValues?.some(d=>d.blockId===b.id&&d.templateId===b.data!.template.id&&JSON.stringify(d.values)===JSON.stringify(b.data!.values)))throw Error('Изменены или потеряны данные таблицы/графика.')
  if(r.components.some(c=>!slide.bindings[c.blockId]?.some(b=>b.id===c.componentId)&&!slide.content.blocks.find(b=>b.id===c.blockId)?.data))throw Error('Неизвестный компонент в результате.')
  const fixedComponents=slide.candidates.find(c=>c.id===r.candidateId)?.fixedComponents??(slide.strictComponents?slide.plan?.components:undefined)
  if(fixedComponents&&r.passed&&(r.components.length!==slide.content.blocks.length||new Set(r.components.map(c=>c.blockId)).size!==r.components.length||r.components.some(c=>c.componentId!==fixedComponents[c.blockId])))throw Error('В режиме компонентов запрещены пропуски и подмена выбора Qwen.')
  if(r.passed&&r.text.some(t=>{const block=slide.content.blocks.find(b=>b.id===t.blockId);return !block||t.size<minimumReadableSize(block,t.field)-.1}))throw Error('Текст меньше читаемого минимума.')
  if(fixedComponents&&r.passed){
    const boxes=Object.entries(r.layout??{});if(boxes.length!==slide.content.blocks.length)throw Error('Нет измеренной геометрии компонентов.')
    for(const [id,b] of boxes){if(!slide.content.blocks.some(c=>c.id===id)||b.x<47||b.y<47||b.x+b.w>1873||b.y+b.h>1033)throw Error('Нарушены поля слайда.')
      const component=r.components.find(c=>c.blockId===id)!;if(Math.abs(component.width-b.w)>2||Math.abs(component.height-b.h)>2)throw Error('Размер компонента не совпадает с измеренной областью.')
      for(const [other,c] of boxes)if(other!==id&&Math.min(b.x+b.w,c.x+c.w)-Math.max(b.x,c.x)>1&&Math.min(b.y+b.h,c.y+c.h)-Math.max(b.y,c.y)>1)throw Error('Пересечение компонентов.')
    }
  }
  if(preflight&&r.quality)r.quality=designQuality(slide.content,slide.candidates.find(c=>c.id===r.candidateId)!,r)
  if(!preflight&&slide.options?.length){
    const selected=slide.options.find(o=>o.id===slide.plan?.optionId)?.receipt
    if(!selected||JSON.stringify(r)!==JSON.stringify(receiptSchema.parse(selected)))throw Error('После выбора используется сохранённое превью; повторная вёрстка недопустима.')
  }
  return r
}
export function applyStudioOption(run:StudioRun,slideId:string,optionId:string,rationale?:string){
  const slide=run.slides.find(s=>s.content.id===slideId),option=slide?.options?.find(o=>o.id===optionId)
  if(!slide||!option?.receipt?.passed)throw Error('Этот вариант не прошёл проверку вёрстки.')
  slide.plan={...option.plan,rationale:rationale??option.plan.rationale}
  run.results[slideId]=option.receipt
  delete slide.error
  run.status=run.slides.every(s=>run.results[s.content.id]?.passed)?'complete':run.slides.every(s=>s.options?.length)?'planning':'preparing'
  delete run.error
  refreshStudioStatus(run)
}
const optionsSchema=z.object({slideId:short,options:z.array(z.object({id:short,receipt:receiptSchema}).strict()).min(1).max(3)}).strict()
export async function commitStudioOptions(bucket:R2Bucket,project:string,revision:string,raw:unknown){
  const payload=optionsSchema.parse(raw),history=await readStudioHistory(bucket,project)
  const run=await mutateStudioRun(bucket,project,revision,run=>{
    const slide=run.slides.find(s=>s.content.id===payload.slideId);if(!slide)throw Error('Неизвестный слайд.')
    // First valid submission wins. A resumed tab cannot replace previews after
    // the model has seen them or invalidate a saved selection.
    if(slide.options?.length)return
    const drafts=draftOptions(slide,run.library),seen=new Set<string>()
    const options=payload.options.map(({id,receipt}):DesignOption=>{
      const draft=drafts.find(d=>d.id===id),r=validateReceipt(run,receipt,true)
      if(!draft||!r.passed||r.slideId!==slide.content.id||r.optionId!==id||r.candidateId!==draft.plan.candidateId)throw Error('Превью не соответствует варианту рецепта.')
      const candidate=slide.candidates.find(c=>c.id===r.candidateId)!
      const components=Object.fromEntries(r.components.filter(c=>slide.strictComponents||candidate.fixedComponents||!slide.content.blocks.find(b=>b.id===c.blockId)?.data).map(c=>[c.blockId,c.componentId]))
      const signature=optionSignature(candidate,run.library,components,Object.fromEntries(r.components.flatMap(c=>c.state?[[c.blockId,c.state]]:[])))
      if(seen.has(signature))throw Error('Одинаковые композиции не считаются разными вариантами.')
      seen.add(signature)
      return {...draft,signature,plan:{...draft.plan,components},receipt:r}
    })
    slide.options=options
    const unit=run.semantic?.units?.find(u=>u.id===slide.content.id)
    // A previously validated plan can become renderable after a local repair,
    // even if a later attempted replacement was rejected. Keep its proof.
    if(run.semantic?.strategy==='components'&&unit?.proof){unit.status='complete';delete unit.error}
    if(run.mode==='fast'||run.semantic?.units||run.semantic?.status==='complete'||options.length===1){
      // Other modes can finish while this worker measures the slide. The
      // signature history must be as current as the recipe history; otherwise
      // its older ordering overrides every fresh cross-mode design signal.
      const recent=history.entries.filter(e=>(slide.diversityKey?e.diversityKey===slide.diversityKey:!!slide.contentKey&&e.contentKey===slide.contentKey)&&e.revision!==run.revision)
      if(recent.length){slide.history=recent.map(e=>e.signature);slide.previousDesigns=recent.flatMap(e=>e.design?[e.design]:[]).slice(-6)}
      const choice=fastOption(slide,run.slides.filter(s=>s!==slide&&s.plan).map(s=>s.plan!.candidateId))
      applyStudioOption(run,slide.content.id,choice.id,slide.strictComponents?slide.plan?.rationale:run.semantic?'Qwen сгруппировал содержание. Сервис выбрал совместимую композицию после измерения текста.':options.length===1?'Один подходящий вариант в текущем наборе рецептов.':'Композиция выбрана с учётом предыдущих результатов и других слайдов.')
    }
    else run.status=run.slides.every(s=>s.options?.length)?'planning':'preparing'
  })
  await recordStudioHistory(bucket,run);return run
}
export async function chooseStudioOption(bucket:R2Bucket,project:string,revision:string,slideId:string,optionId:string){
  const run=await mutateStudioRun(bucket,project,revision,run=>applyStudioOption(run,slideId,optionId,'Выбрано пользователем из проверенных вариантов.'))
  await recordStudioHistory(bucket,run);return run
}
export async function commitStudioRender(bucket:R2Bucket,project:string,revision:string,raw:unknown){return mutateStudioRun(bucket,project,revision,run=>{
  const result=validateReceipt(run,raw);run.results[result.slideId]=result
  run.status=run.slides.every(s=>run.results[s.content.id])?(run.slides.every(s=>run.results[s.content.id].passed)?'complete':'blocked'):'rendering'
})}

/** Explicit paint-only refresh of a completed slide and all its alternatives.
 * CAS protects another tab's selection; the complete old run is recoverable. */
const appearanceInvariant=(receipt:RenderReceipt)=>{const r=receiptSchema.parse(receipt);return JSON.stringify({...r,html:undefined,preview:undefined,colorZone:undefined,brandAccents:undefined,text:r.text.map(t=>({...t,color:undefined}))})}

/** Restore legacy bands from their immutable pre-treatment backup, matched by
 * option and measured content. Current selection and newer work never roll back. */
export async function readStudioAppearanceSources(bucket:R2Bucket,project:string,revision:string){
  const run=await readStudioRun(bucket,project,revision)
  if(!run||run.status!=='complete')throw Error('Сначала завершите создание слайдов.')
  await assertStudioProject(bucket,run)
  const legacy=await bucket.get(studioKey(project,revision).replace('/run.json',`/before-${COLOR_ZONE_VERSION}.json`))
  const baseline=legacy?await legacy.json<StudioRun>():null
  return Object.fromEntries(run.slides.map(work=>[work.content.id,(work.options?.map(o=>o.receipt!)??[run.results[work.content.id]]).map(receipt=>{
    if(!receipt.colorZone)return receipt
    const old=baseline?.slides.find(s=>s.content.id===work.content.id)
    const source=receipt.optionId?old?.options?.find(o=>o.id===receipt.optionId)?.receipt:baseline?.results[work.content.id]
    if(!source||source.colorZone||appearanceInvariant(source)!==appearanceInvariant(receipt))throw Error('Не найден исходный вариант слайда до цветовых заливок.')
    return source
  })]))
}

export async function refreshStudioColors(bucket:R2Bucket,project:string,revision:string,raw:unknown){
  const payload=z.object({slideId:short,basis:z.string().min(1).max(128),receipts:z.array(receiptSchema).min(1).max(3)}).strict().parse(raw)
  const before=await readStudioRun(bucket,project,revision)
  if(!before||before.status!=='complete')throw Error('Сначала завершите создание слайдов.')
  await assertStudioProject(bucket,before)
  const original=before.slides.find(s=>s.content.id===payload.slideId)
  if(!original)throw Error('Не найден слайд.')
  const saved=original.options?.map(o=>o.receipt!)??[before.results[payload.slideId]]
  if(payload.basis!==await contentHash(saved)||saved.length!==payload.receipts.length)throw Error('Оформление изменилось в другой вкладке. Обновите страницу.')
  const replacements=payload.receipts.map((raw,i)=>{
    const r=validateReceipt(before,raw,true)
    if(!r.passed||appearanceInvariant(r)!==appearanceInvariant(saved[i]))throw Error('При обновлении цвета нельзя менять содержание, компоненты или геометрию.')
    return r
  })
  const version=replacements.some(r=>r.brandAccents)?BRAND_ACCENTS_VERSION:COLOR_ZONE_VERSION
  await bucket.put(studioKey(project,revision).replace('/run.json',`/before-${version}.json`),JSON.stringify(before),{...json,onlyIf:{etagDoesNotMatch:'*'}})
  return mutateStudioRun(bucket,project,revision,run=>{
    const slide=run.slides.find(s=>s.content.id===payload.slideId)!
    if(run.status!=='complete'||JSON.stringify(slide)!==JSON.stringify(original)||JSON.stringify(run.results[payload.slideId])!==JSON.stringify(before.results[payload.slideId]))throw Error('Оформление изменилось в другой вкладке. Обновите страницу.')
    slide.options?.forEach((option,i)=>{option.receipt=replacements[i]})
    run.results[payload.slideId]=replacements.find(r=>r.optionId===before.results[payload.slideId].optionId)??replacements[0]
  })
}
