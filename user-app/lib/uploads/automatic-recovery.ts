import { isUploadCancelled, UploadCancelledError } from './cancellation'
export const RECOVERY_DELAYS = [15_000, 45_000, 120_000] as const
type RecoveryRecord = { attempts: number; retryAt: number; waiting: boolean; exhausted: boolean }
type Journal = { read(): RecoveryRecord | null; write(record: RecoveryRecord | null): void }
export class ProcessingRecoveryError extends Error {
  constructor(message: string, readonly retryable = true) { super(message) }
}
export function processingFailure(status: number, message: string, code?: string) {
  if (status === 410 || code === 'UPLOAD_CANCELLED') return new UploadCancelledError()
  return new ProcessingRecoveryError(message, ![400, 401, 403, 404, 413, 422].includes(status)
    && !['QWEN_NOT_CONFIGURED', 'SEMANTIC_SOURCE_INCOMPLETE', 'QWEN_UNAUTHORIZED', 'QWEN_HTTP_401', 'QWEN_HTTP_402', 'QWEN_HTTP_403', 'QWEN_HTTP_404', 'QWEN_INVALID_SETTINGS', 'QWEN_MODEL_MISMATCH', 'SEMANTIC_VALIDATION', 'REFINEMENT_FAILED', 'REFINEMENT_BUDGET_EXHAUSTED', 'SOURCE_CHANGED'].includes(code ?? ''))
}
export function recoveryJournal(uploadId: string, revision: string): Journal {
  const key = `msp:auto-recovery:${uploadId}:${revision}`
  let memory: RecoveryRecord | null = null
  return {
    read() {
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? 'null') as RecoveryRecord | null
        if (value && Number.isInteger(value.attempts) && value.attempts >= 1 && value.attempts <= RECOVERY_DELAYS.length
          && Number.isFinite(value.retryAt) && typeof value.waiting === 'boolean' && typeof value.exhausted === 'boolean') return value
      } catch { /* A blocked browser store still has a bounded in-memory budget. */ }
      return memory
    },
    write(record) {
      memory = record
      try { if (record) localStorage.setItem(key, JSON.stringify(record)); else localStorage.removeItem(key) } catch { /* Same fallback. */ }
    },
  }
}

/** Call under the upload's Web Lock. Only failed work is retried; successful
 * model packets keep their server cache. Reloads share the same retry budget. */
export async function withAutomaticRecovery(options: {
  run(recover: boolean): Promise<void>; journal: Journal
  wait(milliseconds: number): Promise<void>; now?: () => number
  onWait(message: string, attempt: number, retryAt: number): void
  signal?: AbortSignal
}) {
  const check = () => { if (options.signal?.aborted) { options.journal.write(null); throw options.signal.reason } }
  check()
  const now = options.now ?? Date.now
  let record = options.journal.read()
  let lastMessage='Продолжаем с сохранённого этапа.'
  const exhausted = () => new ProcessingRecoveryError('Автоматическое продолжение пока не удалось. Готовые этапы сохранены; требуется устранить причину ошибки.', false)
  if (record?.exhausted) throw exhausted()
  const schedule = (message: string) => {
    lastMessage=message
    const attempts = (record?.attempts ?? 0) + 1
    if (attempts > RECOVERY_DELAYS.length) {
      record = { ...record!, exhausted: true, waiting: false }; options.journal.write(record)
      throw new ProcessingRecoveryError(`${exhausted().message} ${message}`, false)
    }
    record = { attempts, retryAt: now() + RECOVERY_DELAYS[attempts - 1], waiting: true, exhausted: false }
    options.journal.write(record)
    options.onWait(message, attempts, record.retryAt)
  }
  // A reload during a request consumes a new attempt; a reload during the
  // backoff keeps the already reserved delay instead of resetting the budget.
  if (record && !record.waiting) schedule('Предыдущая попытка прервалась.')
  while (true) {
    check()
    if (record) {
      options.onWait(lastMessage, record.attempts, record.retryAt)
      try { await options.wait(Math.max(0, record.retryAt - now())) } catch (error) { check(); throw error }
      check()
      record = { ...record, waiting: false }; options.journal.write(record)
    }
    try {
      await options.run(!!record)
      options.journal.write(null)
      return
    } catch (error) {
      check()
      if (isUploadCancelled(error)) { options.journal.write(null); throw error }
      if (error instanceof ProcessingRecoveryError && !error.retryable) {
        options.journal.write({ attempts: record?.attempts ?? 1, retryAt: now(), waiting: false, exhausted: true })
        throw error
      }
      schedule(error instanceof Error ? error.message : 'Соединение прервалось.')
    }
  }
}
