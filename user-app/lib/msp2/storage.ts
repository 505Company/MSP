import { z } from 'zod'
import { contentHash, catalogLibrary } from '../design-system/catalog'
import { readEditableCatalog } from '../design-system/editable-analysis'
import { readBackgroundCatalog } from '../design-system/background-storage'
import { projectPreparedBoxes } from '../presentations/prepared-component-storage'
import { getBankStyle } from '../workspace/storage'
import { beginModelRun } from '../uploads/model-run'
import type { QwenConfig } from '../uploads/qwen-analysis'
import { MSP2_VERSION, type Project, type Run, type SlideResult } from './types'
import { localPlan, planningTask, sourcePackets } from './planner'
import { validatePlanGrid, gridRect } from './grid'
import { slideSpec } from './spec'
import { designTokens } from './theme'

const uuid = z.string().uuid(), json = { httpMetadata: { contentType: 'application/json' } }
const projectKey = (id: string) => `msp2/projects/${uuid.parse(id)}.json`
export const runKey = (id: string, revision: string) => `msp2/runs/${uuid.parse(id)}/${uuid.parse(revision)}/run.json`
export const projectInput = z.object({ id: uuid, name: z.string().trim().min(1).max(120), text: z.string().min(1).max(100000).refine(t => !!t.trim() && !t.includes('\0')), uploadId: uuid, mode: z.enum(['local', 'ai']) }).strict()
export const readProject = async (bucket: R2Bucket, id: string): Promise<Project | null> => (await bucket.get(projectKey(id)))?.json<Project>() ?? null
export const readRun = async (bucket: R2Bucket, id: string, revision: string): Promise<Run | null> => (await bucket.get(runKey(id, revision)))?.json<Run>() ?? null

export async function saveProject(bucket: R2Bucket, raw: unknown, baseRevision?: string) {
  const input = projectInput.parse(raw), oldFile = await bucket.get(projectKey(input.id)), old = oldFile ? await oldFile.json<Project>() : null
  if (old && !baseRevision) {
    if (old.text === input.text && old.uploadId === input.uploadId && old.mode === input.mode && old.name === input.name) return old
    throw Error('Проект с этим ID уже существует.')
  }
  if (baseRevision && (!old || old.revision !== baseRevision)) throw Error('Проект изменился в другой вкладке. Ваш текст остался в форме.')
  const style = await getBankStyle(bucket, input.uploadId)
  if (!style && old?.uploadId !== input.uploadId) throw Error('Выберите дизайн-систему из банка.')
  sourcePackets(input.text) // Validate boundaries and rectangular data before storing.
  const now = new Date().toISOString(), project: Project = { ...input, revision: crypto.randomUUID(), styleName: style?.name ?? old!.styleName, createdAt: old?.createdAt ?? now, updatedAt: now }
  const written = await bucket.put(projectKey(input.id), JSON.stringify(project), { ...json, onlyIf: oldFile ? { etagMatches: oldFile.etag } : { etagDoesNotMatch: '*' } })
  if (!written) throw Error('Проект изменился в другой вкладке. Обновите страницу.')
  return project
}

