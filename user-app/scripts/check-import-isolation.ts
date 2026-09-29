/** Read-only replay. No HTTP, no provider credentials, no application writes. */
import assert from 'node:assert/strict'
import { applicationSnapshot, loadJson, saveJson, digest } from './pixel-pilot-store'
import { buildSourceSystem } from '../lib/design-system/source-system'
import { planSemanticScan } from '../lib/design-system/semantic-scan-plan'
import { readScanRun, validateScanReply, type SemanticSystem } from '../lib/design-system/semantic-scan'
import { readSourceScene, nativeListMarker } from '../lib/design-system/source-scene'
import { readModelRun } from '../lib/uploads/model-run'
import { rejectedModelResponse, isolateSemanticReply } from '../lib/design-system/semantic-isolation'
import { compileSemanticLibrary } from '../lib/design-system/semantic-library'
import type { VisualManifest } from '../lib/digital-designer/visual-package'

const [id, output] = process.argv.slice(2)
assert.match(id ?? '', /^[a-f0-9-]{36}$/)
assert.ok(output, 'Supply a diagnostic output directory')
const storage = applicationSnapshot(), visual = await storage.read(`visual/${id}/manifest.json`) as VisualManifest
const initial = await loadJson(`${output}/state.json`)
const scan = initial?.current?.runId ? await storage.read(`semantic-scans/${id}/runs/${initial.current.runId}.json`) as Awaited<ReturnType<typeof readScanRun>> : await readScanRun(storage.bucket, id)
assert.ok(scan?.resultKey, 'A saved scan result is required')
const semantic = await storage.read(scan.resultKey) as SemanticSystem
const system = buildSourceSystem(visual.snapshot), plan = planSemanticScan(visual.snapshot, system), scene = readSourceScene(visual.snapshot)
const replayed = []
for (const part of scan.parts.filter(p => p.status === 'failed' && p.kind === 'visual' && !p.id.startsWith('refine-'))) {
  const batch = plan.batches.find(b => b.id === part.id)!, prefix = `semantic-scans/${id}/parts/${part.id}`
  const run = await readModelRun(storage.bucket, prefix, part.runId)
  assert.ok(run)
  const raw = await rejectedModelResponse(storage.bucket, prefix, run), before = digest(raw)
  const styleIds = new Set(batch.nodes.flatMap(n => n.styleIds))
  const context = { snapshot: visual.snapshot, batch, styles: system.styles.filter(s => styleIds.has(s.id)), fixedMarkerIds: batch.nodes.filter(n => nativeListMarker(scene.records.get(n.id)!, scene)).map(n => n.id) }
  let result, isolated = false
  try { result = validateScanReply(raw, context) }
  catch { result = isolateSemanticReply(raw, context, validateScanReply); isolated = true }
  assert.equal(digest(raw), before, 'Provider response must remain immutable')
  semantic.batches = semantic.batches.filter(b => b.id !== part.id)
  semantic.batches.push({ id: part.id, runId: run.id, result })
  replayed.push({ part: part.id, slides: [...new Set(batch.nodes.map(n => n.slide))], isolated, coverage: result.coverage, molecules: result.reply.molecules.length, changes: result.normalizations.length })
}
const { library, metadata } = await compileSemanticLibrary(visual.snapshot, semantic)
const baseline = await loadJson(`${output}/before.json`), changes: string[] = []
for (const [key, hash] of Object.entries(baseline?.hashes ?? {})) if (digest(await storage.read(key)) !== hash) changes.push(key)
const isResponse = (key: string) => key.includes(id) && (/\/responses\/[^/]+\.json$/.test(key) || key.endsWith('/response.json'))
const addedResponses = storage.rows.map(r => r.key).filter(key => isResponse(key) && !Object.hasOwn(baseline?.hashes ?? {}, key))
const mutable = (key: string) => key.startsWith('processing-jobs/') || /\/(current|claim)\.json$/.test(key) || key.includes('/claims/')
const protectedChanges = changes.filter(key => !mutable(key))
const report = { uploadId: id, sourceRunId: scan.id, slides: visual.snapshot.slideCount, replayed, components: library.components.length, compounds: library.components.filter(c => c.kind === 'compound').length, coverage: metadata.coverage, assemblyIssues: library.assemblyIssues, protectedCount: Object.keys(baseline?.hashes ?? {}).filter(key => !mutable(key)).length, protectedChanges, concurrentStateChanges: changes.filter(mutable).length, concurrentNewResponseObjects: addedResponses.length, scriptModelCalls: 0, scriptApplicationWrites: 0 }
await saveJson(`${output}/verification.json`, report)
await saveJson(`${output}/derived-library.json`, { library, metadata })
assert.deepEqual(protectedChanges, [])
console.log(JSON.stringify(report, null, 2))
