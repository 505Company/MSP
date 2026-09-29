import { z } from 'zod'
import type { EditableCatalog } from '../design-system/editable-contract'
import { readEditableCatalog } from '../design-system/editable-analysis'
import { assertUploadActive, uploadIsCancelled } from '../uploads/cancellation-server'
import { LAB_VERSION, PROFILE_VERSION, rulesSchema, type ComponentContent, type ComponentProfile, type ComponentRules } from './contract'
import { digest, sourceCandidate } from './source'
import { emptyRules, applyRules } from './rules'
import { readRuleHistory } from './storage'
import { validateProof, type QualityProof } from './proof'
import { validateSourceCheck } from './source-check'
import { googleFontAlternative } from './font-policy'
import { catalogCandidates, candidateScene, withNativeQuote } from './candidates'
import { originalAssets, auditSourceFidelity, type SourceFidelity, type AssetIdentity } from './fidelity'

export const PREPARATION_VERSION = `preparation-1:${PROFILE_VERSION}:${LAB_VERSION}`
export const PREPARATION_LEASE_MS = 45_000
const prefix = 'component-preparation/'
const json = { httpMetadata: { contentType: 'application/json' } }
const key = (upload: string) => `${prefix}${z.string().uuid().parse(upload)}/jobs.json`
const resultKey = (upload: string, id: string) => `${prefix}${upload}/results/${id}.json`
export type PreparationInput = { profile: ComponentProfile; content: ComponentContent; rules: ComponentRules; ruleRevision: string | null; fontSource: string; assets: AssetIdentity[] }
export type PreparedComponent = {
  version: string; componentId: string; inputHash: string; ruleRevision: string | null; profile: ComponentProfile; rules: ComponentRules
  faces: { family: string; weight: number; hash: string }[]; proof: QualityProof; proofHash: string; source: ReturnType<typeof validateSourceCheck>
  assets: AssetIdentity[]; fidelity: SourceFidelity; technical: 'passed' | 'failed'; coverage: { fits: number; readable: number; tested: number }; sourceFidelity: 'preserved' | 'failed'; generationAdmission: boolean; createdAt: number
}
export type PreparationJob = {
  id: string; uploadId: string; componentId: string; name: string; catalogId: string; version: string; inputHash: string
  status: 'queued' | 'running' | 'retrying' | 'blocked' | 'complete' | 'unsupported' | 'cancelled'
  input?: PreparationInput; reason?: string; createdAt: number; updatedAt: number; attempts: number; retryAt?: number
  owner?: string; leaseToken?: string; leaseUntil?: number
  result?: { key: string; technical: 'passed' | 'failed'; fits: number; tested: number; sourceFits: boolean; fontHash: string; sourceFidelity: 'preserved' | 'failed'; generationAdmission: boolean }
}
export function publicPreparationJob(job: PreparationJob) {
  const { input, owner, leaseToken, leaseUntil, ...view } = job
  void input; void owner; void leaseToken; void leaseUntil
  return view
}
export async function readPreparationJobs(bucket: R2Bucket, upload: string): Promise<PreparationJob[]> {
  const jobs = await (await bucket.get(key(upload)))?.json<PreparationJob[]>() ?? []
  return await uploadIsCancelled(bucket, upload) ? jobs.map(j => ({ ...j, status: 'cancelled' as const })) : jobs
}
async function mutate(bucket: R2Bucket, upload: string, change: (jobs: PreparationJob[]) => PreparationJob[]) {
  for (let i = 0; i < 8; i++) {
    await assertUploadActive(bucket, upload)
    const file = await bucket.get(key(upload)), previous = file ? await file.json<PreparationJob[]>() : []
    const next = change(previous)
    if (next === previous) return previous
    if (await bucket.put(key(upload), JSON.stringify(next), { ...json, onlyIf: file ? { etagMatches: file.etag } : { etagDoesNotMatch: '*' } })) return next
  }
  throw Error('Состояние подготовки изменилось. Повторите запрос.')
}
async function fontSource(bucket: R2Bucket, upload: string) {
  const manifest = await (await bucket.get(`source-fonts/${upload}/v2/manifest.json`))?.json<{ fonts: { key: string }[] }>()
  return digest({ manifest: manifest ?? null, files: await Promise.all((manifest?.fonts ?? []).map(async f => [f.key, (await bucket.head(f.key))?.etag ?? null])) })
}
/** Cheap admission only. Each expensive matrix receives its own lease, so an
 * import/presentation can take priority between two components. No model calls. */
