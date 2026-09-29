"use client"
import {GRAPHIC_COMPONENTS_VERSION} from '@/lib/design-system/graphic-components'
import {ensureUploadFonts} from '@/browser/fonts'
import { useEffect } from 'react'
import { runComponentCalibration } from './component-calibration'
import {EDITABLE_COMPILER_VERSION} from '@/lib/design-system/editable-contract'
import {qualifyEditableCatalog,HTML_QUALIFICATION_VERSION} from '@/lib/design-system/editable-qualification'
import type { editableState } from '@/lib/design-system/editable-analysis'
import type { ScanRun } from '@/lib/design-system/semantic-scan'
import { semanticScanProgress } from '@/lib/design-system/semantic-scan-progress'
import type { UploadJob } from '@/lib/uploads/domain'
import { readProcessingResponse, readProcessingCompletion } from '@/lib/uploads/read-processing-response'
import { reportDesignProgress, settleDesignProgress, scheduleDesignRecovery, observeBackgroundJob, type DesignProgressReporter } from '@/lib/uploads/design-progress'
import { processingFailure, recoveryJournal, withAutomaticRecovery } from '@/lib/uploads/automatic-recovery'
import { assertDesignSystemActive, cancelDesignSystem, designSystemIsCancelled, subscribeUploadCancellation } from '@/lib/uploads/cancellation-client'
import { isUploadCancelled, UploadCancelledError } from '@/lib/uploads/cancellation'

import {runGraphicReconstruction} from '@/lib/design-system/reconstruction-browser'
import {RECONSTRUCTION_VERSION} from '@/lib/design-system/reconstruction-contract'
import {runEditableRefinements} from '@/browser/editable-refinement'
import {repairIncompleteSource} from '@/browser/source-repair'
import {runQualityAudit} from '@/browser/quality-audit'

