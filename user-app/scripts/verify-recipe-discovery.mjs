import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const [uploadId, directory = 'outputs/diagnostics/recipe-discovery-live', origin = 'http://127.0.0.1:5184'] = process.argv.slice(2)
if (!/^[a-f0-9-]{36}$/.test(uploadId ?? '')) throw Error('Provide the source upload UUID')
const protectedIds = (process.env.MSP_PROTECTED_PROJECT_IDS ?? '').split(',').filter(Boolean)
if (!protectedIds.length || protectedIds.some(id => !/^[a-f0-9-]{36}$/.test(id))) throw Error('MSP_PROTECTED_PROJECT_IDS is required')
const output = resolve(directory), base = `/api/uploads/${uploadId}`
await mkdir(output, { recursive: true })
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const get = async path => {
  const response = await fetch(origin + path)
  if (!response.ok) throw Error(`${response.status}: ${await response.text()}`)
  return response.json()
}
const preserve = async () => {
  const projects = {}, pilots = {}
  for (const id of protectedIds) projects[id] = hash(await get(`/api/projects/${id}/layout`))
  for (const round of ['pilot-1', 'structural-1', 'family-2', 'comparison-1']) pilots[round] = hash(await get(`${base}/recipe-pilot?round=${round}`))
  const library = await get(`${base}/recipe-library`)
  return { projects, pilots, entries: library.entries }
}
const manifestPath = `${output}/experiment.json`
let manifest
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
if (!manifest) {
  manifest = { uploadId, jobId: randomUUID(), requestLimit: 24, createdAt: new Date().toISOString(), before: await preserve() }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' })
}
if (manifest.uploadId !== uploadId) throw Error('Saved experiment belongs to another source')
try {
  const response = await fetch(origin + base + '/recipe-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start', request: { id: manifest.jobId, limit: manifest.requestLimit } }) })
  if (!response.ok) throw Error(await response.text())
  let job, previous = ''
  for (let attempts = 0; attempts < 400; attempts++) {
    const state = await get(base + '/recipe-jobs')
    job = state.jobs.find(j => j.id === manifest.jobId)
    if (!job) throw Error('The queued job disappeared')
    const progress = JSON.stringify({ status: job.status, used: job.budget.used, detail: job.progress.detail, error: job.error })
    if (progress !== previous) { console.log(progress); previous = progress }
    if (['complete', 'blocked', 'cancelled'].includes(job.status)) break
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  const result = await get(`${base}/recipe-jobs?jobId=${manifest.jobId}`)
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2))
  for (const check of result.evidence?.checks ?? []) if (check.report) await writeFile(`${output}/${check.id}.png`, Buffer.from(check.report.preview.split(',')[1], 'base64'))
  console.log(JSON.stringify({ jobId: job.id, status: job.status, result: job.result, requests: job.budget }))
  if (job.status !== 'complete') process.exitCode = 1
} finally {
  const after = await preserve(), before = manifest.before
  const unchanged = hash(before.projects) === hash(after.projects) && hash(before.pilots) === hash(after.pilots) && before.entries.every(e => after.entries.some(a => hash(a) === hash(e)))
  await writeFile(`${output}/preservation.json`, JSON.stringify({ unchanged, before, after }, null, 2))
  if (!unchanged) throw Error('Protected presentation, pilot or library entry changed')
}
