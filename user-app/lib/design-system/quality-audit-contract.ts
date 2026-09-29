import { z } from 'zod'
import type { EditableCatalog } from './editable-contract'
import type { SourceSnapshot } from '../digital-designer/source-types'
import { readSourceScene } from './source-scene'
import { sourceMembers } from './editable-structure'
import { SemanticValidationError } from './semantic-contract'

export const QUALITY_AUDIT_VERSION = 'design-quality-audit-1'
export const AUDIT_VALIDATION_VERSION = 'whole-unit-evidence-3'
export const MAX_AUDIT_REPAIRS = 6
export const MAX_AUDIT_REPAIRS_PER_SLIDE = 2
const id = z.string().min(1).max(160), words = z.string().trim().min(1).max(700)
const ids = z.array(id).min(1).max(250)
export const semanticUnitSchema = z.object({
  id, name: z.string().min(1).max(120), purpose: words,
  level: z.enum(['component', 'composition']), sourceIds: ids,
  textIds: z.array(id).max(120), keepTogether: z.boolean(),
  preserve: z.array(z.string().min(1).max(250)).min(1).max(8),
}).strict()
export const auditFindingSchema = z.object({
  id, kind: z.enum(['missing-unit', 'fragmented-unit', 'lost-relationship', 'appearance', 'graphic', 'background', 'unresolved']),
  unitId: id.nullable(), sourceIds: ids, componentIds: z.array(id).max(50),
  reason: words, repair: z.enum(['component', 'graphic', 'review']),
}).strict()
export const slideAuditSchema = z.object({
  slide: z.number().int().positive(),
  units: z.array(semanticUnitSchema).max(32),
  relations: z.array(z.object({ from: id, to: id, kind: z.enum(['explains', 'compares', 'sequence', 'contains']), reason: words }).strict()).max(48),
  techniques: z.array(z.object({ name: z.string().min(1).max(120), purpose: words, sourceIds: ids, preserve: z.array(z.string().min(1).max(250)).min(1).max(8) }).strict()).max(8),
  findings: z.array(auditFindingSchema).max(12), note: z.string().max(1500),
}).strict()
export const qualityReplySchema = z.object({ slides: z.array(slideAuditSchema).min(1).max(2) }).strict()
export const styleAuditSchema = z.object({
  summary: words,
  patterns: z.array(z.object({
    name: z.string().min(1).max(120), purpose: words, application: words,
    scope: z.enum(['observed', 'recurring']),
    preserve: z.array(z.string().min(1).max(250)).min(1).max(8),
    evidence: z.array(z.object({ slide: z.number().int().positive(), sourceIds: ids }).strict()).min(1).max(12),
  }).strict()).max(16),
  limitations: z.array(z.string().min(1).max(300)).max(16),
}).strict()
export type SemanticUnit = z.infer<typeof semanticUnitSchema>
export type SlideAudit = z.infer<typeof slideAuditSchema>
export type AuditFinding = z.infer<typeof auditFindingSchema>
export type TemplateDesignIntent = z.infer<typeof styleAuditSchema>
export type AuditResult = { slides: SlideAudit[]; rejected: { slide: number; reason: string }[] }
export type SourceIntegrity = { status: 'checked' | 'unavailable'; resources: number; missing: { path: string; slides: number[] }[]; incompleteSlides: number[]; reason?: string }
export type AuditBatch = { id: string; slides: number[]; status: 'pending' | 'complete' | 'partial' | 'skipped'; error?: string; runId?: string; liveRequests?: number; attempt?: number }
export type AuditRepair = { id: string; batchId: string; findingId: string; slide: number; sourceIds: string[]; unit: SemanticUnit | null; reason: string; target: 'component' | 'graphic' | 'review'; region: { x: number; y: number; width: number; height: number }; status: 'pending' | 'queued' | 'accepted' | 'unresolved' | 'deferred'; requestId?: string; catalogId?: string; componentIds?: string[]; detail?: string }
export type QualityAuditJob = {
  version: typeof QUALITY_AUDIT_VERSION; id: string; sourceHash: string; sourceRevision: string; catalogId: string; sourceCatalogId: string;
  createdAt: number; updatedAt: number; batches: AuditBatch[]; overview: AuditBatch;
  status: 'auditing' | 'repairing' | 'complete'; integrity: SourceIntegrity;
  repairs: AuditRepair[]; repairPlanReady: boolean; modelRequests: number;
}
export type QualityAuditState = { enabled: boolean; job: QualityAuditJob | null; stale: boolean; results: AuditResult[]; style: TemplateDesignIntent | null }

