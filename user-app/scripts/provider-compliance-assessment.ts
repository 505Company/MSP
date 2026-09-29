import { hasReasoning, object, type Capture } from './provider-compliance-transport'
import { parseJsonContent, type Case, type Verdict } from './provider-compliance-suite'

export const ASSESSMENT_VERSION = 'provider-compliance-evaluation-2'

/** This is a provider-contract check, not an arithmetic benchmark. Keep model
 * answer quality as evidence, separately from the observable thinking toggle.
 * Expected validation errors can arrive inside HTTP-200 SSE envelopes. */
export function assessCapture(test: Case, capture: Capture): Verdict {
  if (test.id.startsWith('reject-')) {
    const parameter = test.id.slice('reject-'.length)
    let error: unknown = capture.error
    for (let depth = 0; depth < 4 && typeof error === 'string'; depth++) {
      try { error = JSON.parse(error) } catch { break }
    }
    const payload = object(object(error).error ?? error)
    const message = String(payload.message ?? capture.error ?? '')
    const parameterError = ['invalid_parameter_error', 'invalid_request_error'].includes(String(payload.code ?? payload.type))
    const rejected = message.includes(parameter) && (parameterError || [400, 422].includes(capture.httpStatus)) && !capture.content && !capture.usage
    return { status: rejected ? 'PASS' : capture.httpStatus === 200 && !capture.error ? 'FAIL' : 'UNVERIFIED',
      detail: rejected ? `${parameter}: validation error returned${capture.httpStatus === 200 ? ' in HTTP-200 SSE' : ''}.`
        : `${parameter}: ${capture.error ? 'no conclusive parameter-validation response' : 'out-of-range value accepted or normalized; silent ignoring is possible but not proven'}.`,
      evidence: { httpStatus: capture.httpStatus, error: payload, generationOccurred: Boolean(capture.usage) } }
  }
  if (/^(native|routerai)-(off|low|medium|xhigh)$/.test(test.id)) {
    const expected = !test.id.endsWith('-off'), observed = hasReasoning(capture), actual = parseJsonContent(capture)
    const schemaValid = Object.keys(actual).length === 2 && Number.isInteger(actual.result) && Number.isInteger(actual.digitSum)
    const arithmeticCorrect = actual.result === 708 && actual.digitSum === 15
    return { status: expected === observed && schemaValid && capture.finishReason === 'stop' ? 'PASS' : 'FAIL',
      detail: `reasoning=${observed}, expected=${expected}; JSON schema=${schemaValid}; arithmetic=${arithmeticCorrect ? 'correct' : 'incorrect (separate quality observation)'}`,
      evidence: { expectedThinking: expected, observedThinking: observed, schemaValid, arithmeticCorrect, actual } }
  }
  if (test.id === 'sampling-nondefault') {
    const actual = parseJsonContent(capture)
    return { status: capture.httpStatus === 200 && !capture.error && capture.finishReason === 'stop' && capture.usage ? 'PASS' : 'FAIL',
      detail: 'Non-default sampling bundle accepted. Per-parameter application is not attested by a successful reply.',
      evidence: { arithmeticCorrect: actual.result === 708 && actual.digitSum === 15, actual } }
  }
  return test.validate(capture)
}
