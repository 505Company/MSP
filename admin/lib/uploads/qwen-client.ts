import { env } from "cloudflare:workers"
import { analyzeStyle } from "./qwen-analysis"
import type { QwenTaskInput } from "./qwen-input"

export type { QwenStyleAnalysis } from "./qwen-analysis"

export function analyzeStyleWithQwen(description: QwenTaskInput, signal?: AbortSignal) {
  return analyzeStyle(description, {
    apiKey: env.INTELION_API_KEY,
    baseUrl: env.INTELION_API_BASE_URL,
    model: env.INTELION_MODEL,
  }, signal)
}
