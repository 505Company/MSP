import { toPng } from 'html-to-image'
import { ensureUploadFonts, captureSourceFontCss } from './fonts'
import { renderEditableHtml } from '../lib/design-system/editable-render'
import { hydrateEditableHtml } from '../lib/design-system/editable-hydrate'
import type { EditableTemplate } from '../lib/design-system/editable-contract'
import type { AuditEvidence } from '../lib/design-system/quality-audit-task'
import type { AuditRepair, QualityAuditState } from '../lib/design-system/quality-audit-contract'
import type { DesignProgressReporter } from '../lib/uploads/design-progress'
import { readProcessingCompletion } from '../lib/uploads/read-processing-response'
import { processingFailure } from '../lib/uploads/automatic-recovery'
import { runEditableRefinements } from './editable-refinement'

/** Every variant is shown or explicitly recorded as a render failure. Do not
 * let representative family cards hide the rest of the source constructions. */
export async function renderAuditBoards(uploadId: string, templates: EditableTemplate[], darkSlides: number[], signal: AbortSignal): Promise<AuditEvidence> {
  const result: AuditEvidence = { boards: [], failed: [] }
  if (!templates.length) return result
  try { await ensureUploadFonts(uploadId) }
  catch (error) {
    signal.throwIfAborted()
    return {boards:[],failed:templates.map(t=>({id:t.id,reason:error instanceof Error?error.message:'Не удалось загрузить шрифты'}))}
  }
  const host = document.createElement('div')
  host.setAttribute('aria-hidden','true'); host.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;contain:layout style;'
  document.body.appendChild(host)
  let fontCss: string | undefined
  const images: { id: string; image: HTMLImageElement; dark: boolean }[] = []
  try {
    for (const [index,t] of templates.entries()) {
      signal.throwIfAborted()
      try {
        if(index>=240)throw Error('Слишком много вариантов на одном слайде; превью требует отдельной проверки')
        host.style.width = Math.min(1400, Math.max(240, t.width)) + 'px'
        host.innerHTML = renderEditableHtml(t)
        const issues = await hydrateEditableHtml(host)
        if (issues.length) throw Error(issues.join('; '))
        await document.fonts.ready
        fontCss ??= await captureSourceFontCss(signal)
        await Promise.all([...host.querySelectorAll('img')].map(img => img.decode()))
        const root = host.firstElementChild as HTMLElement
        if (!root || root.getBoundingClientRect().height <= 0) throw Error('Компонент не имеет видимого размера')
        const bounds=root.getBoundingClientRect()
        if(bounds.width>4096||bounds.height>4096||bounds.width*bounds.height>8_000_000)throw Error('Превью компонента слишком велико для безопасной проверки')
        const png = await toPng(root, { pixelRatio: 1, fontEmbedCSS: fontCss, cacheBust: false })
        const image = new Image(); image.src = png; await image.decode()
        images.push({ id: t.id, image, dark: darkSlides.includes(t.slide) })
      } catch (e) { signal.throwIfAborted(); result.failed.push({ id: t.id, reason: (e instanceof Error ? e.message : 'Ошибка превью').slice(0,400) }) }
    }
    for (let start = 0; start < images.length; start += 12) {
      signal.throwIfAborted()
      const items = images.slice(start,start+12), canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = Math.ceil(items.length/3)*340
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#edf0f5'; ctx.fillRect(0,0,canvas.width,canvas.height)
      items.forEach((item,i) => {
        const x = (i%3)*480, y = Math.floor(i/3)*340, scale = Math.min(452/item.image.naturalWidth,286/item.image.naturalHeight)
        ctx.fillStyle = item.dark ? '#171717' : '#fff'; ctx.fillRect(x+8,y+8,464,300)
        const w = item.image.naturalWidth*scale, h = item.image.naturalHeight*scale
        ctx.drawImage(item.image,x+(480-w)/2,y+8+(300-h)/2,w,h)
        ctx.fillStyle = '#18263b'; ctx.font = '14px monospace'; ctx.fillText(item.id,x+12,y+329,455)
      })
      result.boards.push({ ids: items.map(i => i.id), image: canvas.toDataURL('image/jpeg',.88) })
    }
    return result
  } finally { host.remove() }
}

