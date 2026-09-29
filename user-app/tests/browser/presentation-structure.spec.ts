import { test, expect, openTestProject } from './workspace-fixture'
import { controlPptx } from '../fixtures/control-pptx'
import { materialIdentity } from '../../lib/presentations/material-identity'
import { layoutInput } from '../fixtures/layout'

test('legacy structure reopens unchanged; only explicit generation switches to the current MSP engine', async ({ page, request }, info) => {
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  await page.goto('/styles'); await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({ name: 'Проверка структуры.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await controlPptx() })
  await expect(page.locator('.cw-list button').first()).toBeVisible({ timeout: 60000 })
  const uploadId = new URL(page.url()).pathname.split('/').at(-1)!
  await page.goto('/styles'); await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({ name: 'Другой стиль.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await controlPptx() })
  await expect(page.locator('.cw-list button').first()).toBeVisible({ timeout: 60000 })
  const otherStyle = new URL(page.url()).pathname.split('/').at(-1)!
  // Q4 rendering has separate browser coverage; this fixture isolates Q2/Q3 orchestration.
  await page.route('**/api/projects/*/deck', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/deck$/, '')
    const current = (await (await request.get(path)).json()).project
    await route.fulfill({ json: { inputId: 'c'.repeat(64), materialId: await materialIdentity(current.text), uploadId: current.uploadId,
      state: { status: 'ready', slides: [{}, {}, {}] }, next: null } })
  })
  let starts = 0, recipeStarts = 0, ready = false
  const fail = false, recipeFail = false
  const plans = new Set<string>()
  // Rendering/review have their own fixture. This one checks Q2 orchestration
  // with either recipe switch, including failed requests and style changes.
  await page.route('**/api/projects/*/layout', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/layout$/, ''), current = (await (await request.get(path)).json()).project
    const materialId = await materialIdentity(current.text), key = `${current.uploadId}:${materialId}`
    if (route.request().method() === 'POST') {
      recipeStarts++
      if (recipeFail) await route.fulfill({ status: 503, json: { error: 'Не удалось подобрать оформление. Содержание сохранено.' } })
      else { plans.add(key); await route.fulfill({ json: { accepted: true } }) }
      return
    }
    const input = layoutInput(); input.uploadId = current.uploadId
    const complete = plans.has(key), slides = Array.from({ length: 3 }, (_, i) => ({ id: `slide-${i + 1}`, title: `Slide ${i + 1}`, phase: complete ? 'ready' : 'plan', round: 0 }))
    await route.fulfill({ json: { configured: true, inputId: 'b'.repeat(64), materialId, uploadId: current.uploadId, status: complete ? 'ready' : 'working', slides, next: complete ? null : { ...slides[0], input } } })
  })
  await page.route('**/api/projects/*/recipes', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/recipes$/, '')
    const current = (await (await request.get(path)).json()).project
    const materialId = await materialIdentity(current.text), key = `${current.uploadId}:${materialId}`
    if (route.request().method() === 'POST') {
      recipeStarts++
      if (recipeFail) await route.fulfill({ status: 503, json: { error: 'Не удалось подобрать оформление. Содержание сохранено.' } })
      else { plans.add(key); await route.fulfill({ status: 202, contentType: 'application/x-ndjson', body: '{"complete":true}\n' }) }
    } else await route.fulfill({ json: { configured: true, inputId: 'b'.repeat(64), materialId, uploadId: current.uploadId,
      plan: plans.has(key) ? { status: 'ready', selections: [{}, {}, {}] } : null } })
  })
  await page.route('**/api/projects/*/structure', async route => {
    if (route.request().method() === 'POST') {
      starts++
      if (fail) await route.fulfill({ status: 503, json: { error: 'Модель временно недоступна. Содержание сохранено.' } })
      else { ready = true; await route.fulfill({ status: 202, contentType: 'application/x-ndjson', body: '{"complete":true}\n' }) }
    } else {
      const path = new URL(route.request().url()).pathname.replace(/\/structure$/, '')
      const current = (await (await request.get(path)).json()).project
      await route.fulfill({ json: { configured: true, materialId: await materialIdentity(current.text), structure: ready ? { status: 'ready', outline: { slides: [{}, {}, {}] } } : null } })
    }
  })
  const id = await openTestProject(page, request, uploadId)
  await expect(page.getByRole('status').filter({ hasText: 'Презентация готова: 3' })).toBeVisible()
  expect(starts).toBe(1)
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Презентация готова' })).toBeVisible()
  expect(starts).toBe(1)
  expect(recipeStarts).toBe(1)
  await page.getByRole('button', { name: 'Содержание и параметры' }).click()
  await page.locator(`#presentation-style input[value="${otherStyle}"]`).check()
  await expect(page.getByRole('status').filter({ hasText: 'Презентация готова' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Сгенерировать слайды' })).toBeEnabled()
  expect(starts).toBe(1); expect(recipeStarts).toBe(1)
  expect((await (await request.get(`/api/projects/${id}`)).json()).project.generationMode).toBeUndefined()
  await page.getByRole('button', { name: 'Сгенерировать слайды' }).click()
  await expect(page.getByRole('region', { name: 'Генерация презентации' })).toContainText('Готово: 1 слайдов.', { timeout: 60000 })
  let current = (await (await request.get(`/api/projects/${id}`)).json()).project
  expect(current.generationMode).toBe('fast'); expect(current.uploadId).toBe(otherStyle)
  expect(starts).toBe(1); expect(recipeStarts).toBe(1)
  const revision = current.revision
  await page.reload()
  await expect(page.locator('.ws-slide-canvas img')).toHaveCount(1)
  expect((await (await request.get(`/api/projects/${id}`)).json()).project.revision).toBe(revision)
  await page.getByRole('button', { name: 'Содержание и параметры' }).click()
  await page.locator('#presentation-content').fill('Обновлённый материал: 42 участника, включая все оговорки.')
  await expect(page.getByRole('status').filter({ hasText: 'Все изменения сохранены' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сгенерировать слайды' })).toBeEnabled()
  current = (await (await request.get(`/api/projects/${id}`)).json()).project
  expect(current.text).toContain('включая все оговорки')
  expect((await (await request.get(`/api/projects/${id}/compose`)).json()).run).toBeNull()
  await page.getByRole('button', { name: 'Сгенерировать слайды' }).click()
  await expect(page.getByRole('region', { name: 'Генерация презентации' })).toContainText('Готово: 1 слайдов.', { timeout: 60000 })
  expect(starts).toBe(1); expect(recipeStarts).toBe(1)
  await page.screenshot({ path: info.outputPath('legacy-project-current-msp.png'), fullPage: true })
})
