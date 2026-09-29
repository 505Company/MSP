/** Read-only replay of the saved source, backgrounds and native graph discovery.
 * No application scripts, storage writes or model requests are permitted. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { applicationSnapshot, saveJson } from './pixel-pilot-store'
import { memoryBucket } from '../tests/helpers/memory-bucket'
import { reconstructionState } from '../lib/design-system/reconstruction'
import { readBackgroundCatalog } from '../lib/design-system/background-storage'
import type { VisualManifest } from '../lib/digital-designer/visual-package'

const id = process.argv[2], output = process.argv[3]
assert.match(id ?? '', /^[a-f\d-]{36}$/); assert.ok(output)
await mkdir(output, { recursive: true })
const storage = applicationSnapshot(), { bucket } = memoryBucket()
for (const row of storage.rows.filter(r => r.key.includes(id) && r.key.endsWith('.json'))) await bucket.put(row.key, JSON.stringify(await storage.read(row.key)))
const visual = await storage.read(`visual/${id}/manifest.json`) as VisualManifest
const graphs = await reconstructionState(bucket, id), backgrounds = await readBackgroundCatalog(storage.bucket, id)
await saveJson(`${output}/discovery.json`, { total: graphs.total, pending: graphs.pending, existing: graphs.results.map(r => ({ id: r.id, status: r.status, reason: r.reason, slides: r.candidate.slides })) })
const nativeGraphs = [...graphs.pending, ...graphs.results.map(r => r.candidate)].filter(c => c.graph)
if (process.argv.includes('--expect-timelines')) assert.deepEqual(nativeGraphs.flatMap(c => c.slides).sort(), [26, 27], 'Both source timelines must reach graph qualification')
if (process.argv.includes('--discovery-only')) process.exit(0)
const bundle = await build({ stdin: { contents: "export {readSourceScene} from './lib/design-system/source-scene'; export {scenePreview,qualifyGraphic,qualifyGraphicParts} from './lib/design-system/reconstruction-browser'; export {assembleBackground} from './lib/design-system/backgrounds'; export {ensureUploadFonts} from './browser/fonts'; export {renderEditableHtml} from './lib/design-system/editable-render'; export {diagramHtml} from './lib/design-system/diagram-graph'; export {hydrateEditableHtml} from './lib/design-system/editable-hydrate';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'Audit', write: false })
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
 const page = await browser.newPage(), blocked: string[] = []
 await page.addInitScript('globalThis.__name = value => value')
 await page.route('**/*', async route => {
  const url = new URL(route.request().url())
  if (url.pathname === '/__source-audit__') return route.fulfill({ contentType: 'text/html', body: '<html><head></head><body></body></html>' })
  if (['GET', 'HEAD'].includes(route.request().method()) && url.origin === 'http://127.0.0.1:5184' && (/^\/fonts\//.test(url.pathname) || /^\/api\/(fonts\/|uploads\/[^/]+\/(assets\/|fonts$))/.test(url.pathname))) return route.continue()
  blocked.push(route.request().method() + ' ' + url.href); return route.abort()
 })
 await page.goto('http://127.0.0.1:5184/__source-audit__'); await page.addScriptTag({ content: bundle.outputFiles[0].text })
 for (const slide of process.argv.includes('--backgrounds-only') ? [] : visual.snapshot.slides) {
  const data = await page.evaluate(async ({ snapshot, id, slide }) => {
   const api = (window as unknown as { Audit: typeof import('../lib/design-system/source-scene') & typeof import('../lib/design-system/reconstruction-browser') & typeof import('../browser/fonts') }).Audit
   await api.ensureUploadFonts(id)
   const scene = api.readSourceScene(snapshot), roots = scene.roots.filter(e => scene.sources.get(e.id)?.slide === slide.number)
   return api.scenePreview(roots, slide.width, slide.height, id, undefined, 1024)
  }, { snapshot: visual.snapshot, id, slide })
  await writeFile(`${output}/slide-${String(slide.number).padStart(2, '0')}.png`, Buffer.from(data.split(',')[1], 'base64'))
 }
 for (const preset of backgrounds.presets) {
  const data = await page.evaluate(async ({ backgrounds, preset, id }) => {
   const api = (window as unknown as { Audit: typeof import('../lib/design-system/backgrounds') & typeof import('../lib/design-system/reconstruction-browser') }).Audit
   const scene = api.assembleBackground(backgrounds, preset.selection, preset)
   return api.scenePreview(scene.elements, scene.width, scene.height, id, undefined, 1024)
  }, { backgrounds, preset, id })
  await writeFile(`${output}/background-${preset.slides.join('-')}.png`, Buffer.from(data.split(',')[1], 'base64'))
 }
 const checks = []
 for (const candidate of process.argv.includes('--backgrounds-only') ? [] : nativeGraphs) {
  const result = await page.evaluate(async ({ candidate, id, fonts }) => {
   const api = (window as unknown as { Audit: typeof import('../lib/design-system/reconstruction-browser') }).Audit
   const r = { id: candidate.id, name: candidate.name, candidate, diagram: candidate.graph, fonts, description: '', status: 'pending-check' as const, reason: '' }
   const qualification = await api.qualifyGraphic(r, id), parts = await api.qualifyGraphicParts(r, id)
   return { candidate: candidate.id, slides: candidate.slides, qualification, parts }
  }, { candidate, id, fonts: visual.snapshot.fonts.map(f => f.family) })
  checks.push(result)
  await page.evaluate(async ({ graph, id }) => {
   const api = (window as unknown as { Audit: typeof import('../lib/design-system/diagram-graph') & typeof import('../lib/design-system/editable-hydrate') }).Audit
   document.body.innerHTML = '<main id="graph-audit"></main>'
   const host = document.getElementById('graph-audit')!
   host.style.cssText = `width:1000px;padding:24px;background:${graph.sourceSurface ?? graph.background ?? '#ffffff'}`
   host.innerHTML = api.diagramHtml(graph, id); await api.hydrateEditableHtml(host)
  }, { graph: candidate.graph!, id })
  await page.locator('#graph-audit').screenshot({ path: `${output}/${candidate.id}.png` })
 }
 await saveJson(`${output}/verification.json`, { graphChecks: checks, blocked, modelRequests: 0, applicationWrites: 0 })
 console.log(JSON.stringify({ sourceSlides: visual.snapshot.slides.length, backgrounds: backgrounds.presets.length, graphChecks: checks, blocked }))
 assert.deepEqual(blocked, [])
} finally { await browser.close() }
