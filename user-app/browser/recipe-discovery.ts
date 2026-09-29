import { renderTemplateRecipe } from './template-recipe-execution'
import { layoutDelay } from './layout-generation'
import type { DiscoveryAdvance } from '../lib/presentations/recipes/discovery-workflow'
import type { publicDiscoveryJob } from '../lib/presentations/recipes/discovery-jobs'

export class RecipeDiscoveryError extends Error {
  constructor(message: string, readonly code: string) { super(message) }
  get retryable() { return /^(QWEN_(UNAVAILABLE|TIMEOUT|TRUNCATED|INCOMPLETE|INTERRUPTED|STREAM_INTERRUPTED|RESPONSE_FAILED|EMPTY|INVALID_JSON|CANCELLED|HTTP_(429|500|502|503|504)))$/.test(this.code) }
}
export async function executeRecipeDiscovery(uploadId: string, jobId: string, token: string, signal?: AbortSignal) {
  const url = `/api/uploads/${uploadId}/recipe-jobs`
  let report: { stepId: string; value: unknown } | undefined
  for (;;) {
    signal?.throwIfAborted()
    const response = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'advance', jobId, token, ...(report ? { report } : {}) }) })
    const text = await response.text(), lines = text.trim().split('\n').filter(Boolean)
    const value = JSON.parse(lines[0]) as DiscoveryAdvance & { error?: string; code?: string }
    if (!response.ok) {
      if (value.code === 'QWEN_ALREADY_RUNNING') { await layoutDelay(2000, signal); continue }
      throw new RecipeDiscoveryError(value.error ?? 'Пополнение рецептов прервалось.', value.code ?? `QWEN_HTTP_${response.status}`)
    }
    if (response.status === 202 && JSON.parse(lines.at(-1)!).complete !== true) {
      const stateResponse = await fetch(url, { cache: 'no-store', signal })
      const state = await stateResponse.json() as { jobs?: ReturnType<typeof publicDiscoveryJob>[] }
      const job = state.jobs?.find(j => j.id === jobId)
      throw new RecipeDiscoveryError(job?.error ?? 'Этап рецепта прервался.', job?.errorCode ?? 'QWEN_INTERRUPTED')
    }
    report = undefined
    if (value.done) return
    if (value.render) {
      const rendered = await renderTemplateRecipe(value.render.recipe, value.render.material, value.render.plan)
      signal?.throwIfAborted()
      report = { stepId: value.stepId!, value: rendered }
    }
  }
}
