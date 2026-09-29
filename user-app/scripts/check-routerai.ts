import { mkdir, open, unlink } from 'node:fs/promises'
import { routeraiConfig, checkRouteraiEndpoint, readRouteraiReceipt } from '../lib/uploads/routerai'
import { modelIdentity, structuredGeneration, parseModelJson } from '../lib/uploads/qwen-structured'
import { capabilityTask, validateCapabilities } from '../lib/uploads/qwen-capabilities'
import { withPixelGenerationProfile } from '../lib/presentations/pixel-task'
import { beginModelRun, readModelRun } from '../lib/uploads/model-run'
import { QwenAnalysisError } from '../lib/uploads/qwen-analysis'
import { diagnosticBucket, loadJson, saveJson, digest } from './pixel-pilot-store'

const output = 'outputs/diagnostics/routerai-setup'
const config = routeraiConfig(process.env), task = withPixelGenerationProfile(capabilityTask)
const generation = structuredGeneration(task, config), request = process.argv.includes('--request')
const verifySaved = process.argv.includes('--verify-saved')
const attempt = process.argv.includes('--attempt=2') ? 2 : 1
await mkdir(output, { recursive: true })
const lock = await open(`${output}/running.lock`, 'wx')
try {
  if (verifySaved && request) throw new QwenAnalysisError('ROUTERAI_CHECK_MODE', 'Повторная проверка сохранённого ответа не отправляет модельный запрос.')
  const evidence = await checkRouteraiEndpoint(config, [...Object.keys(generation), 'max_tokens', 'response_format', 'structured_outputs'], task.maxTokens, AbortSignal.timeout(20_000))
  await saveJson(`${output}/endpoint-${Date.now()}.json`, evidence)
  await saveJson(`${output}/connection.json`, { model: modelIdentity(config), generation, maxTokens: task.maxTokens, keyConfigured: Boolean(config.apiKey?.trim()),
    guarantee: 'Metadata declares BF16. Route is checked against the RouterAI receipt. Hardware precision and per-parameter application are not independently attested.' })
  console.log(JSON.stringify({ preflight: 'passed', ...evidence, keyConfigured: Boolean(config.apiKey?.trim()), modelRequests: 0 }))
  if (verifySaved) {
    const previous = await readModelRun(diagnosticBucket(output), `smoke-${attempt}`)
    if (!previous) throw new QwenAnalysisError('ROUTERAI_CHECK_MISSING', 'Нет сохранённого ответа для проверки.')
    const input = await loadJson(`${output}/model/smoke-${attempt}/inputs/${previous.inputHash}.json`)
    const reply = await loadJson(`${output}/model/smoke-${attempt}/responses/${previous.id}.json`)
    if (!reply || reply.finishReason !== 'stop' || digest(input.task) !== digest(task) || digest(reply.identity) !== digest(modelIdentity(config))) {
      throw new QwenAnalysisError('ROUTERAI_CHECK_CHANGED', 'Ответ не завершён или не соответствует текущей проверке.')
    }
    const result = validateCapabilities(parseModelJson(reply.content)), receipt = await readRouteraiReceipt(config, reply.requestId)
    const verification = { passed: true, checkedAt: new Date().toISOString(), sourceRunId: previous.id, sourceRunStatus: previous.status,
      responseHash: digest(reply), result, receipt, usage: reply.usage, reasoning: reply.reasoning, endpoint: evidence,
      originalRunChanged: false, modelRequests: 0, pilotAllowanceChanged: false }
    await saveJson(`${output}/verification-${attempt}.json`, verification)
    console.log(JSON.stringify(verification))
  }
  if (request) {
    const bucket = diagnosticBucket(output), prefix = `smoke-${attempt}`, identity = modelIdentity(config)
    const previous = await readModelRun(bucket, prefix)
    if (previous) throw new QwenAnalysisError('ROUTERAI_SMOKE_RETAINED', 'Эта попытка уже сохранена. Автоматический повтор не выполняется.')
    const budget = await loadJson(`${output}/experiment.json`) ?? { maxRequests: 2, used: 0, reservations: [], purpose: 'Connection, exact recommended parameters, image input, strict JSON and recorded provider; no slide generation.' }
    const started = await beginModelRun({ bucket, prefix, config, task, version: 'routerai-connection-check-1', scope: { synthetic: true }, validate: validateCapabilities,
      beforeRequest: async () => {
        if (budget.maxRequests !== 2 || budget.used >= 2 || budget.used !== budget.reservations.length) throw new QwenAnalysisError('ROUTERAI_CHECK_BUDGET', 'Лимит проверки подключения исчерпан.')
        budget.used++; budget.reservations.push({ at: new Date().toISOString(), prefix, identity, taskHash: digest(task) })
        await saveJson(`${output}/experiment.json`, budget)
      } })
    try { await started.execute?.() }
    finally { await saveJson(`${output}/result-${attempt}.json`, { run: started.run, pilotAllowanceChanged: false, productionProjectChanged: false }) }
    console.log(JSON.stringify({ status: started.run.status, result: started.run.result, provenance: started.run.provenance, used: budget.used, limit: budget.maxRequests }))
  }
} catch (error) {
  console.error(JSON.stringify({ code: error instanceof QwenAnalysisError ? error.code : 'ROUTERAI_CHECK_FAILED', message: error instanceof QwenAnalysisError ? error.message : 'Проверка подключения не завершена.', modelKeyPrinted: false }))
  process.exitCode = 1
} finally { await lock.close(); await unlink(`${output}/running.lock`) }
