import test from 'node:test'
import assert from 'node:assert/strict'
import { routeraiConfig, checkRouteraiEndpoint, readRouteraiReceipt } from '../lib/uploads/routerai'
import { requestStructured, structuredGeneration, modelIdentity, type StructuredRequest } from '../lib/uploads/qwen-structured'
import { withPixelGenerationProfile } from '../lib/presentations/pixel-task'
import { beginModelRun } from '../lib/uploads/model-run'
import { memoryBucket } from './helpers/memory-bucket'

const config = routeraiConfig({ ROUTERAI_API_KEY: 'synthetic-key' })
const task = withPixelGenerationProfile({ schemaName: 'test', schema: { type: 'object' }, maxTokens: 20, messages: [{ role: 'user', content: 'Synthetic' }] } satisfies StructuredRequest)
const endpoint = { tag: 'deepinfra', provider_name: 'DeepInfra', quantization: 'bf16', status: 0, context_length: 262144, max_completion_tokens: 131072,
  supported_parameters: ['temperature', 'top_p', 'top_k', 'min_p', 'presence_penalty', 'repetition_penalty', 'reasoning', 'max_tokens', 'response_format', 'structured_outputs'] }
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const catalog = (e = endpoint) => json({ data: { id: config.model, endpoints: [e] } })
const response = () => new Response([
  { id: 'provider-id', model: config.model, choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'stop' }] },
  { choices: [], usage: { completion_tokens: 10, completion_tokens_details: { reasoning_tokens: 8 } } },
].map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream', 'x-generation-id': 'router-generation' } })

test('explicit AkashML FP8 experiment verifies its own precision and route without weakening default BF16',async t=>{
  const experiment={...config,routerai:{providerTag:'akashml',quantization:'fp8' as const}}
  let paid=0
  t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
    if(String(url).endsWith('/endpoints'))return catalog({...endpoint,tag:'akashml',provider_name:'AkashML',quantization:'fp8'})
    if(String(url).includes('/generation?'))return json({data:{provider:'akashml',model:config.model}})
    paid++;assert.deepEqual(JSON.parse(String(init?.body)).provider,{only:['akashml'],allow_fallbacks:false});return response()
  })
  const result=await requestStructured(task,experiment)
  assert.equal(result.endpoint?.declaredQuantization,'fp8');assert.equal(result.routingReceipt?.providerName,'akashml');assert.equal(paid,1)
  assert.equal(routeraiConfig({}).routerai?.quantization,'bf16');assert.equal(routeraiConfig({}).routerai?.providerTag,'deepinfra')
  await assert.rejects(checkRouteraiEndpoint(config,[],1),{code:'ROUTERAI_ENDPOINT_INCOMPATIBLE'})
  assert.throws(()=>modelIdentity({...config,routerai:{providerTag:'deepinfra',quantization:'fp8'}}),{code:'ROUTERAI_INVALID_SETTINGS'})
})

test('RouterAI sends the complete sampling profile, normalized reasoning and explicit provider; receipt proves recorded routing', async t => {
  const calls: { url: string; init?: RequestInit }[] = []
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/endpoints')) return catalog()
    if (String(url).includes('/generation?')) return json({ data: { provider_name: 'DeepInfra', model: config.model, total_cost: 0.01 } })
    return response()
  })
  const result = await requestStructured(task, config)
  const body = JSON.parse(String(calls[1].init!.body))
  assert.deepEqual(body.provider, { only: ['deepinfra'], allow_fallbacks: false })
  assert.deepEqual(body.reasoning, { enabled: true, effort: 'xhigh' })
  assert.equal(body.chat_template_kwargs, undefined); assert.equal(body.reasoning_effort, undefined)
  assert.deepEqual([body.temperature, body.top_p, body.top_k, body.min_p, body.presence_penalty, body.repetition_penalty, body.max_tokens], [1, .95, 20, 0, 0, 1, 32768])
  assert.equal(body.response_format.type, 'json_schema'); assert.equal(body.stream, true)
  assert.equal(calls[0].init?.headers, undefined)
  assert.equal(calls[2].url, 'https://routerai.ru/api/v1/generation?id=router-generation')
  assert.equal(result.routingReceipt?.providerName, 'DeepInfra'); assert.equal(result.endpoint?.declaredQuantization, 'bf16')
  assert.equal(result.reasoning?.tokens, 8)
})

