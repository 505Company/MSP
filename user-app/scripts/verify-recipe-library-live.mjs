// Synthetic source only. All bindings, plans and rendered slides come from the ordinary API/worker.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const firstOnly = process.argv.includes('--first-family-only')
const [uploadId, output = 'outputs/diagnostics/recipe-library-live', origin = 'http://127.0.0.1:5184'] = process.argv.slice(2).filter(a => a !== '--first-family-only')
if (!/^[a-f0-9-]{36}$/.test(uploadId ?? '')) throw Error('Usage: verify-recipe-library-live.mjs <upload-id> [output] [origin] [--first-family-only]')
const protectedId = process.env.MSP_PROTECTED_PROJECT_ID
if (!protectedId || !/^[a-f0-9-]{36}$/.test(protectedId)) throw Error('MSP_PROTECTED_PROJECT_ID is required')
const get = async path => {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw Error(await response.text())
  return response.json()
}
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const preserve = async () => {
  const result = { readyPresentation: hash(await get(`/api/projects/${protectedId}/layout`)) }
  for (const round of ['pilot-1', 'structural-1', 'family-2', 'comparison-1']) result[round] = hash(await get(`/api/uploads/${uploadId}/recipe-pilot?round=${round}`))
  return result
}
await mkdir(output, { recursive: true })
let text = await readFile(new URL('./fixtures/recipe-library-control.txt', import.meta.url), 'utf8')
if (firstOnly) text = text.split('Слайд 3')[0].trim()
const manifestPath = resolve(output, 'experiment.json')
let manifest
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
if (!manifest) {
  manifest = { projectId: randomUUID(), uploadId, sourceHash: hash(text), synthetic: true, name: 'Контроль библиотеки рецептов', layoutRequestLimit: 18, createdAt: new Date().toISOString() }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' })
}
if (manifest.uploadId !== uploadId || manifest.sourceHash !== hash(text) || manifest.projectId === protectedId) throw Error('Control source changed; existing project will not be overwritten')
const library = await get(`/api/uploads/${uploadId}/recipe-library`), enabled = library.recipes.filter(r => r.status === 'enabled')
if (enabled.length < (firstOnly ? 1 : 2)) throw Error('Required qualified recipe families are not enabled')
const before = await preserve(), base = `/api/projects/${manifest.projectId}`
await writeFile(`${output}/protected-before.json`, JSON.stringify(before, null, 2))
try {
  const created = await fetch(origin + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: manifest.projectId, uploadId, name: manifest.name, text }) })
  if (!created.ok) throw Error(await created.text())
  const project = (await created.json()).project
  let structure = await get(base + '/structure')
  if (!structure.structure) {
    const response = await fetch(origin + base + '/structure', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: structure.materialId }), signal: AbortSignal.timeout(900000) })
    const result = await response.text()
    if (!response.ok || result.includes('"complete":false')) throw Error(`Content preparation failed: ${JSON.stringify((await get(base + '/structure')).structure?.error)}`)
    structure = await get(base + '/structure')
  }
  await writeFile(`${output}/structure.json`, JSON.stringify(structure, null, 2))
  if (structure.structure?.status !== 'ready') throw Error('Saved structure is not ready; no unbounded preparation retries')
  console.log(JSON.stringify({ projectId: project.id, structure: structure.structure.status, requests: structure.structure.liveRequests }))
  const initial = await get(base + '/layout'), remaining = manifest.layoutRequestLimit - initial.budget.used
  if (initial.status !== 'ready') {
    if (remaining <= 0) throw Error('Control generation allowance exhausted')
    const code = await new Promise((resolveCode, reject) => {
      const child = spawn(process.execPath, ['scripts/verify-layout-generation.mjs', project.id, String(remaining), `${output}/generation`, origin], { stdio: 'inherit', env: process.env })
      child.once('error', reject); child.once('close', resolveCode)
    })
    if (code !== 0) throw Error('Ordinary generation is not ready; diagnostics retained')
  }
  const final = await get(base + '/layout'), afterProject = (await get(base)).project
  if (afterProject.revision !== project.revision || hash(afterProject.text) !== manifest.sourceHash) throw Error('Control source changed during generation')
  const selections = final.slides.map(s => ({ slideId: s.id, phase: s.phase, recipe: s.recipeSelection, round: s.round }))
  const selectedIds = new Set(selections.map(s => s.recipe?.id))
  const expectedIds = enabled.map(r => r.id)
  const familiesSelected = expectedIds.every(id => selectedIds.has(id))
  const authorSelected = selections.some(s => s.recipe && !expectedIds.includes(s.recipe.id))
  await writeFile(`${output}/result.json`, JSON.stringify({ ...manifest, inputId: final.inputId, url: `${origin}/projects/${project.id}`, status: final.status,
    structureRequests: structure.structure.liveRequests, layoutBudget: final.budget, libraryRevision: library.revision,
    selections, familiesSelected, authorSelected, sourceUnchanged: true }, null, 2))
  console.log(JSON.stringify({ status: final.status, selections, familiesSelected, authorSelected, layoutBudget: final.budget, projectId: project.id }))
  if (!familiesSelected || !authorSelected) throw Error('The model did not exercise every intended branch; do not claim complete library coverage')
} finally {
  const after = await preserve(), unchanged = JSON.stringify(before) === JSON.stringify(after)
  await writeFile(`${output}/preservation.json`, JSON.stringify({ unchanged, before, after }, null, 2))
  if (!unchanged) throw Error('Protected presentation or recipe evidence changed')
}
