import assert from "node:assert/strict"
import test from "node:test"

import { processingResponse } from "../admin/lib/uploads/processing-response.js"
import { readProcessingResponse } from "../admin/lib/uploads/read-processing-response.js"
import { processingCount } from "../admin/lib/uploads/processing-activity.js"

test("acknowledges the persisted job before processing completes, then drains the stream", async () => {
  let finish!: () => void
  const done = new Promise<void>((resolve) => { finish = resolve })
  const { response, completion } = processingResponse({ id: "upload-1" }, () => done)
  const initial = await readProcessingResponse<{ id: string }>(response)
  assert.equal(initial.id, "upload-1")
  assert.equal(processingCount(), 1)
  finish()
  await completion
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(processingCount(), 0)
})

test("disconnect aborts processing so the caller can persist a retryable failure", async () => {
  let aborted = false
  const { response, completion } = processingResponse({ id: "upload-2" }, (signal) =>
    new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => { aborted = true; resolve() }, { once: true })
    })
  )
  const reader = response.body!.getReader()
  await reader.read()
  await reader.cancel()
  await completion
  assert.equal(aborted, true)
})

test("ordinary JSON failures remain readable", async () => {
  const result = await readProcessingResponse<{ error: string }>(
    Response.json({ error: "Invalid PPTX" }, { status: 400 })
  )
  assert.equal(result.error, "Invalid PPTX")
})
