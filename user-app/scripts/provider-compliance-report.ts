import type { Case, Verdict } from './provider-compliance-suite'
import { hasReasoning, number, reasoningTokens, type Capture, type JsonObject } from './provider-compliance-transport'
import { assessCapture, ASSESSMENT_VERSION } from './provider-compliance-assessment'

export type CaseResult = { id: string; title: string; group: number; requestHash: string; verdict: Verdict; capture: Capture | null;
  receipt: JsonObject | null; receiptError: string | null; at: string; originalVerdict?: Verdict;
  endpointEvidence?: { baseUrl: string; model: string | null; requestedModel: string; modelMatches: boolean };
  estimatedCostRub?: number | null }
export type ProviderContext = { kind: 'routerai' | 'direct'; label: string; baseUrl: string; apiModel: string;
  declaredQuantization: string | null; primaryDialect: 'native' | 'routerai' }
export const routeraiReportContext: ProviderContext = { kind: 'routerai', label: 'RouterAI / DeepInfra', baseUrl: 'https://routerai.ru/api/v1',
  apiModel: 'qwen/qwen3.8-27b', declaredQuantization: 'bf16', primaryDialect: 'routerai' }
export type Report = { at: string; version: string; assessmentVersion: string; overall: string; checks: Array<Verdict & { item: number; title: string }>;
  summary: JsonObject; cases: CaseResult[]; limitations: string[]; provider?: ProviderContext }

