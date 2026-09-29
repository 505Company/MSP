import type { UploadJob } from './domain'
import type { PublicProcessingJob } from './processing-jobs'
import type { ScanRun } from '../design-system/semantic-scan'
import { semanticScanProgress } from '../design-system/semantic-scan-progress'
import { cancelDesignSystem, designSystemIsCancelled, subscribeUploadCancellation } from './cancellation-client'

export const designSteps = [
  { id: 'source', label: 'Файл', compact: 'Файл' },
  { id: 'analysis', label: 'Анализ слайдов', compact: 'Анализ' },
  { id: 'components', label: 'Компоненты', compact: 'Элементы' },
  { id: 'editable', label: 'Проверка данных', compact: 'Данные' },
  { id: 'graphics', label: 'Графика', compact: 'Графика' },
] as const
export type DesignStep = typeof designSteps[number]['id']
export type DesignProgressUpdate = {
  step: DesignStep; detail: string; scope?: string; completed?: number; total?: number; unit?: 'percent'
}
export type DesignProgressReporter = (progress: DesignProgressUpdate) => void
export type DesignTask = DesignProgressUpdate & {
  id: string; label: string; uploadId?: string; owned: boolean; saved: boolean; managed?: boolean
  execution?: 'background'; workerAvailable?: boolean; heartbeatAt?: number
  backgroundVersion?: string
  status: 'running' | 'complete' | 'error' | 'waiting'
  startedAt: number; updatedAt: number; samples: { at: number; completed: number }[]; retryAt?: number
}
type Store = { tasks: DesignTask[]; listeners: Set<() => void>; dismissed?: Map<string,string> }
declare global { interface Window { __mspDesignProgress?: Store } }
const store: Store = typeof window === 'undefined' ? { tasks: [], listeners: new Set() }
  : window.__mspDesignProgress ??= { tasks: [], listeners: new Set() }
const empty: DesignTask[] = []
export const designProgressSnapshot = () => store.tasks
export const designProgressServerSnapshot = () => empty
export function subscribeDesignProgress(listener: () => void) {
  store.listeners.add(listener)
  return () => { store.listeners.delete(listener) }
}
function publish(tasks: DesignTask[]) { store.tasks = tasks; store.listeners.forEach(fn => fn()) }
subscribeUploadCancellation(id => publish(store.tasks.filter(t => t.id !== id && t.uploadId !== id)))

/** Samples belong to one actual work unit. A new phase, changed total, retry or
 * visibility gap must never reuse an old rate or imply an overall percentage. */
export function advanceDesignTask(previous: DesignTask, update: DesignProgressUpdate, now = Date.now()): DesignTask {
  const completed = Number.isFinite(update.completed) ? Math.max(0, update.completed!) : undefined
  const total = Number.isFinite(update.total) && update.total! > 0 ? update.total : undefined
  const scope = update.scope ?? update.step
  const reset = scope !== previous.scope || update.step !== previous.step || total !== previous.total
    || completed === undefined || completed < (previous.completed ?? 0)
  let samples = reset ? [] : previous.samples
  if (completed !== undefined && samples.at(-1)?.completed !== completed) samples = [...samples, { at: now, completed }].slice(-8)
  const changed = reset || completed !== previous.completed || update.detail !== previous.detail
  return { ...previous, ...update, scope, completed, total, unit: update.unit, retryAt: undefined, samples, updatedAt: changed ? now : previous.updatedAt }
}
export function reportDesignProgress(id: string, update: DesignProgressUpdate, options: {
  label?: string; uploadId?: string; owned?: boolean; saved?: boolean; startedAt?: number
} = {}) {
  if (designSystemIsCancelled(options.uploadId ?? id)) return
  const now = Date.now(), previous = store.tasks.find(t => t.id === id)
  // A read-only server observation must not overwrite a browser's later phase.
  if (previous?.owned && !options.owned) return
  const task = advanceDesignTask(previous ?? {
    id, label: options.label ?? 'Дизайн-система', owned: false, saved: false,
    status: 'running', startedAt: options.startedAt ?? now, updatedAt: now, samples: [], ...update,
  }, update, now)
  Object.assign(task, Object.fromEntries(Object.entries(options).filter(([,value])=>value!==undefined)), { status: 'running' })
  if(options.owned)task.managed=true
  publish([...store.tasks.filter(t => t.id !== id), task])
}
export function settleDesignProgress(id: string, status: DesignTask['status'], detail: string) {
  publish(store.tasks.map(t => t.id === id ? { ...t, status, detail, owned: false, samples: [], retryAt: undefined, updatedAt: Date.now() } : t))
}
export function scheduleDesignRecovery(id:string,detail:string,retryAt:number) {
  publish(store.tasks.map(t=>t.id===id?{...t,detail,retryAt,status:'running',owned:true,samples:[],completed:undefined,total:undefined,updatedAt:Date.now()}:t))
}
export function moveDesignProgress(from: string, uploadId: string) {
  if (designSystemIsCancelled(uploadId)) { publish(store.tasks.filter(t => t.id !== from && t.id !== uploadId)); return }
  const task = store.tasks.find(t => t.id === from)
  if (task) publish([...store.tasks.filter(t => t.id !== from && t.id !== uploadId), { ...task, id: uploadId, uploadId, saved: true }])
}
export function dismissDesignProgress(id: string) {
  const task=store.tasks.find(t=>t.id===id)
  if(task?.status==='running'||task?.status==='waiting')return
  if(task?.backgroundVersion)(store.dismissed??=new Map()).set(id,task.backgroundVersion)
  publish(store.tasks.filter(t => t.id !== id))
}
export function resetDesignProgressTiming() { publish(store.tasks.map(t => ({ ...t, samples: [] }))) }