export async function enqueuePreparation(bucket: R2Bucket, upload: string, catalog?: EditableCatalog | null, now = Date.now()) {
  await assertUploadActive(bucket, upload)
  catalog ??= await readEditableCatalog(bucket, upload)
  if (!catalog?.qualification) return []
  const fonts = await fontSource(bucket, upload), candidates = await catalogCandidates(bucket, upload, catalog)
  const prepared: PreparationJob[] = []
  for (const template of catalog.families.flatMap(f => f.variants)) {
    const candidate = candidates.find(c => c.template.id === template.id)!
    const profile = 'profile' in candidate ? candidate.profile : undefined
    let input: PreparationInput | undefined
    if (profile && 'content' in candidate && candidate.content) {
      const history = await readRuleHistory(bucket, upload, profile)
      try { input = { profile, content: candidate.content, rules: history.versions[0]?.rules ?? emptyRules(), ruleRevision: history.head, fontSource: fonts, assets: await originalAssets(bucket, upload, profile) } }
      catch { candidate.reason = 'Исходная иллюстрация недоступна. Подготовка сохранит исходный компонент.' }
    }
    prepared.push({ id: crypto.randomUUID(), uploadId: upload, componentId: template.id, name: template.name, catalogId: catalog.id,
      version: PREPARATION_VERSION, inputHash: await digest({ version: PREPARATION_VERSION, catalogId: catalog.id, template, input: input ?? null }),
      status: input ? 'queued' : 'unsupported', ...(input ? { input } : { reason: candidate.reason }), createdAt: now, updatedAt: now, attempts: 0 })
  }
  if ((await readEditableCatalog(bucket, upload))?.id !== catalog.id) throw Error('Библиотека изменилась во время подготовки.')
  return mutate(bucket, upload, old => {
    const next = prepared.map(job => {
      const previous = old.find(j => j.componentId === job.componentId)
      if (previous?.inputHash === job.inputHash) return previous.status === 'unsupported' && previous.reason !== job.reason ? { ...previous, reason: job.reason, updatedAt: now } : previous
      // Updating the source must not undo an explicit per-component stop.
      return previous?.status === 'cancelled' ? { ...job, status: 'cancelled' as const } : job
    })
    // Old immutable results remain on disk; a new catalog/rule revision never
    // relabels them as current or lets a late worker publish into the new job.
    return next.length === old.length && next.every((j, i) => j === old[i]) ? old : next
  })
}
function assertLease(job: PreparationJob | undefined, token: string, now: number): asserts job is PreparationJob {
  if (!job || job.status !== 'running' || job.leaseToken !== token || (job.leaseUntil ?? 0) <= now) throw Error('Утрачено владение подготовкой компонента.')
}
async function currentInput(bucket: R2Bucket, job: PreparationJob) {
  if (job.version !== PREPARATION_VERSION || !job.input) throw Error('Версия подготовки изменилась.')
  const catalog = await readEditableCatalog(bucket, job.uploadId)
  if (!catalog || catalog.id !== job.catalogId || !catalog.qualification?.checks.some(c => c.id === job.componentId && c.passed)) throw Error('Исходная библиотека изменилась.')
  const template = catalog.families.flatMap(f => f.variants).find(t => t.id === job.componentId)
  if (!template) throw Error('Исходный компонент отсутствует.')
  const candidate = await sourceCandidate(withNativeQuote(template, await candidateScene(bucket, job.uploadId, [template])), catalog.id)
  if (candidate.profile?.fingerprint !== job.input.profile.fingerprint) throw Error('Исходный компонент изменился.')
  if ((await readRuleHistory(bucket, job.uploadId, candidate.profile)).head !== job.input.ruleRevision) throw Error('Настройки компонента изменились.')
  if (await fontSource(bucket, job.uploadId) !== job.input.fontSource) throw Error('Исходные шрифты изменились.')
  if (await digest(await originalAssets(bucket, job.uploadId, candidate.profile)) !== await digest(job.input.assets)) throw Error('Исходные изображения изменились.')
  return candidate
}
export async function ownedPreparation(bucket: R2Bucket, upload: string, id: string, token: string, now = Date.now()) {
  await assertUploadActive(bucket, upload)
  const job = (await readPreparationJobs(bucket, upload)).find(j => j.id === id)
  assertLease(job, token, now); await currentInput(bucket, job)
  return job
}
export async function claimPreparation(bucket: R2Bucket, owner: string, now = Date.now()) {
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) })
    for (const item of page.objects.filter(o => o.key.endsWith('/jobs.json'))) {
      const upload = item.key.slice(prefix.length).split('/')[0]
      if (await uploadIsCancelled(bucket, upload)) continue
      let jobs = await readPreparationJobs(bucket, upload)
      // Refinement may publish a newer catalog after the first qualification
      // enqueued matrices. Replace obsolete jobs, including those blocked by
      // that revision change, before looking for runnable work. Same-version
      // failures keep their retry budget; cancelled jobs are not resumed here.
      if (jobs.some(j => ['queued', 'retrying', 'running', 'blocked'].includes(j.status))) {
        const catalog = await readEditableCatalog(bucket, upload)
        if (catalog?.qualification && jobs.some(j => j.catalogId !== catalog.id)) jobs = await enqueuePreparation(bucket, upload, catalog, now)
      }
      const candidate = jobs.find(j => ['queued', 'retrying', 'running'].includes(j.status) && (j.retryAt ?? 0) <= now && !(j.status === 'running' && (j.leaseUntil ?? 0) > now))
      if (!candidate) continue
      let reason: string | undefined
      try { await currentInput(bucket, candidate) } catch (e) { reason = e instanceof Error ? e.message : 'Источник изменился.' }
      const token = crypto.randomUUID()
      const changed = await mutate(bucket, upload, jobs => jobs.map(job => {
        if (job.id !== candidate.id || !['queued', 'retrying', 'running'].includes(job.status) || (job.retryAt ?? 0) > now || job.status === 'running' && (job.leaseUntil ?? 0) > now) return job
        const attempts = job.attempts + Number(job.status === 'running')
        if (reason || attempts > 2) return { ...job, status: 'blocked', reason: reason ?? 'Проверка несколько раз прервалась.', updatedAt: now }
        return { ...job, attempts, status: 'running', owner, leaseToken: token, leaseUntil: now + PREPARATION_LEASE_MS, retryAt: undefined, reason: undefined, updatedAt: now }
      }))
      const claimed = changed.find(j => j.leaseToken === token)
      if (claimed) return claimed
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return null
}
const submitted = z.object({ rules: rulesSchema, proof: z.unknown(), source: z.unknown(), assets: z.array(z.object({ url: z.string().max(300), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(20).default([]), faces: z.array(z.object({ family: z.string().min(1).max(160), weight: z.number().int().min(100).max(900), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(12) }).strict()
/** Publication validates the pinned fields, source properties and current lease.
 * It admits a reusable profile; it never writes manual rules or starts a deck. */
export async function finishPreparation(bucket: R2Bucket, upload: string, id: string, token: string, raw: unknown, now = Date.now()) {
  const job = await ownedPreparation(bucket, upload, id, token, now), input = submitted.parse(raw), pinned = job.input!
  if (await digest(input.rules.states) !== await digest(pinned.rules.states) || pinned.rules.fontReplacements?.some(r => !input.rules.fontReplacements?.some(v => v.source === r.source && v.family === r.family))) throw Error('Фоновая проверка не может менять ручные правила.')
  if (input.rules.fontReplacements?.some(r => !pinned.rules.fontReplacements?.some(v => v.source === r.source && v.family === r.family) && (!pinned.profile.fields.some(f => f.font === r.source) || googleFontAlternative(r.source) !== r.family))) throw Error('Замена шрифта не соответствует правилам продукта.')
  const profile = await applyRules(pinned.profile, input.rules), checked = await validateProof(profile, input.proof)
  const source = validateSourceCheck(profile, pinned.content, input.source), technical = checked.technical === 'passed' && source.passed ? 'passed' : 'failed'
  if (await digest(input.assets) !== await digest(pinned.assets)) throw Error('Не подтверждены исходные изображения.')
  const candidate = await currentInput(bucket, job), fidelity = await auditSourceFidelity(candidate.template, profile, pinned.content)
  const generationAdmission = technical === 'passed' && fidelity.status === 'preserved'
  if (profile.fields.some(f => !input.faces.some(face => face.family === f.font && face.weight === f.weight))) throw Error('Не подтверждены шрифты всех полей.')
  const fontHash = await digest(input.faces), evidenceHash = await digest({ proof: checked.hash, source, rules: input.rules })
  const path = resultKey(upload, `${job.inputHash}-${fontHash}-${evidenceHash}-${token}`)
  await bucket.put(path, JSON.stringify({ version: PREPARATION_VERSION, componentId: job.componentId, inputHash: job.inputHash, ruleRevision: pinned.ruleRevision, profile, rules: input.rules, faces: input.faces,
    proof: checked.proof, proofHash: checked.hash, source, technical, coverage: checked.coverage, assets: input.assets, fidelity, sourceFidelity: fidelity.status, generationAdmission, createdAt: now }), { ...json, onlyIf: { etagDoesNotMatch: '*' } })
  await currentInput(bucket, job)
  return mutate(bucket, upload, jobs => {
    if (!jobs.some(j => j.id === id)) throw Error('Задание заменено новой версией.')
    return jobs.map(current => {
    if (current.id !== id) return current
    assertLease(current, token, now)
    return { ...current, result: { key: path, technical, fits: checked.coverage.fits, tested: checked.coverage.tested, sourceFits: source.passed, fontHash, sourceFidelity: fidelity.status, generationAdmission }, updatedAt: now }
    })
  })
}
export async function updatePreparation(bucket: R2Bucket, upload: string, token: string, update: { complete?: boolean; error?: string; retryable?: boolean }, now = Date.now()) {
  if (update.complete) {
    const job = (await readPreparationJobs(bucket, upload)).find(j => j.leaseToken === token)
    assertLease(job, token, now); await currentInput(bucket, job)
  }
  return mutate(bucket, upload, jobs => {
    if (!jobs.some(j => j.leaseToken === token)) throw Error('Утрачено владение подготовкой компонента.')
    return jobs.map(job => {
    if (job.leaseToken !== token) return job
    assertLease(job, token, now)
    const next: PreparationJob = { ...job, leaseUntil: now + PREPARATION_LEASE_MS, updatedAt: now }
    if (update.complete) { if (!job.result) throw Error('Проверка компонента ещё не сохранена.'); next.status = 'complete' }
    if (update.error) { next.attempts++; next.reason = update.error.slice(0, 700); next.status = update.retryable !== false && next.attempts <= 2 ? 'retrying' : 'blocked'; next.retryAt = now + next.attempts * 15_000 }
    if (next.status !== 'running') { delete next.leaseToken; delete next.leaseUntil; delete next.owner }
    return next
    })
  })
}
/** Consumers must use this accessor, never a historic result key directly.
 * Geometry is evidence for the pinned content/constraints, not automatic
 * permission for the presentation generator to select this component. */
export async function readPreparedComponent(bucket: R2Bucket, upload: string, component: string) {
  await assertUploadActive(bucket, upload)
  const job = (await readPreparationJobs(bucket, upload)).find(j => j.componentId === component)
  if (!job?.result || job.status !== 'complete') return null
  await currentInput(bucket, job)
  return (await bucket.get(job.result.key))?.json<PreparedComponent>() ?? null
}
export async function commandPreparation(bucket: R2Bucket, upload: string, id: string, action: 'cancel' | 'retry') {
  return mutate(bucket, upload, jobs => jobs.map(job => {
    if (job.id !== id || ['unsupported', 'complete'].includes(job.status) || action === 'retry' && !['blocked', 'cancelled'].includes(job.status)) return job
    return { ...job, status: action === 'cancel' ? 'cancelled' : 'queued', attempts: action === 'retry' ? 0 : job.attempts, retryAt: undefined, reason: undefined, owner: undefined, leaseToken: undefined, leaseUntil: undefined, updatedAt: Date.now() }
  }))
}
