import { buildQwenMessages, type QwenTaskInput } from "./qwen-input.js"
import { z } from "zod"

export type QwenStyleAnalysis = {
  familySuggestion: string
  variantSuggestion: string
  purposeSuggestion: string
  summary: string
  confidence: number
  foundations: {
    paletteRoles: Array<{ role: string; color: string; confidence: number }>
    typographyRoles: Array<{
      role: string
      fontFamily: string
      sizePt: number | null
      confidence: number
    }>
    grid: string
    backgroundStrategy: string
  }
  compositionClusters: Array<{
    name: string
    intent: string
    slideIndices: number[]
    confidence: number
  }>
  warnings: Array<{
    section: "palette" | "typography" | "compositions" | "assets" | "other"
    message: string
    severity: "blocking" | "warning"
  }>
}

type QwenResult =
  | { status: "not_configured" }
  | {
      status: "analyzed"
      format: "json_schema" | "json_object"
      model: string
      analysis: QwenStyleAnalysis
    }

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    familySuggestion: { type: "string" },
    variantSuggestion: { type: "string" },
    purposeSuggestion: { type: "string" },
    summary: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    foundations: {
      type: "object",
      additionalProperties: false,
      properties: {
        paletteRoles: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              role: { type: "string" },
              color: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["role", "color", "confidence"],
          },
        },
        typographyRoles: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              role: { type: "string" },
              fontFamily: { type: "string" },
              sizePt: { type: ["number", "null"] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["role", "fontFamily", "sizePt", "confidence"],
          },
        },
        grid: { type: "string" },
        backgroundStrategy: { type: "string" },
      },
      required: ["paletteRoles", "typographyRoles", "grid", "backgroundStrategy"],
    },
    compositionClusters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          intent: { type: "string" },
          slideIndices: { type: "array", items: { type: "integer", minimum: 0 } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["name", "intent", "slideIndices", "confidence"],
      },
    },
    warnings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          section: {
            type: "string",
            enum: ["palette", "typography", "compositions", "assets", "other"],
          },
          message: { type: "string" },
          severity: { type: "string", enum: ["blocking", "warning"] },
        },
        required: ["section", "message", "severity"],
      },
    },
  },
  required: [
    "familySuggestion",
    "variantSuggestion",
    "purposeSuggestion",
    "summary",
    "confidence",
    "foundations",
    "compositionClusters",
    "warnings",
  ],
} as const

export type QwenConfig = { apiKey?: string; baseUrl?: string; model?: string; timeoutMs?: number }

export class QwenAnalysisError extends Error {
  constructor(readonly code: string, message: string, cause?: unknown) { super(message, { cause }); this.name = "QwenAnalysisError" }
}

export async function analyzeStyle(
  description: QwenTaskInput,
  config: QwenConfig,
  signal?: AbortSignal
): Promise<QwenResult> {
  const apiKey = config.apiKey
  if (!apiKey) return { status: "not_configured" }

  // One deadline includes response-body consumption and the format fallback.
  // Keep the caller's disconnect signal: an abandoned request must not run on.
  const timeout = AbortSignal.timeout(config.timeoutMs ?? 180_000)
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout
  combined.throwIfAborted()
  try {
    const first = await requestAnalysis(apiKey, description, true, config, combined)
    if (first.response.ok) {
      return { status: "analyzed", format: "json_schema", model: first.model,
        analysis: await readAnalysis(first.response, description) }
    }
    if (![400, 422].includes(first.response.status)) throw await providerError(first.response)
    // Providers may support json_object but not strict JSON Schema.
    await first.response.body?.cancel()
    const fallback = await requestAnalysis(apiKey, description, false, config, combined)
    if (!fallback.response.ok) throw await providerError(fallback.response)
    return { status: "analyzed", format: "json_object", model: fallback.model,
      analysis: await readAnalysis(fallback.response, description) }
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    if (timeout.aborted) throw new QwenAnalysisError("QWEN_TIMEOUT", "Анализ занял слишком много времени. Разбор презентации сохранён: откройте черновик или повторите анализ.")
    if (error instanceof QwenAnalysisError) throw error
    throw new QwenAnalysisError("QWEN_UNAVAILABLE", "Не удалось получить полный ответ модели. Разбор презентации сохранён. Повторите анализ позже.", error)
  }
}

async function requestAnalysis(
  apiKey: string,
  description: QwenTaskInput,
  strict: boolean,
  config: QwenConfig,
  signal?: AbortSignal
): Promise<{ response: Response; model: string }> {
  const baseUrl = config.baseUrl ?? "https://rus.aiapi.intelion.cloud/v1"
  const model = config.model ?? "qwen3.8-27b"
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 6000,
      stream: true,
      chat_template_kwargs: { enable_thinking: false },
      messages: buildQwenMessages(description),
      response_format: strict
        ? {
            type: "json_schema",
            json_schema: {
              name: "presentation_style_analysis",
              strict: true,
              schema: analysisSchema,
            },
          }
        : { type: "json_object" },
    }),
    signal,
  })
  return { response, model }
}

