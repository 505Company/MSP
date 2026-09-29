/** Local, read-only audit of source resources versus the user-facing library. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { applicationSnapshot, digest, loadJson, saveJson } from './pixel-pilot-store'
import { catalogLibrary, listCatalog } from '../lib/design-system/catalog'
import { readEditableCatalog } from '../lib/design-system/editable-analysis'
import { readBackgroundCatalog } from '../lib/design-system/background-storage'
import { readReconstructionCatalog } from '../lib/design-system/reconstruction'
import { readCalibratedCatalog } from '../lib/design-system/calibration'
import { readSourceScene } from '../lib/design-system/source-scene'
import type { VisualManifest } from '../lib/digital-designer/visual-package'

const [uploadId, output, sourcePath] = process.argv.slice(2)
assert.match(uploadId ?? '', /^[a-f\d-]{36}$/); assert.ok(output)
const store = applicationSnapshot(), visual = await store.read(`visual/${uploadId}/manifest.json`) as VisualManifest
const saved = await catalogLibrary(store.bucket, uploadId), editable = await readEditableCatalog(store.bucket, uploadId)
assert.ok(saved && editable)
const backgrounds = await readBackgroundCatalog(store.bucket, uploadId), reconstruction = await readReconstructionCatalog(store.bucket, uploadId)
const scene = readSourceScene(visual.snapshot), graphics = []
for (let page = 1; ; page++) {
  const result = await listCatalog(store.bucket, uploadId, new URLSearchParams({ section: 'graphics', page: String(page) }))
  assert.ok(result); graphics.push(...result.items)
  if (page >= result.pages) break
}
const graphicIds = new Set(graphics.flatMap(g => g.occurrenceIds ?? [g.id]))
const passed = new Set(editable.qualification?.checks.filter(c => c.passed).map(c => c.id) ?? [])
const templates = editable.families.flatMap(f => f.variants).filter(t => passed.has(t.id))
const coverage = visual.snapshot.assets.map(asset => {
  const occurrences = [...scene.records.values()].filter(r => r.disposition === 'visible' && r.element.kind === 'raster' && r.element.assetId === asset.id)
  const components = saved.library.components.filter(c => c.source.assetIds.includes(asset.id))
  const sourceIds = new Set(occurrences.map(r => r.element.id))
  return { id: asset.id, origins: asset.origins.filter(p => p.startsWith('ppt/media/')), slides: [...new Set(occurrences.map(r => r.source.slide))],
    stored: store.rows.some(r => r.key === `visual/${uploadId}/${asset.id}`),
    graphics: components.filter(c => graphicIds.has(c.id)).map(c => c.id),
    components: templates.filter(t => t.sourceIds.some(id => sourceIds.has(id))).map(t => t.id),
    backgrounds: [...new Set(backgrounds.artworks.filter(a => a.assetIds.includes(asset.id)).flatMap(a => a.placements.map(p => p.slide)))] }
})
const uncovered = coverage.filter(a => a.slides.length && !a.graphics.length && !a.components.length && !a.backgrounds.length)
const chartSources = saved.library.components.filter(c => c.semantics.some(s => s.role === 'chart') && c.source.assetIds.length && !c.slots.length)
const missingCharts = chartSources.filter(c => !graphicIds.has(c.id)).map(c => c.id)
const before = await loadJson(`${output}/before.json`), calibratedBefore = await loadJson(`${output}/calibration-before.json`)
const calibrated = await readCalibratedCatalog(store.bucket, uploadId, saved.catalogId)
const protectedChanges = [
  ...(before && digest(before.catalog) !== digest(saved) ? ['source-catalog'] : []),
  // A normal local requalification may update this derived catalog identity.
  // Every underlying recognition/retention result must remain unchanged.
  ...(before && digest(before.reconstruction?.results ?? null) !== digest(reconstruction?.results ?? null) ? ['reconstruction-results'] : []),
  ...(calibratedBefore && digest(calibratedBefore) !== digest(calibrated) ? ['calibration'] : []),
]
const zip = sourcePath ? await JSZip.loadAsync(await readFile(sourcePath)) : null
const original = zip ? { file: sourcePath, slides: Object.keys(zip.files).filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).length,
  nativeCharts: Object.keys(zip.files).filter(k => /^ppt\/charts\/chart\d+\.xml$/.test(k)).length,
  media: Object.keys(zip.files).filter(k => /^ppt\/media\/[^/]+$/.test(k)).length } : null
const report = { uploadId, original, sourceSlides: visual.snapshot.slides.length, sourceResources: visual.assets.filter(a => a.origins.some(p => /^ppt\/media\//.test(p))).length,
  visibleNormalizedResources: coverage.filter(a => a.slides.length).length, graphics: graphics.map(g => ({ id: g.id, name: g.name, slides: g.slides, sourceOnly: !!g.sourceOnly })),
  backgroundPresets: backgrounds.presets.map(p => ({ id: p.id, slides: p.slides, layers: p.selection.layers.length })),
  backgroundPlacements: backgrounds.artworks.reduce((n, a) => n + a.placements.length, 0),
  diagrams: reconstruction?.results.filter(r => r.status === 'ready' && r.diagram).map(r => ({ id: r.id, slides: r.candidate.slides, nodes: r.diagram!.nodes.length, edges: r.diagram!.edges.length })),
  coverage, uncovered, missingCharts, protectedChanges, modelRequests: 0 }
await saveJson(`${output}/coverage.json`, report)
assert.deepEqual(protectedChanges, []); assert.deepEqual(uncovered, []); assert.deepEqual(missingCharts, [])
assert.ok(coverage.every(a => !a.slides.length || a.stored), 'A visible source image is missing from storage')
console.log(JSON.stringify({ sourceSlides: report.sourceSlides, original, sourceResources: report.sourceResources, visibleResources: report.visibleNormalizedResources, graphics: graphics.length,
  sourceOnly: graphics.filter(g => g.sourceOnly).length, backgroundPlacements: report.backgroundPlacements, backgroundPresets: report.backgroundPresets.length, diagrams: report.diagrams?.length,
  uncovered: uncovered.length, missingCharts, protectedChanges, modelRequests: 0 }))
