/** Read-only source replay. Output goes to diagnostics; no model calls or source edits. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { applicationSnapshot, digest, loadJson, saveJson } from './pixel-pilot-store'
import { catalogLibrary } from '../lib/design-system/catalog'
import { readBackgroundCatalog } from '../lib/design-system/background-storage'
import { readReconstructionCatalog } from '../lib/design-system/reconstruction'
import type { VisualManifest } from '../lib/digital-designer/visual-package'
import type { ElementIR } from '../vendor/drag/src/core/model'
import type { GraphicSystem } from '../lib/design-system/graphic-components'

const uploadId = process.argv[2]
if (!/^[a-f0-9-]{36}$/.test(uploadId ?? '')) throw Error('Pass the upload UUID')
const output = process.argv[3] ?? `outputs/diagnostics/background-diagrams/${uploadId}`
await mkdir(output, { recursive: true })
const store = applicationSnapshot(), visual = await store.read(`visual/${uploadId}/manifest.json`) as VisualManifest
const saved = await catalogLibrary(store.bucket, uploadId), backgrounds = await readBackgroundCatalog(store.bucket, uploadId), reconstruction = await readReconstructionCatalog(store.bucket, uploadId)
assert.ok(saved && reconstruction)
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } }), errors: string[] = [], writes: string[] = []
// tsx/esbuild annotates names in serialized evaluation functions.
await page.addInitScript('globalThis.__name = (value) => value')
page.on('pageerror', e => errors.push(e.message))
await page.route('**/api/**', async route => {
  if (!['GET', 'HEAD'].includes(route.request().method())) {
    writes.push(route.request().url())
    // The completed-page shell normally makes an idempotent queue POST. Replace
    // it with a status GET in this diagnostic, never enqueue/restart a job.
    if (route.request().url().endsWith('/processing') && route.request().postDataJSON()?.restart === false) return route.fulfill({ response: await page.request.get(route.request().url()) })
    return route.abort()
  }
  return route.continue()
})
try {
  await page.goto(`http://127.0.0.1:5184/styles/${uploadId}?section=backgrounds`)
  await page.getByAltText('Предпросмотр фона').waitFor({ state: 'visible' })
  await page.screenshot({ path: `${output}/background-ui.png`, fullPage: true })
  const result = await page.evaluate(async ({ snapshot, library, catalog, results, uploadId }) => {
    const load = (path: string) => import(/* webpackIgnore: true */ path)
    const [{ readSourceScene }, { assembleBackground }, { scenePreview, graphicPixels, compareGraphicPixels }, { ensureUploadFonts }, { graphElements, diagramHtml }, { buildGraphicSystem, composeDiagram }, { hydrateEditableHtml }] = await Promise.all([load('/lib/design-system/source-scene.ts'), load('/lib/design-system/backgrounds.ts'), load('/lib/design-system/reconstruction-browser.ts'), load('/browser/fonts.ts'), load('/lib/design-system/diagram-graph.ts'), load('/lib/design-system/graphic-components.ts'), load('/lib/design-system/editable-hydrate.ts')])
    await ensureUploadFonts(uploadId)
    const scene = readSourceScene(snapshot), comparisons = [], pictures: Record<string, string> = {}
    for (const preset of catalog.presets) {
      const slide = preset.slides[0], ids = new Set(preset.selection.layers.flatMap(l => library.components.find(c => c.id === l.placementId)!.source.elementIds))
      const fill = [...scene.records.values()].find((r: { source: { slide: number }; element: ElementIR }) => r.source.slide === slide && r.element.name === 'Slide background') as { element: ElementIR } | undefined
      if (fill) ids.add(fill.element.id)
      const prune = (e: ElementIR): ElementIR[] => {
        if (ids.has(e.id)) return [e]
        if (!('children' in e)) return []
        const children = e.children.flatMap(prune)
        return children.length ? [{ ...e, children }] : []
      }
      const roots = scene.roots.filter((e: ElementIR) => scene.sources.get(e.id)?.slide === slide).flatMap(prune)
      const source = await scenePreview(roots, preset.width, preset.height, uploadId, undefined, 1024)
      const composed = assembleBackground(catalog, preset.selection, preset)
      const rendered = await scenePreview(composed.elements, composed.width, composed.height, uploadId, undefined, 1024)
      const comparison = compareGraphicPixels(await graphicPixels(source), await graphicPixels(rendered))
      comparisons.push({ slides: preset.slides, ...comparison })
      pictures[`source-background-${slide}`] = source; pictures[`background-${slide}`] = rendered
    }
    const first = catalog.presets[0]
    for (const size of [{ width: 900, height: 900 }, { width: 720, height: 1280 }]) {
      const assembled = assembleBackground(catalog, first.selection, size)
      pictures[`background-${size.width}x${size.height}`] = await scenePreview(assembled.elements, size.width, size.height, uploadId, undefined, 1024)
    }
    const diagrams = []
    for (const r of results.filter(r => r.diagram && r.status === 'ready')) {
      const g = r.diagram!, elements = graphElements(g)
      const rendered = await scenePreview(elements, g.width, g.height, uploadId, undefined, 1024)
      pictures[`diagram-${r.candidate.slides[0]}`] = rendered
      const source = await scenePreview(g.sourceElements!, g.width, g.height, uploadId, undefined, 1024)
      diagrams.push({ slides: r.candidate.slides, nodes: g.nodes.filter(n => n.kind === 'block').length, edges: g.edges.length, ...compareGraphicPixels(await graphicPixels(source), await graphicPixels(rendered)) })
    }
    const system: GraphicSystem = buildGraphicSystem({ results })
    const group = system.groups.find(g => g.kind === 'diagram'), parts = system.components.filter(c => group?.componentIds.includes(c.id))
    if (!parts.some(p => p.role === 'block' && p.slots.length === 1 && !p.source.assetIds.length) || !parts.some(p => p.edge)) {
      return { comparisons, diagrams, newDiagram: { supported: false, reason: 'No verified single-field block and connector pair; source diagrams checked separately' }, pictures }
    }
    const graph = composeDiagram(system, { nodes: [{ id: 'start', text: 'Заявка' }, { id: 'a', text: 'Проверка данных' }, { id: 'b', text: 'Согласование' }, { id: 'finish', text: 'Решение' }], edges: [{ from: 'start', to: 'a' }, { from: 'start', to: 'b' }, { from: 'a', to: 'finish' }, { from: 'b', to: 'finish' }] })
    const host = document.createElement('div'); host.innerHTML = diagramHtml(graph, uploadId)
    const issues = await hydrateEditableHtml(host), overflow = host.querySelectorAll('[data-native-overflow="true"]').length
    pictures['new-diagram'] = await scenePreview(graphElements(graph), graph.width, graph.height, uploadId, undefined, 1024)
    return { comparisons, diagrams, newDiagram: { supported: true, nodes: graph.nodes.length, edges: graph.edges.length, issues, overflow }, pictures }
  }, { snapshot: visual.snapshot, library: saved.library, catalog: backgrounds, results: reconstruction.results, uploadId })
  for (const [name, data] of Object.entries(result.pictures)) await writeFile(`${output}/${name}.png`, Buffer.from(data.split(',')[1], 'base64'))
  const checks = { comparisons: result.comparisons, diagrams: result.diagrams, newDiagram: result.newDiagram }
  await page.getByRole('navigation', { name: 'Раздел дизайн-системы' }).getByRole('link', { name: 'Схемы', exact: true }).click()
  await page.getByLabel('Исходная схема', { exact: true }).locator('[aria-busy="false"]').waitFor({ state: 'attached' })
  await page.screenshot({ path: `${output}/diagrams-ui.png`, fullPage: true })
  const protectedBefore = await loadJson('outputs/diagnostics/vk-background-diagrams/before.json')
  const protectedChanges: string[] = []
  if (protectedBefore?.uploadId === uploadId) for (const [key, hash] of Object.entries(protectedBefore.protectedHashes)) if (digest(await store.read(key)) !== hash) protectedChanges.push(key)
  const report = { uploadId, sourceCatalogId: saved.catalogId, fills: backgrounds.fills.map(f => f.name), artworks: backgrounds.artworks.length, presets: backgrounds.presets.length, ...checks, errors, blockedWrites: writes, protectedChecked: protectedBefore?.uploadId === uploadId ? Object.keys(protectedBefore.protectedHashes).length : 0, protectedChanges, modelCalls: 0 }
  await saveJson(`${output}/verification.json`, report)
  assert.ok(checks.comparisons.every(c => c.pixelError < .000001), 'A background differs from its original source layers')
  assert.ok(checks.diagrams.every(c => c.pixelError === 0), 'A source graph changed')
  if (checks.newDiagram.supported) { assert.equal(checks.newDiagram.overflow, 0); assert.deepEqual(checks.newDiagram.issues, []) }
  assert.deepEqual(errors, []); assert.ok(writes.every(url => url.endsWith('/processing')), 'Unexpected write attempt'); assert.deepEqual(protectedChanges, [])
  console.log(JSON.stringify(report))
} finally { await browser.close() }
