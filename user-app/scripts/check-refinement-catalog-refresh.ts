/** Read application JSON into an isolated bucket, then exercise the normal
 * local refresh path. No application writes, queue restart or model transport. */
import { applicationSnapshot, saveJson, digest } from './pixel-pilot-store'
import { memoryBucket } from '../tests/helpers/memory-bucket'
import { refreshRefinement } from '../lib/design-system/refinement'
import { readRefinementRegistry, readRefinementJob } from '../lib/design-system/refinement-storage'

const [upload, output] = process.argv.slice(2)
if (!/^[a-f0-9-]{36}$/.test(upload ?? '') || !output?.startsWith('outputs/')) throw Error('Usage: check-refinement-catalog-refresh.ts UPLOAD outputs/DIRECTORY')
const snapshot = applicationSnapshot(), copy = memoryBucket()
for (const row of snapshot.rows.filter(r => r.key.includes(upload) && r.key.endsWith('.json'))) await copy.bucket.put(row.key, JSON.stringify(await snapshot.read(row.key)))
const registry = await readRefinementRegistry(copy.bucket, upload)
if (!registry.pending) throw Error('No pending refinement')
const before = await readRefinementJob(copy.bucket, upload, registry.pending)
const protectedFiles = new Map([...copy.data].filter(([key]) => key.includes('/models/') || key.includes('/candidate-')).map(([key, value]) => [key, digest(value.value)]))
globalThis.fetch = async () => { throw Error('Audit cannot call network or a model') }
const after = await refreshRefinement(copy.bucket, upload, registry.pending)
const candidates = await Promise.all(after.tasks.filter(t => t.status === 'checking').map(async t => ({ slide: t.slide, candidate: await (await copy.bucket.get(t.candidateKey!))!.json() })))
const changedEvidence = [...protectedFiles].filter(([key, hash]) => digest(copy.data.get(key)?.value) !== hash).map(([key]) => key)
await saveJson(`${output}/refinement-refresh.json`, { before, after, protectedFiles: protectedFiles.size, changedEvidence, liveRequests: 0, applicationWrites: 0 })
await saveJson(`${output}/refinement-candidates.json`, candidates)
if (changedEvidence.length || JSON.stringify(before?.budget) !== JSON.stringify(after.budget)) throw Error('Refresh changed evidence or budget')
console.log(JSON.stringify({ before: before?.baseId, after: after.baseId, tasks: after.tasks.map(t => ({ slide: t.slide, status: t.status, error: t.error })), candidates: candidates.length, changedEvidence, budget: after.budget }, null, 2))
