import { test, expect, openTestProject } from './workspace-fixture'
import { controlPptx } from '../fixtures/control-pptx'
import { materialIdentity } from '../../lib/presentations/material-identity'

test('partial slides keep their positions; viewer and reopening saved results never generate', async ({ page, request }, info) => {
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  await page.goto('/styles'); await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({ name: 'Gallery.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await controlPptx() })
  await expect(page.locator('.cw-list button').first()).toBeVisible({ timeout: 60000 })
  const uploadId = new URL(page.url()).pathname.split('/').at(-1)!, inputId = 'd'.repeat(64)
  const preview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII='
  let complete = false, posts = 0, layoutReads = 0
  page.on('request', r => { if (/\/api\/projects\/[^/]+\/(structure|layout|generation|recipes|deck)/.test(r.url()) && r.method() === 'POST') posts++ })
  await page.route('**/api/projects/*/structure', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/structure$/, ''), current = (await (await request.get(path)).json()).project
    await route.fulfill({ json: { configured: true, materialId: await materialIdentity(current.text), structure: { status: 'ready' } } })
  })
  await page.route('**/api/projects/*/generation', route => route.fulfill({ json: { available: true, job: { inputId, status: complete ? 'complete' : 'running', progress: { detail: 'Создаём слайды: 2 из 3', completed: 2, total: 3 } } } }))
  await page.route('**/api/projects/*/layout', async route => {
    layoutReads++
    const path = new URL(route.request().url()).pathname.replace(/\/layout$/, ''), current = (await (await request.get(path)).json()).project
    await route.fulfill({ json: { configured: true, inputId, renderVersion: 'layout-dom-1', materialId: await materialIdentity(current.text), uploadId, status: 'working', next: null,
      slides: [1, 2, 3].map(n => ({ id: `slide-${n}`, title: `Раздел ${n}`, phase: n === 2 ? 'plan' : 'ready', ...(n === 2 ? {} : { previewRound: 0 }) })) } })
  })
  await page.route('**/api/projects/*/layout/preview?*', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(preview.split(',')[1], 'base64') }))
  await page.route('**/api/projects/*/slides', route => route.fulfill({ json: { presentation: { inputId, slides: [1, 2, 3].map(n => ({ id: `slide-${n}`, title: `Раздел ${n}`, image: preview, status: 'Готов' })) } } }))
  await openTestProject(page, request, uploadId, false)
  await expect(page.locator('.ws-slide-card')).toHaveCount(3)
  await expect(page.locator('.ws-slide-placeholder')).toHaveCount(1)
  const first = page.getByRole('button', { name: 'Открыть слайд 1: Раздел 1', exact: true })
  await first.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Предыдущий слайд' })).toBeDisabled()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('Слайд 3. Раздел 3')
  await expect(page.getByRole('button', { name: 'Следующий слайд' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(first).toBeFocused()
  expect(posts).toBe(0)
  complete = true
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Презентация готова: 3' })).toBeVisible()
  const previousReads = layoutReads
  await expect(page.locator('.ws-slide-open')).toHaveCount(3)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Открыть слайд 2: Раздел 2', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('Слайд 2. Раздел 2')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('slide-viewer-mobile.png') })
  await page.getByRole('button', { name: 'Закрыть просмотр слайда' }).click()
  await page.reload()
  await expect(page.locator('.ws-slide-open')).toHaveCount(3)
  expect(layoutReads).toBe(previousReads)
  expect(posts).toBe(0)
})
