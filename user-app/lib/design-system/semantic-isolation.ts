import { semanticReply, SemanticValidationError, type SemanticContext, type SemanticReply } from './semantic-contract'
import type { validateScanReply } from './semantic-scan'
import { readSourceScene } from './source-scene'
import { QwenAnalysisError } from '../uploads/qwen-analysis'
import { parseModelJson } from '../uploads/qwen-structured'
import type { ModelRun } from '../uploads/model-run'

export type ImportOmission = { name: string; elementIds: string[]; slides: number[]; reason: string }
export const localRecognitionError = (error: unknown) => error instanceof QwenAnalysisError && ['SEMANTIC_VALIDATION', 'SEMANTIC_SCHEMA', 'QWEN_INVALID_JSON'].includes(error.code)
export async function rejectedModelResponse(bucket: R2Bucket, prefix: string, run: ModelRun): Promise<unknown> {
  const key = run.clarificationRequests ? `${prefix}/clarifications/${run.id}/response.json` : `${prefix}/responses/${run.id}.json`
  const file = await bucket.get(key)
  if (!file) throw Error('Сохранённый ответ недоступен; безопасный пропуск пока невозможен')
  const saved = await file.json<{content: string}>()
  try { return parseModelJson(saved.content) } catch { return null }
}
const empty = (): SemanticReply => ({ styles: [], atoms: [], molecules: [], rules: [], content: [], pending: [] })
const sections = ['styles', 'atoms', 'molecules', 'rules', 'content', 'pending'] as const
const reason = 'Не удалось подтвердить состав или текстовые поля. Исходные объекты сохранены.'

/** Run only after the bounded model attempt failed. Every accepted entry and
 * the combined result still pass the same validator. Never guess a replacement
 * role or geometry; omitted source IDs stay unresolved and cannot be compiled. */
export function isolateSemanticReply(raw: unknown, context: SemanticContext, validate: typeof validateScanReply) {
  const scene = readSourceScene(context.snapshot), own = new Set(context.batch.nodes.map(n => n.id))
  const omissions: ImportOmission[] = [], changes: ReturnType<typeof validateScanReply>['normalizations'] = []
  let accepted = empty()
  const defer = (ids: string[], label: string, why = reason) => {
    const sourceIds = [...new Set(ids.filter(id => own.has(id)).flatMap(id => [id, ...context.batch.nodes.filter(n => scene.records.get(n.id)?.ancestors.includes(id)).map(n => n.id)]))]
    omissions.push({ name: label.slice(0, 120), elementIds: sourceIds, slides: [...new Set(sourceIds.map(id => scene.records.get(id)!.source.slide))], reason: why })
  }
  const refs = (entry: unknown) => {
    if (!entry || typeof entry !== 'object') return []
    const value = entry as Record<string, unknown>
    return [value.elementId, ...(Array.isArray(value.elementIds) ? value.elementIds : []), ...(Array.isArray(value.textSlots) ? value.textSlots.map(s => s && typeof s === 'object' ? s.elementId : null) : [])].filter((id): id is string => typeof id === 'string')
  }
  const allPending = (reply: SemanticReply) => [...reply.pending, ...context.batch.nodes.filter(n => !reply.pending.some(p => p.elementId === n.id)).map(n => ({ elementId: n.id, reason: 'Проверка отдельного предложения' }))]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) defer([...own], 'Неразобранные объекты', 'Ответ для этой части не удалось прочитать. Исходные объекты сохранены.')
  else for (const section of sections) {
    const entries = (raw as Record<string, unknown>)[section]
    if (!Array.isArray(entries) || entries.length > 500) { defer([], 'Предложения компонентов', 'Часть ответа имеет неверный формат. Неопределённые объекты сохранены отдельно.'); continue }
    for (const entry of entries) {
      const label = entry && typeof entry === 'object' && typeof entry.name === 'string' ? entry.name : section === 'styles' ? 'Роль стиля' : 'Элемент дизайн-системы'
      const parsed = semanticReply.shape[section].element.safeParse(entry)
      if (!parsed.success) { defer(refs(entry), label); continue }
      const trial = { ...accepted, [section]: [...accepted[section], parsed.data] } as SemanticReply
      try {
        const tested = validate({ ...trial, pending: allPending(trial) }, context)
        changes.push(...tested.normalizations)
        accepted = { ...tested.reply, pending: trial.pending }
      } catch (error) {
        if (!(error instanceof SemanticValidationError)) throw error
        defer(refs(entry), label)
        // Conflicting style names are not resolved by choosing whichever came first.
        if (section === 'styles' && entry && typeof entry === 'object' && 'styleId' in entry) accepted.styles = accepted.styles.filter(s => s.styleId !== entry.styleId)
      }
    }
  }
  const pending = new Map(accepted.pending.map(p => [p.elementId, p]))
  for (const omission of omissions) for (const elementId of omission.elementIds) pending.set(elementId, { elementId, reason: omission.reason })
  accepted.pending = [...pending.values()]
  try { validate(accepted, context) }
  catch (error) {
    if (!(error instanceof SemanticValidationError) || error.issues.some(i => !i.startsWith('missing-decision:'))) throw error
    for (const issue of error.issues) {
      const id = issue.slice('missing-decision:'.length)
      if (!own.has(id)) throw error
      const why = 'Модель не определила назначение объекта. Исходник сохранён.'
      accepted.pending.push({ elementId: id, reason: why }); defer([id], 'Неопределённый объект', why)
    }
  }
  const checked = validate(accepted, context)
  return { ...checked, normalizations: [...changes, ...checked.normalizations], omissions }
}
