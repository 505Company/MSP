/** Browser measurements of saved catalogues only. The request allowlist
 * prevents new model runs, upload retries and other application mutations. */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { saveJson } from './pixel-pilot-store'

const [id, output] = process.argv.slice(2)
assert.match(id ?? '', /^[a-f\d-]{36}$/); assert.ok(output)
await mkdir(output, { recursive: true })
const bundle = await build({ stdin: { contents: "export {qualifyEditableCatalog} from './lib/design-system/editable-qualification'; export {ensureUploadFonts} from './browser/fonts';", resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'Audit', write: false })
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage(), blocked: string[] = [], writes: string[] = []
  await page.addInitScript('globalThis.__name = value => value')
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), root = `/api/uploads/${id}/editable-system`
    if (url.pathname === '/__saved-component-check__') return route.fulfill({ contentType: 'text/html', body: '<html><head></head><body></body></html>' })
    if (url.origin === 'http://127.0.0.1:5184') {
      if (request.method() === 'GET' && (/^\/fonts\//.test(url.pathname) || /^\/api\/(fonts\/|uploads\/[^/]+\/(assets\/|fonts$))/.test(url.pathname) || url.pathname === root)) return route.continue()
      if (request.method() === 'POST' && (url.pathname === root + '/qualification' || url.pathname === root + '/refinements' && request.postDataJSON()?.action === 'recheck')) { writes.push(url.pathname); return route.continue() }
    }
    blocked.push(request.method() + ' ' + url.href); return route.abort()
  })
  await page.goto('http://127.0.0.1:5184/__saved-component-check__'); await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const result = await page.evaluate(async ({ id }) => {
    const api = (window as unknown as { Audit: typeof import('../lib/design-system/editable-qualification') & typeof import('../browser/fonts') }).Audit
    const request = async <T,>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(`/api/uploads/${id}/editable-system${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const value = await response.json() as T & { error?: string }; if (!response.ok) throw Error(value.error ?? 'Local qualification failed'); return value
    }
    await api.ensureUploadFonts(id)
    const state = await request<{ catalog: import('../lib/design-system/editable-contract').EditableCatalog }>(''), base = state.catalog
    if (!base) throw Error('Saved base catalog is unavailable')
    const qualification = await api.qualifyEditableCatalog(base)
    await request('/qualification', qualification)
    const reports = []
    let work = await request<import('../lib/design-system/refinement-recheck').PublishedRecheck>('/refinements', { action: 'recheck' })
    while (work.candidate) {
      // Native saved refinements use the ordinary HTML check. A raster replay
      // needs the separate image fidelity verifier, never a fabricated pass.
      if (work.candidate.catalog.families.some(f => f.variants.some(v => v.sourceRegion))) throw Error('Raster replay requires the production raster qualifier')
      const report = await api.qualifyEditableCatalog(work.candidate.catalog); reports.push(report)
      work = await request('/refinements', { action: 'recheck', report })
    }
    const after = await request<{ catalog: import('../lib/design-system/editable-contract').EditableCatalog }>('')
    return { beforeId: base.id, base: qualification, reports, complete: work.complete, after: after.catalog }
  }, { id })
  await saveJson(`${output}/verification.json`, { ...result, blocked, writes, modelRequests: 0 })
  assert.deepEqual(blocked, [])
  console.log(JSON.stringify({ before: result.beforeId, after: result.after.id, basePassed: result.base.checks.filter(c => c.passed).length, baseFailed: result.base.checks.filter(c => !c.passed), replayChecks: result.reports.map(r => ({ total: r.checks.length, passed: r.checks.filter(c => c.passed).length })), complete: result.complete, blocked, modelRequests: 0 }))
} finally { await browser.close() }