export function remainingStageSeconds(task: DesignTask, now = Date.now()): number | null {
  const first = task.samples[0], last = task.samples.at(-1)
  if (task.status !== 'running' || !task.total || !first || !last || task.samples.length < 3
    || last.completed >= task.total || last.completed - first.completed < 2 || last.at - first.at < 4000) return null
  const perUnit = (last.at - first.at) / (last.completed - first.completed)
  // Never count down to zero while waiting on a stalled request.
  if (now - last.at > Math.max(20_000, perUnit * 2)) return null
  return Math.ceil((task.total - last.completed) * perUnit / 1000)
}

/** The server's 100% ends extraction only; browser qualification follows it. */
export function observeDesignUpload(upload: UploadJob, scan: ScanRun | null) {
  if (upload.status === 'cancelled') { cancelDesignSystem(upload.id); return }
  const previous = store.tasks.find(t => t.id === upload.id)
  if (previous?.managed || previous?.owned || previous?.status === 'complete') return
  const active = upload.status === 'processing' || upload.status === 'queued' || scan?.status === 'running'
  if (!active && !previous) return
  if (previous && designSteps.findIndex(s => s.id === previous.step) > 1) return
  reportDesignProgress(upload.id, {
    step: 'analysis', scope: `scan:${scan?.id ?? upload.id}`, detail: upload.stage,
    ...(scan?.status === 'running' ? semanticScanProgress(scan) : {}),
  }, { label: upload.fileName, uploadId: upload.id, saved: true, startedAt: previous?.startedAt ?? Date.parse(scan?.startedAt ?? upload.createdAt) })
  if (scan?.status === 'failed' || upload.status === 'failed' || upload.qwenStatus === 'failed') {
    settleDesignProgress(upload.id, 'error', scan?.error ?? upload.errorMessage ?? 'Обработка прервалась. Готовые этапы сохранены.')
  } else if (!active) {
    settleDesignProgress(upload.id, 'waiting', upload.qwenStatus === 'not_configured'
      ? 'Файл сохранён. Для продолжения нужно подключить анализ оформления.'
      : 'Разбор сохранён. Откройте дизайн-систему, чтобы продолжить проверку компонентов.')
  }
}

/** Durable worker state wins over a page's old flight. Heartbeats confirm
 * liveness; only completed work contributes to the time estimate. */
export function observeBackgroundJob(job: PublicProcessingJob, available: boolean) {
  if (job.status === 'cancelled') { cancelDesignSystem(job.id); return }
  if (designSystemIsCancelled(job.id)) return
  const backgroundVersion=`${job.revision}:${job.status}:${job.updatedAt}`
  if(store.dismissed?.get(job.id)===backgroundVersion)return
  const previous = store.tasks.find(t => t.id === job.id)
  const task = advanceDesignTask(previous ?? { id: job.id, label: job.label, uploadId: job.id, owned: false, saved: true,
    status: 'running', startedAt: job.createdAt, updatedAt: job.updatedAt, samples: [], ...job.progress }, job.progress, job.updatedAt)
  Object.assign(task, { execution: 'background', backgroundVersion, workerAvailable: available, heartbeatAt: job.heartbeatAt, owned: false, managed: true,
    saved: true, uploadId: job.id, label: job.label, retryAt: job.retryAt,
    status: job.status === 'complete' ? 'complete' : job.status === 'blocked' ? 'error' : job.status === 'queued' ? 'waiting' : 'running' })
  if (job.status === 'blocked') task.detail = job.error ?? 'Сборка прервалась. Готовые этапы сохранены.'
  if (job.status === 'retrying') task.detail = `${job.error ?? 'Соединение прервалось.'} Продолжим автоматически с сохранённого этапа.`
  if (job.status === 'queued') task.detail = available ? 'Задание в очереди. Обработка начнётся автоматически.' : 'Задание сохранено. Ожидаем подключения фонового обработчика.'
  publish([...store.tasks.filter(t => t.id !== job.id), task])
  if (job.status === 'complete' && previous?.status !== 'complete' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('design-system:ready', { detail: job.id }))
    window.dispatchEvent(new Event('style-bank:uploads-changed'))
  }
}