type State=Awaited<ReturnType<typeof editableState>>
type Progress={message:string;done:boolean;error:string}
type Flight={promise:Promise<void>;progress:Progress;listeners:Set<(p:Progress)=>void>}
declare global {interface Window {__mspDesignSystemFlights?:Map<string,Flight>}}
const flights=typeof window==='undefined'?new Map<string,Flight>():window.__mspDesignSystemFlights??=new Map<string,Flight>()
function pause(signal:AbortSignal,ms=4000) {
  signal.throwIfAborted()
  return new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason)};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms);signal.addEventListener('abort',abort,{once:true})})
}
export async function executeDesignSystem(uploadId:string,onProgress:(message:string)=>void,signal:AbortSignal,recover:boolean,backgroundReport?:DesignProgressReporter) {
  signal.throwIfAborted(); assertDesignSystemActive(uploadId)
  const status=await fetch(`/api/uploads/${uploadId}`,{signal,cache:'no-store'})
  const current=await status.json() as {upload?:UploadJob;error?:string}
  if(current.upload?.status==='cancelled')throw new UploadCancelledError()
  if(!status.ok)throw processingFailure(status.status,current.error??'Не удалось получить состояние файла')
  const report:DesignProgressReporter=backgroundReport??(progress=>reportDesignProgress(uploadId,progress,{uploadId,owned:true,saved:true}))
  const processing=await fetch(`/api/uploads/${uploadId}/processing`,{signal,cache:'no-store'}),queued=await processing.json() as {job?:{work?:string}}
  if(queued.job?.work==='audit'){
    await runQualityAudit(uploadId,signal,report)
    settleDesignProgress(uploadId,'complete','Аудит завершён. Результаты и замечания сохранены.');return
  }
  if(queued.job?.work==='refinement'){
    await runEditableRefinements(uploadId,signal,report)
    settleDesignProgress(uploadId,'complete','Проверка дополнений завершена.');return
  }
  await repairIncompleteSource(uploadId,signal,detail=>{onProgress(detail);report({step:'analysis',scope:'source-repair',detail})})
    // The upload response acknowledges storage before the server scan ends.
    // Observe it first; do not qualify an incomplete component catalog.
    const waitingSince=Date.now();let resumed=false
    while(true){
      const response=await fetch(`/api/uploads/${uploadId}/semantic-scan`,{signal}),state=await response.json() as {run:ScanRun|null;error?:string}
      if(!response.ok)throw processingFailure(response.status,state.error??'Не удалось получить состояние анализа')
      if(state.run?.status==='complete')break
      if(state.run?.status==='failed'&&(!recover||resumed))throw processingFailure(409,state.run.error??'Анализ прерван. Готовые этапы сохранены.',state.run.errorCode)
      let needsStart=state.run?.status==='failed'
      if(!state.run){
        const jobResponse=await fetch(`/api/uploads/${uploadId}`,{signal}),job=await jobResponse.json() as {upload?:UploadJob;error?:string}
        if(!jobResponse.ok)throw processingFailure(jobResponse.status,job.error??'Не удалось получить состояние файла')
        needsStart=!!job.upload&&(!!backgroundReport||!['queued','processing'].includes(job.upload.status))
      }
      if(needsStart&&!resumed){
        report({step:'analysis',scope:'resume',detail:'Продолжаем анализ с сохранённого этапа'})
        const started=await fetch(`/api/uploads/${uploadId}/semantic-scan`,{method:'POST',signal})
        if(!started.ok){const failure=await started.json() as {error?:string;code?:string};throw processingFailure(started.status,failure.error??'Не удалось продолжить анализ',failure.code)}
        await readProcessingResponse(started,{uploadId,signal});resumed=true
        window.dispatchEvent(new Event('style-bank:uploads-changed'))
        continue
      }
      const progress=state.run?semanticScanProgress(state.run):{detail:'Ожидаем начало анализа'}
      report({step:'analysis',scope:`scan:${state.run?.id??uploadId}`,...progress})
      onProgress(progress.detail)
      if(!state.run&&Date.now()-waitingSince>90_000)throw Error('Анализ не начался. Исходник сохранён; можно продолжить со страницы дизайн-системы.')
      await pause(signal)
    }
    await buildDesignSystem(uploadId,onProgress,signal,report)
    settleDesignProgress(uploadId,'complete','Компоненты, данные и графика проверены. Можно создавать презентацию.')
}
async function buildDesignSystem(uploadId:string,onProgress:(message:string)=>void,signal:AbortSignal,report:DesignProgressReporter) {
  report({step:'components',detail:'Подготавливаем шрифты для проверки компонентов',scope:'fonts'})
  const fontWarnings=await ensureUploadFonts(uploadId)
  signal.throwIfAborted()
  await runComponentCalibration(uploadId,onProgress,signal,report)
  const base=`/api/uploads/${uploadId}/editable-system`
  const read=async()=>{const r=await fetch(base,{signal});const s=await r.json() as State;if(!r.ok)throw Error(s.error??'Не удалось получить состояние');return s}
  let state=await read()
  const reportAssembly=(s:State)=>report({step:'editable',scope:'assembly',detail:'Собираем редактируемые конструкции',completed:s.completed,total:s.total})
  reportAssembly(state)
  while(state.running&&!state.catalog){
    onProgress(`Собираем редактируемые конструкции: ${state.completed} из ${state.total}`)
    reportAssembly(state)
    await pause(signal)
    state=await read()
  }
  if(!state.catalog){
    onProgress(`Собираем редактируемые конструкции: ${state.completed} из ${state.total}`)
    let observing=true
    const timer=setInterval(()=>void read().then(s=>{if(observing){onProgress(`Собираем редактируемые конструкции: ${s.completed} из ${s.total}`);reportAssembly(s)}}).catch(()=>undefined),5000)
    try {
      const response=await fetch(base,{method:'POST',signal})
      // Await the final stream message here: the first line is only an ack.
      await readProcessingCompletion(response)
      state=await read()
      if(!state.catalog)throw processingFailure(409,state.error||'Сборка прервалась. Готовые этапы сохранены.',state.errorCode??undefined)
    }finally{observing=false;clearInterval(timer)}
  }
  if(state.catalog&&!state.catalog.qualification){
    onProgress('Проверяем HTML на исходных и новых данных…')
    const qualification=await qualifyEditableCatalog(state.catalog,(completed,total)=>report({step:'editable',scope:'html-check',detail:'Проверяем конструкции на исходных и новых данных',completed,total}),signal),response=await fetch(base+'/qualification',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(qualification),signal})
    if(!response.ok)throw Error('Не удалось сохранить проверку HTML')
  }
  await runGraphicReconstruction(uploadId,onProgress,signal,report)
  const auditResponse=await fetch(`/api/uploads/${uploadId}/quality-audit`,{signal,cache:'no-store'})
  if(!auditResponse.ok)throw Error('Не удалось прочитать состояние проверки дизайн-системы')
  const audit=await auditResponse.json() as {enabled:boolean}
  await runEditableRefinements(uploadId,signal,report,!audit.enabled)
  await runQualityAudit(uploadId,signal,report)
  onProgress('Дизайн-система собрана и откалибрована'+(fontWarnings.length?`. Замена отсутствующих шрифтов: ${fontWarnings.join('; ')}.`:''))
  window.dispatchEvent(new CustomEvent('design-system:ready',{detail:uploadId}))
}

