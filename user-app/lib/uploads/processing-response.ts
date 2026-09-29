// Keep the HTTP response alive while the job runs. A completed 202 response
// would leave only the Worker's short waitUntil grace period for Qwen.
export function processingResponse(
  initial: unknown,
  work: (signal: AbortSignal) => Promise<unknown>
): { response: Response; completion: Promise<void> } {
  const encoder = new TextEncoder()
  const abort = new AbortController()
  let closed = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let completion!: Promise<void>

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify(initial)}\n`))
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode("\n"))
      }, 10_000)
      completion = Promise.resolve()
        .then(() => work(abort.signal))
        .then(
          () => {
            if (!closed) controller.enqueue(encoder.encode('{"complete":true}\n'))
          },
          error => {
            // Preserve the sanitized failure category: a rejected model reply
            // cannot be repaired by repeatedly treating it as a network outage.
            const failure = error instanceof QwenAnalysisError
              ? { code: error.code, error: error.message }
              : { code: 'PROCESSING_INTERRUPTED', error: 'Обработка прервалась. Готовые этапы сохранены.' }
            if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify({ complete: false, ...failure })}\n`))
          }
        )
        .finally(() => {
          clearInterval(heartbeat)
          if (!closed) {
            closed = true
            controller.close()
          }
        })
    },
    cancel() {
      closed = true
      clearInterval(heartbeat)
      abort.abort(new Error("Обработка прервана: вкладка была закрыта. Повторите анализ сохранённого файла."))
      return completion
    },
  })

  return {
    response: new Response(body, {
      status: 202,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    }),
    completion,
  }
}
import { QwenAnalysisError } from './qwen-analysis'