type Completion = {
  error?: unknown
  choices?: Array<{ finish_reason?: string | null; message?: { content?: string | Array<{ text?: string }> }; delta?: { content?: string } }>
}

async function completionText(response: Response): Promise<string> {
  let content = "", finish: string | null | undefined, done = false
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const payload = await response.json() as Completion
    if (payload.error) throw new QwenAnalysisError("QWEN_RESPONSE_FAILED", "Сервис модели не завершил ответ.")
    const choice = payload.choices?.[0]
    const value = choice?.message?.content
    content = Array.isArray(value) ? value.map((part) => part.text ?? "").join("") : value ?? ""
    finish = choice?.finish_reason
  } else {
    if (!response.body) throw new Error("Missing response stream")
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = "", received = 0
    const consume = (event: string) => {
      const raw = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n").trim()
      if (!raw) return
      if (raw === "[DONE]") { done = true; return }
      const chunk = JSON.parse(raw) as Completion
      if (chunk.error) throw new QwenAnalysisError("QWEN_STREAM_INTERRUPTED", "Ответ модели прервался. Повторите анализ сохранённого файла.")
      const choice = chunk.choices?.[0]
      content += choice?.delta?.content ?? ""
      if (choice?.finish_reason) finish = choice.finish_reason
    }
    try {
      while (!done) {
        const next = await reader.read()
        if (next.done) break
        received += next.value.byteLength
        if (received > 1_000_000) throw new Error("Response exceeds limit")
        buffer += decoder.decode(next.value, { stream: true })
        let boundary: RegExpExecArray | null
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          consume(buffer.slice(0, boundary.index))
          buffer = buffer.slice(boundary.index + boundary[0].length)
          if (done) break
        }
      }
      if (!done) {
        buffer += decoder.decode()
        if (buffer.trim()) consume(buffer)
      }
      if (!done || !finish) throw new QwenAnalysisError("QWEN_STREAM_INTERRUPTED", "Ответ модели не завершён. Повторите анализ сохранённого файла.")
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }
  if (finish === "length") throw new QwenAnalysisError("QWEN_TRUNCATED", "Ответ модели обрезан по лимиту. Черновик анализа не сохранён; повторите анализ.")
  if (finish && finish !== "stop") throw new QwenAnalysisError("QWEN_INCOMPLETE", "Модель не завершила анализ презентации.")
  if (!content.trim()) throw new QwenAnalysisError("QWEN_EMPTY", "Модель вернула пустой ответ. Повторите анализ сохранённого файла.")
  return content
}

const confidence = z.number().min(0).max(1)
const validatedAnalysis = z.object({
  familySuggestion: z.string(), variantSuggestion: z.string(), purposeSuggestion: z.string(), summary: z.string(), confidence,
  foundations: z.object({
    paletteRoles: z.array(z.object({ role: z.string(), color: z.string().regex(/^#[0-9a-f]{6}$/i), confidence }).strict()),
    typographyRoles: z.array(z.object({ role: z.string(), fontFamily: z.string(), sizePt: z.number().positive().nullable(), confidence }).strict()),
    grid: z.string(), backgroundStrategy: z.string(),
  }).strict(),
  compositionClusters: z.array(z.object({ name: z.string(), intent: z.string(), slideIndices: z.array(z.number().int().nonnegative()), confidence }).strict()),
  warnings: z.array(z.object({ section: z.enum(["palette", "typography", "compositions", "assets", "other"]), message: z.string(), severity: z.enum(["blocking", "warning"]) }).strict()),
}).strict()

async function readAnalysis(response: Response, input: QwenTaskInput): Promise<QwenStyleAnalysis> {
  const text = await completionText(response)
  let value: unknown
  try { value = JSON.parse(stripCodeFence(text)) } catch { throw new QwenAnalysisError("QWEN_INVALID_JSON", "Ответ модели не удалось прочитать. Повторите анализ сохранённого файла.") }
  const checked = validatedAnalysis.safeParse(value)
  if (!checked.success) throw new QwenAnalysisError("QWEN_INVALID_SCHEMA", "Ответ модели не соответствует структуре дизайн-системы. Повторите анализ.")
  const allowed = new Set(input.sourceSlides.filter((slide) => slide.included && slide.providedObjectCount > 0).map((slide) => slide.index))
  if (checked.data.compositionClusters.some((cluster) => cluster.slideIndices.some((index) => !allowed.has(index)))) {
    throw new QwenAnalysisError("QWEN_INVALID_REFERENCES", "Модель сослалась на слайды, которых нет в анализе. Повторите анализ.")
  }
  return checked.data
}

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
}

async function providerError(response: Response): Promise<QwenAnalysisError> {
  await response.body?.cancel()
  const message = response.status === 401 || response.status === 403
    ? "Сервис модели отклонил доступ. Требуется проверить серверный ключ."
    : response.status === 429 ? "Сервис модели занят. Разбор сохранён; повторите анализ позже."
    : `Сервис модели временно недоступен (HTTP ${response.status}). Разбор презентации сохранён.`
  return new QwenAnalysisError(`QWEN_HTTP_${response.status}`, message)
}
