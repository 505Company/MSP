// Opt-in live Q2→Q3 acceptance. No credential reads; archived temporary project.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { acceptedVariants, recipeFamilies } from '../lib/presentations/recipes/catalog.ts'
if (!process.argv.includes('--live')) throw new Error('Pass --live to allow configured Qwen requests')
const base = 'http://localhost:5184', out = 'outputs/q3', id = crypto.randomUUID()
await mkdir(out, { recursive: true })
const payload = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
async function api(path, init) {
  const response = await fetch(base + path, init), data = await response.json()
  if (!response.ok) throw new Error(`${path}: ${data.error}`)
  return data
}
assert.equal((await api('/api/capabilities/qwen')).configured, true)
const bank = await api('/api/style-bank'), style = bank.styles.find(s => s.id === '8d4274e6-7684-4427-a0ec-fbf1293d2424')
assert.ok(style)
const text = await readFile('tests/fixtures/q2-content.md', 'utf8')
await api('/api/projects', payload({ id, uploadId: style.id, name: 'Контроль Q3 — временный', text }))
let verification
try {
  const before = await api(`/api/projects/${id}/structure`)
  console.log(JSON.stringify({ phase: 'structure', projectId: id }))
  const q2 = await fetch(`${base}/api/projects/${id}/structure`, payload({ materialId: before.materialId }))
  await writeFile(`${out}/structure-stream.ndjson`, await q2.text()); assert.ok(q2.ok)
  const structure = await api(`/api/projects/${id}/structure`)
  await writeFile(`${out}/structure.json`, JSON.stringify(structure, null, 2))
  assert.equal(structure.structure.status, 'ready', JSON.stringify(structure.structure.error))
  const scope = await api(`/api/projects/${id}/recipes`)
  console.log(JSON.stringify({ phase: 'recipes', projectId: id, inputId: scope.inputId }))
  const input = { inputId: scope.inputId, materialId: scope.materialId, uploadId: scope.uploadId }
  const q3 = await fetch(`${base}/api/projects/${id}/recipes`, payload(input))
  const stream = await q3.text(); await writeFile(`${out}/recipe-stream.ndjson`, stream); assert.ok(q3.ok, stream)
  const result = await api(`/api/projects/${id}/recipes`)
  await writeFile(`${out}/result.json`, JSON.stringify(result, null, 2))
  assert.ok(['ready', 'blocked'].includes(result.plan.status), JSON.stringify(result.plan.error))
  assert.deepEqual(result.plan.selections.map(s => s.slideId), structure.structure.outline.slides.map(s => s.id))
  for (const s of result.plan.selections) if (s.recipeId !== null) {
    assert.ok(recipeFamilies.some(f => f.id === s.recipeId))
    assert.ok(acceptedVariants.some(e => e.id === s.variantId && e.recipe.id === s.recipeId))
  }
  const replay = await api(`/api/projects/${id}/recipes`, payload(input))
  assert.equal(replay.reused, true); assert.equal(replay.plan.id, result.plan.id)
  assert.equal((await api(`/api/projects/${id}/structure`)).structure.id, structure.structure.id)
  verification = { verifiedAt: new Date().toISOString(), projectId: id, status: result.plan.status,
    recipes: recipeFamilies.length, slideCount: result.plan.selections.length, selectedCount: result.plan.selections.filter(s => s.recipeId !== null).length,
    q2LiveRequests: structure.structure.liveRequests, q3LiveRequests: result.plan.liveRequests, q3CacheHits: result.plan.cacheHits,
    runId: result.plan.id, inputId: scope.inputId, catalogId: result.plan.catalogId, recipeCatalogHash: result.plan.recipeCatalogHash,
    replayAdditionalRequests: 0, fitVerified: result.plan.fitVerified }
  console.log(JSON.stringify({ phase: 'verified', ...verification }))
} finally {
  const project = (await api(`/api/projects/${id}`)).project
  await api(`/api/projects/${id}`, payload({ baseRevision: project.revision }, 'DELETE'))
  await writeFile(`${out}/verification.json`, JSON.stringify({ ...verification, projectId: id, temporaryProjectArchived: true }, null, 2))
}
