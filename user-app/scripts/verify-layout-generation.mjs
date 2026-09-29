// Uses the ordinary background queue. Never modifies source, plans or reports.
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const [projectId, limitText, output = 'outputs/diagnostics/layout-generation', origin = 'http://127.0.0.1:5184'] = process.argv.slice(2)
const requestLimit = Number(limitText)
if (!/^[\w-]+$/.test(projectId ?? '') || !Number.isInteger(requestLimit) || requestLimit < 1 || requestLimit > 120) throw Error('Usage: verify-layout-generation.mjs <project-id> <max-new-requests> [output] [origin]')
const base = `${origin}/api/projects/${projectId}`
const get = async path => {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(30000) })
  const value = await r.json()
  if (!r.ok) throw Error(value.error ?? `HTTP ${r.status}`)
  return value
}
const source = async () => {
  const { project } = await get('')
  return { revision: project.revision, uploadId: project.uploadId, textHash: createHash('sha256').update(project.text).digest('hex') }
}
const before = await source(), start = Date.now(), initial = await get('/layout')
const queued = await fetch(base + '/generation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputId: initial.inputId, requestLimit, ...(process.env.MSP_RETRY === '1' ? { retry: true } : {}) }), signal: AbortSignal.timeout(30000) })
if (!queued.ok) throw Error((await queued.json()).error ?? 'Could not enqueue generation')
await mkdir(output, { recursive: true })
let previous = '', view, job
for (;;) {
  view = await get('/layout'); ({ job } = await get('/generation'))
  if (view.inputId !== initial.inputId) throw Error('Input changed during verification')
  const progress = JSON.stringify({ status: view.status, phases: view.slides.map(s => `${s.id}:${s.phase}:${s.round}`), budget: view.budget, job: job?.status })
  if (previous !== progress) { console.log(progress); previous = progress }
  if (view.status === 'ready' && job?.status === 'complete' || ['blocked', 'cancelled'].includes(job?.status)) break
  if (Date.now() - start > 20 * 60_000) throw Error('Verification timed out; durable job remains in its recorded state')
  await new Promise(resolve => setTimeout(resolve, 3000))
}
const after = await source()
if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Source changed during verification')
for (const slide of view.slides) {
  if (slide.previewRound === undefined) continue
  const response = await fetch(`${base}/layout/preview?inputId=${view.inputId}&slideId=${slide.id}&round=${slide.previewRound}&render=${view.renderVersion}`)
  if (!response.ok) throw Error(`Missing preview: ${slide.id}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (Buffer.from(bytes.subarray(0, 8)).toString('hex') !== '89504e470d0a1a0a') throw Error(`Invalid PNG: ${slide.id}`)
  await writeFile(`${output}/${slide.id}.png`, bytes)
}
const { next, ...summary } = view
void next
await writeFile(`${output}/summary.json`, JSON.stringify({ ...summary, source: before, job, elapsedMs: Date.now() - start }, null, 2))
console.log(JSON.stringify({ status: view.status, budget: view.budget, sourceUnchanged: true, error: job?.error, output }))
if (view.status !== 'ready') process.exitCode = 1
