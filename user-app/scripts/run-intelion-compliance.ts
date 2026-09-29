import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { captureCompletion, object, safeText, type JsonObject } from './provider-compliance-transport'
import { complianceCases, outputCapacityControl, OUTPUT as ROUTER_OUTPUT } from './provider-compliance-suite'
import { assessCapture } from './provider-compliance-assessment'
import { buildReport, markdownReport, type CaseResult, type ProviderContext } from './provider-compliance-report'
import { intelionCase, intelionPrices, estimateIntelionCost, canContinueSyntheticTool, INTELION_URL, INTELION_MODEL, INTELION_OUTPUT as OUTPUT, INTELION_VERSION as VERSION, type IntelionPrices } from './intelion-compliance'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function save(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(`${path}.tmp`, path)
}
async function existing<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch (error) { if (object(error).code === 'ENOENT') return null; throw error }
}
type Reservation = { id: string; requestHash: string; at: string; upperBoundRub: number; estimatedCostRub: number | null }
type Budget = { version: string; maxRequests: 24; maxRub: 30; reservations: Reservation[] }
const run = process.argv.includes('--run'), config = { apiKey: process.env.INTELION_API_KEY,
  baseUrl: (process.env.INTELION_API_BASE_URL || INTELION_URL).replace(/\/$/, ''), model: process.env.INTELION_MODEL || INTELION_MODEL }
