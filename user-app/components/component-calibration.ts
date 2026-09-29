import { loadPresentationReader } from '@/lib/digital-designer/browser-loader'
import type { calibrationState } from '@/lib/design-system/calibration'
import type { ComponentQualification } from '@/lib/design-system/calibration-contract'
import type { DesignProgressReporter } from '@/lib/uploads/design-progress'
import { processingFailure } from '@/lib/uploads/automatic-recovery'
type State = Awaited<ReturnType<typeof calibrationState>>
export async function calibrationSheets(previews: State['previews']) {
  const sheets: { ids: string[]; dataUrl: string }[] = []
  const perSheet = Math.max(24, Math.ceil(previews.length / 8))
  for (let at = 0; at < previews.length; at += perSheet) {
    const batch = previews.slice(at, at + perSheet), cols = 4, width = 300, height = 230
    const canvas = document.createElement('canvas'); canvas.width = cols * width; canvas.height = Math.ceil(batch.length / cols) * height
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#e4e8ef'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (const [i, preview] of batch.entries()) {
      const img = new Image(); img.src = preview.dataUrl; await img.decode()
      const x = i % cols * width, y = Math.floor(i / cols) * height, scale = Math.min((width - 20) / img.width, (height - 45) / img.height)
      ctx.fillStyle = '#8993a5'; ctx.fillRect(x + 5, y + 30, width - 10, height - 35)
      ctx.drawImage(img, x + (width - img.width * scale) / 2, y + 32 + (height - 45 - img.height * scale) / 2, img.width * scale, img.height * scale)
      ctx.fillStyle = '#172134'; ctx.font = 'bold 21px Arial'; ctx.fillText(preview.id, x + 10, y + 24)
    }
    sheets.push({ ids: batch.map(p => p.id), dataUrl: canvas.toDataURL('image/jpeg', .86) }); canvas.width = canvas.height = 0
  }
  return sheets
}
export async function runComponentCalibration(uploadId: string, onProgress: (message: string) => void, signal: AbortSignal, report?: DesignProgressReporter) {
  const base = '/api/uploads/' + uploadId, reader = await loadPresentationReader()
  const assets = new Map<string, { id: string; bytes: Uint8Array }>()
  async function state(inputs = false): Promise<State> {
    const r = await fetch(base + '/calibration' + (inputs ? '?inputs=1' : ''), { signal }); const data = await r.json() as State & { error?: string }
    if (!r.ok) throw processingFailure(r.status,data.error??'Не удалось получить компоненты'); return data
  }
  async function post(body: unknown) {
    const r = await fetch(base + '/calibration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
    if (!r.ok) {const data=await r.json() as {error:string;code?:string};throw processingFailure(r.status,data.error,data.code)}
    return r
  }
  let current = await state(true), checked = current.checked
  report?.({step:'components',scope:'qualification',detail:'Проверяем исходный вид и замену данных',completed:checked,total:current.total})
  const pending: ComponentQualification[] = []
  for (const component of current.components ?? []) {
    signal.throwIfAborted(); onProgress(`Проверяем компоненты: ${checked + 1} из ${current.total}`)
    const resources = await Promise.all(component.source.assetIds.map(async id => {
      if (assets.has(id)) return assets.get(id)!
      const r = await fetch(base + '/assets/' + id, { signal }); if (!r.ok && r.status !== 404) throw new Error('Исходное изображение недоступно')
      const asset = { id, bytes: r.ok ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array() }; assets.set(id, asset); return asset
    }))
    pending.push(await reader.qualifyComponent(component, resources)); checked++
    report?.({step:'components',scope:'qualification',detail:'Проверяем исходный вид и замену данных',completed:checked,total:current.total})
    if (pending.length === 4 || checked === current.total) { await post({ action: 'qualify', catalogId: current.catalogId, records: pending }); pending.length = 0 }
  }
  current = await state()
  while (!current.calibrated && current.job) {
    signal.throwIfAborted()
    onProgress(current.job.phase === 'merge' ? 'Qwen сравнивает семейства по всему каталогу…' : `Qwen сравнивает компоненты: ${current.completedParts + 1} из ${current.totalParts}`)
    report?.({step:'components',scope:'comparison',detail:current.job.phase==='merge'?'Объединяем повторяющиеся компоненты':'Сравниваем компоненты и собираем семейства',completed:current.completedParts,total:current.totalParts})
    const sheets = await calibrationSheets(current.previews)
    const r = await post({ action: 'model', catalogId: current.catalogId, inputHash: current.inputHash, jobId: current.job.id, sheets })
    const lines = (await r.text()).split('\n').filter(Boolean).map(line => JSON.parse(line))
    current = await state()
    if (!lines.some(line => line.complete === true)) throw processingFailure(409,current.error || 'Анализ прервался. Готовые проверки сохранены; можно продолжить.',current.errorCode)
  }
  if (!current.calibrated) throw new Error('Калибровка пока не завершена.')
  return current.calibrated
}
