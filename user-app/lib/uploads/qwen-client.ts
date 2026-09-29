import { env } from "cloudflare:workers"
import { analyzeCheckpoint } from "../digital-designer/pipeline"
import type { QwenTaskInput } from "./qwen-input"

export type { QwenStyleAnalysis } from "./qwen-analysis"

export function analyzeStyleWithQwen(description: QwenTaskInput, signal?: AbortSignal) {
  return analyzeCheckpoint(description, {
    apiKey: env.INTELION_API_KEY,
    baseUrl: env.INTELION_API_BASE_URL,
    model: env.INTELION_MODEL,
  }, signal)
}

export function modelConfig() { return { apiKey: env.INTELION_API_KEY, baseUrl: env.INTELION_API_BASE_URL, model: env.INTELION_MODEL } }