export async function projectList(bucket: R2Bucket) {
  const result = []; let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: 'msp2/projects/', cursor, limit: 100 })
    for (const entry of page.objects) {
      const file = await bucket.get(entry.key); if (!file) continue
      const project = await file.json<Project>(), run = await readRun(bucket, project.id, project.revision)
      const readyCount = Object.keys(run?.results ?? {}).length, slideCount = run?.packets.length ?? sourcePackets(project.text).length
      const first = run?.packets.find(p => run.results[p.id])
      result.push({ ...project, text: undefined, readyCount, slideCount, errorCount: Object.keys(run?.errors ?? {}).length, previewUrl: first ? `/api/msp2/projects/${project.id}/preview?revision=${project.revision}&slide=${first.id}` : null })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function startRun(bucket: R2Bucket, id: string, revision: string) {
  const project = await readProject(bucket, id)
  if (!project || project.revision !== revision) throw Error('Содержание изменилось. Обновите проект перед генерацией.')
  const previous = await readRun(bucket, id, revision); if (previous) return previous
  const catalog = await catalogLibrary(bucket, project.uploadId)
  if (!catalog) throw Error('Сначала завершите создание компонентов выбранной дизайн-системы.')
  const [editable, prepared, backgrounds] = await Promise.all([readEditableCatalog(bucket, project.uploadId), projectPreparedBoxes(bucket, project, { adoptCurrent: true }), readBackgroundCatalog(bucket, project.uploadId)])
  const passed = new Set(editable?.qualification?.checks.filter(c => c.passed).map(c => c.id) ?? [])
  const library: Run['library'] = { id: catalog.catalogId, uploadId: project.uploadId, name: project.styleName, tokens: catalog.library.tokens, rules: catalog.semantic?.rules.map(r => r.interpretation) ?? [], prepared, editable: editable?.families.flatMap(f => f.variants.filter(t => passed.has(t.id))) ?? [], backgrounds: backgrounds ?? undefined }
  designTokens(library)
  const run: Run = { version: MSP2_VERSION, projectId: id, revision, createdAt: new Date().toISOString(), mode: project.mode, library, packets: sourcePackets(project.text), plans: {}, results: {}, errors: {}, modelRuns: {} }
  if (project.mode === 'local') for (const packet of run.packets) {
    try { run.plans[packet.id] = localPlan(packet, library) } catch (e) { run.errors[packet.id] = e instanceof Error ? e.message : 'Не удалось разобрать содержание.' }
  }
  await bucket.put(runKey(id, revision), JSON.stringify(run), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  return (await readRun(bucket, id, revision))!
}

export async function changeRun(bucket: R2Bucket, id: string, revision: string, change: (run: Run) => void) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const key = runKey(id, revision), file = await bucket.get(key)
    if (!file) throw Error('Генерация ещё не начата.')
    const run = await file.json<Run>()
    if (run.version !== MSP2_VERSION) throw Error('Для нового движка запустите новую версию презентации.')
    change(run)
    if (await bucket.put(key, JSON.stringify(run), { ...json, onlyIf: { etagMatches: file.etag } })) return run
  }
  throw Error('Состояние обновляется в другой вкладке. Повторите сохранение.')
}

export async function planSlide(bucket: R2Bucket, id: string, revision: string, slideId: string, config: QwenConfig, signal: AbortSignal) {
  const run = await readRun(bucket, id, revision), packet = run?.packets.find(p => p.id === slideId)
  if (!run || !packet) throw Error('Слайд не найден.')
  if (run.results[slideId] || run.plans[slideId]) return run
  if (run.mode === 'local') return changeRun(bucket, id, revision, next => { next.plans[slideId] = localPlan(packet, run.library); delete next.errors[slideId] })
  const { task, validate } = planningTask(packet, run.library)
  const job = await beginModelRun({ bucket, prefix: `msp2/model/${id}/${revision}/${slideId}`, task, validate, config, version: MSP2_VERSION, scope: { projectId: id, revision, slideId } })
  try {
    await job.execute?.(signal)
    if (!job.run.result) throw Error('Модель не вернула полный проверенный план.')
    return await changeRun(bucket, id, revision, next => { if (!next.plans[slideId]) next.plans[slideId] = job.run.result!; delete next.errors[slideId]; next.modelRuns[job.run.id] = job.run.liveRequests })
  } catch (error) {
    await changeRun(bucket, id, revision, next => { next.errors[slideId] = error instanceof Error ? error.message : 'Не удалось спланировать слайд.'; next.modelRuns[job.run.id] = job.run.liveRequests })
    throw error
  }
}

