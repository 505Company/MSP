import { beginProcessing } from "./processing-activity.js"
import { designSystemIsCancelled, subscribeUploadCancellation } from './cancellation-client'
import { processingFailure } from './automatic-recovery'

/** Wait for the final frame, preserving the server's recovery decision. The
 * first frame only acknowledges storage; it does not prove successful work. */
export async function readProcessingCompletion(response: Response): Promise<void> {
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
    const body = await response.json().catch(() => ({})) as { error?: string; code?: string }
    throw processingFailure(response.ok ? 503 : response.status, body.error ?? 'Не удалось продолжить сборку.', body.code)
  }
  const messages = (await response.text()).split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as { complete?: boolean; error?: string; code?: string })
  const failure = messages.find(m => m.complete === false)
  if (failure) throw processingFailure(409, failure.error ?? 'Обработка прервалась. Готовые этапы сохранены.', failure.code)
  if (!messages.some(m => m.complete === true)) throw processingFailure(503, 'Соединение прервалось. Продолжим с сохранённого этапа.')
}

export async function readProcessingResponse<T>(response: Response, options: {uploadId?:string;signal?:AbortSignal} = {}): Promise<T> {
  if (!response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
    if (!response.headers.get("Content-Type")?.includes("application/json")) {
      throw new Error(response.status === 413 ? "Файл и изображения превысили лимит загрузки. Используйте меньшую презентацию." : `Сервер не завершил загрузку (HTTP ${response.status}). Повторите попытку.`)
    }
    return response.json() as Promise<T>
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Сервер не вернул подтверждение загрузки")
  const endProcessing = beginProcessing()
  const decoder = new TextDecoder()
  let buffer = ""
  let unsubscribe = () => {}
  const cancel = () => { endProcessing(); void reader.cancel().catch(() => undefined) }
  const cleanup = () => { endProcessing(); unsubscribe(); options.signal?.removeEventListener('abort',cancel); reader.releaseLock() }
  options.signal?.addEventListener('abort',cancel,{once:true})
  if(options.signal?.aborted)cancel()

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) throw new Error("Подтверждение загрузки было прервано")
      buffer += decoder.decode(value, { stream: true })
      const newline = buffer.indexOf("\n")
      if (newline < 0) continue
      const result = JSON.parse(buffer.slice(0, newline)) as T
      const ack = result as {accepted?:{id:string}[];upload?:{id:string}}
      const ids = new Set([options.uploadId,ack.upload?.id,...(ack.accepted??[]).map(u=>u.id)].filter((id):id is string=>!!id))
      const cancelIfFinished = () => { if(ids.size && [...ids].every(designSystemIsCancelled))cancel() }
      unsubscribe = subscribeUploadCancellation(id=>{if(ids.has(id))cancelIfFinished()})
      cancelIfFinished()

      // Drain independently of component lifetime and SPA navigation. Returning
      // the first message lets the UI show the persisted queue immediately.
      void (async () => {
        try {
          while (!(await reader.read()).done) { /* Keep the processing request open. */ }
        } catch {
          // The queue records interruption and offers retry from saved data.
        } finally {
          cleanup()
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("style-bank:uploads-changed"))
          }
        }
      })()
      return result
    }
  } catch (error) {
    endProcessing()
    await reader.cancel().catch(() => undefined)
    cleanup()
    throw error
  }
}
