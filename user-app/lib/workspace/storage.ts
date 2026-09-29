import { z } from 'zod'
import { LibraryConflict } from '../design-system/storage'
import type { BankStyle, PresentationProject } from './types'
import { assertUploadActive, cancelUpload, uploadIsCancelled } from '../uploads/cancellation-server'

const json = { httpMetadata: { contentType: 'application/json' } }
export const workspaceId = z.string().uuid()
const bankKey = (id: string) => `workspace/style-bank/${workspaceId.parse(id)}.json`
const projectKey = (id: string) => `workspace/projects/${workspaceId.parse(id)}.json`

async function records<T>(bucket: R2Bucket, prefix: string): Promise<T[]> {
  const result: T[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor, limit: 100 })
    for (const entry of page.objects) {
      if (!entry.key.endsWith('.json')) continue
      const file = await bucket.get(entry.key)
      if (file) result.push(await file.json<T>())
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return result
}
// Membership is explicit. Stored imports and old mock presets are not bank entries.
export const listBank = async (bucket: R2Bucket) => (await records<BankStyle>(bucket, 'workspace/style-bank/')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
export async function getBankStyle(bucket: R2Bucket, id: string): Promise<BankStyle | null> {
  if (await uploadIsCancelled(bucket, id)) return null
  const file = await bucket.get(bankKey(id))
  return file ? file.json<BankStyle>() : null
}
export async function addBankStyle(bucket: R2Bucket, style: BankStyle): Promise<BankStyle> {
  await assertUploadActive(bucket, style.id)
  await bucket.put(bankKey(style.id), JSON.stringify(style), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  // Deletion may win while an import is still registering its saved source.
  if (await uploadIsCancelled(bucket, style.id)) {
    await bucket.delete(bankKey(style.id)); await assertUploadActive(bucket, style.id)
  }
  return (await getBankStyle(bucket, style.id))!
}
export async function removeBankStyle(bucket: R2Bucket, id: string) {
  // Existing projects retain their source and immutable definitions.
  await cancelUpload(bucket, id)
  await bucket.delete(bankKey(id))
}
export const projectContent = z.object({
  name: z.string().trim().min(1, 'Введите название проекта').max(120),
  text: z.string().min(1).max(100_000).refine(text => !!text.trim() && !text.includes('\0'), 'Нужен непустой текст без нулевых символов'),
  generationMode: z.enum(['fast','smart']).optional(),
  compositionMode: z.enum(['recipes','components']).optional(),
  modelRoute: z.enum(['default','akashml-fp8']).optional(),
  recipeScope: z.enum(['all','new']).optional(),
}).strict()
export const newProject = projectContent.extend({ id: workspaceId, uploadId: workspaceId })
export const projectUpdate = projectContent.extend({ baseRevision: workspaceId, uploadId: workspaceId.optional() })
export async function getProject(bucket: R2Bucket, id: string): Promise<PresentationProject | null> {
  const file = await bucket.get(projectKey(id))
  return file ? file.json<PresentationProject>() : null
}
export const listProjects = async (bucket: R2Bucket) => (await records<PresentationProject>(bucket, 'workspace/projects/')).filter(p => !p.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
export async function createProject(bucket: R2Bucket, raw: unknown, style: BankStyle): Promise<PresentationProject> {
  const input = newProject.parse(raw)
  if (input.uploadId !== style.id) throw new Error('Выбранная дизайн-система не совпадает с проектом')
  const now = new Date().toISOString()
  const project: PresentationProject = { schemaVersion: 1, ...input, revision: crypto.randomUUID(), styleName: style.name, createdAt: now, updatedAt: now }
  const written = await bucket.put(projectKey(project.id), JSON.stringify(project), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  if (written) return project
  const previous = await getProject(bucket, input.id)
  if (previous && previous.uploadId === input.uploadId && previous.name === input.name && previous.text === input.text && previous.generationMode === input.generationMode && previous.compositionMode === input.compositionMode && previous.modelRoute === input.modelRoute && previous.recipeScope === input.recipeScope) return previous
  throw new LibraryConflict('Этот проект уже создан с другим содержанием. Обновите страницу проектов.')
}
export async function updateProject(bucket: R2Bucket, id: string, raw: unknown): Promise<PresentationProject> {
  const input = projectUpdate.parse(raw), key = projectKey(id), file = await bucket.get(key)
  if (!file) throw new Error('Проект не найден')
  const previous = await file.json<PresentationProject>()
  if (previous.revision !== input.baseRevision) throw new LibraryConflict('Проект изменён в другой вкладке. Ваш текст остался в форме; его можно сохранить отдельным проектом.')
  const uploadId = input.uploadId ?? previous.uploadId
  const style = uploadId !== previous.uploadId ? await getBankStyle(bucket, uploadId) : null
  if (uploadId !== previous.uploadId && !style) throw new LibraryConflict('Выбранный стиль больше недоступен. Выберите другой стиль из банка.')
  const next = { ...previous, name: input.name, text: input.text, uploadId, ...(input.recipeScope ?? previous.recipeScope ? {recipeScope:input.recipeScope??previous.recipeScope}:{}), ...(input.compositionMode ?? previous.compositionMode ? { compositionMode: input.compositionMode ?? previous.compositionMode } : {}), ...(input.modelRoute ?? previous.modelRoute ? { modelRoute: input.modelRoute ?? previous.modelRoute } : {}), ...(input.generationMode ?? previous.generationMode ? { generationMode: input.generationMode ?? previous.generationMode } : {}), styleName: style?.name ?? previous.styleName, revision: crypto.randomUUID(), updatedAt: new Date().toISOString() }
  const written = await bucket.put(key, JSON.stringify(next), { ...json, onlyIf: { etagMatches: file.etag } })
  if (!written) throw new LibraryConflict('Другая вкладка уже сохранила содержание. Ваш текст остался в форме.')
  return next
}
export async function archiveProject(bucket: R2Bucket, id: string, baseRevision: string) {
  const key = projectKey(id), file = await bucket.get(key)
  if (!file) return
  const previous = await file.json<PresentationProject>()
  if (previous.revision !== workspaceId.parse(baseRevision)) throw new LibraryConflict('Проект изменился в другой вкладке. Обновите его перед удалением из списка.')
  const next = { ...previous, archivedAt: new Date().toISOString(), revision: crypto.randomUUID() }
  if (!await bucket.put(key, JSON.stringify(next), { ...json, onlyIf: { etagMatches: file.etag } })) throw new LibraryConflict('Проект изменился. Обновите страницу.')
}