const finite = z.number().finite(), label = z.string().max(1200)
const receiptSchema = z.object({
  version: z.literal(MSP2_VERSION), slideId: label, planHash: z.string().regex(/^[a-f0-9]{64}$/), passed: z.literal(true),
  preview: z.string().max(6000000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/), html: z.string().min(1).max(8000000),
  grid: z.array(z.object({ i: label, x: finite, y: finite, w: finite, h: finite }).strict()).max(14), spec: z.unknown(),
  blockIds: z.array(label).max(14), issues: z.array(label).max(0), warnings: z.array(label).max(40), elapsedMs: finite.nonnegative(),
  components: z.array(z.object({ blockId: label, componentId: label, kind: z.enum(['prepared', 'editable']), width: finite.positive(), height: finite.positive(), state: z.enum(['vertical', 'horizontal', 'compact']).optional() }).strict()).max(14),
  text: z.array(z.object({ blockId: label, field: label, value: z.string().max(100000), size: finite.positive(), x: finite, y: finite, width: finite.nonnegative(), height: finite.nonnegative(), font: label, color: label, weight: finite }).strict()).max(100),
  dataValues: z.array(z.object({ blockId: label, templateId: label, values: z.unknown() }).strict()).max(14),
  search: z.object({ measuredWidths: finite.int().positive(), candidates: finite.int().positive(), checked: finite.int().positive(), score: finite, typographyScale: finite.min(0).max(1) }).strict(),
}).strict()

export async function validateResult(run: Run, raw: unknown): Promise<SlideResult> {
  const r = receiptSchema.parse(raw) as SlideResult, plan = run.plans[r.slideId]
  if (!plan || r.planHash !== await contentHash(plan)) throw Error('Результат относится к другому плану.')
  validatePlanGrid(r.grid, plan)
  if (JSON.stringify(r.spec) !== JSON.stringify(slideSpec(plan))) throw Error('Спецификация компонентов изменена.')
  if (JSON.stringify(r.blockIds) !== JSON.stringify(plan.content.blocks.map(b => b.id))) throw Error('Потерян или переставлен исходный блок.')
  const expectedFields = plan.content.blocks.flatMap(b => Object.entries(b.fields).map(([field, value]) => ({ block: b, field, value })))
  if (r.text.length !== expectedFields.length) throw Error('Поле потеряно или продублировано.')
  for (const { block, field, value } of expectedFields) {
    const matches = r.text.filter(t => t.blockId === block.id && t.field === field)
    const min = block.role === 'title' ? 40 : block.role === 'footer' && block.source.length < 160 ? 20 : field === 'value' ? 56 : 24
    if (matches.length !== 1 || matches[0].value !== value || matches[0].size < min) throw Error('Нарушены содержание или читаемость текста.')
    const t = matches[0], box = gridRect(r.grid.find(c => c.i === block.id)!)
    if (t.x < box.x - 2 || t.y < box.y - 2 || t.x + t.width > box.x + box.width + 2 || t.y + t.height > box.y + box.height + 2) throw Error('Текст выходит за границы блока.')
  }
  const expectedComponents = plan.content.blocks.flatMap(b => plan.components[b.id] ? [{ blockId: b.id, componentId: plan.components[b.id].id }] : b.data ? [{ blockId: b.id, componentId: b.data.template.id }] : [])
  if (r.components.length !== expectedComponents.length || expectedComponents.some(c => r.components.filter(v => v.blockId === c.blockId && v.componentId === c.componentId).length !== 1)) throw Error('Импортированный компонент подменён или потерян.')
  for (const c of r.components) {
    const box = gridRect(r.grid.find(g => g.i === c.blockId)!)
    if (c.width > box.width + 2 || c.height > box.height + 2) throw Error('Компонент выходит за границы блока.')
  }
  const data = plan.content.blocks.filter(b => b.data).map(b => ({ blockId: b.id, templateId: b.data!.template.id, values: b.data!.values }))
  if (JSON.stringify(r.dataValues) !== JSON.stringify(data)) throw Error('Изменены исходные данные таблицы или графика.')
  if (/<script\b|<[^>]+\son[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*javascript:/iu.test(r.html)) throw Error('Недопустимое содержимое экспортируемого слайда.')
  return r
}

export async function saveResult(bucket: R2Bucket, id: string, revision: string, raw: unknown) {
  const run = await readRun(bucket, id, revision); if (!run) throw Error('Генерация ещё не начата.')
  const result = await validateResult(run, raw)
  return changeRun(bucket, id, revision, next => {
    if (!next.results[result.slideId]) next.results[result.slideId] = result
    delete next.errors[result.slideId]
  })
}
