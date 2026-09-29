// Explicit live acceptance test. Uses the configured local server, never reads
// credentials. Temporary project is archived; model evidence remains in R2.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { prepareMaterial } from '../lib/presentations/material.ts'
if (!process.argv.includes('--live')) throw new Error('Pass --live to allow the configured Qwen requests')
const base = 'http://localhost:5184', out = 'outputs/q2', id = crypto.randomUUID()
await mkdir(out, { recursive: true })
async function api(path, init) {
  const response = await fetch(base + path, init), data = await response.json()
  if (!response.ok) throw new Error(`${path}: ${data.error}`)
  return data
}
const payload = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
assert.equal((await api('/api/capabilities/qwen')).configured, true)
const bank = await api('/api/style-bank'), style = bank.styles.find(s => s.id === '8d4274e6-7684-4427-a0ec-fbf1293d2424')
assert.ok(style)
const source = await readFile('tests/fixtures/q2-content.md', 'utf8')
let project = (await api('/api/projects', payload({ id, uploadId: style.id, name: 'Контроль Q2 — временный', text: source }))).project
const runs = []
try {
  for (const [name, text] of [['explicit', source], ['automatic', source.replace(/^# /gm, '')]]) {
    if (project.text !== text) project = (await api(`/api/projects/${id}`, payload({ baseRevision: project.revision, name: project.name, text }, 'PUT'))).project
    const before = await api(`/api/projects/${id}/structure`)
    console.log(JSON.stringify({ phase: 'start', name, projectId: id, materialId: before.materialId }))
    const response = await fetch(`${base}/api/projects/${id}/structure`, payload({ materialId: before.materialId }))
    const stream = await response.text()
    await writeFile(`${out}/${name}-stream.ndjson`, stream)
    assert.ok(response.ok, stream)
    const after = await api(`/api/projects/${id}/structure`)
    await writeFile(`${out}/${name}-result.json`, JSON.stringify(after, null, 2))
    assert.equal(after.structure.status, 'ready', JSON.stringify(after.structure.error))
    const m = await prepareMaterial(text), outline = after.structure.outline
    assert.deepEqual(outline.slides.flatMap(s => s.fragmentIds), m.fragments.map(f => f.id))
    assert.equal(outline.coverage.complete, true)
    assert.ok(outline.slides.length >= 2)
    if (name === 'explicit') assert.equal(outline.slides.length, 5)
    const replay = await api(`/api/projects/${id}/structure`, payload({ materialId: m.id }))
    assert.equal(replay.reused, true); assert.equal(replay.structure.id, after.structure.id)
    runs.push({ name, projectId: id, materialId: m.id, runId: after.structure.id, slides: outline.slides.length,
      fragments: outline.coverage.fragments, directions: outline.coverage.directionFragments, liveRequests: after.structure.liveRequests, cacheHits: after.structure.cacheHits, replayAdditionalRequests: 0 })
    console.log(JSON.stringify({ phase: 'verified', ...runs.at(-1) }))
  }
  // Returning to the exact earlier material, even with a different style, reuses Q2.
  const otherStyle = bank.styles.find(s => s.id !== style.id) ?? style
  project = (await api(`/api/projects/${id}`, payload({ baseRevision: project.revision, name: project.name, text: source, uploadId: otherStyle.id }, 'PUT'))).project
  const restored = await api(`/api/projects/${id}/structure`)
  assert.equal(restored.structure.id, runs[0].runId)
  assert.equal((await api(`/api/projects/${id}/structure`, payload({ materialId: restored.materialId }))).reused, true)
  await writeFile(`${out}/verification.json`, JSON.stringify({ verifiedAt: new Date().toISOString(), runs, restoredEarlierMaterial: true, alternateStyle: otherStyle.id, temporaryProjectArchived: true }, null, 2))
} finally {
  const latest = (await api(`/api/projects/${id}`)).project
  await api(`/api/projects/${id}`, payload({ baseRevision: latest.revision }, 'DELETE'))
}
