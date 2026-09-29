import { z } from 'zod'
import type { EditableCatalog } from './editable-contract'
import type { HtmlQualification } from './editable-qualification'

export const REFINEMENT_VERSION = 'editable-refinement-1'
export const MAX_REFINEMENT_SLIDES = 12
export const refinementFeedback = { incomplete: 'Не хватает подписи или части блока', extra: 'Захвачены лишние элементы', split: 'Здесь несколько самостоятельных компонентов' } as const
export const regionSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(.005).max(1), height: z.number().min(.005).max(1) }).strict().refine(r => r.x + r.width <= 1.00001 && r.y + r.height <= 1.00001, 'Область выходит за слайд')
export type RefinementRegion = z.infer<typeof regionSchema>
export const refinementRequestSchema = z.object({
  id: z.string().uuid(), mode: z.enum(['scan', 'region', 'feedback']), catalogId: z.string().regex(/^[a-f0-9]{64}$/),
  slide: z.number().int().positive().optional(), region: regionSchema.optional(), templateId: z.string().min(1).max(160).optional(),
  feedback: z.enum(['incomplete', 'extra', 'split']).optional(), note: z.string().max(600).default(''),
  nativeOnly: z.boolean().optional(),
  target: z.enum(['auto', 'component', 'graphic']).optional(),
  audit: z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), findingId: z.string().min(1).max(170) }).strict().optional(),
}).strict().superRefine((v, ctx) => {
  if(v.nativeOnly&&v.mode!=='scan')ctx.addIssue({code:'custom',message:'Проверка структуры доступна только для каталога'})
  if (v.mode === 'region' && (!v.slide || !v.region)) ctx.addIssue({ code: 'custom', message: 'Выделите область на исходном слайде' })
  if (v.mode === 'feedback' && (!v.templateId || !v.feedback)) ctx.addIssue({ code: 'custom', message: 'Укажите компонент и причину' })
  if (v.mode !== 'region' && (v.region || v.slide) || v.mode !== 'feedback' && (v.templateId || v.feedback)) ctx.addIssue({ code: 'custom', message: 'Несовместимые параметры дополнения' })
  if (v.mode !== 'region' && v.target) ctx.addIssue({ code: 'custom', message: 'Назначение области доступно только при выделении' })
  if (v.audit && v.mode !== 'region') ctx.addIssue({ code: 'custom', message: 'Замечание аудита относится к конкретному блоку' })
})
export type RefinementInput = z.infer<typeof refinementRequestSchema>
export type RefinementCoverage = { slide: number; visible: number; represented: number; unassigned: string[]; broad: string[]; reviewed: boolean }
export type RefinementTask = { slide: number; selectedIds: string[]; status: 'pending' | 'running' | 'checking' | 'complete' | 'failed' | 'skipped'; startedAt?: number; error?: string; errorCode?: string; issues?: string[]; runId?: string; modelPrefix?: string; replayed?: boolean; candidateKey?: string; report?: HtmlQualification; note?: string; raster?: { width: number; height: number }; rejectedReasons?: string[] }
export const refinementTaskFinished = (task: RefinementTask) => task.status === 'complete' || task.status === 'skipped'
export type RefinementJob = {
  id: string; mode: RefinementInput['mode'] | 'automatic'; input: Omit<RefinementInput, 'id' | 'mode'>;
  baseId: string; originalBaseId: string; sourceRevision: string; createdAt: number; updatedAt: number;
  status: 'queued' | 'running' | 'checking' | 'complete' | 'failed' | 'cancelled'; tasks: RefinementTask[];
  remaining: number; budget: { used: number; limit: number; slides: Record<string, number> };
  result?: { added: number; updated: number; rejected: number; duplicates: number; skipped?: number; version?: string; items?: RefinementChange[] }; error?: string;
}
export type RefinementChange = { id: string; name: string; kind: string; slide: number }
export type RefinementCandidate = { catalog: EditableCatalog; removeIds: string[]; duplicates: number; rejected: number }
export type RefinementState = { configured: boolean; background: boolean; catalogId: string | null; ready: boolean; coverage: RefinementCoverage[]; jobs: RefinementJob[]; pending: string | null; queue?: string[]; canUndo: boolean; applied: string[]; stale: boolean }
