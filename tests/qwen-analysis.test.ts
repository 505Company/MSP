import assert from "node:assert/strict"
import test from "node:test"
import { analyzeStyle } from "../admin/lib/uploads/qwen-analysis.js"
import { buildQwenInput } from "../admin/lib/uploads/qwen-input.js"
import { profilePptxBytes } from "../admin/lib/uploads/pptx-profiler.js"
import { pptxFixture, shape } from "./fixtures/qwen-pptx.js"

const analysis = {
  familySuggestion: "Test", variantSuggestion: "Simple", purposeSuggestion: "Review",
  summary: "Extracted structure", confidence: 0.8,
  foundations: { paletteRoles: [], typographyRoles: [], grid: "Two columns", backgroundStrategy: "Light" },
  compositionClusters: [{ name: "Comparison", intent: "Compare", slideIndices: [0], confidence: 0.8 }], warnings: [],
}
const input = async () => buildQwenInput(await profilePptxBytes("test.pptx", await pptxFixture([{ objects: shape("1") }])))
const response = () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(analysis) } }] })

test("a valid analysis taking 90 seconds is not discarded at the former 60-second deadline", async (t) => {
  // Compress model time by 1000 while exercising the real request and abort path.
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), ms / 1000)
    timer.unref()
    return controller.signal
  })
  t.mock.method(globalThis, "fetch", (_url: unknown, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(response()), 90)
    init.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal!.reason) }, { once: true })
  }))
  assert.equal((await analyzeStyle(await input(), { apiKey: "test" })).status, "analyzed")
})

test("a response cut off by the model token limit never becomes a ready draft", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "length", message: { content: JSON.stringify(analysis) } }] }))
  await assert.rejects(analyzeStyle(await input(), { apiKey: "test" }), /не заверш|обрезан|truncated/i)
})

test("invalid nested data and slide references are rejected before storing an analysis", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...analysis, compositionClusters: [{ ...analysis.compositionClusters[0], slideIndices: [999] }] }) } }] }))
  await assert.rejects(analyzeStyle(await input(), { apiKey: "test" }), /слайд|schema|структур/i)
})

function streamingResponse(value: unknown, terminated = true) {
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(value) }, finish_reason: null }] })}\r\n\r\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\r\n\r\n${terminated ? "data: [DONE]\r\n\r\n" : ""}`)
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < encoded.length; i += 11) controller.enqueue(encoded.slice(i, i + 11))
    controller.close()
  } }), { headers: { "Content-Type": "text/event-stream" } })
}

test("streaming preserves split UTF-8 and framing and waits for a complete answer", async (t) => {
  t.mock.method(globalThis, "fetch", async () => streamingResponse({ ...analysis, summary: "Крупный заголовок и две колонки" }))
  const result = await analyzeStyle(await input(), { apiKey: "test" })
  assert.equal(result.status, "analyzed")
  if (result.status === "analyzed") assert.equal(result.analysis.summary, "Крупный заголовок и две колонки")
})

test("a broken stream is not treated as a completed analysis even if partial JSON is valid", async (t) => {
  t.mock.method(globalThis, "fetch", async () => streamingResponse(analysis, false))
  await assert.rejects(analyzeStyle(await input(), { apiKey: "test" }), /не заверш/)
})

test("the same deadline and caller cancellation cover response-body consumption", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => new Response(new ReadableStream({ start(controller) {
    const fail = () => controller.error(init.signal!.reason)
    if (init.signal?.aborted) fail()
    else init.signal?.addEventListener("abort", fail, { once: true })
  } }), { headers: { "Content-Type": "text/event-stream" } }))
  const keepAlive = setTimeout(() => {}, 200)
  try {
    await assert.rejects(analyzeStyle(await input(), { apiKey: "test", timeoutMs: 20 }), /Разбор презентации сохранён/)
    const cancel = new AbortController()
    const pending = analyzeStyle(await input(), { apiKey: "test" }, cancel.signal)
    cancel.abort(new Error("User cancelled"))
    await assert.rejects(pending, /User cancelled/)
  } finally { clearTimeout(keepAlive) }
})
