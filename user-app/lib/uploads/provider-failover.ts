import {QwenAnalysisError,type QwenConfig} from './qwen-analysis'
import {modelIdentity} from './qwen-structured'
import {routeraiConfig} from './routerai'

/** Explicit application policy. Each upstream still receives a pinned route;
 * RouterAI must not choose an unlisted provider on our behalf. */
export function presentationModelConfig(environment:Record<string,string|undefined>):QwenConfig{
 const primary={...routeraiConfig(environment),routerai:{providerTag:'deepinfra',quantization:'bf16' as const},timeoutMs:240_000,connectTimeoutMs:15_000}
 return {...primary,fallbacks:[
  {...primary,routerai:{providerTag:'akashml',quantization:'fp8'}},
  {apiKey:environment.INTELION_API_KEY,baseUrl:environment.INTELION_API_BASE_URL,model:environment.INTELION_MODEL,timeoutMs:240_000,connectTimeoutMs:15_000},
 ]}
}
export function providerChain(config:QwenConfig){
 const chain=[config,...config.fallbacks??[]]
 if(chain.length>3||chain.slice(1).some(c=>c.fallbacks?.length))throw new QwenAnalysisError('QWEN_INVALID_SETTINGS','Некорректная цепочка провайдеров.')
 return chain.map(({fallbacks:_,...route})=>route)
}
export function acceptsProvider(identity:ReturnType<typeof modelIdentity>,chain:QwenConfig[]){
 return chain.some(route=>JSON.stringify(modelIdentity(route))===JSON.stringify(identity))
}
export function providerUnavailable(error:unknown){
 if(!(error instanceof QwenAnalysisError))return false
 return ['QWEN_NOT_CONFIGURED','ROUTERAI_PREFLIGHT_FAILED','ROUTERAI_ENDPOINT_INCOMPATIBLE','QWEN_UNAVAILABLE','QWEN_TIMEOUT','QWEN_CONNECT_TIMEOUT','QWEN_STREAM_INTERRUPTED','QWEN_RESPONSE_FAILED'].includes(error.code)||/^QWEN_HTTP_(401|402|403|404|408|425|429|5\d\d)$/.test(error.code)
}
