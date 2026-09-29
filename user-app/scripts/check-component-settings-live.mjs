import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const [upload, component] = process.argv.slice(2)
if (!upload || !component) throw Error('Pass upload and component IDs')
const origin = 'http://127.0.0.1:5184', folder = 'outputs/diagnostics/component-settings'
const endpoint = `${origin}/api/uploads/${encodeURIComponent(upload)}/editable-system`
const rulesEndpoint = `${origin}/api/uploads/${encodeURIComponent(upload)}/component-profiles?component=${encodeURIComponent(component)}`
const read = async url => { const r = await fetch(url); assert.ok(r.ok, `Read failed: ${r.status}`); return r.json() }
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const before = await read(endpoint), rulesBefore = await read(rulesEndpoint)
await mkdir(folder, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }), errors = [], writes = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    if (route.request().method() === 'GET') return route.continue()
    writes.push(route.request().url()); return route.abort()
  })
  await page.goto(`${origin}/styles/${encodeURIComponent(upload)}/components/${encodeURIComponent(component)}`)
  await page.locator('#preview [data-component-box]').waitFor({ timeout: 60000 })
  assert.equal(await page.locator('#status').innerText(), 'Помещается')
  assert.equal(await page.locator('#style').isVisible(), false)
  assert.ok((await page.locator('#bank-link').getAttribute('href')).startsWith(`/styles/${upload}?`))
  const fields = await page.locator('#preview [data-component-field]').evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, font: getComputedStyle(n).fontFamily })))
  const fontNote = await page.locator('#font-note').isVisible() ? await page.locator('#font-note').innerText() : null
  assert.ok(fields.length >= 2)
  await page.screenshot({ path: `${folder}/editor-desktop.png` })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.setViewportSize({ width: 1280, height: 1000 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: `${folder}/editor-1280.png` })
  const after = await read(endpoint), rulesAfter = await read(rulesEndpoint)
  assert.equal(hash(before.catalog), hash(after.catalog)); assert.equal(hash(rulesBefore), hash(rulesAfter))
  assert.deepEqual(errors, []); assert.deepEqual(writes, [])
  const summary = { upload, component, url: page.url(), fields, fontNote, unchangedCatalog: true, unchangedRules: true, sourceHash: hash(before.catalog), errors, writes }
  await writeFile(`${folder}/summary.json`, JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary, null, 2))
} finally { await browser.close() }
