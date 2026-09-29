import type { ModelMessage } from '../digital-designer/design-context'
import { completionResult, QwenAnalysisError, type QwenConfig } from './qwen-analysis'
import { z } from 'zod'
import { checkRouteraiEndpoint, readRouteraiReceipt, routeraiRouting, ROUTERAI_BASE_URL, ROUTERAI_MODEL } from './routerai'
import { QwenObservationRecorder } from './qwen-observation'

// Additive observations do not change generation or invalidate valid old caches.
export const QWEN_TRANSPORT_VERSION = 'web-qwen-structured-2'
const samplingSchema = z.object({
  temperature: z.number().min(0).max(2).optional(), topP: z.number().positive().max(1).optional(),
  topK: z.number().int().positive().optional(), minP: z.number().min(0).max(1).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(), repetitionPenalty: z.number().positive().max(2).optional(),
}).strict()
export type StructuredRequest = {
  messages: ModelMessage[]; schema: object; schemaName: string; maxTokens: number; thinking?: boolean
  sampling?: z.infer<typeof samplingSchema>; reasoningEffort?: 'low' | 'medium' | 'xhigh'
}
export function structuredGeneration(task: StructuredRequest, config?: QwenConfig) {
  const sampling = samplingSchema.parse(task.sampling ?? {})
  const effort = z.enum(['low', 'medium', 'xhigh']).optional().parse(task.reasoningEffort)
  if (effort && !task.thinking) throw new QwenAnalysisError('QWEN_INVALID_SETTINGS', 'Уровень рассуждения требует включённого режима thinking.')
  const generation = {
    temperature: sampling.temperature ?? 0.1,
    ...(sampling.topP !== undefined ? { top_p: sampling.topP } : {}),
    ...(sampling.topK !== undefined ? { top_k: sampling.topK } : {}),
    ...(sampling.minP !== undefined ? { min_p: sampling.minP } : {}),
    ...(sampling.presencePenalty !== undefined ? { presence_penalty: sampling.presencePenalty } : {}),
    ...(sampling.repetitionPenalty !== undefined ? { repetition_penalty: sampling.repetitionPenalty } : {}),
    ...(effort ? { reasoning_effort: effort } : {}),
    chat_template_kwargs: { enable_thinking: task.thinking ?? false },
  }
  if (!config?.routerai) return generation
  const { reasoning_effort, chat_template_kwargs, ...samplingParameters } = generation
  return { ...samplingParameters, reasoning: { enabled: chat_template_kwargs.enable_thinking,
    ...(reasoning_effort ? { effort: reasoning_effort } : {}) }, provider: routeraiRouting(config) }
}
export function modelIdentity(config: QwenConfig) {
  if (config.routerai) return { provider: 'routerai', baseUrl: ROUTERAI_BASE_URL, model: config.model ?? ROUTERAI_MODEL, weightsRevision: null,
    routing: { ...routeraiRouting(config), requiredQuantization: config.routerai.quantization, contract: config.routerai.quantization==='bf16'?'routerai-deepinfra-1':'routerai-explicit-route-1' } }
  if (config.baseUrl?.startsWith(ROUTERAI_BASE_URL)) throw new QwenAnalysisError('ROUTERAI_INVALID_SETTINGS', 'Подключение RouterAI требует явной настройки провайдера.')
  return { provider: 'intelion', baseUrl: (config.baseUrl ?? 'https://rus.aiapi.intelion.cloud/v1').replace(/\/$/, ''), model: config.model ?? 'qwen3.8-27b', weightsRevision: null }
}

