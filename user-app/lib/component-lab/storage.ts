import { z } from 'zod'
import { rulesSchema, type ComponentProfile, type ComponentRules } from './contract'
import { applyRules } from './rules'
import { validateProof, type QualityProof } from './proof'

const metadata = { httpMetadata: { contentType: 'application/json' } }
export class ComponentRuleConflict extends Error {}
const saveSchema = z.object({ baseRevision: z.string().uuid().nullable(), source: z.string().length(64), rules: rulesSchema, proof: z.unknown().optional() }).strict()
export type RuleRevision = { id: string; parent: string | null; number: number; source: string; createdAt: string; rules: ComponentRules; profile: ComponentProfile; proof?: QualityProof; proofHash?: string; technical: 'passed' | 'failed' | 'not-tested'; generationAdmission: false }
export type RuleHistory = { head: string | null; versions: RuleRevision[] }
type Pointer = { head: string }
const prefix = (upload: string, p: ComponentProfile) => `component-rules/${z.string().uuid().parse(upload)}/${p.fingerprint}/${encodeURIComponent(p.id)}`
export async function readRuleHistory(bucket: R2Bucket, upload: string, p: ComponentProfile): Promise<RuleHistory> {
  const root = prefix(upload, p), pointer = await (await bucket.get(`${root}/current.json`))?.json<Pointer>()
  const versions: RuleRevision[] = []
  let id = pointer?.head
  while (id && versions.length < 20) {
    const r = await (await bucket.get(`${root}/versions/${z.string().uuid().parse(id)}.json`))?.json<RuleRevision>()
    if (!r || r.source !== p.fingerprint || r.profile.id !== p.id) throw Error('Сохранённая версия недоступна')
    versions.push(r); id = r.parent ?? undefined
  }
  return { head: pointer?.head ?? null, versions }
}
export async function saveRuleRevision(bucket: R2Bucket, upload: string, p: ComponentProfile, raw: unknown): Promise<RuleRevision> {
  const input = saveSchema.parse(raw), root = prefix(upload, p), file = await bucket.get(`${root}/current.json`), pointer = await file?.json<Pointer>()
  if (input.source !== p.fingerprint) throw Error('Исходник изменился. Откройте актуальный компонент.')
  if ((pointer?.head ?? null) !== input.baseRevision) throw new ComponentRuleConflict('В другой вкладке уже сохранена версия. Черновик сохранён; обновите страницу и проверьте изменения.')
  const previous = pointer ? await (await bucket.get(`${root}/versions/${pointer.head}.json`))?.json<RuleRevision>() : undefined
  const profile = await applyRules(p, input.rules), checked = input.proof ? await validateProof(profile, input.proof) : undefined
  const revision: RuleRevision = { id: crypto.randomUUID(), parent: input.baseRevision, number: (previous?.number ?? 0) + 1, source: p.fingerprint, createdAt: new Date().toISOString(), rules: input.rules, profile,
    ...(checked ? { proof: checked.proof, proofHash: checked.hash } : {}), technical: checked?.technical ?? 'not-tested', generationAdmission: false }
  await bucket.put(`${root}/versions/${revision.id}.json`, JSON.stringify(revision), { ...metadata, onlyIf: { etagDoesNotMatch: '*' } })
  const saved = await bucket.put(`${root}/current.json`, JSON.stringify({ head: revision.id }), { ...metadata, onlyIf: file ? { etagMatches: file.etag } : { etagDoesNotMatch: '*' } })
  if (!saved) throw new ComponentRuleConflict('Другая вкладка сохранила версию первой. Черновик сохранён; обновите страницу.')
  return revision
}
/** Integration boundary: pin this immutable revision in a future project
 * snapshot. No presentation pipeline is switched to it by this module. */
export async function readPinnedRuleProfile(bucket: R2Bucket, upload: string, source: ComponentProfile, revisionId: string) {
  const r = await (await bucket.get(`${prefix(upload, source)}/versions/${z.string().uuid().parse(revisionId)}.json`))?.json<RuleRevision>()
  if (!r || r.source !== source.fingerprint || r.technical !== 'passed' || !r.proof) throw Error('Версия не прошла проверку')
  const p = await applyRules(source, r.rules), checked = await validateProof(p, r.proof)
  if (p.fingerprint !== r.profile.fingerprint || checked.hash !== r.proofHash || checked.technical !== 'passed') throw Error('Версия не соответствует сохранённой проверке')
  return { revisionId: r.id, profile: p, proofHash: checked.hash }
}
