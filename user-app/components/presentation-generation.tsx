"use client"
import { useEffect, useState } from 'react'
import { STUDIO_VERSION,canReflowRecipes, type StudioRun } from '@/lib/presentations/studio/contract'
import { BRAND_ACCENTS_VERSION,canApplyBrandAccents } from '@/lib/presentations/studio/brand-accents'
import { contentHash } from '@/lib/design-system/catalog'
import { renderStudioOptions } from '@/browser/studio-generation'
import { PresentationSlideGallery } from './presentation-slide-gallery'
import { displayStudioError,needsStudioReparse,studioSlideFeedback } from '@/lib/presentations/studio/run-feedback'
import {generationPreview} from '@/lib/presentations/studio/generations'
import {needsLocalRecovery} from '@/lib/presentations/studio/fallback-content'

// A project may have dozens of large saved runs. Read the gallery in order;
// active generation requests retain their independent progress.
let galleryRead:Promise<unknown>=Promise.resolve()
function readGeneration(url:string,signal:AbortSignal,preview:boolean){
  const request=async()=>{signal.throwIfAborted();const response=await fetch(url,{signal,cache:'no-store'}),data=await response.json() as {run:StudioRun|null;configured:boolean;error?:string;background?:{status:string;available:boolean;progress:{detail:string}}};if(!response.ok)throw Error(data.error);return data}
  if(!preview)return request()
  const result=galleryRead.then(request,request);galleryRead=result.catch(()=>{});return result
}

