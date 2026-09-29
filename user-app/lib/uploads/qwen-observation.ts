/** Timings are relative to the start of the request operation, including preflight.
 * TTFT is measured from POST dispatch to the first nonempty content/reasoning delta.
 * Chunks and characters are not token counts; usage remains provider-reported. */
export type QwenObservation = {
  version: 'qwen-observation-1'; startedAt: string
  requestSentMs: number | null; responseHeadersMs: number | null
  firstByteMs: number | null; firstEventMs: number | null; firstTokenMs: number | null
  firstContentMs: number | null; firstReasoningMs: number | null; lastEventMs: number | null
  elapsedMs: number; ttftMs: number | null
  bytes: number; events: number; contentChunks: number; reasoningChunks: number
  contentCharacters: number; reasoningCharacters: number; streamComplete: boolean
}

export class QwenObservationRecorder {
  private readonly started: number
  private readonly state: QwenObservation
  constructor(private readonly now: () => number = () => performance.now()) {
    this.started = now()
    this.state = { version: 'qwen-observation-1', startedAt: new Date().toISOString(), requestSentMs: null, responseHeadersMs: null,
      firstByteMs: null, firstEventMs: null, firstTokenMs: null, firstContentMs: null, firstReasoningMs: null, lastEventMs: null,
      elapsedMs: 0, ttftMs: null, bytes: 0, events: 0, contentChunks: 0, reasoningChunks: 0,
      contentCharacters: 0, reasoningCharacters: 0, streamComplete: false }
  }
  private elapsed() { return Math.max(0, Math.round(this.now() - this.started)) }
  sent() { this.state.requestSentMs ??= this.elapsed() }
  headers() { this.state.responseHeadersMs ??= this.elapsed() }
  bytes(count: number) { this.state.firstByteMs ??= this.elapsed(); this.state.bytes += count }
  event() {
    const at = this.elapsed(); this.state.firstEventMs ??= at; this.state.lastEventMs = at; this.state.events++
  }
  delta(content: string, reasoningCharacters: number) {
    const at = this.elapsed()
    if (content.length || reasoningCharacters) this.state.firstTokenMs ??= at
    if (content.length) { this.state.firstContentMs ??= at; this.state.contentChunks++; this.state.contentCharacters += content.length }
    if (reasoningCharacters) { this.state.firstReasoningMs ??= at; this.state.reasoningChunks++; this.state.reasoningCharacters += reasoningCharacters }
  }
  complete() { this.state.streamComplete = true }
  snapshot(): QwenObservation {
    return { ...this.state, elapsedMs: this.elapsed(), ttftMs: this.state.firstTokenMs !== null && this.state.requestSentMs !== null
      ? this.state.firstTokenMs - this.state.requestSentMs : null }
  }
}
