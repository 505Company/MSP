// Inspect a completed live job using one temporary page; no API writes reach the server.
import { chromium, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const output = process.argv[2] ?? 'outputs/diagnostics/recipe-discovery-live'
const experiment = JSON.parse(await readFile(`${output}/experiment.json`, 'utf8'))
const origin = process.env.MSP_BASE_URL ?? 'http://127.0.0.1:5184'
const url = `${origin}/styles/${experiment.uploadId}?section=composition`
const get = async (endpoint = 'recipe-jobs') => {
  const response = await fetch(`${origin}/api/uploads/${experiment.uploadId}/${endpoint}`)
  if (!response.ok) throw Error(await response.text())
  return response.json()
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const before = await get(), job = before.jobs.find(job => job.id === experiment.jobId)
if (job?.status !== 'complete') throw Error('The live job must be complete before a read-only inspection')
const processingBefore = await get('processing')
if (processingBefore.job?.status !== 'complete') throw Error('The original import must already be complete')
const errors = [], mutations = []
const browser = await chromium.launch({ headless: true, ...(process.env.MSP_BROWSER_PATH ? { executablePath: process.env.MSP_BROWSER_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    if (route.request().method() === 'GET') return route.continue()
    const request = { method: route.request().method(), url: route.request().url(), body: route.request().postDataJSON() }
    mutations.push(request)
    if (request.url === `${origin}/api/uploads/${experiment.uploadId}/processing` && request.method === 'POST' && request.body?.restart === false) {
      // Return the actual saved completed job without sending the shell's no-op
      // delegation to the server or creating an artificial network-error banner.
      return route.fulfill({ status: 202, json: processingBefore })
    }
    return route.abort()
  })
  await page.goto(url)
  const section = page.getByRole('region', { name: 'Рецепты слайдов', exact: true })
  await expect(section).toContainText(`Запросы: ${job.budget.used} / ${job.budget.limit}`, { timeout: 30000 })
  await expect(page.getByText('Failed to fetch', { exact: true })).toHaveCount(0)
  await section.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `${output}/ui-desktop.png`, animations: 'disabled' })
  await section.getByText('Результаты проверки', { exact: true }).click()
  await expect(section.locator('.rd-evidence h4')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `${output}/evidence-desktop.png`, animations: 'disabled' })
  await section.getByText('Результаты проверки', { exact: true }).click()
  await page.reload()
  await expect(section).toContainText(`Запросы: ${job.budget.used} / ${job.budget.limit}`)
  const after = await get()
  // The legacy style shell delegates even a completed import on mount. Record
  // its intercepted readback; do not mistake it for a recipe start.
  const unexpectedMutations = mutations.filter(r => r.url !== `${origin}/api/uploads/${experiment.uploadId}/processing` || r.method !== 'POST' || r.body?.restart !== false)
  const processingUnchanged = hash(processingBefore.job) === hash((await get('processing')).job)
  const report = { url, jobId: job.id, technical: job.result?.technical, errors, interceptedMutations: mutations, completedImportDelegation: 'answered from saved GET; no POST reached server', unexpectedMutations, processingUnchanged,
    jobsUnchanged: hash(before.jobs) === hash(after.jobs), budgetBefore: job.budget, budgetAfter: after.jobs.find(j => j.id === job.id)?.budget,
    desktop: { width: 1440, height: 1000 } }
  await writeFile(`${output}/ui-check.json`, JSON.stringify(report, null, 2))
  expect(errors).toEqual([]); expect(unexpectedMutations).toEqual([]); expect(processingUnchanged).toBe(true); expect(report.jobsUnchanged).toBe(true)
  console.log(JSON.stringify(report))
} finally { await browser.close() }
