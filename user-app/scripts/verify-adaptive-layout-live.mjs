// An isolated project, byte-identical source. All semantic decisions go through Qwen.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const [sourceId, output = 'outputs/diagnostics/adaptive-layout-live', origin = 'http://127.0.0.1:5184'] = process.argv.slice(2)
if (!/^[a-f0-9-]{36}$/.test(sourceId ?? '')) throw Error('Usage: verify-adaptive-layout-live.mjs <source-project-id> [output] [origin]')
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const get = async path => { const r = await fetch(origin + path, { signal: AbortSignal.timeout(120000) }); if (!r.ok) throw Error(await r.text()); return r.json() }
const { project: source } = await get(`/api/projects/${sourceId}`)
const protectedIds = [sourceId, ...(process.env.MSP_PROTECTED_PROJECT_IDS ?? '').split(',').filter(Boolean)]
const preserve = async () => {
  const result = {}
  for (const id of protectedIds) { result[id] = { project: hash(await get(`/api/projects/${id}`)), layout: hash(await get(`/api/projects/${id}/layout`)) } }
  result.library = hash(await get(`/api/uploads/${source.uploadId}/recipe-library`))
  for (const round of ['pilot-1', 'structural-1', 'family-2', 'comparison-1']) result[round] = hash(await get(`/api/uploads/${source.uploadId}/recipe-pilot?round=${round}`))
  result.discovery = hash((await get(`/api/uploads/${source.uploadId}/recipe-jobs`)).jobs)
  return result
}
await mkdir(output, { recursive: true })
const manifestPath = `${output}/experiment.json`
let manifest
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
if (!manifest) {
  const maxNewRequests = Number(process.env.MSP_EXPERIMENT_LIMIT ?? 24)
  if (!Number.isInteger(maxNewRequests) || maxNewRequests < 4 || maxNewRequests > 24) throw Error('Experiment limit must be 4..24')
  manifest = { projectId: randomUUID(), sourceId, sourceRevision: source.revision, sourceHash: hash(source.text), uploadId: source.uploadId,
    name: process.env.MSP_EXPERIMENT_NAME ?? 'Автолейаут: контроль исходного материала',
    maxNewRequests, layoutRequestLimit: maxNewRequests - 2, structureAttempts: 0, createdAt: new Date().toISOString() }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' })
}
if (manifest.sourceId !== sourceId || manifest.sourceHash !== hash(source.text) || manifest.sourceRevision !== source.revision || manifest.uploadId !== source.uploadId || protectedIds.includes(manifest.projectId)) throw Error('Experiment source changed; no overwrite or new allowance')
const before = await preserve(), base = `/api/projects/${manifest.projectId}`
let baseline = before
try {
  baseline = JSON.parse(await readFile(`${output}/protected-before.json`, 'utf8'))
  if (JSON.stringify(baseline) !== JSON.stringify(before)) throw Error('Protected state changed since the original experiment checkpoint')
} catch (e) {
  if (e.code !== 'ENOENT') throw e
  await writeFile(`${output}/protected-before.json`, JSON.stringify(before, null, 2), { flag: 'wx' })
}
try {
  const previous = await readFile(`${output}/result.json`, 'utf8')
  await writeFile(`${output}/result-before-${Date.now()}.json`, previous, { flag: 'wx' })
} catch (e) { if (e.code !== 'ENOENT') throw e }
try {
  const created = await fetch(origin + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: manifest.projectId, name: manifest.name ?? 'Автолейаут: контроль исходного материала', uploadId: source.uploadId, text: source.text }) })
  if (!created.ok) throw Error(await created.text())
  let structure = await get(base + '/structure')
  if (structure.structure?.status !== 'ready') {
    if (manifest.structureAttempts >= 1) throw Error('One bounded Q2 attempt already spent; no automatic allowance reset')
    manifest.structureAttempts++; await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
    const response = await fetch(origin + base + '/structure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ materialId: structure.materialId }), signal: AbortSignal.timeout(900000) })
    if (!response.ok) throw Error(await response.text())
    await response.text(); structure = await get(base + '/structure')
  }
  await writeFile(`${output}/structure.json`, JSON.stringify(structure, null, 2))
  if (structure.structure?.status !== 'ready') throw Error('Q2 did not produce a complete outline')
  const initial = await get(base + '/layout')
  console.log(JSON.stringify({ projectId: manifest.projectId, url: `${origin}/projects/${manifest.projectId}`, structureRequests: structure.structure.liveRequests, slides: initial.slides.length }))
  if (initial.status !== 'ready' && initial.budget.used < manifest.layoutRequestLimit) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/verify-layout-generation.mjs', manifest.projectId, String(manifest.layoutRequestLimit), `${output}/generation`, origin], { stdio: 'inherit', env: process.env })
      child.once('error', reject); child.once('close', resolve)
    })
    if (code !== 0) console.log('Generation stopped with recorded failures; inspect the retained measurements and model decisions.')
  }
  const final = await get(base + '/layout'), { project } = await get(base)
  const sourceUnchanged = hash(project.text) === manifest.sourceHash
  await writeFile(`${output}/result.json`, JSON.stringify({ ...manifest, url: `${origin}/projects/${project.id}`, inputId: final.inputId, status: final.status,
    sourceUnchanged, structureRequests: structure.structure.liveRequests, layoutBudget: final.budget, slides: final.slides.map(s => ({ id: s.id, title: s.title, phase: s.phase, round: s.round, recipe: s.recipeSelection, error: s.error,
      adaptive: s.adaptiveFit && { passed: s.adaptiveFit.passed, trials: s.adaptiveFit.trials.length, selected: { columns: s.adaptiveFit.trials.at(-1).columns, fontStep: s.adaptiveFit.trials.at(-1).fontStep },
        components: s.adaptiveFit.trials.at(-1).components?.map(c => ({ id: c.id, templateId: c.templateId, fontFamily: c.fontFamily, scale: c.scale })) } })) }, null, 2))
  if (!sourceUnchanged) throw Error('Source modified during experiment')
  if (final.status !== 'ready') process.exitCode = 1
} finally {
  const after = await preserve(), unchanged = JSON.stringify(baseline) === JSON.stringify(after)
  await writeFile(`${output}/preservation.json`, JSON.stringify({ unchanged, before: baseline, after }, null, 2))
  if (!unchanged) throw Error('A protected project, recipe or previous budget changed')
}
