"use client"
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UploadCloud, LoaderCircle } from 'lucide-react'
import { loadPresentationReader } from '@/lib/digital-designer/browser-loader'
import { uploadPreparedPresentation } from '@/lib/uploads/browser-transfer'
import { readProcessingResponse } from '@/lib/uploads/read-processing-response'
import { SOURCE_SIZE_LABEL, TRANSFER_LIMITS } from '@/lib/uploads/transfer-limits'
import type { UploadJob } from '@/lib/uploads/domain'
import { workspaceRequest } from './workspace-data'
import { finishDesignSystem } from './automatic-design-system'
import { reportDesignProgress, moveDesignProgress, settleDesignProgress } from '@/lib/uploads/design-progress'
import { assertDesignSystemActive, designSystemIsCancelled } from '@/lib/uploads/cancellation-client'
import { isUploadCancelled } from '@/lib/uploads/cancellation'

export function ImportStyle({ destinationBase = '/styles' }: { destinationBase?: string } = {}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState(''), [savedId, setSavedId] = useState('')
  useEffect(() => {
    if (!busy) return
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [busy])
  async function add(id: string) {
    assertDesignSystemActive(id)
    setProgress('Добавляем дизайн-систему в банк…')
    await workspaceRequest('/api/style-bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: id }) })
    return `${destinationBase}/${id}`
  }
  async function upload(file: File) {
    if (busy) return
    if (!/\.(pptx|pdf)$/i.test(file.name) || !file.size || file.size > TRANSFER_LIMITS.sourceBytes) { setError(`Выберите непустой PPTX или PDF до ${SOURCE_SIZE_LABEL}`); return }
    setBusy(true); setError(''); setSavedId('')
    let destination = ''
    let taskId = `file:${crypto.randomUUID()}`
    const sourceProgress = (detail:string,scope='read',completed?:number,total?:number) => reportDesignProgress(taskId,{step:'source',detail,scope,completed,total,unit:scope==='transfer'&&total===100?'percent':undefined},{label:file.name,owned:true})
    try {
      setProgress('Читаем исходный файл…')
      sourceProgress('Читаем исходный файл…')
      const reader = await loadPresentationReader()
      const visual = await reader.preparePresentation(new Uint8Array(await file.arrayBuffer()), file.name, (current, total) => {
        setProgress(`Извлекаем дизайн: слайд ${current} из ${total}`)
        sourceProgress('Читаем слайды и извлекаем оформление','slides',Math.max(0,current-1),total)
      })
      sourceProgress('Готовим исходник и изображения к сохранению','transfer')
      const response = await uploadPreparedPresentation(file, visual, setProgress,(done,total)=>sourceProgress('Сохраняем шаблон','transfer',Math.round(done/total*100),100))
      const result = await readProcessingResponse<{ accepted?: UploadJob[]; rejected?: { reason: string }[]; error?: string }>(response)
      const id = result.accepted?.[0]?.id
      if (!response.ok || !id) throw new Error(result.error ?? result.rejected?.[0]?.reason ?? 'Не удалось импортировать дизайн-систему')
      setSavedId(id); moveDesignProgress(taskId,id); taskId=id; destination = await add(id)
      reportDesignProgress(id,{step:'analysis',detail:'Определяем оформление и правила слайдов'},{owned:true,uploadId:id,saved:true})
      const capability=await fetch('/api/capabilities/qwen').then(r=>r.json()) as {configured:boolean}
      if(capability.configured)await finishDesignSystem(id,setProgress,new AbortController().signal)
      else settleDesignProgress(id,'waiting','Файл сохранён. Для продолжения нужно подключить анализ оформления.')
    } catch (e) {
      if(isUploadCancelled(e)||designSystemIsCancelled(taskId)){destination='';setSavedId('')}
      else {const message=e instanceof Error ? e.message : 'Не удалось импортировать файл';setError(message);settleDesignProgress(taskId,'error',message)}
    }
    finally { setBusy(false); setProgress(''); if (input.current) input.current.value = '' }
    if (destination&&!designSystemIsCancelled(taskId)) router.push(destination)
  }
  async function retryListing() {
    setBusy(true); setError(''); let destination = ''
    try { destination = await add(savedId) } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось добавить систему') }
    finally { setBusy(false); setProgress('') }
    if (destination) router.push(destination)
  }
  return <div className="ws-import">
    <button className="pw-primary" onClick={() => input.current?.click()} disabled={busy}>{busy ? <LoaderCircle className="pw-spin" size={17} /> : <UploadCloud size={17} />}Добавить дизайн-систему</button>
    <input ref={input} type="file" accept=".pptx,.pdf" hidden aria-label="PPTX или PDF дизайн-системы" onChange={e => { if (e.target.files?.[0]) void upload(e.target.files[0]) }} />
    {busy && <p role="status" className="sr-only">{progress}</p>}
    {error && <div className="pw-error" role="alert">{error}{savedId && <button className="pw-text-button" disabled={busy} onClick={retryListing}>Повторить добавление в банк</button>}</div>}
  </div>
}