export function PresentationGeneration({projectId,revision,paused,allowStart,onSettled,onRunChange,selectedSlides,onToggleSlide}:{projectId:string;revision:string;paused:boolean;allowStart:boolean;onSettled?:(revision:string)=>void;onRunChange?:(run:StudioRun)=>void;selectedSlides?:Set<string>;onToggleSlide?:(revision:string,id:string)=>void}){
  const [run,setRun]=useState<StudioRun|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[retry,setRetry]=useState(0)
  const [working,setWorking]=useState(false)
  const [coloring,setColoring]=useState(false)
  useEffect(()=>{if(run)onRunChange?.(run)},[run,onRunChange])
  useEffect(()=>{
    if(paused)return
    const controller=new AbortController(),signal=controller.signal,url=`/api/projects/${projectId}/compose`
    const show=(s:string)=>{if(!signal.aborted)setMessage(s)}
    let executingLocally=false,serverOwned=false
    const read=()=>readGeneration(`${url}?revision=${encodeURIComponent(revision)}${executingLocally?'':'&preview=1'}`,signal,!executingLocally&&!allowStart&&!retry)
    const readFull=()=>readGeneration(`${url}?revision=${encodeURIComponent(revision)}`,signal,false)
    const post=async(action:string,receipt?:unknown,slideId?:string)=>{const r=await fetch(url,{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,action,...receipt?{receipt}:{},...slideId?{slideId}:{}})});if(!r.ok)throw Error(((await r.json()) as {error:string}).error);return r}
    const recover=async(current:StudioRun)=>{
      if(current.status==='cancelled'){if(!signal.aborted)setRun(current);return current}
      const missing=studioSlideFeedback(current).filter(s=>!s.result?.passed||needsLocalRecovery(current,s.work)).map(s=>s.id)
      if(missing.length&&current.previewOnly)current=(await readFull()).run!
      for(const id of missing){
        signal.throwIfAborted();show('Подбираем рецепт и размер текста…')
        const {renderStudioFallback}=await import('@/browser/studio-fallback')
        const receipt=await renderStudioFallback(current,id,signal)
        current=((await(await post('fallback',receipt,id)).json()) as {run:StudioRun}).run
        if(!signal.aborted)setRun(current)
      }
      return current
    }
    void(async()=>{
      setWorking(true);setError('');show('Открываем слайды…')
      let view=await read(),initial=view.run
      if(initial&&initial.revision!==revision)return
      if(!initial&&!allowStart&&!retry){show('Содержание сохранено. Выберите режим и нажмите «Сгенерировать слайды».');return}
      if(!initial){show('Подбираем рецепты и компоненты…');initial=((await(await post('start')).json()) as {run:StudioRun}).run;view=await read()}
      if(!initial)throw Error('Не удалось начать генерацию.')
      let current:StudioRun=initial
      if(!signal.aborted)setRun(current)
      if(retry&&view.background&&current.status!=='complete'&&current.status!=='cancelled'){await post('resume');view=await read()}
      if(view.background&&['queued','running','retrying'].includes(view.background.status)){
        serverOwned=true
        while(view.run&&!['complete','cancelled'].includes(view.run.status)){
          signal.throwIfAborted();setRun(view.run);show(view.background?.progress.detail??'Генерация выполняется в фоне…')
          if(view.background?.status==='blocked')throw Error('Фоновый обработчик приостановился. Готовые слайды сохранены.')
          await new Promise<void>((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(signal.reason)},timer=window.setTimeout(()=>{signal.removeEventListener('abort',stop);resolve()},2500);signal.addEventListener('abort',stop,{once:true})})
          view=await read()
        }
        if(view.run)setRun(view.run)
        onSettled?.(revision);return
      }
      if(current.status==='cancelled'){onSettled?.(revision);return}
      if(current.status==='complete'){await recover(current);onSettled?.(revision);return}
      executingLocally=true
      if(current.previewOnly)current=(await readFull()).run!
      if(needsStudioReparse(current)){await recover(current);onSettled?.(revision);return}
      if(current.version!==STUDIO_VERSION&&!(retry&&canReflowRecipes(current))){await recover(current);onSettled?.(revision);return}
      if(retry){
        show(current.semantic?.strategy==='components'?'Проверяем сохранённые решения компонентов…':'Повторно подбираем рецепты для сохранённого содержания…')
        current=((await(await post('reflow')).json()) as {run:StudioRun}).run
        if(!signal.aborted)setRun(current)
      }
      if(current.status!=='complete'&&!allowStart&&!retry){await recover(current);onSettled?.(revision);return}
      if(current.status==='blocked'&&!retry){await recover(current);onSettled?.(revision);return}
      if(current.semantic?.units){
        // Each worker owns one durable slide job and its local render.
        // Component planning is heavier; three independent slides can progress
        // together without combining their responses or repeating successes.
        const queue=current.semantic.units.filter(u=>!current.results[u.id]?.passed).map(u=>u.id),errors:string[]=[],repairs=new Set<string>(),measured=new Set<string>()
        const repair=(id:string,semanticFailure=false)=>{const key=`${id}/${semanticFailure?'semantic':'geometry'}`;if((!semanticFailure&&current.semantic?.strategy!=='components')||repairs.has(key))return false;repairs.add(key);queue.push(id);return true}
        const publish=async()=>{const latest=(await read()).run!;if(!signal.aborted)setRun(latest);return latest}
        const worker=async()=>{
          while(queue.length){
            signal.throwIfAborted();const id=queue.shift()!
            try{
              let latest=await publish(),unit=latest.semantic!.units!.find(u=>u.id===id)!
              const previous=latest.slides.find(s=>s.content.id===id)
              if(previous?.strictComponents&&previous.error&&unit.proof&&!measured.has(id)){
                // A renderer update can fix the saved model plan for free.
                // Otherwise provide current measured sizes, not stale errors.
                show(`Проверяем сохранённую сетку слайда ${unit.packet.index+1}…`)
                try{
                  const options=await renderStudioOptions(latest.library,previous,signal)
                  await post('options',{slideId:id,options:options.map(o=>({id:o.id,receipt:o.receipt}))});await publish();continue
                }catch(error){
                  if(signal.aborted)throw error
                  await post('fail',{slideId:id,error:(error instanceof Error?error.message:'Вёрстка не завершена.').slice(0,4000)})
                  measured.add(id)
                  latest=await publish();unit=latest.semantic!.units!.find(u=>u.id===id)!
                }
              }
              if(unit.status!=='complete'||latest.semantic?.strategy==='components'&&latest.slides.find(s=>s.content.id===id)?.error){
                show(`Qwen разбирает слайды. Готово ${Object.keys(latest.results).length} из ${latest.semantic!.units!.length}…`)
                await(await post('structure',undefined,id)).text();latest=await publish();unit=latest.semantic!.units!.find(u=>u.id===id)!
                if(unit.status!=='complete'){if(!repair(id,true))errors.push(unit.error??`${id}: разбор не завершён`);continue}
              }
              const work=latest.slides.find(s=>s.content.id===id)!
              if(!work.candidates.length&&work.error){errors.push(`${id}: ${work.error}`);continue}
              if(work.options?.length)continue
              show(`Размещаем содержание слайда ${unit.packet.index+1}…`)
              try{
                const options=await renderStudioOptions(latest.library,work,signal)
                await post('options',{slideId:id,options:options.map(o=>({id:o.id,receipt:o.receipt}))});await publish()
              }catch(error){
                if(signal.aborted)throw error
                const message=error instanceof Error?error.message:'Вёрстка не завершена.'
                await post('fail',{slideId:id,error:message.slice(0,4000)});measured.add(id);if(!repair(id))errors.push(`${id}: ${message}`);await publish()
              }
            }catch(error){if(signal.aborted)throw error;errors.push(error instanceof Error?error.message:`${id}: ошибка запроса`)}
          }
        }
        await Promise.all(Array.from({length:current.semantic.strategy==='components'?3:2},()=>worker()));current=await recover(await publish())
        if(current.status!=='complete'){setError(current.error||errors.join('\n')||'Часть слайдов требует проверки.');onSettled?.(revision);return}
        show(`Готово: ${current.slides.length} слайдов.`);onSettled?.(revision);return
      }
      if(current.semantic?.status==='pending'){
        show('Qwen разбирает исходный текст: связывает факты, пояснения и смысловые группы…')
        await(await post('structure')).text();current=(await read()).run!
        if(!signal.aborted)setRun(current)
        if(current.error)throw Error(current.error)
        if(current.semantic?.status!=='complete')throw Error('Разбор содержания ещё не завершён. Готовые этапы сохранены.')
      }
      for(const [i,slide] of current.slides.entries()){
        signal.throwIfAborted();if(slide.options?.length)continue
        show(`Готовим варианты слайда ${i+1} из ${current.slides.length}…`)
        let options:Awaited<ReturnType<typeof renderStudioOptions>>
        try{options=await renderStudioOptions(current.library,slide,signal)}catch(error){
          if(!signal.aborted){const message='Вёрстка слайда '+(i+1)+': '+(error instanceof Error?error.message:'не завершена.');current=((await(await post('fail',{slideId:slide.content.id,error:message.slice(0,2000)})).json()) as {run:StudioRun}).run;setRun(current)}
          if(signal.aborted)throw error
          continue
        }
        signal.throwIfAborted();current=((await(await post('options',{slideId:slide.content.id,options:options.map(o=>({id:o.id,receipt:o.receipt}))})).json()) as {run:StudioRun}).run
        if(!signal.aborted)setRun(current)
      }
      while(current.mode!=='fast'&&current.slides.some(s=>!s.plan&&!s.error)){
        show('Qwen сравнивает готовые варианты по изображениям…')
        const count=current.slides.filter(s=>s.plan).length
        const response=await post('design');await response.text();current=(await read()).run!
        if(current.error)throw Error(current.error)
        if(current.slides.filter(s=>s.plan).length===count)throw Error('Выбор оформления не завершён или ещё выполняется в другой вкладке. Готовые этапы сохранены.')
        if(!signal.aborted)setRun(current)
      }
      current=await recover(current)
      show(current.status==='complete'?`Готово: ${current.slides.length} слайдов.`:'Часть слайдов требует исправления содержания.')
      onSettled?.(revision)
    })().catch(async e=>{if(!signal.aborted){try{if(serverOwned)throw e;const current=(await read()).run;if(!current)throw e;await recover(current)}catch(error){if(!signal.aborted)setError(error instanceof Error?error.message:'Не удалось открыть сохранённое содержание.')}if(!signal.aborted)onSettled?.(revision)}}).finally(()=>{if(!signal.aborted)setWorking(false)})
    return()=>controller.abort()
  },[projectId,revision,paused,allowStart,retry,onSettled])
  const current=run?.revision===revision?run:null
  const reparse=!!current&&needsStudioReparse(current)
  async function fullRun(){
    if(!current)throw Error('Генерация ещё не загружена.')
    if(!current.previewOnly)return current
    const response=await fetch(`/api/projects/${projectId}/compose?revision=${revision}`,{cache:'no-store'}),data=await response.json() as {run:StudioRun;error?:string}
    if(!response.ok||!data.run)throw Error(data.error??'Не удалось открыть сохранённые слайды.')
    return data.run
  }
  const needsColors=current?.status==='complete'&&current.version===STUDIO_VERSION&&current.slides.some(s=>(s.options?.map(o=>o.receipt!)??[current.results[s.content.id]]).some(r=>canApplyBrandAccents(s.content,s.candidates.find(c=>c.id===r.candidateId))&&r.brandAccents?.version!==BRAND_ACCENTS_VERSION))
  async function colorize(){
    if(!current||coloring)return
    setColoring(true);setError('')
    try{
      const {restyleStudioReceipt}=await import('@/browser/studio-color-zones')
      const sourceResponse=await fetch(`/api/projects/${projectId}/compose?revision=${revision}&appearanceSource=1`,{cache:'no-store'}),sourceData=await sourceResponse.json() as {sources:Record<string,StudioRun['results'][string][]>;error?:string}
      if(!sourceResponse.ok)throw Error(sourceData.error??'Не удалось открыть исходные слайды.')
      let latest=await fullRun()
      for(const [index,s] of latest.slides.entries()){
        const originals=s.options?.map(o=>o.receipt!)??[latest.results[s.content.id]]
        if(originals.every(r=>r.brandAccents?.version===BRAND_ACCENTS_VERSION||!canApplyBrandAccents(s.content,s.candidates.find(c=>c.id===r.candidateId))))continue
        setMessage(`Обновляем акценты: слайд ${index+1} из ${latest.slides.length}…`)
        const receipts=[]
        for(const r of sourceData.sources[s.content.id])receipts.push(await restyleStudioReceipt(current.library,s,r))
        const response=await fetch(`/api/projects/${projectId}/compose`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'colors',revision,receipt:{slideId:s.content.id,basis:await contentHash(originals),receipts}})}),data=await response.json() as {run:StudioRun;error?:string}
        if(!response.ok)throw Error(data.error)
        latest=data.run;setRun(generationPreview(latest))
      }
      setMessage(`Акценты обновлены. Готово: ${latest.slides.length} слайдов.`)
    }catch(e){setError(e instanceof Error?e.message:'Не удалось обновить оформление.')}finally{setColoring(false)}
  }
  if(paused)return null
  return <section aria-label="Генерация презентации" className="ws-structure-status" data-generation-busy={working}>
    {(error||working&&message)&&<p className={error?'pw-error':'ws-form-status'} role="status">{error?displayStudioError(error):message}</p>}
    {!paused&&error&&!reparse&&current?.status!=='cancelled'&&<button className="pw-outline" disabled={working} onClick={()=>setRetry(n=>n+1)}>Продолжить создание</button>}
    {!error&&!reparse&&current&&current.status!=='cancelled'&&(current.version===STUDIO_VERSION&&current.status!=='complete'||canReflowRecipes(current))&&!allowStart&&!retry&&<button className="pw-outline" onClick={()=>setRetry(n=>n+1)}>Продолжить создание</button>}
    {current&&<>
      {needsColors&&<button className="pw-outline" disabled={coloring||working} onClick={()=>void colorize()}>{coloring?'Обновляем оформление…':'Обновить акценты'}</button>}
      {current.status==='cancelled'&&<p className="msp-generation-stopped" role="status">Генерация остановлена. Готовые слайды сохранены.</p>}
      <PresentationSlideGallery slides={studioSlideFeedback(current).filter(s=>current.status!=='cancelled'||s.result?.passed).map(({id,title,result:r})=>({id,title,image:r?.preview,selection:onToggleSlide?{checked:selectedSlides?.has(`${revision}/${id}`)??false,disabled:!r?.passed,onChange:()=>onToggleSlide(revision,id)}:undefined,status:r?.passed?'Готов':'Собираем слайд…'}))}/>
    </>}
  </section>
}
