import { z } from 'zod'
import { contentHash } from '../../design-system/catalog'
import type { VisualManifest } from '../../digital-designer/visual-package'
import { QwenAnalysisError } from '../../uploads/qwen-analysis'
import type { TemplateRecipe } from './template-contract'
import { TEMPLATE_RENDER_VERSION } from './template-measurement'

const json = { httpMetadata: { contentType: 'application/json' } }
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().regex(/^[\w-]{1,120}$/)
const reviewer = z.enum(['user', 'delegated-agent'])
const entrySchema = z.object({
  id, version: hash, bundleHash: hash, artistic: z.enum(['pending', 'accepted', 'rejected']),
  enabled: z.boolean(), reason: z.string().max(1000), decidedAt: z.string().nullable(),
  artisticReview: z.object({ reviewer, reason: z.string().min(1).max(1000), decidedAt: z.string() }).strict().optional(),
}).strict()
export type RecipeLibraryEntry = z.infer<typeof entrySchema>
const registrySchema = z.object({ schemaVersion: z.literal('recipe-library-1'), revision: hash,
  previous: hash.nullable(), entries: z.array(entrySchema).max(200),
}).strict()
export type RecipeRegistry = z.infer<typeof registrySchema>
export type RecipeBundle = {
  schemaVersion: 'recipe-bundle-1'; renderVersion: typeof TEMPLATE_RENDER_VERSION; recipe: TemplateRecipe
  receipt: { key: string; hash: string; scope: string }
  evidence: { key: string; hash: string }[]
}
export type AvailableRecipe = { entry: RecipeLibraryEntry; bundle: RecipeBundle }
const root = (uploadId: string) => `recipe-library/${uploadId}`
const bundleKey = (uploadId: string, recipeId: string, version: string) => `${root(uploadId)}/bundles/${recipeId}/${version}.json`
const fail = (code: string, message: string): never => { throw new QwenAnalysisError(code, message) }

