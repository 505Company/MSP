import { readModelRun, type ModelRun } from '../uploads/model-run'
import { QwenAnalysisError } from '../uploads/qwen-analysis'
import { parseModelJson } from '../uploads/qwen-structured'
import { SemanticValidationError } from './semantic-contract'
import type { RefinementTask } from './refinement-contract'
import { refinementRoot } from './refinement-storage'

export const localRefinementFailure = (code?: string) => ['SEMANTIC_VALIDATION','QWEN_INVALID_JSON','QWEN_INCOMPLETE','QWEN_TRUNCATED','REFINEMENT_BUDGET_EXHAUSTED'].includes(code ?? '')
export function refinementFailureMessage(code: string | undefined, issues: string[], fallback: string) {
  if (code === 'SEMANTIC_VALIDATION') {
    if (issues.length && issues.every(i => /^slides\.\d+\.note: String must contain at most \d+ character\(s\)$/.test(i))) return 'Служебное пояснение оказалось слишком длинным. Ошибка не связана с исходными объектами.'
    if (issues.some(i => i.startsWith('unknown-or-cross-slide-source:'))) return 'Модель сослалась на отсутствующие объекты или на другой слайд.'
    if (issues.some(i => i.startsWith('invalid-composition-members:'))) return 'Модель указала некорректные связи между компонентами композиции.'
    if (issues.some(i => /^slides\.\d+\./.test(i))) return 'Ответ модели не соответствует формату описания компонентов.'
  }
  return fallback
}
export function refinementFailure(error: unknown) {
  const errorCode = error instanceof QwenAnalysisError ? error.code : undefined
  const issues = error instanceof SemanticValidationError ? error.issues : []
  return { errorCode, issues, error: refinementFailureMessage(errorCode, issues, error instanceof Error ? error.message : 'Не удалось проверить слайд') }
}

/** Old task records contain only runId. Resolve their exact immutable run once
 * per read, without modifying the record or searching any other upload. */
export async function refinementModelEvidence(bucket: R2Bucket, uploadId: string, task: RefinementTask) {
  if (!task.runId) return null
  const root = `${refinementRoot(uploadId)}/models/`
  let prefix = task.modelPrefix?.startsWith(root) ? task.modelPrefix : undefined
  if (!prefix) {
    let cursor: string | undefined
    do {
      const page = await bucket.list({ prefix: root, ...(cursor ? { cursor } : {}) })
      const match = page.objects.find(o => o.key.endsWith(`/runs/${task.runId}.json`))
      if (match) { prefix = match.key.slice(0, -(`/runs/${task.runId}.json`.length)); break }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
  if (!prefix) return null
  const run = await readModelRun(bucket, prefix, task.runId)
  return run ? { prefix, run } : null
}
export async function refinementSavedReply(bucket: R2Bucket, prefix: string, run: ModelRun) {
  const source = run.sourceRunId ? await readModelRun(bucket, prefix, run.sourceRunId) : run
  if (!source || source.status === 'running') return null
  const raw = source.clarificationRequests ? await bucket.get(`${prefix}/clarifications/${source.id}/response.json`) : null
  const file = raw ?? await bucket.get(`${prefix}/responses/${source.id}.json`)
  if (!file) return null
  try {
    const saved = await file.json<{ content: string; finishReason: string }>()
    // An unfinished provider response can contain parseable JSON. It is still
    // incomplete evidence and must not bypass the transport completion check.
    return saved.finishReason === 'stop' ? parseModelJson(saved.content) : null
  }
  catch { return null }
}
