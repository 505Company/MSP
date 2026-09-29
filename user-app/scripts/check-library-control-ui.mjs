// Read-only check of an already generated control deck. All API mutations are blocked.
import { chromium, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const output = process.argv[2] ?? 'outputs/diagnostics/recipe-library-live'
const result = JSON.parse(await readFile(`${output}/result.json`, 'utf8'))
if (result.status !== 'ready') throw Error('Control generation has not finished')
const origin = new URL(result.url).origin
const get = async () => {
  const response = await fetch(`${origin}/api/projects/${result.projectId}/layout`)
  if (!response.ok) throw Error(await response.text())
  return response.json()
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const before = await get(), mutations = [], errors = []
const browser = await chromium.launch({ headless: true, ...(process.env.MSP_BROWSER_PATH ? { executablePath: process.env.MSP_BROWSER_PATH } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    if (route.request().method() === 'GET') return route.continue()
    mutations.push({ method: route.request().method(), url: route.request().url() })
    return route.abort()
  })
  await page.goto(result.url)
  await expect(page.locator('.ws-slide-open')).toHaveCount(3, { timeout: 30000 })
  for (const card of await page.locator('.ws-slide-open').all()) {
    await card.scrollIntoViewIfNeeded()
    await expect.poll(() => card.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  }
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height })
    await page.locator('.ws-slides-heading').scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${output}/ui-${name}.png`, fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: /^Открыть слайд 3:/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('opacity', '1')
    const box = await dialog.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
    await page.screenshot({ path: `${output}/viewer-${name}.png`, animations: 'disabled' })
    await page.getByRole('button', { name: 'Закрыть просмотр слайда' }).click()
  }
  await page.reload()
  await expect(page.locator('.ws-slide-open')).toHaveCount(3)
  await page.waitForTimeout(1500)
  const after = await get()
  const report = { projectId: result.projectId, mutations, errors, layoutUnchanged: hash(before) === hash(after), budgetBefore: before.budget, budgetAfter: after.budget,
    desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } }
  await writeFile(`${output}/ui-check.json`, JSON.stringify(report, null, 2))
  expect(mutations).toEqual([]); expect(errors).toEqual([]); expect(report.layoutUnchanged).toBe(true)
  console.log(JSON.stringify(report))
} finally { await browser.close() }