export async function readRecipeRegistry(bucket: R2Bucket, uploadId: string): Promise<RecipeRegistry> {
  const file = await bucket.get(`${root(uploadId)}/registry.json`)
  if (file) return registrySchema.parse(await file.json())
  const body = { schemaVersion: 'recipe-library-1' as const, previous: null, entries: [] }
  return { ...body, revision: await contentHash(body) }
}
async function changeRegistry(bucket: R2Bucket, uploadId: string, expected: string, change: (entries: RecipeLibraryEntry[]) => RecipeLibraryEntry[], beforeCommit?: () => Promise<unknown>) {
  const key = `${root(uploadId)}/registry.json`, file = await bucket.get(key)
  const old = await readRecipeRegistry(bucket, uploadId)
  if (old.revision !== expected) fail('RECIPE_LIBRARY_CHANGED', 'Библиотека обновилась. Прочитайте её актуальную версию.')
  const entries = change(structuredClone(old.entries))
  if (JSON.stringify(entries) === JSON.stringify(old.entries)) return old
  const body = { schemaVersion: 'recipe-library-1' as const, previous: old.revision, entries }
  const next = registrySchema.parse({ ...body, revision: await contentHash(body) })
  await bucket.put(`${root(uploadId)}/history/${next.revision}.json`, JSON.stringify(next), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  await beforeCommit?.()
  if (!await bucket.put(key, JSON.stringify(next), { ...json, onlyIf: file ? { etagMatches: file.etag } : { etagDoesNotMatch: '*' } })) fail('RECIPE_LIBRARY_CHANGED', 'Библиотека изменена другим запросом.')
  return next
}
async function documentHash(bucket: R2Bucket, key: string) {
  const file = await bucket.get(key)
  return file ? contentHash(await file.json()) : null
}
async function sourceHash(bucket: R2Bucket, uploadId: string) {
  const manifest = await (await bucket.get(`visual/${uploadId}/manifest.json`))?.json<VisualManifest>()
  return manifest ? contentHash(manifest.snapshot) : null
}

/** Called only by a qualifier that has checked the exact render/model inputs.
 * The public API never accepts caller-supplied recipes or PASS assertions. */
export async function registerRecipeVersion(bucket: R2Bucket, recipe: TemplateRecipe, receiptKey: string, evidenceKeys: string[], expectedRevision: string, beforeCommit?: () => Promise<unknown>) {
  const p = recipe.passport, uploadId = p.origin.uploadId!
  id.parse(uploadId); id.parse(p.id); hash.parse(p.version)
  if (p.scope.kind !== 'design-system' || p.scope.uploadId !== uploadId || p.origin.sourceHash !== recipe.sourceSnapshotHash ||
    await sourceHash(bucket, uploadId) !== recipe.sourceSnapshotHash) fail('RECIPE_SOURCE_CHANGED', 'Рецепт относится к другой версии дизайн-системы.')
  const receipt = await (await bucket.get(receiptKey))?.json<{ recipeVersion: string; sourceHash: string; technical: string; scope: string }>()
  if (!receipt || !['passed', 'failed'].includes(receipt.technical) || receipt.recipeVersion !== p.version || receipt.sourceHash !== recipe.sourceSnapshotHash || !receipt.scope) fail('RECIPE_UNQUALIFIED', 'Техническая проверка этой версии не завершена.')
  if (!evidenceKeys.length) fail('RECIPE_UNQUALIFIED', 'Нет доказательств проверки рецепта.')
  const evidence = []
  for (const key of [...new Set([...evidenceKeys, receiptKey])]) {
    if (!key.startsWith(`recipe-pilots/${uploadId}/`) && !key.startsWith(`recipe-discovery/${uploadId}/`)) fail('RECIPE_UNQUALIFIED', 'Доказательства относятся к другому источнику.')
    const digest = await documentHash(bucket, key)
    if (!digest) fail('RECIPE_UNQUALIFIED', 'Не найдено доказательство проверки рецепта.')
    evidence.push({ key, hash: digest! })
  }
  const bundle: RecipeBundle = { schemaVersion: 'recipe-bundle-1', renderVersion: TEMPLATE_RENDER_VERSION,
    recipe, receipt: { key: receiptKey, hash: (await documentHash(bucket, receiptKey))!, scope: receipt!.scope }, evidence }
  const bundleHash = await contentHash(bundle), key = bundleKey(uploadId, p.id, p.version)
  await bucket.put(key, JSON.stringify(bundle), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  if (await documentHash(bucket, key) !== bundleHash) fail('RECIPE_VERSION_CONFLICT', 'Эта версия уже сохранена с другими доказательствами. Исходная запись не заменена.')
  return changeRegistry(bucket, uploadId, expectedRevision, entries => {
    if (entries.some(e => e.id === p.id && e.version === p.version)) return entries
    return [...entries, { id: p.id, version: p.version, bundleHash, artistic: 'pending', enabled: false, reason: '', decidedAt: null }]
  }, beforeCommit)
}

export async function readRecipeBundle(bucket: R2Bucket, uploadId: string, entry: RecipeLibraryEntry): Promise<RecipeBundle | null> {
  const file = await bucket.get(bundleKey(uploadId, entry.id, entry.version))
  if (!file) return null
  const bundle = await file.json<RecipeBundle>()
  if (await contentHash(bundle) !== entry.bundleHash || bundle.schemaVersion !== 'recipe-bundle-1' || bundle.renderVersion !== TEMPLATE_RENDER_VERSION ||
    bundle.recipe.passport.id !== entry.id || bundle.recipe.passport.version !== entry.version || bundle.recipe.passport.scope.kind !== 'design-system' ||
    bundle.recipe.passport.scope.uploadId !== uploadId || bundle.recipe.passport.origin.uploadId !== uploadId) return null
  return bundle
}
export async function recipeEligibility(bucket: R2Bucket, uploadId: string, entry: RecipeLibraryEntry, checkApproval = true) {
  const reasons: string[] = [], bundle = await readRecipeBundle(bucket, uploadId, entry)
  if (checkApproval && entry.artistic !== 'accepted') reasons.push('artistic-not-accepted')
  if (!bundle) return { bundle, reasons: [...reasons, 'missing-or-stale-bundle'] }
  const receipt = await (await bucket.get(bundle.receipt.key))?.json<{ technical: string }>()
  if (receipt?.technical !== 'passed') reasons.push('technical-not-passed')
  if (await sourceHash(bucket, uploadId) !== bundle.recipe.sourceSnapshotHash) reasons.push('source-changed')
  for (const proof of bundle.evidence) if (await documentHash(bucket, proof.key) !== proof.hash) reasons.push('qualification-evidence-changed')
  return { bundle, reasons: [...new Set(reasons)] }
}
export const libraryDecisionSchema = z.object({ action: z.enum(['accept', 'reject', 'enable', 'disable']),
  expectedRevision: hash, recipeId: id, version: hash, reason: z.string().trim().min(1).max(1000),
  reviewer: reviewer.optional(),
}).strict()
export async function decideRecipe(bucket: R2Bucket, uploadId: string, raw: unknown) {
  const action = libraryDecisionSchema.parse(raw), registry = await readRecipeRegistry(bucket, uploadId)
  const entry = registry.entries.find(e => e.id === action.recipeId && e.version === action.version)
  if (!entry) fail('RECIPE_NOT_REGISTERED', 'Версия рецепта не зарегистрирована.')
  if (action.action === 'accept' || action.action === 'enable') {
    const { reasons } = await recipeEligibility(bucket, uploadId, entry!, action.action === 'enable')
    if (reasons.length) fail('RECIPE_NOT_ELIGIBLE', `Рецепт не допущен: ${reasons.join(', ')}.`)
  }
  return changeRegistry(bucket, uploadId, action.expectedRevision, entries => entries.map(e => {
    if (e.id !== action.recipeId) return e
    if (e.version !== action.version) return action.action === 'enable' ? { ...e, enabled: false } : e
    const decidedAt = new Date().toISOString()
    return { ...e, artistic: action.action === 'accept' ? 'accepted' : action.action === 'reject' ? 'rejected' : e.artistic,
      enabled: action.action === 'enable' || action.action === 'accept' && e.enabled,
      ...(action.action === 'accept' || action.action === 'reject' ? { artisticReview: { reviewer: action.reviewer ?? 'user', reason: action.reason, decidedAt } } : {}),
      reason: action.reason, decidedAt }
  }))
}
export async function availableRecipes(bucket: R2Bucket, uploadId: string): Promise<AvailableRecipe[]> {
  const registry = await readRecipeRegistry(bucket, uploadId), available: AvailableRecipe[] = []
  for (const entry of registry.entries.filter(e => e.enabled)) {
    const { bundle, reasons } = await recipeEligibility(bucket, uploadId, entry)
    if (bundle && !reasons.length) available.push({ entry, bundle })
  }
  return available
}
