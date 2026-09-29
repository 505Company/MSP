import { beginProcessing } from "./processing-activity.js"

export async function readProcessingResponse<T>(response: Response): Promise<T> {
  if (!response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
    return response.json() as Promise<T>
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Сервер не вернул подтверждение загрузки")
  const endProcessing = beginProcessing()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) throw new Error("Подтверждение загрузки было прервано")
      buffer += decoder.decode(value, { stream: true })
      const newline = buffer.indexOf("\n")
      if (newline < 0) continue
      const result = JSON.parse(buffer.slice(0, newline)) as T

      // Drain independently of component lifetime and SPA navigation. Returning
      // the first message lets the UI show the persisted queue immediately.
      void (async () => {
        try {
          while (!(await reader.read()).done) { /* Keep the processing request open. */ }
        } catch {
          // The queue records interruption and offers retry from saved data.
        } finally {
          endProcessing()
          reader.releaseLock()
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
    reader.releaseLock()
    throw error
  }
}
