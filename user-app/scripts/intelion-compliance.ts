import type { Case } from './provider-compliance-suite'
import { object, number, type Capture, type JsonObject } from './provider-compliance-transport'

export const INTELION_URL = 'https://rus.aiapi.intelion.cloud/v1'
export const INTELION_MODEL = 'qwen3.8-27b'
export const INTELION_OUTPUT = 'outputs/diagnostics/provider-compliance-intelion'
export const INTELION_VERSION = 'intelion-provider-compliance-1'

/** All content, schemas, sampling and token limits are shared. Outside explicit
 * dialect probes, disable thinking using Intelion's native template parameter. */
export function intelionCase(test: Case): Case {
  if (/^(native|routerai)-(off|low|medium|xhigh)$/.test(test.id) || !test.body.reasoning) return test
  const body = { ...test.body }, reasoning = object(body.reasoning)
  delete body.reasoning
  body.chat_template_kwargs = { ...object(body.chat_template_kwargs), enable_thinking: reasoning.enabled }
  if (reasoning.effort) body.reasoning_effort = reasoning.effort
  return { ...test, body }
}
export type IntelionPrices = { promptRubPerToken: number; completionRubPerToken: number; cacheReadRubPerToken: number | null; sourceUnit: string }
export function intelionPrices(metadata: JsonObject): IntelionPrices {
  const pricing = object(object(metadata.meta).pricing)
  if (pricing.unit !== 'RUB_KOPECKS/1M_tokens') throw new Error('Unknown Intelion pricing unit; no paid call sent.')
  const prompt = number(pricing.input_incl_vat) ?? number(pricing.input), completion = number(pricing.output_incl_vat) ?? number(pricing.output)
  if (prompt === null || completion === null || prompt <= 0 || completion <= 0) throw new Error('Missing current Intelion token prices.')
  const cache = number(pricing.cache_read_incl_vat)
  return { promptRubPerToken: prompt / 100_000_000, completionRubPerToken: completion / 100_000_000,
    cacheReadRubPerToken: cache !== null && cache >= 0 ? cache / 100_000_000 : null, sourceUnit: String(pricing.unit) }
}
export function estimateIntelionCost(capture: Capture, prices: IntelionPrices): number | null {
  const prompt = number(capture.usage?.prompt_tokens), completion = number(capture.usage?.completion_tokens)
  if (prompt === null || completion === null || prompt < 0 || completion < 0) return null
  const cached = Math.min(prompt, Math.max(0, number(object(capture.usage?.prompt_tokens_details).cached_tokens) ?? 0))
  return (prompt - cached) * prices.promptRubPerToken + cached * (prices.cacheReadRubPerToken ?? prices.promptRubPerToken) + completion * prices.completionRubPerToken
}

/** A wrong finish_reason is still a protocol failure. A separately requested
 * continuation may test the valid, harmless synthetic call without hiding it. */
export function canContinueSyntheticTool(capture: Capture | null): boolean {
  if (!capture || capture.error || capture.model !== INTELION_MODEL || capture.toolCalls.length !== 1) return false
  const call = capture.toolCalls[0]
  if (!call.id || call.function.name !== 'add_numbers') return false
  try { const args = object(JSON.parse(call.function.arguments)); return args.a === 17 && args.b === 23 && Object.keys(args).length === 2 }
  catch { return false }
}