export function buildReport(version: string, cases: Case[], originalResults: CaseResult[], budget: JsonObject, provider: ProviderContext = routeraiReportContext): Report {
  const routeVerified = (result: CaseResult) => provider.kind === 'routerai'
    ? Boolean(result.receipt)
    : result.endpointEvidence?.baseUrl === provider.baseUrl && result.endpointEvidence.requestedModel === provider.apiModel &&
      result.endpointEvidence.modelMatches && result.capture?.model === provider.apiModel
  const results = originalResults.map(result => {
    const test = cases.find(test => test.id === result.id)
    if (!test || !result.capture) return result
    const evaluated: Verdict = provider.kind === 'direct' && test.id === 'reject-top_k' && result.capture.httpStatus === 200 && !result.capture.error
      ? { status: 'PARTIAL', detail: 'top_k=-1 was accepted. vLLM documents -1 as disabling top-k, so this probe cannot establish ignored sampling on Intelion; deployed engine is not attested.',
        evidence: { source: 'https://docs.vllm.ai/en/latest/api/vllm/sampling_params/#vllm.sampling_params.SamplingParams.top_k', originalSharedProbe: result.verdict } }
      : assessCapture(test, result.capture)
    // An expected rejected request need not have a successful generation receipt.
    const expectedRejection = test.id.startsWith('reject-') && evaluated.status === 'PASS'
    const verdict: Verdict = !expectedRejection && (result.capture.error || !routeVerified(result))
      ? { status: result.capture.error ? 'FAIL' : 'UNVERIFIED', detail: result.capture.error ?? `Route not attested: ${result.receiptError ?? 'no receipt'}` } : evaluated
    return { ...result, originalVerdict: result.verdict, verdict }
  })
  const get = (id: string) => results.find(result => result.id === id)
  const group = (ids: string[], fallback: string): Verdict => {
    const found = ids.map(get)
    if (found.some(value => value?.verdict.status === 'FAIL')) return { status: 'FAIL', detail: found.filter(value => value?.verdict.status === 'FAIL').map(value => `${value!.id}: ${value!.verdict.detail}`).join('; ') }
    if (found.some(value => !value || value.verdict.status !== 'PASS')) return { status: 'UNVERIFIED', detail: fallback }
    return { status: 'PASS', detail: ids.join(', ') }
  }
  const nativeThinking = group(['native-off', 'native-low'], 'Native enable_thinking pair not completed.'), routedThinking = group(['routerai-off', 'routerai-low'], 'RouterAI thinking pair not completed.')
  const successful = results.filter(result => result.capture?.httpStatus === 200 && !result.capture.error)
  const routed = successful.filter(result => provider.kind === 'routerai'
    ? result.receipt?.providerName === 'deepinfra' && result.receipt.model === provider.apiModel : routeVerified(result))
  const efforts = results.filter(result => /^(native|routerai)-(low|medium|xhigh)$/.test(result.id)).map(result => ({ id: result.id, verdict: result.verdict.status,
    promptTokens: result.capture?.usage?.prompt_tokens, reasoningTokens: result.capture ? reasoningTokens(result.capture) : null,
    reasoningCharacters: result.capture?.reasoningCharacters, ttftMs: result.capture?.metrics.ttftMs }))
  const preserved = group(['preserve-true', 'preserve-false'], 'Both values must change retention of the synthetic history marker.')
  const sampling = group(['sampling-nondefault', ...['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty'].map(value => `reject-${value}`)], 'Sampling checks not complete.')
  const structured = get(`${provider.primaryDialect}-xhigh`)
  const initialOutput = get('output-32768'), controlledOutput = get('output-32768-control')
  const outputVerdict: Verdict = controlledOutput ? { ...controlledOutput.verdict,
    detail: `${initialOutput?.verdict.detail ?? 'No initial probe'}. ${controlledOutput.verdict.detail}` }
    : initialOutput?.verdict ?? { status: 'UNVERIFIED', detail: 'Long-output probe not completed.' }
  const schemaThinking: Verdict = structured?.verdict.status === 'PASS' && structured.capture && hasReasoning(structured.capture)
    ? { status: 'PASS', detail: 'Strict JSON Schema, correct answer, nonempty reasoning channel in the same streamed request.' }
    : { status: structured ? 'FAIL' : 'UNVERIFIED', detail: 'JSON Schema plus thinking not established.' }
  const telemetryComplete = successful.length > 0 && successful.every(result => result.capture!.usage !== null && result.capture!.finishReason !== null &&
    result.capture!.metrics.ttftMs !== null && number(result.capture!.usage?.completion_tokens) !== null)
  const checks: Report['checks'] = [
    { item: 1, title: 'Model identity and fixed deployed revision', status: routed.length === successful.length && routed.length ? 'PARTIAL' : 'UNVERIFIED',
      detail: `${routed.length}/${successful.length} successful calls ${provider.kind === 'routerai' ? 'have matching RouterAI provider/model receipts' : 'return the requested model alias at the configured Intelion HTTPS endpoint (no independent upstream receipt)'}. Reference repository Qwen/Qwen3.8-27B is pinned; hosted weights revision is not exposed or pinned by this API.` },
    { item: 2, title: 'Server bfloat16 and absence of quantization_config', status: provider.declaredQuantization && provider.declaredQuantization.toLowerCase() !== 'bf16' ? 'FAIL' : 'UNVERIFIED',
      detail: `Endpoint metadata declares ${provider.declaredQuantization ?? 'no precision'}. ${provider.declaredQuantization && provider.declaredQuantization.toLowerCase() !== 'bf16' ? 'This declaration conflicts with the BF16 requirement. ' : ''}Reference config is bfloat16 with no quantization_config; loaded deployment configuration and server logs are unavailable.` },
    { item: 3, title: 'enable_thinking=true/false', ...nativeThinking,
      detail: `Native flags: ${nativeThinking.status}. RouterAI reasoning.enabled: ${routedThinking.status}. ${nativeThinking.detail}`, evidence: { native: nativeThinking, routerai: routedThinking } },
    { item: 4, title: 'reasoning_effort=low/medium/xhigh', status: efforts.length === 6 && efforts.every(value => value.verdict === 'PASS') ? 'PARTIAL' : efforts.some(value => value.verdict === 'FAIL') ? 'FAIL' : 'UNVERIFIED',
      detail: 'Per-level requests, token counts and timing are recorded. HTTP acceptance or different output lengths cannot independently prove that all effort levels were applied.', evidence: { efforts } },
    { item: 5, title: 'preserve_thinking=true/false', ...preserved },
    { item: 6, title: 'Small text and UI image', ...group(['small-ui-image'], 'Image check not completed.') },
    { item: 7, title: 'temperature, top_p, top_k, min_p, repetition_penalty',
      status: sampling.status === 'PASS' ? 'PARTIAL' : sampling.status, detail: `${sampling.detail}. Non-default acceptance and invalid-value rejection do not establish the exact sampler implementation.` },
    { item: 8, title: 'Tool calling and tool-result continuation', ...group(['tool-call', 'tool-result'], 'Tool cycle not complete.') },
    { item: 9, title: 'JSON Schema with thinking', ...schemaThinking },
    { item: 10, title: '24500 → 64000 → 128000 input tokens', ...group(['context-24500', 'context-64000', 'context-128000'], 'Long-context sequence not complete.'),
      evidence: { scope: 'Exact tokenizer counts plus seven independent markers distributed across each input. Scope is these tested inputs; universal absence of truncation cannot be inferred.' } },
    { item: 11, title: 'max_tokens=32768', ...outputVerdict },
    { item: 12, title: 'Usage, finish_reason, TTFT, generation tokens, KV cache, errors', status: telemetryComplete ? 'PARTIAL' : 'UNVERIFIED',
      detail: `API telemetry ${telemetryComplete ? 'recorded' : 'incomplete'}; any reported cached-token counts are retained. KV-cache dtype, allocation, occupancy, eviction and server errors are not exposed.` },
  ]
  const done = cases.every(test => results.some(result => result.id === test.id))
  const counts = Object.fromEntries(['PASS', 'FAIL', 'PARTIAL', 'UNVERIFIED'].map(status => [status, checks.filter(check => check.status === status).length]))
  return { at: new Date().toISOString(), version, assessmentVersion: ASSESSMENT_VERSION, provider, overall: done ? checks.some(check => check.status === 'FAIL') ? 'NOT_COMPLIANT' : checks.every(check => check.status === 'PASS') ? 'COMPLIANT' : 'NOT_FULLY_ATTESTED' : 'IN_PROGRESS',
    summary: { completedCases: results.length, plannedCases: cases.length, counts, budget, successfulRoutedCalls: routed.length }, checks, cases: results,
    limitations: [
      'PASS means the observable behavior passed this fixture, not a provider SLA or hardware attestation.',
      'No direct server access: fixed deployed revision, actual weight dtype, loaded quantization_config and KV-cache details remain unverified.',
      'The pinned public model config/tokenizer are reference artifacts, not evidence of what DeepInfra loaded.',
      'Private generated reasoning is counted and hashed, never stored. The preserve_thinking marker is authored synthetic history.',
      'Stream TTFT is client-observed time to first nonempty reasoning/content/tool delta. HTTP headers, first body byte and first final-content delta are separate.',
      'All inputs are synthetic. The slide pilot counter and production projects are untouched. Saved attempts are never automatically resubmitted.',
      'Evaluation v2 handles parameter-validation errors inside HTTP-200 SSE and separates arithmetic answer quality from provider flags. Original first-pass verdicts and responses are retained unchanged in cases/.',
      ...(provider.kind === 'direct' ? ['The shared top_k=-1 rejection probe is inconclusive for Intelion: -1 is a documented disabling value in vLLM. This does not attest which engine Intelion deployed. Parse errors in other negative probes do not establish that invalid parameter values were accepted.'] : []),
    ] }
}
const cell = (value: unknown) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ')
export function markdownReport(report: Report): string {
  return `# Provider compliance · ${report.provider?.label ?? 'RouterAI / DeepInfra'} / Qwen3.8-27B\n\n${report.at}\n\n**${report.overall}** — ${report.summary.completedCases}/${report.summary.plannedCases} cases. Assessment: ${report.assessmentVersion}.\n\n` +
    '| № | Requirement | Verdict | Evidence / limitation |\n|---|---|---|---|\n' +
    report.checks.map(check => `| ${check.item} | ${cell(check.title)} | **${check.status}** | ${cell(check.detail)} |`).join('\n') +
    '\n\n## Per-request observations\n\n| Case | Verdict | HTTP | Prompt | Output | Reasoning | Finish | TTFT ms | Time ms | RUB |\n|---|---|---|---|---|---|---|---|---|---|\n' +
    report.cases.map(result => { const c = result.capture; return `| ${result.id} | ${result.verdict.status} | ${cell(c?.httpStatus)} | ${cell(c?.usage?.prompt_tokens)} | ${cell(c?.usage?.completion_tokens)} | ${cell(c ? reasoningTokens(c) : null)} | ${cell(c?.finishReason)} | ${cell(c?.metrics.ttftMs)} | ${cell(c?.metrics.durationMs)} | ${cell(result.receipt?.totalCostRub ?? (result.estimatedCostRub !== undefined && result.estimatedCostRub !== null ? `~${result.estimatedCostRub}` : null))} |` }).join('\n') +
    `\n\n## Budget\n\n\`\`\`json\n${JSON.stringify(report.summary.budget, null, 2)}\n\`\`\`\n\n## Interpretation\n\n` + report.limitations.map(value => `- ${value}`).join('\n') +
    '\n\nExact requests, safe responses, receipts, event timings and errors are in `cases/`. Reference fixtures and SHA-256 provenance are in `fixtures/`.\n'
}
