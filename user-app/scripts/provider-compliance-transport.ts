import { createHash } from 'node:crypto'

export type JsonObject = Record<string, unknown>
export type ToolCall = { index: number; id: string; type: 'function'; function: { name: string; arguments: string } }
export type Capture = {
  httpStatus: number; requestId: string | null; model: string | null; content: string; toolCalls: ToolCall[]
  finishReason: string | null; usage: JsonObject | null; reasoningCharacters: number; reasoningSha256: string | null
  metrics: { headersMs: number; firstByteMs: number | null; ttftMs: number | null; firstContentMs: number | null; durationMs: number; events: number }
  error: string | null; streamDone: boolean
}
export function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}
export function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
export function safeText(value: unknown): string {
  return String(value).replace(/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED]').slice(0, 4000)
}
export function reasoningTokens(capture: Capture): number | null {
  return number(object(capture.usage?.completion_tokens_details).reasoning_tokens) ?? number(capture.usage?.reasoning_tokens)
}
export function hasReasoning(capture: Capture): boolean {
  return capture.reasoningCharacters > 0 || (reasoningTokens(capture) ?? 0) > 0
}

/** Incremental SSE reader, including fragmented tool arguments. Private reasoning
 * is hashed and counted. Event logs store only lengths/hashes of generated deltas. */
export async function captureCompletion(response: Response, started: number, record: (event: JsonObject) => Promise<void> = async () => {}): Promise<Capture> {
  const result: Capture = { httpStatus: response.status, requestId: response.headers.get('x-generation-id'), model: null, content: '', toolCalls: [],
    finishReason: null, usage: null, reasoningCharacters: 0, reasoningSha256: null,
    metrics: { headersMs: performance.now() - started, firstByteMs: null, ttftMs: null, firstContentMs: null, durationMs: 0, events: 0 }, error: null, streamDone: false }
  const hash = createHash('sha256'), toolCalls = new Map<number, ToolCall>()
  const elapsed = () => Math.round((performance.now() - started) * 100) / 100
  const reasoning = (value: unknown) => {
    if (typeof value === 'string' && value) { result.reasoningCharacters += value.length; hash.update(value); result.metrics.ttftMs ??= elapsed() }
  }
  const receive = async (payload: unknown) => {
    const event = object(payload)
    result.metrics.events++
    if (typeof event.id === 'string') result.requestId ??= event.id
    if (typeof event.model === 'string') result.model = event.model
    if (event.error) result.error = safeText(JSON.stringify(event.error))
    if (event.usage && typeof event.usage === 'object') result.usage = object(event.usage)
    const safeChoices: JsonObject[] = []
    for (const entry of Array.isArray(event.choices) ? event.choices : []) {
      const choice = object(entry), delta = object(choice.delta ?? choice.message)
      if (typeof choice.finish_reason === 'string') result.finishReason = choice.finish_reason
      const content = typeof delta.content === 'string' ? delta.content : ''
      if (content) { result.content += content; result.metrics.ttftMs ??= elapsed(); result.metrics.firstContentMs ??= elapsed() }
      // Compatible providers sometimes expose both aliases for the same text.
      const thought = delta.reasoning_content ?? delta.reasoning
      reasoning(thought)
      if (!thought && Array.isArray(delta.reasoning_details)) for (const detail of delta.reasoning_details) reasoning(object(detail).text)
      const tools = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
      for (const [position, entry] of tools.entries()) {
        const fragment = object(entry), index = number(fragment.index) ?? position, fn = object(fragment.function)
        const tool = toolCalls.get(index) ?? { index, id: '', type: 'function', function: { name: '', arguments: '' } }
        if (typeof fragment.id === 'string') tool.id += fragment.id
        if (typeof fn.name === 'string') tool.function.name += fn.name
        if (typeof fn.arguments === 'string') tool.function.arguments += fn.arguments
        toolCalls.set(index, tool); result.metrics.ttftMs ??= elapsed()
      }
      safeChoices.push({ index: choice.index, finishReason: choice.finish_reason, contentCharacters: content.length,
        contentSha256: content ? createHash('sha256').update(content).digest('hex') : null,
        reasoningCharacters: typeof thought === 'string' ? thought.length : 0, toolFragments: tools.length })
    }
    await record({ elapsedMs: elapsed(), id: event.id, model: event.model, usage: event.usage, error: result.error, choices: safeChoices })
  }
  try {
    if (!response.ok) {
      result.error = safeText(await response.text())
    } else if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      result.metrics.firstByteMs = elapsed()
      await receive(await response.json()); result.streamDone = true
    } else {
      if (!response.body) throw new Error('Empty response body')
      const reader = response.body.getReader(), decoder = new TextDecoder()
      let pending = ''
      const dispatch = async (block: string) => {
        const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim()
        if (!data) return
        if (data === '[DONE]') { result.streamDone = true; return }
        await receive(JSON.parse(data))
      }
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (value?.length) result.metrics.firstByteMs ??= elapsed()
          pending += decoder.decode(value, { stream: !done })
          let match: RegExpExecArray | null
          while ((match = /\r?\n\r?\n/.exec(pending))) {
            const block = pending.slice(0, match.index)
            pending = pending.slice(match.index + match[0].length)
            await dispatch(block)
          }
          if (done) { if (pending.trim()) await dispatch(pending); break }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    }
  } catch (error) { result.error = safeText(error instanceof Error ? error.message : error) }
  // A server without a reasoning parser may put a think block in content.
  result.content = result.content.replace(/<think>([\s\S]*?)(?:<\/think>|$)/g, (_match, thought: string) => { reasoning(thought); return '' }).trim()
  result.reasoningSha256 = result.reasoningCharacters ? hash.digest('hex') : null
  result.toolCalls = [...toolCalls.values()].sort((a, b) => a.index - b.index)
  result.metrics.durationMs = elapsed()
  if (response.ok && !result.error && !result.finishReason) result.error = 'Stream ended without finish_reason'
  return result
}
