/** Enqueue through the product API, observe the supervised worker without any
 * open editor, and save evidence only under diagnostics. No model requests. */
import assert from 'node:assert/strict'
import { applicationSnapshot, digest, saveJson } from './pixel-pilot-store'
import type { publicPreparationJob, PreparedComponent } from '../lib/component-lab/preparation-jobs'
type Job = ReturnType<typeof publicPreparationJob>

const [upload, output = 'outputs/diagnostics/component-preparation'] = process.argv.slice(2)
assert(upload && /^[a-f\d-]{36}$/.test(upload), 'Usage: verify-component-preparation.ts UPLOAD OUTPUT')
const origin = 'http://127.0.0.1:5184', endpoint = `${origin}/api/uploads/${upload}/component-preparation`
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) }), v = await r.json()
  assert(r.ok, JSON.stringify(v)); return v as T
}
async function originals() {
  const snapshot = applicationSnapshot(), rows = snapshot.rows.filter(r => r.key.includes(upload) && (r.key.startsWith('editable-systems/') || r.key.startsWith('component-rules/')))
  return Promise.all(rows.map(async r => [r.key, digest(await snapshot.read(r.key))]))
}
const before = await originals(), started = Date.now(), states: { at: number; counts: Record<string, number> }[] = []
const admitted = await json<{ jobs: Job[] }>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ensure' }) })
let jobs = admitted.jobs
while (Date.now() - started < 240000) {
  const current = await json<{ jobs: Job[] }>(endpoint); jobs = current.jobs
  const counts: Record<string, number> = {}
  jobs.forEach(j => { counts[j.status] = (counts[j.status] ?? 0) + 1 })
  if (JSON.stringify(counts) !== JSON.stringify(states.at(-1)?.counts)) { states.push({ at: Date.now() - started, counts }); console.log(JSON.stringify(states.at(-1))) }
  if (!jobs.some(j => ['queued', 'running', 'retrying'].includes(j.status))) break
  await new Promise(resolve => setTimeout(resolve, 3000))
}
const results = []
for (const job of jobs.filter(j => j.status === 'complete')) {
  const { prepared } = await json<{ prepared: PreparedComponent | null }>(`${endpoint}?component=${encodeURIComponent(job.componentId)}`)
  assert(prepared); await saveJson(`${output}/${job.componentId}.json`, prepared)
  results.push({ id: job.componentId, family: prepared.profile.family, technical: prepared.technical, coverage: prepared.coverage, sourcePassed: prepared.source.passed, fidelity: prepared.fidelity, generationAdmission: prepared.generationAdmission, fontReplacements: prepared.rules.fontReplacements ?? [], ruleRevision: prepared.ruleRevision })
}
assert.deepEqual(await originals(), before, 'The original catalog or user rules changed')
const summary = { upload, version: jobs[0]?.version, elapsedMs: Date.now() - started, states, jobs, results, sourceAndRulesUnchanged: true, modelRequests: 0, limitation: 'Source-property fidelity and technical measurements do not constitute artistic approval or pixel-identical reproduction.' }
await saveJson(`${output}/run.json`, summary)
console.log(JSON.stringify({ output, elapsedMs: summary.elapsedMs, supported: results.length, passed: results.filter(r => r.technical === 'passed').length, unchanged: true }))
assert(!jobs.some(j => ['queued', 'running', 'retrying', 'blocked'].includes(j.status)), 'The queue did not finish cleanly; see run.json')
