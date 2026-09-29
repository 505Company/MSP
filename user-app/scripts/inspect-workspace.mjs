import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const [id, out = 'outputs/project-inputs'] = process.argv.slice(2)
assert.match(id ?? '', /^[a-f0-9-]{36}$/)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.MSP_BROWSER_PATH ? { executablePath: process.env.MSP_BROWSER_PATH } : {}) })
try {
  const page = await browser.newPage({ baseURL: 'http://localhost:5184', viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const json = async path => (await page.request.get(path)).json()
  const bank = await json('/api/style-bank'), projects = await json('/api/projects')
  const originalProject = await json(`/api/projects/${id}`), originalSlide = await json(`/api/projects/${id}/slide`)
  assert.deepEqual(bank.styles.map(s => s.id), [id]); assert.equal(projects.projects.length, 1)
  await page.goto('/curator')
  await expect(page).toHaveURL('http://localhost:5184/')
  await expect(page.locator('#presentation-style')).toHaveValue(id)
  await page.locator('.ws-style-cover img').evaluate(img => img.decode())
  await page.screenshot({ path: `${out}/home.png`, fullPage: true })
  const viewports = []
  for (const [route, file] of [['/projects', 'new-project'], [`/projects/${id}`, 'vk-project']]) {
    await page.goto(route)
    await expect(page.locator('#presentation-style')).toHaveValue(id)
    await expect(page.locator('#presentation-content')).toHaveValue(file === 'new-project' ? '' : originalProject.project.text)
    await page.locator('.ws-style-cover img').evaluate(img => img.decode())
    assert.equal(await page.locator('.cw-list,.ws-project-tabs,.ws-project-card,.slide-composer,pre,code,details').count(), 0)
    assert.equal(await page.getByRole('button', { name: /Скачать PPTX|Сохранить содержание|Добавить выбранный компонент/ }).count(), 0)
    for (const width of [1440, 1024, 720, 390, 320]) {
      await page.setViewportSize({ width, height: width < 650 ? 844 : 1000 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${route} / ${width}`)
      await expect(page.locator('#presentation-content')).toBeVisible()
      await expect(page.locator('#presentation-style')).toBeVisible()
      viewports.push({ route, width, noHorizontalOverflow: true })
      if (width === 1440 || width === 390) {
        await page.evaluate(() => scrollTo(0, 0))
        await page.screenshot({ path: `${out}/${file}-${width}.png`, fullPage: true })
      }
    }
  }
  assert.deepEqual(await json(`/api/projects/${id}`), originalProject)
  assert.deepEqual(await json(`/api/projects/${id}/slide`), originalSlide)
  assert.deepEqual(errors, [])
  const result = { bankEntries: bank.styles.length, projects: projects.projects.length, savedInstances: originalSlide.slide.document.items.length, inputsUnchanged: true, savedSlidePreserved: true, manualEditor: false, viewports, pageErrors: errors }
  await writeFile(`${out}/verification.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { await browser.close() }
