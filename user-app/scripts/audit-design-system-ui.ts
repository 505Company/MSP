/** Exercise the normal local preparation queue and source-only graph upgrade.
 * Model/import mutations are blocked; no source catalog or result is patched. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import type { PreparationJob } from '../lib/component-lab/preparation-jobs'
const id = process.argv[2], output = process.argv[3], origin = 'http://127.0.0.1:5184'
assert.match(id ?? '', /^[a-f\d-]{36}$/); assert.ok(output)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.MSP_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }), blocked: string[] = [], errors: string[] = []
 page.on('pageerror', e => errors.push(e.message))
 await page.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url())
  if (request.method() === 'GET') return route.continue()
  const data = request.postDataJSON()
  if (url.pathname === `/api/uploads/${id}/component-preparation` && data.action === 'ensure') return route.continue()
  if (url.pathname === `/api/uploads/${id}/reconstruction` && (data.nativeOnly === true || data.candidateId?.startsWith('graph-') && (data.qualification || data.partsQualification))) return route.continue()
  if (url.pathname.endsWith('/catalog') || url.pathname.endsWith('/processing') && !data.restart) {
   const read = await page.request.get(url.href); return route.fulfill({ response: read })
  }
  blocked.push(request.method() + ' ' + url.pathname); return route.abort()
 })
 const ensure = await page.request.post(`${origin}/api/uploads/${id}/component-preparation`, { data: { action: 'ensure' } })
 assert.ok(ensure.ok(), await ensure.text())
 let jobs: PreparationJob[] = (await ensure.json()).jobs
 const deadline = Date.now() + 180_000
 while (jobs.some(j => ['queued', 'running', 'retrying'].includes(j.status)) && Date.now() < deadline) {
  console.log('Local preparation', JSON.stringify({ complete: jobs.filter(j => j.status === 'complete').length, active: jobs.filter(j => ['queued', 'running', 'retrying'].includes(j.status)).length }))
  await new Promise(resolve => setTimeout(resolve, 5000))
  jobs = (await (await page.request.get(`${origin}/api/uploads/${id}/component-preparation`)).json()).jobs
 }
 const admitted = jobs.filter(j => j.status === 'complete' && j.result?.generationAdmission).length
 await page.goto(`${origin}/styles/${id}?section=components`)
 await expect(page.getByText(`Вариантов с проверенной адаптивностью: ${admitted}.`, { exact: true })).toBeVisible({ timeout: 30000 }).catch(async error => {
  await page.screenshot({ path: `${output}/gallery-failure.png`, fullPage: false })
  await writeFile(`${output}/gallery-failure.json`, JSON.stringify({ text: await page.locator('body').innerText(), errors, blocked, admitted }, null, 2)); throw error
 })
 await page.screenshot({ path: `${output}/components.png`, fullPage: false })
 const card = page.locator('.ed-card[data-component-id="b5-1"]')
 await expect(card).toContainText('Адаптивный · проверен'); await card.click()
 await expect(page.locator('#status')).toHaveText('Помещается', { timeout: 30000 })
 await page.screenshot({ path: `${output}/adaptive-card.png`, fullPage: false })
 await page.goto(`${origin}/styles/${id}?section=diagrams`)
 await expect(page.getByLabel('Схема из исходника').locator('option')).toHaveCount(2, { timeout: 60000 })
 await expect(page.getByLabel('Исходная схема', { exact: true })).toBeVisible()
 await page.screenshot({ path: `${output}/diagrams.png`, fullPage: false })
 const result = { admitted, supported: jobs.filter(j => j.status === 'complete').length, active: jobs.filter(j => ['queued', 'running', 'retrying'].includes(j.status)).length, errors, blocked, modelRequests: 0 }
 await writeFile(`${output}/verification.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result))
 assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
} finally { await browser.close() }
