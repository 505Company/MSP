import { QwenAnalysisError } from '../uploads/qwen-analysis'
import type { LayoutContext } from './layout-context'

export const MAX_LAYOUT_REQUESTS_PER_SLIDE = 6
export type LayoutBudget = { used: number; limit: number; slides: Record<string, number> }
const json = { httpMetadata: { contentType: 'application/json' } }
export async function readLayoutBudget(bucket: R2Bucket, context: LayoutContext): Promise<LayoutBudget> {
  const file = await bucket.get(`${context.prefix}/budget.json`)
  return file ? file.json<LayoutBudget>() : { used: 0, limit: Math.min(120, context.inputs.length * MAX_LAYOUT_REQUESTS_PER_SLIDE), slides: {} }
}
/** A caller can impose a smaller run cap, never replenish spent requests. */
export async function limitLayoutRequests(bucket: R2Bucket, context: LayoutContext, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 120) throw Error('Недопустимый предел запросов.')
  const key = `${context.prefix}/budget.json`
  for (let attempt = 0; attempt < 8; attempt++) {
    const file = await bucket.get(key), budget = file ? await file.json<LayoutBudget>() : await readLayoutBudget(bucket, context)
    const next = { ...budget, limit: Math.min(budget.limit, limit) }
    if (await bucket.put(key, JSON.stringify(next), { ...json, onlyIf: file ? { etagMatches: file.etag } : { etagDoesNotMatch: '*' } })) return next
  }
  throw Error('Состояние бюджета обновляется другим обработчиком.')
}
export async function reserveLayoutRequest(bucket: R2Bucket, context: LayoutContext, slideId: string) {
  const key = `${context.prefix}/budget.json`
  for (let attempt = 0; attempt < 8; attempt++) {
    const file = await bucket.get(key), budget = file ? await file.json<LayoutBudget>() : await readLayoutBudget(bucket, context)
    if (budget.used >= budget.limit || (budget.slides[slideId] ?? 0) >= MAX_LAYOUT_REQUESTS_PER_SLIDE) throw new QwenAnalysisError('LAYOUT_BUDGET_EXHAUSTED', 'Достигнут предел автоматических запросов. Содержание и проверенные этапы сохранены.')
    const next = { ...budget, used: budget.used + 1, slides: { ...budget.slides, [slideId]: (budget.slides[slideId] ?? 0) + 1 } }
    if (await bucket.put(key, JSON.stringify(next), { ...json, onlyIf: file ? { etagMatches: file.etag } : { etagDoesNotMatch: '*' } })) return
  }
  throw new QwenAnalysisError('QWEN_ALREADY_RUNNING', 'Состояние бюджета обновляется другим обработчиком.')
}