if (config.baseUrl !== INTELION_URL || config.model !== INTELION_MODEL) throw new Error('Intelion diagnostic is restricted to the existing official endpoint and qwen3.8-27b.')
const shared = [...await complianceCases(), outputCapacityControl()], cases = shared.map(intelionCase)
const baselineBytes = await readFile(`${ROUTER_OUTPUT}/report.json`)
const baselineHash = createHash('sha256').update(baselineBytes).digest('hex')
const baseline = JSON.parse(baselineBytes.toString('utf8'))
if (baseline.summary?.completedCases !== 24 || baseline.summary?.plannedCases !== 24) throw new Error('Expected the complete retained 24-case RouterAI baseline.')
await mkdir(`${OUTPUT}/cases`, { recursive: true })
const lock = await open(`${OUTPUT}/running.lock`, 'wx')
const results: CaseResult[] = []
let budget: Budget = { version: VERSION, maxRequests: 24, maxRub: 30, reservations: [] }
let provider: ProviderContext = { kind: 'direct', label: 'Intelion', baseUrl: INTELION_URL, apiModel: INTELION_MODEL, declaredQuantization: null, primaryDialect: 'native' }
const writeReport = async () => {
  const report = buildReport(VERSION, cases, results, {
    maxRequests: budget.maxRequests, reservedRequests: budget.reservations.length, maxRub: budget.maxRub,
    receiptedCostRub: null, estimatedCostRub: budget.reservations.reduce((sum, row) => sum + (row.estimatedCostRub ?? 0), 0),
    requestsWithUsageEstimate: budget.reservations.filter(row => row.estimatedCostRub !== null).length,
    conservativeCommittedRub: budget.reservations.reduce((sum, row) => sum + row.upperBoundRub, 0),
    costBasis: 'Estimate from reported usage and /models pricing; no billing receipt. Unknown costs retain a conservative reservation.',
  }, provider)
  report.limitations.push('Shared fixtures are in ../provider-compliance/fixtures; RouterAI baseline is frozen by SHA-256. No baseline responses are regenerated.',
    'For common capability cases, reasoning.enabled is translated to native chat_template_kwargs.enable_thinking. The eight native/routerai dialect probes are sent unchanged to both APIs.')
  await save(`${OUTPUT}/report.json`, report); await writeFile(`${OUTPUT}/report.md`, markdownReport(report))
  return report
}
try {
  budget = await existing<Budget>(`${OUTPUT}/budget.json`) ?? budget
  if (budget.version !== VERSION || budget.maxRequests !== 24 || budget.maxRub !== 30 || budget.reservations.length > 24) throw new Error('Budget identity mismatch; never reset prior requests.')
  const plan = { version: VERSION, model: INTELION_MODEL, baseUrl: INTELION_URL, maxRequests: 24, maxRub: 30, baselinePath: `${ROUTER_OUTPUT}/report.json`, baselineHash,
    sharedFixtures: `${ROUTER_OUTPUT}/fixtures`, adaptation: 'Native thinking for shared capability cases; all eight explicit dialect probes unchanged.',
    tests: cases.map((test, index) => ({ id: test.id, bodyHash: digest(test.body), sharedBodyHash: digest(shared[index].body), bodyAdapted: digest(test.body) !== digest(shared[index].body), maxTokens: test.body.max_tokens })) }
  const previousPlan = await existing(`${OUTPUT}/plan.json`)
  if (previousPlan && digest(previousPlan) !== digest(plan)) throw new Error('Frozen comparison plan changed; do not overwrite or replay saved requests.')
  await save(`${OUTPUT}/plan.json`, plan)
  const previousProvider = await existing<ProviderContext>(`${OUTPUT}/provider.json`)
  if (previousProvider) provider = previousProvider
  let prices: IntelionPrices | null = null
  if (run) {
    if (!config.apiKey?.trim()) throw new Error('Intelion key is missing.')
    const started = performance.now(), preflight: JsonObject = { at: new Date().toISOString(), baseUrl: INTELION_URL, model: INTELION_MODEL, modelRequests: 0 }
    try {
      const response = await fetch(`${INTELION_URL}/models`, { headers: { Authorization: `Bearer ${config.apiKey}` }, redirect: 'manual', signal: AbortSignal.timeout(20000) })
      preflight.http = response.status
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Intelion preflight HTTP ${response.status}`) }
      const entries = object(await response.json()).data
      const metadata = Array.isArray(entries) ? entries.map(object).find(item => item.id === INTELION_MODEL) : null
      if (!metadata || object(metadata.meta).online === false) throw new Error('Requested Intelion model is absent or offline.')
      preflight.modelMetadata = metadata; prices = intelionPrices(metadata); preflight.prices = prices
      const quantization = object(metadata.meta).quantization
      provider = { ...provider, declaredQuantization: typeof quantization === 'string' ? quantization : null }
      await save(`${OUTPUT}/provider.json`, provider)
    } catch (error) { preflight.error = safeText(error instanceof Error ? `${error.message} ${object(object(error).cause).code ?? ''}` : error); throw error }
    finally { preflight.elapsedMs = Math.round(performance.now() - started); await save(`${OUTPUT}/preflight-${Date.now()}.json`, preflight) }
    await save(`${OUTPUT}/budget.json`, budget)
  }
  for (const test of cases) {
    const path = `${OUTPUT}/cases/${test.id}`
    const previous = await existing<CaseResult>(`${path}/result.json`)
    const continueSkippedTool = run && process.argv.includes('--continue-skipped-tool') && test.id === 'tool-result' && previous?.capture === null &&
      previous.verdict.status === 'UNVERIFIED' && !budget.reservations.some(item => item.id === test.id) &&
      canContinueSyntheticTool(results.find(result => result.id === 'tool-call')?.capture ?? null)
    if (previous && !continueSkippedTool) { results.push(previous); continue }
    if (previous && continueSkippedTool) {
      // There was no previous POST for this dependent case. Preserve the skipped
      // assessment, then allow exactly one new continuation; never repeat a POST.
      await writeFile(`${path}/result-initial-skipped.json`, JSON.stringify(previous, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    }
    if (!run || !prices) continue
    const priorReservation = budget.reservations.find(item => item.id === test.id)
    if (priorReservation) {
      results.push({ id: test.id, title: test.title, group: test.group, at: new Date().toISOString(), requestHash: priorReservation.requestHash, capture: null, receipt: null, receiptError: null,
        verdict: { status: 'UNVERIFIED', detail: 'An interrupted reserved request is retained without automatic resubmission.' } }); continue
    }
    await mkdir(path, { recursive: true })
    let caseBody = test.body
    if (test.dependsOn) {
      const parent = results.find(result => result.id === test.dependsOn)
      if (!parent?.capture || (parent.verdict.status !== 'PASS' && !continueSkippedTool)) {
        const skipped: CaseResult = { id: test.id, title: test.title, group: test.group, at: new Date().toISOString(), requestHash: digest(caseBody), capture: null, receipt: null, receiptError: null,
          verdict: { status: 'UNVERIFIED', detail: 'Prerequisite tool call failed. No substitute call or extra model request.' } }
        await save(`${path}/result.json`, skipped); results.push(skipped); await writeReport(); continue
      }
      const prior = parent.capture.toolCalls[0], call = { id: prior.id, type: prior.type, function: prior.function }, args = object(JSON.parse(call.function.arguments))
      caseBody = { ...caseBody, messages: [...caseBody.messages as unknown[], { role: 'assistant', content: parent.capture.content || null, tool_calls: [call] },
        { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ sum: Number(args.a) + Number(args.b) }) }] }
    }
    const body: JsonObject = { ...caseBody, model: INTELION_MODEL, stream: true, stream_options: { include_usage: true } }
    const upperBoundRub = (test.estimatedInputTokens * 2 * prices.promptRubPerToken + Number(body.max_tokens) * prices.completionRubPerToken) * 1.15
    if (budget.reservations.length >= budget.maxRequests || budget.reservations.reduce((sum, row) => sum + row.upperBoundRub, 0) + upperBoundRub > budget.maxRub) throw new Error('Intelion compliance allowance reached.')
    await save(`${path}/request.json`, body)
    const reservation: Reservation = { id: test.id, requestHash: digest(body), at: new Date().toISOString(), upperBoundRub, estimatedCostRub: null }
    budget.reservations.push(reservation); await save(`${OUTPUT}/budget.json`, budget)
    const result: CaseResult = { id: test.id, title: test.title, group: test.group, at: new Date().toISOString(), requestHash: reservation.requestHash, capture: null, receipt: null, receiptError: null,
      verdict: { status: 'UNVERIFIED', detail: 'Not completed.' } }
    console.log(JSON.stringify({ starting: test.id, reserved: budget.reservations.length, upperBoundRub }))
    const events = await open(`${path}/events.jsonl`, 'wx', 0o600)
    try {
      const started = performance.now()
      const response = await fetch(`${INTELION_URL}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(test.id.startsWith('output-32768') ? 900000 : 300000) })
      result.capture = await captureCompletion(response, started, async value => { await events.write(JSON.stringify(value) + '\n') })
      result.endpointEvidence = { baseUrl: INTELION_URL, requestedModel: INTELION_MODEL, model: result.capture.model, modelMatches: result.capture.model === INTELION_MODEL }
      result.verdict = assessCapture(test, result.capture)
      result.estimatedCostRub = estimateIntelionCost(result.capture, prices); reservation.estimatedCostRub = result.estimatedCostRub
      const expectedRejection = test.id.startsWith('reject-') && result.verdict.status === 'PASS'
      if (!expectedRejection && (result.capture.error || !result.endpointEvidence.modelMatches)) result.verdict = {
        status: result.capture.error ? 'FAIL' : 'UNVERIFIED', detail: result.capture.error ?? `Response model differs from requested alias: ${result.capture.model}`, evidence: { contentCheck: result.verdict } }
    } catch (error) { result.verdict = { status: 'UNVERIFIED', detail: safeText(error instanceof Error ? `${error.message} ${object(object(error).cause).code ?? ''}` : error) } }
    finally { await events.close() }
    await save(`${path}/result.json`, result); await save(`${OUTPUT}/budget.json`, budget)
    results.push(result); await writeReport()
    console.log(JSON.stringify({ completed: test.id, verdict: result.verdict.status, detail: result.verdict.detail, usage: result.capture?.usage, ttftMs: result.capture?.metrics.ttftMs, estimatedCostRub: result.estimatedCostRub }))
    if (result.capture?.httpStatus === 401 || result.capture?.httpStatus === 403) throw new Error('Intelion authorization failed; remaining requests not sent.')
  }
  const final = await writeReport()
  console.log(JSON.stringify({ overall: final.overall, summary: final.summary, report: `${OUTPUT}/report.md`, baselineChanged: false, mode: run ? 'run' : 'read-existing' }))
} catch (error) {
  await writeReport(); console.error(JSON.stringify({ code: 'INTELION_COMPLIANCE_STOPPED', message: safeText(error instanceof Error ? error.message : error), automaticRetry: false })); process.exitCode = 1
} finally { await lock.close(); await unlink(`${OUTPUT}/running.lock`) }
