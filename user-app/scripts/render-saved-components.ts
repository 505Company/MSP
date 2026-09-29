/** Read-only component/source comparison. No app entry point or model calls. */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { applicationSnapshot, saveJson } from './pixel-pilot-store'
import { readEditableCatalog } from '../lib/design-system/editable-analysis'
import { readSourceScene } from '../lib/design-system/source-scene'
import { sourceMembers } from '../lib/design-system/editable-structure'
import type { VisualManifest } from '../lib/digital-designer/visual-package'
const [id, output, ...selected] = process.argv.slice(2)
assert.match(id ?? '', /^[a-f\d-]{36}$/); assert.ok(output)
const store = applicationSnapshot(), catalog = await readEditableCatalog(store.bucket, id), visual = await store.read(`visual/${id}/manifest.json`) as VisualManifest
assert.ok(catalog)
const scene = readSourceScene(visual.snapshot), templates = catalog.families.flatMap(f => f.variants).filter(t => selected.includes(t.id))
assert.equal(templates.length, selected.length)
await mkdir(output, { recursive: true })
const bundle = await build({ stdin: { contents: "export {renderEditableHtml} from './lib/design-system/editable-render'; export {hydrateEditableHtml} from './lib/design-system/editable-hydrate'; export {ensureUploadFonts} from './browser/fonts';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'Audit', write: false })
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } }), blocked: string[] = [], results = []
  await page.addInitScript('globalThis.__name = value => value')
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/__component-audit__') return route.fulfill({ contentType: 'text/html', body: '<html><head></head><body></body></html>' })
    if (route.request().method() === 'GET' && url.origin === 'http://127.0.0.1:5184' && (/^\/fonts\//.test(url.pathname) || /^\/api\/(fonts\/|uploads\/[^/]+\/(assets\/|fonts$))/.test(url.pathname))) return route.continue()
    blocked.push(route.request().method() + ' ' + url.href); return route.abort()
  })
  await page.goto('http://127.0.0.1:5184/__component-audit__'); await page.addScriptTag({ content: bundle.outputFiles[0].text })
  for (const template of templates) {
    const issues = await page.evaluate(async ({ template, id }) => {
      const api = (window as unknown as { Audit: typeof import('../lib/design-system/editable-render') & typeof import('../lib/design-system/editable-hydrate') & typeof import('../browser/fonts') }).Audit
      await api.ensureUploadFonts(id); document.body.innerHTML = '<main id="component"></main>'
      const host = document.getElementById('component')!; host.style.cssText = 'width:900px;padding:24px;background:white;box-sizing:border-box'
      host.innerHTML = api.renderEditableHtml(template, template.data)
      const issues = await api.hydrateEditableHtml(host); await document.fonts.ready
      await Promise.all([...host.querySelectorAll('img')].map(i => i.decode()))
      return { issues, warnings: host.dataset.fontWarnings }
    }, { template, id })
    await page.locator('#component').screenshot({ path: `${output}/${template.id}.png` })
    const members = sourceMembers(template.sourceIds, scene), slide = visual.snapshot.slides.find(s => s.number === template.slide)!
    const x = Math.min(...members.map(m => m.bounds.x)), y = Math.min(...members.map(m => m.bounds.y))
    results.push({ id: template.id, slide: template.slide, kind: template.kind, name: template.name, issues,
      source: { width: slide.width, height: slide.height, bounds: { x, y, width: Math.max(...members.map(m => m.bounds.x + m.bounds.width)) - x, height: Math.max(...members.map(m => m.bounds.y + m.bounds.height)) - y } } })
  }
  await saveJson(`${output}/verification.json`, { results, blocked, modelRequests: 0, applicationWrites: 0 })
  assert.deepEqual(blocked, []); console.log(JSON.stringify({ rendered: results.length, blocked, modelRequests: 0 }))
} finally { await browser.close() }