/** A single paid attempt. No silent schema fallback, semantic repair, or retry. */
export async function requestStructured(task: StructuredRequest, config: QwenConfig, signal?: AbortSignal, beforeRequest?: () => Promise<void>) {
  if (!config.apiKey?.trim()) throw new QwenAnalysisError('QWEN_NOT_CONFIGURED', 'Требуется настроить подключение модели на сервере.')
  const generation = structuredGeneration(task, config)
  const identity = modelIdentity(config), started = Date.now()
  const observation = new QwenObservationRecorder()
  const timeout = AbortSignal.timeout(config.timeoutMs ?? 180_000)
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout
  let phase = config.routerai ? 'preflight' : 'request'
  try {
    const endpoint = config.routerai ? await checkRouteraiEndpoint(config, [...Object.keys(generation), 'max_tokens', 'response_format', 'structured_outputs'], task.maxTokens, combined) : undefined
    combined.throwIfAborted()
    await beforeRequest?.()
    combined.throwIfAborted()
    phase = 'request'; observation.sent()
    const connectionAbort=new AbortController()
    const connectionTimer=config.connectTimeoutMs?setTimeout(()=>connectionAbort.abort(),config.connectTimeoutMs):undefined
    let response:Response
    try{response = await fetch(`${identity.baseUrl}/chat/completions`, {
      // Workers supports manual/follow. Reject 3xx below without forwarding
      // Authorization; redirect:error itself throws in the Workers runtime.
      method: 'POST', signal: AbortSignal.any([combined,connectionAbort.signal]), redirect: 'manual',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: identity.model, ...generation, max_tokens: task.maxTokens,
        stream: true, stream_options: { include_usage: true },
        messages: task.messages, response_format: { type: 'json_schema', json_schema: { name: task.schemaName, strict: true, schema: task.schema } } }),
    })}catch(error){if(connectionAbort.signal.aborted&&!combined.aborted)throw new QwenAnalysisError('QWEN_CONNECT_TIMEOUT','Провайдер не ответил при подключении.');throw error}finally{clearTimeout(connectionTimer)}
    observation.headers()
    if (!response.ok) {
      // Keep only an allowlisted diagnosis, never an upstream body that could
      // echo credentials, source text or image data. Read a bounded prefix.
      const reader = response.body?.getReader()
      const prefix = reader ? await reader.read().catch(() => null) : null
      await reader?.cancel().catch(() => {})
      const detail = new TextDecoder().decode(prefix?.value?.slice(0, 8192))
      const failure = new QwenAnalysisError(`QWEN_HTTP_${response.status}`, [401, 403].includes(response.status)
        ? 'Сервис модели отклонил доступ. Требуется проверить серверный ключ.'
        : `Сервис модели вернул HTTP ${response.status}. Исходные данные сохранены.`)
      failure.diagnostic = { phase: 'request', transportCodes: [], kind: /(?:too many|maximum|limit)[\s\S]{0,100}image|image[\s\S]{0,100}(?:limit|exceed|maximum)/i.test(detail) ? 'image-limit'
        : /(?:body|request|payload)[\s\S]{0,100}(?:too large|exceed|limit)/i.test(detail) ? 'request-size'
        : /(?:context|token)[\s\S]{0,100}(?:limit|exceed|maximum|too long)/i.test(detail) ? 'context-limit'
        : /(?:schema|response_format)[\s\S]{0,100}(?:invalid|unsupported|error)/i.test(detail) ? 'schema-rejected'
        : /<html|<!doctype/i.test(detail) ? 'http-html' : 'http-rejected' }
      throw failure
    }
    phase = 'response'
    const result = await completionResult(response, observation)
    if (result.finishReason !== 'stop') {
      const failure = new QwenAnalysisError('QWEN_INCOMPLETE', 'Модель не завершила ответ.')
      failure.partialResponse = result
      failure.diagnostic = { phase: 'response', transportCodes: [], kind: 'missing-finish' }
      throw failure
    }
    let routingReceipt
    if (config.routerai) {
      phase = 'receipt'
      try { routingReceipt = await readRouteraiReceipt(config, response.headers.get('x-generation-id') ?? result.requestId ?? '', combined) }
      catch (error) {
        const failure = error instanceof QwenAnalysisError ? error : new QwenAnalysisError('ROUTERAI_ROUTE_UNVERIFIED', 'Квитанция RouterAI не получена. Ответ сохранён, но провайдер не подтверждён.')
        failure.partialResponse = result; throw failure
      }
    }
    return { ...result, identity, elapsedMs: Date.now() - started, responseFormat: 'json_schema' as const,
      ...(endpoint ? { endpoint } : {}), ...(routingReceipt ? { routingReceipt } : {}) }
  } catch (error) {
    const failure = signal?.aborted ? new QwenAnalysisError('QWEN_CANCELLED', 'Анализ прерван. Исходные данные сохранены.')
      : timeout.aborted ? new QwenAnalysisError('QWEN_TIMEOUT', 'Модель не завершила анализ вовремя. Исходные данные сохранены.')
      : error instanceof QwenAnalysisError ? error
      : new QwenAnalysisError('QWEN_UNAVAILABLE', 'Не удалось получить полный ответ модели. Исходные данные сохранены.')
    if (error instanceof QwenAnalysisError && error.partialResponse) failure.partialResponse = error.partialResponse
    else if (observation.snapshot().requestSentMs !== null) failure.partialResponse = { content: '', requestId: null, reportedModel: null, finishReason: null,
      usage: { promptTokens: null, completionTokens: null, totalTokens: null }, observation: observation.snapshot() }
    const codes: string[] = [], allowed = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPERM', 'EACCES', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED'])
    let current: unknown = error
    for (let i = 0; i < 5 && current && typeof current === 'object'; i++) {
      const value = current as { code?: string; cause?: unknown }
      if (value.code && allowed.has(value.code)) codes.push(value.code)
      current = value.cause
    }
    const message = error instanceof Error ? error.message : ''
    failure.diagnostic = { phase, transportCodes: [...new Set(codes)], kind: signal?.aborted ? 'cancelled' : timeout.aborted ? 'timeout'
      : error instanceof QwenAnalysisError && error.diagnostic ? error.diagnostic.kind
      : error instanceof SyntaxError ? 'invalid-response-json' : /certificate|TLS|SSL/i.test(message) ? 'tls' : /network|fetch|connect/i.test(message) ? 'network' : 'transport' }
    throw failure
  }
}

export function parseModelJson(text: string): unknown {
  try { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) }
  catch { throw new QwenAnalysisError('QWEN_INVALID_JSON', 'Ответ модели не удалось прочитать. Исходные данные сохранены.') }
}