test('changed precision, unavailable endpoint, missing parameters or insufficient output limit stop before budget reservation and paid POST', async t => {
  let reservations = 0, paid = 0, e = endpoint
  t.mock.method(globalThis, 'fetch', async (_: unknown, init?: RequestInit) => { if (init?.method === 'POST') paid++; return catalog(e) })
  for (const change of [{ quantization: 'fp8' }, { status: -1 }, { max_completion_tokens: 100 }, { supported_parameters: endpoint.supported_parameters.filter(p => p !== 'top_k') }]) {
    e = { ...endpoint, ...change }
    const { bucket } = memoryBucket()
    const started = await beginModelRun({ bucket, prefix: 'check', config, task, version: 'test', scope: {}, validate: raw => raw, beforeRequest: async () => { reservations++ } })
    await assert.rejects(started.execute!(), { code: 'ROUTERAI_ENDPOINT_INCOMPATIBLE' })
    assert.equal(started.run.liveRequests, 0)
  }
  assert.equal(reservations, 0); assert.equal(paid, 0)
})

test('an unavailable BF16 provider reports availability rather than a precision or token-limit failure', async t => {
  let paid=0,reservations=0
  t.mock.method(globalThis,'fetch',async(_:unknown,init?:RequestInit)=>{
    if(init?.method==='POST')paid++
    return catalog({...endpoint,status:-2,max_completion_tokens:235929})
  })
  await assert.rejects(requestStructured(task,config,undefined,async()=>{reservations++}),error=>{
    assert.match((error as Error).message,/^DeepInfra сейчас недоступен\./)
    assert.doesNotMatch((error as Error).message,/не подтвердил|лимит|BF16/)
    assert.match((error as Error).message,/Запрос модели не отправлен/)
    return true
  })
  assert.equal(paid,0);assert.equal(reservations,0)
})

test('unexpected provider preserves completed reply but cannot publish a success or populate cache', async t => {
  t.mock.method(globalThis, 'fetch', async (url: unknown) => String(url).endsWith('/endpoints') ? catalog() : String(url).includes('/generation?') ? json({ data: { provider_name: 'Other', model: config.model } }) : response())
  const { bucket, data } = memoryBucket()
  const started = await beginModelRun({ bucket, prefix: 'mismatch', config, task, version: 'test', scope: {}, validate: raw => raw })
  await assert.rejects(started.execute!(), { code: 'ROUTERAI_ROUTE_MISMATCH' })
  assert.equal(started.run.status, 'failed'); assert.equal(started.run.liveRequests, 1)
  assert.equal([...data.keys()].some(k => k.includes('/cache/')), false)
  const saved = JSON.parse(data.get(`mismatch/responses/${started.run.id}.json`)!.value)
  assert.equal(saved.content, '{"ok":true}')
})

test('live RouterAI receipt uses a provider slug; contradictory aliases and unknown models remain rejected', async t => {
  let data: Record<string, unknown> = { provider: 'deepinfra', model: config.model, total_cost: .13 }
  t.mock.method(globalThis, 'fetch', async () => json({ data }))
  assert.equal((await readRouteraiReceipt(config, 'synthetic')).providerName, 'deepinfra')
  data = { ...data, provider_name: 'Other' }
  await assert.rejects(readRouteraiReceipt(config, 'synthetic'), { code: 'ROUTERAI_ROUTE_MISMATCH' })
  data = { provider: 'deepinfra', model: 'other/model' }
  await assert.rejects(readRouteraiReceipt(config, 'synthetic'), { code: 'ROUTERAI_ROUTE_MISMATCH' })
})

test('RouterAI identity and cache differ by provider, while legacy Intelion remains byte equivalent', async t => {
  assert.deepEqual(modelIdentity({}), { provider: 'intelion', baseUrl: 'https://rus.aiapi.intelion.cloud/v1', model: 'qwen3.8-27b', weightsRevision: null })
  assert.deepEqual(structuredGeneration({ ...task, sampling: undefined, reasoningEffort: undefined, thinking: false }), { temperature: .1, chat_template_kwargs: { enable_thinking: false } })
  const { bucket } = memoryBucket()
  const first = await beginModelRun({ bucket, prefix: 'cache', config, task, version: 'test', scope: {}, validate: raw => raw })
  const second = await beginModelRun({ bucket, prefix: 'cache', config: { ...config, routerai: { providerTag: 'another', quantization: 'bf16' } }, task, version: 'test', scope: {}, validate: raw => raw })
  assert.notEqual(first.run.inputHash, second.run.inputHash)
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Unexpected request') })
  assert.throws(() => modelIdentity({ baseUrl: 'https://routerai.ru/api/v1' }), { code: 'ROUTERAI_INVALID_SETTINGS' })
  await assert.rejects(checkRouteraiEndpoint({ ...config, baseUrl: 'https://untrusted.invalid' }, [], 1), { code: 'ROUTERAI_INVALID_SETTINGS' })
})