/** A single import continuation across section navigation and React remounts.
 * Web Locks also serialize two tabs; server model leases guard other clients. */
function start(uploadId:string,label?:string) {
  assertDesignSystemActive(uploadId)
  const revision=`auto-2:family-conflicts-2:${EDITABLE_COMPILER_VERSION}:${HTML_QUALIFICATION_VERSION}:${RECONSTRUCTION_VERSION}:${GRAPHIC_COMPONENTS_VERSION}`
  const key=`${uploadId}:${revision}`
  const previous=flights.get(key);if(previous)return previous
  reportDesignProgress(uploadId,{step:'analysis',detail:'Продолжаем сборку с сохранённого этапа',scope:'resume'},{uploadId,label,owned:true,saved:true})
  const flight={promise:Promise.resolve(),progress:{message:'Продолжаем автоматическую сборку…',done:false,error:''},listeners:new Set<(p:Progress)=>void>()}
  const publish=(message:string,done=false,error='')=>{flight.progress={message,done,error};flight.listeners.forEach(fn=>fn(flight.progress))}
  const controller=new AbortController(),signal=controller.signal
  const unsubscribe=subscribeUploadCancellation(id=>{if(id===uploadId)controller.abort(new UploadCancelledError())})
  const run=()=>withAutomaticRecovery({
    signal,
    run:recover=>executeDesignSystem(uploadId,message=>publish(message),signal,recover),
    journal:recoveryJournal(uploadId,revision),
    wait:async ms=>{
      await pause(signal,ms)
      if(!navigator.onLine)await new Promise<void>((resolve,reject)=>{
        const cleanup=()=>{window.removeEventListener('online',online);signal.removeEventListener('abort',abort)}
        const online=()=>{cleanup();resolve()},abort=()=>{cleanup();reject(signal.reason)}
        window.addEventListener('online',online,{once:true});signal.addEventListener('abort',abort,{once:true})
        if(signal.aborted)abort()
      })
    },
    onWait:(message,attempt,retryAt)=>{
      const detail=`${message} Повторим автоматически · попытка ${attempt} из 3.`
      scheduleDesignRecovery(uploadId,detail,retryAt);publish(detail)
    },
  })
  flight.promise=Promise.resolve().then(async()=>{if(navigator.locks)await navigator.locks.request(`msp-design-system-${uploadId}`,{signal},run);else await run()}).then(()=>publish(flight.progress.message,true)).catch(e=>{
    if(isUploadCancelled(e)||designSystemIsCancelled(uploadId)){cancelDesignSystem(uploadId);throw new UploadCancelledError()}
    const message=e instanceof Error?e.message:'Сборка прервалась'
    settleDesignProgress(uploadId,'error',message);publish('',false,message);throw e
  }).finally(unsubscribe)
  void flight.promise.catch(()=>undefined)
  flights.set(key,flight);return flight
}
export async function delegateDesignSystem(uploadId:string,restart=false) {
  const r=await fetch(`/api/uploads/${uploadId}/processing`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({restart})})
  const state=await r.json() as {configured?:boolean;available?:boolean;job?:import('@/lib/uploads/processing-jobs').PublicProcessingJob;error?:string;code?:string}
  if(!r.ok)throw processingFailure(r.status,state.error??'Не удалось запустить фоновую обработку',state.code)
  if(!state.configured)return false
  if(state.job)observeBackgroundJob(state.job,!!state.available)
  window.dispatchEvent(new Event('processing-jobs:changed'))
  return true
}
export async function finishDesignSystem(uploadId:string,onProgress:(message:string)=>void,signal:AbortSignal) {
  signal.throwIfAborted()
  if(await delegateDesignSystem(uploadId))return
  const flight=start(uploadId),listener=(progress:Progress)=>onProgress(progress.error||progress.message)
  flight.listeners.add(listener);listener(flight.progress)
  try{await flight.promise}finally{flight.listeners.delete(listener)}
}
export function AutomaticDesignSystem({uploadId,enabled,label}:{uploadId:string;enabled:boolean;label?:string}) {
  useEffect(()=>{
    if(!enabled||designSystemIsCancelled(uploadId))return
    void delegateDesignSystem(uploadId).then(delegated=>{if(!delegated)start(uploadId,label)}).catch(error=>{if(!isUploadCancelled(error))settleDesignProgress(uploadId,'error',error instanceof Error?error.message:'Не удалось продолжить сборку')})
  },[uploadId,enabled,label])
  return null
}
