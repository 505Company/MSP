import { readFile } from 'node:fs/promises'
import { object, type Capture, type JsonObject, hasReasoning, number, reasoningTokens } from './provider-compliance-transport'

export const COMPLIANCE_VERSION = 'routerai-deepinfra-compliance-1'
export const OUTPUT = 'outputs/diagnostics/provider-compliance'
export type Verdict = { status: 'PASS' | 'FAIL' | 'PARTIAL' | 'UNVERIFIED'; detail: string; evidence?: JsonObject }
export type Case = { id: string; group: number; title: string; body: JsonObject; estimatedInputTokens: number;
  validate: (result: Capture) => Verdict; dependsOn?: string }
export async function readJson(path: string): Promise<JsonObject> { return JSON.parse(await readFile(path, 'utf8')) as JsonObject }
export const sampling = { temperature: 1, top_p: .95, top_k: 20, min_p: 0, repetition_penalty: 1, presence_penalty: 0 }
const messages = [{ role: 'user', content: 'Compute (17*23-37)*2, then the sum of the decimal digits of the result. Return only a JSON object with integer fields result and digitSum.' }]
const schema = (name: string, properties: JsonObject) => ({ type: 'json_schema', json_schema: {
  name, strict: true, schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
} })
export const mathSchema = schema('math_check', { result: { type: 'integer' }, digitSum: { type: 'integer' } })
export function parseJsonContent(result: Capture): JsonObject {
  try { return object(JSON.parse(result.content)) } catch { return {} }
}
function compareJson(result: Capture, expected: JsonObject): Verdict {
  const actual = parseJsonContent(result), keys = Object.keys(expected)
  const matches = keys.filter(key => actual[key] === expected[key])
  const exact = matches.length === keys.length && Object.keys(actual).length === keys.length
  return { status: exact && result.finishReason === 'stop' ? 'PASS' : 'FAIL',
    detail: `${matches.length}/${keys.length} expected fields; finish_reason=${result.finishReason}`,
    evidence: { expected, actual, matches } }
}
function math(result: Capture, thinking: boolean): Verdict {
  const validation = compareJson(result, { result: 708, digitSum: 15 }), observed = hasReasoning(result)
  return { ...validation, status: validation.status === 'PASS' && observed === thinking ? 'PASS' : 'FAIL',
    detail: `${validation.detail}; reasoning=${observed}, expected=${thinking}`,
    evidence: { ...validation.evidence, reasoningCharacters: result.reasoningCharacters, reasoningTokens: reasoningTokens(result) } }
}
export async function complianceCases(): Promise<Case[]> {
  const cases: Case[] = []
  for (const dialect of ['native', 'routerai']) {
    for (const level of ['off', 'low', 'medium', 'xhigh']) {
      const enabled = level !== 'off'
      const params = dialect === 'native'
        ? { chat_template_kwargs: { enable_thinking: enabled }, ...(enabled ? { reasoning_effort: level } : {}) }
        : { reasoning: { enabled, ...(enabled ? { effort: level } : {}) } }
      cases.push({ id: `${dialect}-${level}`, group: level === 'off' ? 3 : 4,
        title: `${dialect}: thinking=${enabled}${enabled ? `, effort=${level}` : ''}`,
        body: { ...sampling, ...params, messages, max_tokens: 2048, response_format: mathSchema }, estimatedInputTokens: 350,
        validate: result => math(result, enabled) })
    }
  }
  const preserved = await readJson(`${OUTPUT}/fixtures/preserve.json`)
  for (const enabled of [true, false]) cases.push({ id: `preserve-${enabled}`, group: 5, title: `preserve_thinking=${enabled}`,
    body: { ...sampling, messages: preserved.messages, chat_template_kwargs: { enable_thinking: true, preserve_thinking: enabled }, reasoning_effort: 'low', max_tokens: 1536 },
    estimatedInputTokens: 500, validate: result => {
      const expected = preserved[enabled ? 'expectedTrue' : 'expectedFalse']
      return { status: result.content === expected && result.finishReason === 'stop' ? 'PASS' : 'FAIL',
        detail: `Synthetic history: expected ${expected}, received ${result.content}`, evidence: { expected, actual: result.content,
          officialPromptTokens: object(preserved.officialPromptTokens)[String(enabled)], reportedPromptTokens: result.usage?.prompt_tokens } }
    } })
  const image = await readJson(`${OUTPUT}/fixtures/small-ui.json`), expected = object(image.expected)
  cases.push({ id: 'small-ui-image', group: 6, title: 'Small text 10/12/14 px and UI states', estimatedInputTokens: 6000,
    body: { ...sampling, reasoning: { enabled: false }, max_tokens: 1536,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Read the attached UI screenshot exactly. Return JSON fields: reference (full reference ID), queue (preserve zeros), retry (preserve zeros), limit, auditKey (code only), provider (selected dropdown option), checked (checked checkbox label), unchecked (unchecked checkbox label), enabledButton, disabledButton. All values must be strings. Do not infer unreadable text; use UNKNOWN.' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${(await readFile(`${OUTPUT}/fixtures/small-ui.png`)).toString('base64')}`, detail: 'high' } }] }],
      response_format: schema('ui_check', Object.fromEntries(Object.keys(expected).map(key => [key, { type: 'string' }]))) },
    validate: result => compareJson(result, expected) })
  cases.push({ id: 'sampling-nondefault', group: 7, title: 'Non-default sampling parameters', estimatedInputTokens: 350,
    body: { ...sampling, temperature: .35, top_p: .72, top_k: 7, min_p: .06, repetition_penalty: 1.12, reasoning: { enabled: false },
      messages, max_tokens: 512, response_format: mathSchema }, validate: result => math(result, false) })
  for (const [parameter, value] of Object.entries({ temperature: -1, top_p: 1.5, top_k: -1, min_p: -1, repetition_penalty: -1 })) {
    cases.push({ id: `reject-${parameter}`, group: 7, title: `Invalid ${parameter} must be rejected`, estimatedInputTokens: 100,
      body: { ...sampling, [parameter]: value, messages: [{ role: 'user', content: 'Reply OK.' }], reasoning: { enabled: false }, max_tokens: 16 },
      validate: result => ({ status: [400, 422].includes(result.httpStatus) ? 'PASS' : result.httpStatus === 200 ? 'FAIL' : 'UNVERIFIED',
        detail: `HTTP ${result.httpStatus}; invalid value ${parameter}=${value}`, evidence: { error: result.error } }) })
  }
  const tools = [{ type: 'function', function: { name: 'add_numbers', description: 'A local synthetic test function. Add two integers.', strict: true,
    parameters: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'], additionalProperties: false } } }]
  const toolMessages = [{ role: 'user', content: 'Use add_numbers to add 17 and 23. After receiving the tool result, return a JSON object with the integer field sum.' }]
  cases.push({ id: 'tool-call', group: 8, title: 'Structured tool call', estimatedInputTokens: 1000,
    body: { ...sampling, reasoning: { enabled: false }, messages: toolMessages, tools, tool_choice: { type: 'function', function: { name: 'add_numbers' } }, max_tokens: 1024 },
    validate: result => {
      const call = result.toolCalls[0]
      let args: JsonObject = {}
      try { args = object(JSON.parse(call?.function.arguments ?? '')) } catch { /* Invalid args are a failed check. */ }
      const passed = result.finishReason === 'tool_calls' && result.toolCalls.length === 1 && Boolean(call.id) && call.function.name === 'add_numbers' && args.a === 17 && args.b === 23 && Object.keys(args).length === 2
      return { status: passed ? 'PASS' : 'FAIL', detail: `${result.toolCalls.length} tool calls; finish_reason=${result.finishReason}`, evidence: { toolCalls: result.toolCalls } }
    } })
  cases.push({ id: 'tool-result', group: 8, title: 'Consume local tool result', estimatedInputTokens: 1500, dependsOn: 'tool-call',
    body: { ...sampling, reasoning: { enabled: false }, messages: toolMessages, tools, tool_choice: 'none', max_tokens: 512,
      response_format: schema('tool_result', { sum: { type: 'integer' } }) }, validate: result => compareJson(result, { sum: 40 }) })
  for (const target of [24500, 64000, 128000]) {
    const fixture = await readJson(`${OUTPUT}/fixtures/context-${target}.json`)
    cases.push({ id: `context-${target}`, group: 10, title: `${target} exact input-content tokens; seven anchors`, estimatedInputTokens: target + 1000,
      body: { ...sampling, reasoning: { enabled: false }, messages: fixture.messages, max_tokens: 1024 },
      validate: result => {
        const check = compareJson(result, object(fixture.expected)), reported = number(result.usage?.prompt_tokens)
        const accounting = reported !== null && reported >= target && Math.abs(reported - Number(fixture.officialPromptTokensThinkingOff)) <= 512
        return { status: check.status === 'PASS' && accounting ? 'PASS' : 'FAIL', detail: `${check.detail}; reported prompt tokens=${reported}, exact content=${target}`,
          evidence: { ...check.evidence, contentTokens: target, referenceChatTokens: fixture.officialPromptTokensThinkingOff, reportedPromptTokens: reported,
            markerTokenOffsets: fixture.markerTokenOffsets, accounting, scope: 'All seven markers recovered and token accounting matches this fixture; not proof for all possible inputs.' } }
      } })
  }
  cases.push({ id: 'output-32768', group: 11, title: 'Actually generate 32768 tokens', estimatedInputTokens: 1000,
    body: { ...sampling, reasoning: { enabled: false }, temperature: .3, max_tokens: 32768, messages: [
      { role: 'system', content: 'You are a synthetic long-output test generator. Continue generating the requested machine-readable data until the output token budget is exhausted. Never summarize, abbreviate, use ellipses, or stop early.' },
      { role: 'user', content: 'Produce 12000 numbered CSV rows, starting at row 1, with no header. Each row has the row number, a distinct English first name, an English city, an English tree species, and a color. Cycle values as needed. Generate every row explicitly; this is a streaming capacity test. Begin now and keep going until your output limit.' },
    ] }, validate: result => {
      const generated = number(result.usage?.completion_tokens), stoppedAtLimit = generated === 32768 && result.finishReason === 'length'
      return { status: stoppedAtLimit ? 'PASS' : result.finishReason === 'stop' && generated !== null && generated < 32768 ? 'UNVERIFIED' : 'FAIL',
        detail: `Requested max_tokens=32768, generated=${generated}, finish_reason=${result.finishReason}`,
        evidence: { generatedTokens: generated, requested: 32768, reasoningTokens: reasoningTokens(result),
          scope: stoppedAtLimit ? '32768 generated tokens observed.' : 'Accepted field alone does not establish a 32768-token output capacity; model may stop voluntarily.' } }
    } })
  return cases
}

/** Explicit follow-up to voluntary early EOS in the first output probe. Token
 * IDs come from the pinned official tokenizer: ' x'=830, endoftext=248044,
 * im_end=248046. Strong bias makes length, not task completion, the stop cause.
 * This is a capacity probe, not a recommended production generation profile. */
export function outputCapacityControl(): Case {
  return { id: 'output-32768-control', group: 11, title: 'Controlled token repetition to reach the output cap', estimatedInputTokens: 300,
    body: { ...sampling, temperature: 0, reasoning: { enabled: false }, max_tokens: 32768,
      logit_bias: { '830': 100, '248044': -100, '248046': -100 },
      messages: [{ role: 'user', content: 'This is a stream capacity check. Output the token x separated by spaces continuously. Continue until the server output token limit, without explanation or an early ending.' }] },
    validate: result => {
      const generated = number(result.usage?.completion_tokens)
      const capped = generated === 32768 && result.finishReason === 'length'
      return { status: capped ? 'PASS' : result.finishReason === 'stop' ? 'UNVERIFIED' : 'FAIL',
        detail: `Controlled max_tokens=32768, generated=${generated}, finish_reason=${result.finishReason}`,
        evidence: { generatedTokens: generated, requested: 32768, biasTokenId: 830, endTokenIds: [248044, 248046],
          outputMatchesRepeatedToken: /^(?:x\s*)+$/.test(result.content), tokenizerRevision: '1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0',
          scope: capped ? 'Observed 32768 output tokens; production prompt may stop earlier.' : 'Full output capacity remains unverified.' } }
    } }
}
