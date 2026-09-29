import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { checkRouteraiEndpoint, readRouteraiReceipt, routeraiConfig, routeraiRouting, ROUTERAI_BASE_URL, ROUTERAI_MODEL } from '../lib/uploads/routerai'
import { captureCompletion, number, object, safeText, type JsonObject } from './provider-compliance-transport'
import { complianceCases, COMPLIANCE_VERSION, OUTPUT, outputCapacityControl } from './provider-compliance-suite'
import { buildReport, markdownReport, type CaseResult } from './provider-compliance-report'
import { assessCapture } from './provider-compliance-assessment'

type Reservation = { id: string; hash: string; at: string; upperBoundRub: number; actualCostRub: number | null }
type Budget = { version: string; maxRequests: 24; maxRub: 30; reservations: Reservation[] }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function save(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(`${path}.tmp`, path)
}
async function existing<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch (error) { if (object(error).code === 'ENOENT') return null; throw error }
}
const paid = process.argv.includes('--run'), config = routeraiConfig(process.env)
if (config.model !== ROUTERAI_MODEL || config.routerai?.providerTag !== 'deepinfra') throw new Error('This test is fixed to qwen/qwen3.8-27b / deepinfra.')
const baseCases = await complianceCases(), cases = [...baseCases]
await mkdir(`${OUTPUT}/cases`, { recursive: true })
const lock = await open(`${OUTPUT}/running.lock`, 'wx')
try {
  const extensionPath = `${OUTPUT}/output-capacity-control-plan.json`
  const extension = await existing(extensionPath)
  if (process.argv.includes('--output-cap-control') || extension) {
    const control = outputCapacityControl()
    const controlPlan = { id: control.id, bodyHash: hash(control.body), body: control.body,
      reason: 'Initial output probe voluntarily stopped at 14485 tokens / 1000 rows. Use the single remaining request within the unchanged 24/30 RUB budget.' }
    if (extension && hash(extension) !== hash(controlPlan)) throw new Error('Output-control extension changed; retained requests cannot be replaced.')
    await save(extensionPath, controlPlan); cases.push(control)
  }
  const budget = await existing<Budget>(`${OUTPUT}/budget.json`) ?? { version: COMPLIANCE_VERSION, maxRequests: 24, maxRub: 30, reservations: [] }
  if (budget.version !== COMPLIANCE_VERSION || budget.maxRequests !== 24 || budget.maxRub !== 30) throw new Error('Unexpected budget identity; do not reset prior attempts.')
  const results: CaseResult[] = []
  const plan = { version: COMPLIANCE_VERSION, model: config.model, provider: routeraiRouting(config), maxRequests: 24, maxRub: 30,
    tests: baseCases.map(test => ({ id: test.id, title: test.title, group: test.group, bodyHash: hash(test.body), maxTokens: test.body.max_tokens })) }
  const priorPlan = await existing(`${OUTPUT}/plan.json`)
  if (priorPlan && hash(priorPlan) !== hash(plan)) throw new Error('Suite changed after preparation. Preserve this series and use an explicit new version.')
  await save(`${OUTPUT}/plan.json`, plan)
  const report = async () => {
    const committed = budget.reservations.reduce((sum, item) => sum + (item.actualCostRub ?? item.upperBoundRub), 0)
    const summary = { maxRequests: budget.maxRequests, reservedRequests: budget.reservations.length, maxRub: budget.maxRub,
      receiptedCostRub: budget.reservations.reduce((sum, item) => sum + (item.actualCostRub ?? 0), 0),
      conservativeCommittedRub: committed, unknownCostRequests: budget.reservations.filter(item => item.actualCostRub === null).length }
    const value = buildReport(COMPLIANCE_VERSION, cases, results, summary)
    await save(`${OUTPUT}/report.json`, value); await writeFile(`${OUTPUT}/report.md`, markdownReport(value))
    return value
  }
  let prices = { prompt: 0, completion: 0 }
  if (paid) {
    if (!config.apiKey?.trim()) throw new Error('ROUTERAI_API_KEY is not configured.')
    const endpoint = await checkRouteraiEndpoint(config, ['max_tokens', 'reasoning', 'temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'response_format', 'structured_outputs', 'tools', 'tool_choice', ...(cases.length > baseCases.length ? ['logit_bias'] : [])], 32768)
    const response = await fetch(`${ROUTERAI_BASE_URL}/models/${ROUTERAI_MODEL}/endpoints`, { redirect: 'manual', signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`Pricing metadata HTTP ${response.status}`)
    const metadata = object(await response.json()), entries = object(metadata.data).endpoints
    const selected = Array.isArray(entries) ? entries.map(object).find(value => value.tag === 'deepinfra') : null
    const pricing = object(selected?.pricing)
    prices = { prompt: Number(pricing.prompt), completion: Number(pricing.completion) }
    if (!Number.isFinite(prices.prompt) || prices.prompt <= 0 || !Number.isFinite(prices.completion) || prices.completion <= 0) throw new Error('Cannot bound cost without valid current pricing.')
    await save(`${OUTPUT}/preflight-${Date.now()}.json`, { endpoint, pricing: prices, metadata })
    await save(`${OUTPUT}/budget.json`, budget)
  }
  for (const test of cases) {
    const path = `${OUTPUT}/cases/${test.id}`
    const previous = await existing<CaseResult>(`${path}/result.json`)
    if (previous) { results.push(previous); continue }
    if (!paid) continue
    const reservation = budget.reservations.find(item => item.id === test.id)
    if (reservation) {
      results.push({ id: test.id, title: test.title, group: test.group, requestHash: reservation.hash, at: new Date().toISOString(), capture: null, receipt: null, receiptError: null,
        verdict: { status: 'UNVERIFIED', detail: 'Reserved attempt has no completed local result; not resubmitted. Its worst-case cost remains reserved.' } }); continue
    }
    await mkdir(path, { recursive: true })
    let caseBody = test.body
    if (test.dependsOn) {
      const prior = results.find(result => result.id === test.dependsOn)
      if (prior?.verdict.status !== 'PASS' || !prior.capture) {
        const skipped: CaseResult = { id: test.id, title: test.title, group: test.group, requestHash: hash(caseBody), at: new Date().toISOString(), capture: null, receipt: null, receiptError: null,
          verdict: { status: 'UNVERIFIED', detail: 'Prerequisite tool call failed; no synthetic successful call was substituted.' } }
        await save(`${path}/result.json`, skipped); results.push(skipped); await report(); continue
      }
      const priorCall = prior.capture.toolCalls[0]
      const call = { id: priorCall.id, type: priorCall.type, function: priorCall.function }
      const args = object(JSON.parse(call.function.arguments)), sum = Number(args.a) + Number(args.b)
      caseBody = { ...caseBody, messages: [...test.body.messages as unknown[], { role: 'assistant', content: prior.capture.content || null, tool_calls: [call] },
        { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ sum }) }] }
    }
    const body: JsonObject = { ...caseBody, model: ROUTERAI_MODEL, provider: routeraiRouting(config), stream: true, stream_options: { include_usage: true } }
    // Twofold input allowance covers differing chat templates/image accounting;
    // the server output cap bounds generation. This is a client safety estimate.
    const upperBoundRub = (test.estimatedInputTokens * 2 * prices.prompt + Number(body.max_tokens) * prices.completion) * 1.15
    const committed = budget.reservations.reduce((sum, item) => sum + (item.actualCostRub ?? item.upperBoundRub), 0)
    if (budget.reservations.length >= budget.maxRequests || committed + upperBoundRub > budget.maxRub) throw new Error('Compliance budget reached. Remaining cases are unverified, not retried.')
    await save(`${path}/request.json`, body)
    const reserved: Reservation = { id: test.id, hash: hash(body), at: new Date().toISOString(), upperBoundRub, actualCostRub: null }
    budget.reservations.push(reserved); await save(`${OUTPUT}/budget.json`, budget)
    console.log(JSON.stringify({ starting: test.id, reserved: budget.reservations.length, worstCaseRub: upperBoundRub }))
    const result: CaseResult = { id: test.id, title: test.title, group: test.group, requestHash: reserved.hash, at: new Date().toISOString(), capture: null, receipt: null, receiptError: null,
      verdict: { status: 'UNVERIFIED', detail: 'Request not completed.' } }
    const events = await open(`${path}/events.jsonl`, 'wx', 0o600)
    try {
      const started = performance.now()
      const response = await fetch(`${ROUTERAI_BASE_URL}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(test.id.startsWith('output-32768') ? 900000 : 300000) })
      result.capture = await captureCompletion(response, started, async event => { await events.write(JSON.stringify(event) + '\n') })
      result.verdict = assessCapture(test, result.capture)
      if (result.capture.requestId) {
        try { result.receipt = { ...await readRouteraiReceipt(config, result.capture.requestId) }; reserved.actualCostRub = number(result.receipt.totalCostRub) }
        catch (error) { result.receiptError = safeText(error instanceof Error ? error.message : error) }
      }
      const expectedRejection = test.id.startsWith('reject-') && result.verdict.status === 'PASS'
      if (!expectedRejection && result.capture.httpStatus === 200 && (result.capture.error || !result.receipt)) {
        result.verdict = { status: result.capture.error ? 'FAIL' : 'UNVERIFIED', detail: result.capture.error ?? `Route not attested: ${result.receiptError ?? 'no generation id'}`, evidence: { contentCheck: result.verdict } }
      }
    } catch (error) { result.verdict = { status: 'UNVERIFIED', detail: safeText(error instanceof Error ? error.message : error) } }
    finally { await events.close() }
    await save(`${path}/result.json`, result); await save(`${OUTPUT}/budget.json`, budget)
    results.push(result); await report()
    console.log(JSON.stringify({ completed: test.id, verdict: result.verdict.status, detail: result.verdict.detail, usage: result.capture?.usage,
      ttftMs: result.capture?.metrics.ttftMs, costRub: result.receipt?.totalCostRub }))
  }
  const final = await report()
  console.log(JSON.stringify({ overall: final.overall, summary: final.summary, report: `${OUTPUT}/report.md`, mode: paid ? 'run' : 'plan/read-existing' }))
} catch (error) {
  console.error(JSON.stringify({ code: 'PROVIDER_COMPLIANCE_STOPPED', message: safeText(error instanceof Error ? error.message : error), automaticRetry: false })); process.exitCode = 1
} finally { await lock.close(); await unlink(`${OUTPUT}/running.lock`) }