export async function runQualityAudit(uploadId: string, signal: AbortSignal, report: DesignProgressReporter = () => {}) {
  const base = `/api/uploads/${uploadId}/quality-audit`
  const read = async () => { const r = await fetch(base,{signal,cache:'no-store'}), body = await r.json() as QualityAuditState & {error?:string}; if(!r.ok)throw Error(body.error); return body }
  const post = async (body: object) => {
    const r = await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal})
    if (r.headers.get('content-type')?.includes('ndjson')) { await readProcessingCompletion(r); return {} as {repair?:AuditRepair|null} }
    const data = await r.json() as {error?:string;code?:string;repair?:AuditRepair|null}
    if(!r.ok)throw processingFailure(r.status,data.error??'Аудит прервался',data.code)
    return data
  }
  let state = await read()
  if (!state.enabled) return state
  if (!state.job || state.stale) { await post({action:'start'}); state=await read() }
  const revision = state.job?.id
  if (!revision) return state
  for (;;) {
    signal.throwIfAborted()
    state = await read(); const job = state.job
    if (!job || job.id !== revision || state.stale) return state
    const done = job.batches.filter(b => b.status !== 'pending').reduce((n,b)=>n+b.slides.length,0), total = job.batches.reduce((n,b)=>n+b.slides.length,0)
    report({step:'graphics',scope:'quality-audit',detail:'Проверяем смысловые блоки и приёмы шаблона',completed:done,total})
    if (job.batches.some(b=>b.status==='pending') || job.overview.status==='pending') {
      let evidence: AuditEvidence | undefined
      if (job.batches.some(b=>b.status==='pending')) {
        const r=await fetch(`${base}?packet=${revision}`,{signal}),value=await r.json() as {packet:{templates:EditableTemplate[];darkSlides:number[];evidenceSaved:boolean}|null;error?:string}
        if(!r.ok)throw Error(value.error)
        if(value.packet&&!value.packet.evidenceSaved)evidence=await renderAuditBoards(uploadId,value.packet.templates,value.packet.darkSlides,signal)
      }
      try { await post({action:'advance',revision,...(evidence?{evidence}:{})}) }
      catch (e) {
        if(!(e instanceof Error)||!e.message.includes('уже обрабатывается'))throw e
        await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason)},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},2000);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()})
      }
      continue
    }
    if (!job.repairPlanReady) { await post({action:'plan',revision}); continue }
    const pending=job.repairs.find(r=>['pending','queued'].includes(r.status))
    if (!pending) break
    let repair=pending
    try {
      const queued=await post({action:'repair',revision}); if(!queued.repair)continue; repair=queued.repair
      report({step:'graphics',scope:'quality-repair',detail:`Проверяем целый блок на слайде ${repair.slide}`,completed:job.repairs.filter(r=>!['pending','queued'].includes(r.status)).length,total:job.repairs.length})
      await runEditableRefinements(uploadId,signal,report,false,repair.requestId)
      await post({action:'settle',revision,findingId:repair.id})
    } catch (e) {
      signal.throwIfAborted()
      // Admission may have committed its ID before the response was lost.
      // Resolve that receipt instead of abandoning the remaining findings.
      if(!repair.requestId)repair=(await read()).job?.repairs.find(r=>r.id===repair.id)??repair
      if (!repair.requestId) throw e
      await post({action:'settle',revision,findingId:repair.id,failure:(e instanceof Error?e.message:'Дополнение не проверено').slice(0,500)})
    }
  }
  window.dispatchEvent(new CustomEvent('design-system:ready',{detail:uploadId}))
  return read()
}