export function auditLeafIds(snapshot: SourceSnapshot, ids: string[]) {
  const scene = readSourceScene(snapshot)
  return [...new Set(sourceMembers(ids, scene).filter(r => r.disposition === 'visible' && !('children' in r.element)).map(r => r.element.id))]
}

/** Invalid slides are isolated. A correct sibling slide is never discarded.
 * ID/text checks ground model judgements; they do not certify semantic truth. */
export function validateQualityReply(raw: unknown, snapshot: SourceSnapshot, catalog: EditableCatalog, numbers: number[]): AuditResult {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { slides?: unknown }).slides)) throw new SemanticValidationError(['audit-schema'])
  const rows = (raw as { slides: unknown[] }).slides, result: AuditResult = { slides: [], rejected: [] }, scene = readSourceScene(snapshot)
  const templates = catalog.families.flatMap(f => f.variants)
  for (const slide of numbers) {
    try {
      const candidates = rows.filter(r => r && typeof r === 'object' && (r as {slide?:number}).slide === slide)
      if (candidates.length !== 1) throw Error('Нет единственного результата слайда')
      const value = slideAuditSchema.parse(candidates[0])
      const known = (values: string[]) => {
        if (new Set(values).size !== values.length || values.some(id => { const r = scene.records.get(id); return !r || r.source.slide !== slide || r.disposition !== 'visible' })) throw Error('Неизвестные или чужие исходные объекты')
      }
      if (new Set(value.units.map(u => u.id)).size !== value.units.length || new Set(value.findings.map(f => f.id)).size !== value.findings.length) throw Error('Повторяющиеся идентификаторы')
      for (const unit of value.units) {
        known(unit.sourceIds); known(unit.textIds)
        const members = sourceMembers(unit.sourceIds, scene), text = members.filter(r => r.disposition === 'visible' && r.element.kind === 'text' && r.element.text.trim()).map(r => r.element.id)
        if (new Set(unit.textIds).size !== unit.textIds.length || text.some(id => !unit.textIds.includes(id)) || unit.textIds.some(id => !text.includes(id))) throw Error('Смысловой блок теряет текст или включает чужую подпись')
      }
      for (const r of value.relations) if (r.from === r.to || !value.units.some(u => u.id === r.from) || !value.units.some(u => u.id === r.to)) throw Error('Неизвестная смысловая связь')
      for (const technique of value.techniques) known(technique.sourceIds)
      const findings: AuditFinding[] = []
      for (const f of value.findings) { try {
        known(f.sourceIds)
        if (f.unitId !== null && !value.units.some(u => u.id === f.unitId)) throw Error('Замечание ссылается на неизвестный блок')
        if (f.componentIds.some(id => !templates.some(t => t.id === id && t.slide === slide))) throw Error('Неизвестный компонент результата')
        const unit = value.units.find(u => u.id === f.unitId)
        // A finding can point at the faulty caption inside a complete unit.
        // Its evidence is not the repair boundary: planning expands to the
        // whole validated unit, including any external explanatory paragraph.
        if (unit && !auditLeafIds(snapshot, f.sourceIds).some(id => auditLeafIds(snapshot, unit.sourceIds).includes(id))) throw Error('Замечание не относится к указанному смысловому блоку')
        if (f.repair === 'component' && !unit) throw Error('Добавление компонента требует целого смыслового блока')
        findings.push(f)
      } catch (e) { result.rejected.push({ slide, reason: `Замечание ${f.id}: ${e instanceof Error ? e.message : 'Ссылки не проверены'}` }) } }
      result.slides.push({...value, findings})
    } catch (e) { result.rejected.push({ slide, reason: e instanceof z.ZodError ? 'Неполный формат смыслового аудита' : e instanceof Error ? e.message : 'Ответ не проверен' }) }
  }
  if (rows.some(r => !r || typeof r !== 'object' || !numbers.includes((r as {slide:number}).slide))) result.rejected.push({ slide: 0, reason: 'Ответ содержит непрошенные слайды; они не использованы' })
  return result
}

export function validateStyleAudit(raw: unknown, snapshot: SourceSnapshot, results: AuditResult[]) {
  const value = styleAuditSchema.parse(raw), allowed = new Map(results.flatMap(r => r.slides).map(s => [s.slide, new Set(s.techniques.flatMap(t => t.sourceIds))]))
  for (const p of value.patterns) {
    if (p.scope === 'recurring' && new Set(p.evidence.map(e => e.slide)).size < 2) throw new SemanticValidationError(['Один пример не доказывает повторяющийся приём шаблона'])
    for (const e of p.evidence) if (!snapshot.slides.some(s => s.number === e.slide) || e.sourceIds.some(id => !allowed.get(e.slide)?.has(id))) throw new SemanticValidationError(['Стилевой приём не подтверждён исходными объектами аудита'])
  }
  return value
}
