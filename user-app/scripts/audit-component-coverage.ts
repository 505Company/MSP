/** Inventory only: reads the existing local store; writes diagnostics, never R2. */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { applicationSnapshot, digest, saveJson } from './pixel-pilot-store'
import { readEditableCatalog } from '../lib/design-system/editable-analysis'
import { catalogLibrary, listCatalog } from '../lib/design-system/catalog'
import { readReconstructionCatalog } from '../lib/design-system/reconstruction'
import { buildGraphicSystem } from '../lib/design-system/graphic-components'
import { sourceCandidate } from '../lib/component-lab/source'
import type { EditableTemplate } from '../lib/design-system/editable-contract'
import type { VisualManifest } from '../lib/digital-designer/visual-package'

const [upload, output = 'outputs/diagnostics/component-coverage.json'] = process.argv.slice(2)
if (!upload) throw Error('Usage: node --import tsx scripts/audit-component-coverage.ts UPLOAD_ID [OUTPUT_JSON]')
const snapshot = applicationSnapshot(), catalog = await readEditableCatalog(snapshot.bucket, upload)
assert(catalog, 'Editable catalog unavailable')
const hash = digest(catalog), visual = await snapshot.read(`visual/${upload}/manifest.json`) as VisualManifest
const library = await catalogLibrary(snapshot.bucket, upload)
const native = await listCatalog(snapshot.bucket, upload, new URLSearchParams({ section: 'components' }))
const graphic = await listCatalog(snapshot.bucket, upload, new URLSearchParams({ section: 'graphics' }))
const reconstruction = await readReconstructionCatalog(snapshot.bucket, upload)
const parts = buildGraphicSystem({ results: reconstruction?.results ?? [] })
const variants = catalog.families.flatMap(f => f.variants), passed = new Set(catalog.qualification?.checks.filter(c => c.passed).map(c => c.id) ?? [])
const start = performance.now()
const candidates = await Promise.all(variants.map(t => sourceCandidate(t, catalog.id)))
const adaptationMs = performance.now() - start
const byId = new Map(candidates.map(c => [c.template.id, c]))
const section = (kind: string) => kind === 'text' ? 'typography-only' : kind === 'graphic' ? 'assets' : ['composition', 'diagram'].includes(kind) ? 'composition' : 'components'
const effective = catalog.families.map(f => ({ ...f, variants: f.variants.filter(t => passed.has(t.id)) })).filter(f => f.variants.length)
const groups = Object.fromEntries(['components', 'composition', 'typography-only', 'assets'].map(s => {
  const families = effective.filter(f => section(f.kind) === s)
  return [s, { cards: families.length, variants: families.reduce((n, f) => n + f.variants.length, 0) }]
}))
const summarize = (t: EditableTemplate) => ({ id: t.id, name: t.name, slide: t.slide, kind: t.kind, section: section(t.kind), sourceIds: t.sourceIds, dataStatus: t.dataStatus,
  htmlPassed: passed.has(t.id), nativeLayout: !!t.sourceLayout, nativeObject: !!t.nativeObject,
  adaptive: byId.get(t.id)?.profile?.family ?? null, reason: byId.get(t.id)?.reason ?? null })
const eligible = candidates.filter(c => c.profile && passed.has(c.template.id))
const report = {
  upload, catalogId: catalog.id, snapshotId: visual.snapshot.sourceId, generatedAt: new Date().toISOString(),
  counts: { sourceSlides: visual.snapshot.slideCount, sourceObjects: visual.snapshot.elements.length, originalMedia: visual.assets.filter(a => a.origins.some(o => o.startsWith('ppt/media/'))).length,
    families: catalog.families.length, variants: variants.length, htmlPassed: passed.size, sections: groups, legacyComponentCards: native?.total ?? 0, legacyGraphicCards: graphic?.total ?? 0,
    diagramParts: parts.components.filter(c => c.role !== 'pattern-piece').length, patternParts: parts.components.filter(c => c.role === 'pattern-piece').length,
    adaptiveVariants: eligible.length, adaptiveRepresentativeCards: effective.filter(f => section(f.kind) === 'components' && byId.get(f.variants[0].id)?.profile).length,
    sourceNativeDefinitions: library?.library.components.length ?? 0 },
  profileDerivation: { runtime: 'Node; no browser font/pixel measurements', milliseconds: Math.round(adaptationMs * 100) / 100, candidates: variants.length, modelRequests: 0 },
  families: catalog.families.map(f => ({ id: f.id, name: f.name, kind: f.kind, section: section(f.kind), gallerySample: f.variants.find(t => passed.has(t.id))?.id ?? null, variants: f.variants.map(summarize) })),
  htmlRejected: catalog.qualification?.checks.filter(c => !c.passed), exclusions: catalog.excluded,
  pages: visual.snapshot.slides.map(slide => ({ slide: slide.number, warnings: slide.warnings, templates: variants.filter(t => t.slide === slide.number).map(summarize),
    coverageNote: catalog.coverage.find(c => c.slide === slide.number)?.note ?? null })),
  reconstructedGroups: parts.groups,
  reconstructedResults: reconstruction?.results.map(r => ({ id: r.id, slides: r.candidate.slides, status: r.status, kind: r.pattern ? 'pattern' : r.diagram ? 'diagram' : 'other', qualification: r.qualification, partsQualification: r.partsQualification })),
  limitation: 'Counts and source IDs prove storage and selection only, not visual fidelity or arbitrary content adaptation.',
}
assert.equal(digest(await readEditableCatalog(applicationSnapshot().bucket, upload)), hash, 'Catalog changed during inventory')
await saveJson(output, report)
console.log(JSON.stringify({ output, counts: report.counts, profileDerivation: report.profileDerivation, unchangedCatalog: true }, null, 2))
