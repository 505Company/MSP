import { QwenAnalysisError, type QwenConfig } from './qwen-analysis'

export const ROUTERAI_BASE_URL = 'https://routerai.ru/api/v1'
export const ROUTERAI_MODEL = 'qwen/qwen3.8-27b'

export function routeraiConfig(environment: Record<string, string | undefined>): QwenConfig {
  return { apiKey: environment.ROUTERAI_API_KEY, baseUrl: ROUTERAI_BASE_URL,
    model: environment.ROUTERAI_MODEL || ROUTERAI_MODEL, timeoutMs: 900_000,
    routerai: { providerTag: environment.ROUTERAI_PROVIDER || 'deepinfra', quantization: 'bf16' } }
}

export function routeraiRouting(config: QwenConfig) {
  const route = config.routerai
  if (!route || (config.baseUrl ?? ROUTERAI_BASE_URL).replace(/\/$/, '') !== ROUTERAI_BASE_URL ||
    !/^[a-z0-9][a-z0-9-]*$/.test(route.providerTag) || !(route.quantization === 'bf16' || route.providerTag === 'akashml' && route.quantization === 'fp8') ||
    !/^[a-z0-9-]+\/[a-z0-9._-]+$/.test(config.model ?? ROUTERAI_MODEL)) {
    throw new QwenAnalysisError('ROUTERAI_INVALID_SETTINGS', 'RouterAI требует явного провайдера, согласованной точности и собственного адреса API.')
  }
  return { only: [route.providerTag], allow_fallbacks: false as const }
}

type Endpoint = {
  tag: string; provider_name: string; quantization?: string; status: number
  context_length: number; max_completion_tokens: number; max_prompt_tokens?: number
  supported_parameters: string[]; supported_apis?: string[]
}
export type RouteraiEndpointEvidence = {
  checkedAt: string; model: string; providerTag: string; providerName: string
  declaredQuantization: string; contextLength: number; maxCompletionTokens: number
  supportedParameters: string[]; requiredParameters: string[]
}

/** Public metadata is a provider declaration, not hardware attestation. Never
 * silently drop a required setting or substitute a lower precision endpoint. */
export async function checkRouteraiEndpoint(config: QwenConfig, parameters: string[], maxTokens: number, signal?: AbortSignal): Promise<RouteraiEndpointEvidence> {
  const routing = routeraiRouting(config), model = config.model ?? ROUTERAI_MODEL
  const timeout = AbortSignal.timeout(20_000)
  const response = await fetch(`${ROUTERAI_BASE_URL}/models/${model}/endpoints`, { redirect: 'manual', signal: signal ? AbortSignal.any([timeout, signal]) : timeout })
  if (!response.ok) { await response.body?.cancel(); throw new QwenAnalysisError('ROUTERAI_PREFLIGHT_FAILED', `Проверка провайдера RouterAI вернула HTTP ${response.status}. Запрос модели не отправлен.`) }
  const payload = await response.json() as { data?: { id?: string; endpoints?: Endpoint[] } }
  const endpoint = payload.data?.endpoints?.find(value => value.tag === routing.only[0])
  const required = [...new Set(parameters.filter(name => name !== 'provider'))].sort()
  const incompatible=(reason:string):never=>{throw new QwenAnalysisError('ROUTERAI_ENDPOINT_INCOMPATIBLE',reason+' Запрос модели не отправлен.')}
  if(payload.data?.id!==model)incompatible('RouterAI не подтвердил выбранную модель.')
  if(!endpoint)return incompatible(`Выбранный провайдер ${routing.only[0]} отсутствует в списке подключений этой модели.`)
  if(endpoint.status!==0)incompatible(`${endpoint.provider_name} сейчас недоступен. Повторите позже или выберите другое подключение модели.`)
  if(endpoint.quantization!==config.routerai!.quantization)incompatible(`${endpoint.provider_name} не подтвердил точность ${config.routerai!.quantization.toUpperCase()}.`)
  if(!Array.isArray(endpoint.supported_parameters))incompatible(`${endpoint.provider_name} не сообщил поддерживаемые параметры.`)
  const missing=required.filter(name=>!endpoint.supported_parameters.includes(name))
  if(missing.length)incompatible(`${endpoint.provider_name} не поддерживает необходимые параметры: ${missing.join(', ')}.`)
  if(!Number.isSafeInteger(maxTokens)||maxTokens<1)incompatible('Указан некорректный лимит ответа модели.')
  if(!Number.isFinite(endpoint.max_completion_tokens))incompatible(`${endpoint.provider_name} не сообщил лимит ответа модели.`)
  if(maxTokens>endpoint.max_completion_tokens)incompatible(`${endpoint.provider_name} допускает ${endpoint.max_completion_tokens} токенов ответа, требуется ${maxTokens}.`)
  return { checkedAt: new Date().toISOString(), model, providerTag: endpoint.tag, providerName: endpoint.provider_name,
    declaredQuantization: endpoint.quantization!, contextLength: endpoint.context_length, maxCompletionTokens: endpoint.max_completion_tokens,
    supportedParameters: endpoint.supported_parameters, requiredParameters: required }
}

export type RouteraiReceipt = { generationId: string; providerName: string; model: string; totalCostRub: number | null }

/** Check RouterAI's recorded route, not a model's self-reported identity. The
 * check happens after inference: it cannot guarantee the upstream's hardware. */
export async function readRouteraiReceipt(config: QwenConfig, generationId: string, signal?: AbortSignal): Promise<RouteraiReceipt> {
  routeraiRouting(config)
  if (!generationId || generationId.length > 256) throw new QwenAnalysisError('ROUTERAI_ROUTE_UNVERIFIED', 'RouterAI не вернул идентификатор запроса для проверки провайдера.')
  const response = await fetch(`${ROUTERAI_BASE_URL}/generation?id=${encodeURIComponent(generationId)}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` }, redirect: 'manual', signal: signal ? AbortSignal.any([AbortSignal.timeout(15_000), signal]) : AbortSignal.timeout(15_000),
  })
  if (!response.ok) { await response.body?.cancel(); throw new QwenAnalysisError('ROUTERAI_ROUTE_UNVERIFIED', `Квитанция RouterAI недоступна (HTTP ${response.status}). Провайдер ответа не подтверждён.`) }
  const { data } = await response.json() as { data?: { provider?: string; provider_name?: string; model?: string; total_cost?: number } }
  // The live RouterAI receipt uses `provider` (slug). Other compatible
  // receipts expose `provider_name`. If both exist they must agree.
  const providers = [data?.provider, data?.provider_name].filter((value): value is string => typeof value === 'string' && value.length > 0)
  if (!providers.length || providers.some(value => value.toLowerCase().replace(/[^a-z0-9]/g, '') !== config.routerai!.providerTag.replace(/-/g, '')) || data?.model !== (config.model ?? ROUTERAI_MODEL)) {
    throw new QwenAnalysisError('ROUTERAI_ROUTE_MISMATCH', 'В квитанции RouterAI отсутствует выбранный провайдер или модель. Ответ сохранён, но не принят.')
  }
  return { generationId, providerName: data!.provider_name ?? data!.provider!, model: data!.model!,
    totalCostRub: typeof data!.total_cost === 'number' && Number.isFinite(data!.total_cost) ? data!.total_cost : null }
}
