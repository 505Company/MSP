import { ensureComponentAdaptation } from './component-adaptation'
import { ensureUploadFonts } from './fonts'
import { prepareRasterRegion, qualifyRasterRegions } from './refinement-raster'
import type { RasterRegionSource } from '@/lib/design-system/refinement-raster'
import { qualifyEditableCatalog, HTML_QUALIFICATION_VERSION } from '@/lib/design-system/editable-qualification'
import { refinementTaskFinished, type RefinementCandidate, type RefinementState } from '@/lib/design-system/refinement-contract'
import { processingFailure } from '@/lib/uploads/automatic-recovery'
import type { DesignProgressReporter } from '@/lib/uploads/design-progress'
import type { PublishedRecheck } from '@/lib/design-system/refinement-recheck'

/** Local maintenance only: never advances a model-backed refinement task. */
export async function recheckPublishedComponents(uploadId: string, signal: AbortSignal, report: DesignProgressReporter = () => {}) {
  const url = `/api/uploads/${uploadId}/editable-system/refinements`
  let qualification: Awaited<ReturnType<typeof qualifyEditableCatalog>> | undefined, fontsReady = false
  for (;;) {
    signal.throwIfAborted()
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recheck', ...(qualification ? { report: qualification } : {}) }), signal })
    const value = await response.json() as PublishedRecheck & { error?: string }
    if (!response.ok) throw Error(value.error ?? 'Не удалось повторно проверить сохранённые дополнения')
    if (!value.candidate) return value.complete
    report({ step: 'editable', scope: 'refinement', detail: 'Повторно проверяем сохранённые компоненты' })
    if (!fontsReady) { await ensureUploadFonts(uploadId); fontsReady = true }
    qualification = await qualifyEditableCatalog(value.candidate.catalog, undefined, signal)
    await qualifyRasterRegions(uploadId, value.candidate.catalog, qualification, signal)
  }
}

export async function runEditableRefinements(uploadId: string, signal: AbortSignal, report: DesignProgressReporter = () => {}, automatic = false, onlyRequestId?: string) {
  const url = `/api/uploads/${uploadId}/editable-system/refinements`
  const post = async (body: object) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
    if (!response.ok) { const data = await response.json() as { error?: string; code?: string }; throw processingFailure(response.status, data.error ?? 'Не удалось продолжить дополнение', data.code) }
    if (response.headers.get('content-type')?.includes('ndjson')) {
      // The initial line only acknowledges the lease. Await the complete stream
      // before sending another command; persisted task state carries failures.
      const messages = (await response.text()).split('\n').filter(s => s.trim()).map(s => JSON.parse(s) as { complete?: boolean })
      if (!messages.some(m => typeof m.complete === 'boolean')) throw Error('Соединение прервалось. Дополнение сохранено; его можно продолжить.')
      if (messages.at(-1)?.complete === false) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason) }, timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 2000)
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
      })
    }
    else await response.json()
  }
  await recheckPublishedComponents(uploadId, signal, report)
  if (automatic) await post({ action: 'automatic' })
  let fontsReady = false
  for (;;) {
    signal.throwIfAborted()
    const response = await fetch(url, { signal, cache: 'no-store' }), state = await response.json() as RefinementState & { error?: string }
    if (!response.ok) throw Error(state.error ?? 'Не удалось проверить дополнение')
    const job = state.jobs.find(j => j.id === state.pending)
    if (onlyRequestId && job?.id !== onlyRequestId) return
    if (!job || job.status === 'cancelled') { if(state.ready)await ensureComponentAdaptation(uploadId,signal).catch(()=>undefined); return }
    if (job.status === 'complete') { await post({ action: 'complete', requestId: job.id }); continue }
    if (state.applied.includes(job.id) && job.tasks.every(refinementTaskFinished)) { await post({ action: 'complete', requestId: job.id }); continue }
    if (job.baseId !== state.catalogId || job.tasks.some(t => t.report && t.report.version !== HTML_QUALIFICATION_VERSION)) {
      await post({ action: 'refresh', requestId: job.id }); continue
    }
    if (job.status === 'failed') throw processingFailure(409, job.tasks.find(t => t.status === 'failed')?.error ?? job.error ?? 'Дополнение прервалось. Исходные компоненты сохранены.', 'REFINEMENT_FAILED')
    report({ step: 'editable', scope: 'refinement', detail: 'Ищем пропуски и проверяем дополнения', completed: job.tasks.filter(refinementTaskFinished).length, total: job.tasks.length })
    if (job.tasks.some(t => t.status === 'checking')) {
      const r = await fetch(`${url}?candidate=${job.id}`, { signal }), value = await r.json() as { candidate: RefinementCandidate | null }
      if (!r.ok || !value.candidate) throw Error('Не удалось получить предложение для проверки')
      if (!fontsReady) { await ensureUploadFonts(uploadId); fontsReady = true }
      const qualification = await qualifyEditableCatalog(value.candidate.catalog, undefined, signal)
      await qualifyRasterRegions(uploadId,value.candidate.catalog,qualification,signal)
      await post({ action: 'report', requestId: job.id, report: qualification })
    } else if (job.tasks.every(refinementTaskFinished)) {
      await post({ action: 'complete', requestId: job.id })
      window.dispatchEvent(new CustomEvent('design-system:ready', { detail: uploadId }))
    } else {
      try {
        const r=await fetch(`${url}?regionSource=${job.id}`,{signal}),value=await r.json() as {source:RasterRegionSource|null;error?:string}
        if(!r.ok)throw Error(value.error??'Не удалось прочитать выделенную область')
        const image=value.source?await prepareRasterRegion(uploadId,value.source,signal):undefined
        await post({ action: 'advance', requestId: job.id, ...(image?{image}:{}) })
      }
      catch (error) {
        if (!(error instanceof Error) || !/уже обрабатывается|уже обновляется/.test(error.message)) throw error
        await new Promise<void>((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(signal.reason) }, timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 2000); signal.addEventListener('abort', abort, { once: true }) })
      }
    }
  }
}
