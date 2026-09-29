import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { test, expect } from './workspace-fixture'
import { nativePptx } from '../fixtures/native-pptx'
import { labCatalog } from '../../component-lab/fixtures'
import { memoryBucket } from '../helpers/memory-bucket'
import { sourceCandidate } from '../../lib/component-lab/source'
import { readRuleHistory, saveRuleRevision } from '../../lib/component-lab/storage'
import { componentSettingsPath } from '../../lib/component-lab/links'

test('gallery reports the prepared queue and opens an admitted variant instead of the unsupported first one', async ({ page }) => {
  const { catalog } = await sources(page), family = catalog.families[0], original = family.variants[0]
  const ready = { ...structuredClone(original), id: 'lab-metric-ready' }
  family.variants.push(ready); catalog.qualification!.checks.push({ id: ready.id, passed: true, source: true, changed: true, issues: [] })
  // A text family was previously hidden regardless of its successful profile.
  catalog.families[1].kind = 'text'; catalog.families[1].variants[0].kind = 'text'
  const jobs = [{ componentId: original.id, status: 'unsupported', reason: 'Needs another profile' }, { componentId: ready.id, status: 'complete', result: { generationAdmission: true } }, { componentId: catalog.families[1].variants[0].id, status: 'complete', result: { generationAdmission: true } }]
  await page.route('**/api/uploads/*/component-preparation', route => route.fulfill({ json: { jobs } }))
  await page.goto('/styles'); await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({ name: 'Adaptive status.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(await nativePptx()) })
  const card = page.getByRole('link', { name: 'Открыть конструкцию «Тестовый компонент metric»', exact: true })
  await expect(card).toHaveAttribute('data-component-id', ready.id, { timeout: 60000 })
  await expect(card).toContainText('Адаптивный · проверен')
  await expect(page.getByText('Вариантов с проверенной адаптивностью: 2.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Открыть конструкцию «Тестовый компонент text»', exact: true })).toBeVisible()
  await card.click()
  await expect(page).toHaveURL(/\/components\/lab-metric-ready$/)
  await expect(page.locator('#status')).toHaveText('Помещается')
})

async function sources(page: Page, missingFont = false) {
  const catalog = labCatalog(), { bucket } = memoryBucket(), writes: string[] = []
  if (missingFont) for (const slot of catalog.families[0].variants[0].sourceLayout!.text) {
    slot.element.fontFamily = 'MSP Absent Sans'
    slot.element.styleRuns!.forEach(run => { run.fontFamily = 'MSP Absent Sans' })
  }
  await page.route('**/api/uploads/*/editable-system', route => route.fulfill({ json: { catalog, native: [], jobs: [], total: 1, completed: 1, running: false } }))
  await page.route('**/api/uploads/*/fonts', route => route.fulfill({ json: { fonts: [] } }))
  await page.route('**/api/uploads/*/component-profiles?*', async route => {
    const url = new URL(route.request().url()), upload = url.pathname.split('/')[3]
    if (url.searchParams.get('candidates') === '1') return route.fulfill({ json: { candidates: await Promise.all(catalog.families.flatMap(f => f.variants).map(t => sourceCandidate(t, catalog.id))) } })
    const t = catalog.families.flatMap(f => f.variants).find(t => t.id === url.searchParams.get('component'))!
    const p = (await sourceCandidate(t, catalog.id)).profile!
    try {
      if (route.request().method() === 'GET') return route.fulfill({ json: await readRuleHistory(bucket, upload, p) })
      writes.push(url.pathname)
      return route.fulfill({ json: { revision: await saveRuleRevision(bucket, upload, p, route.request().postDataJSON()) } })
    } catch (e) { return route.fulfill({ status: 409, json: { error: e instanceof Error ? e.message : String(e) } }) }
  })
  await page.route('**/api/fonts/google?*', async route => {
    const url = new URL(route.request().url()), family = url.searchParams.get('family')
    if (!missingFont || family !== 'Noto Sans') return route.fulfill({ json: { files: [] } })
    if (url.searchParams.has('asset')) return route.fulfill({ contentType: 'font/ttf', body: await readFile(new URL(`../../public/fonts/play/Play-${url.searchParams.get('style') === 'Bold' ? 'Bold' : 'Regular'}.ttf`, import.meta.url)) })
    return route.fulfill({ json: { files: [{ url: `${url.pathname}${url.search}&asset=0` }] } })
  })
  return { catalog, writes }
}

test('library opens the same editor in the app; saved rules reappear in the component and history', async ({ page, request }, info) => {
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  const { catalog, writes } = await sources(page), original = JSON.stringify(catalog), errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/styles'); await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({ name: 'Настройки компонентов.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(await nativePptx()) })
  const card = page.getByRole('link', { name: 'Открыть конструкцию «Тестовый компонент metric»', exact: true })
  await expect(card).toBeVisible({ timeout: 60000 }); await card.click()
  await expect(page).toHaveURL(/\/styles\/[a-f0-9-]+\/components\/lab-metric$/)
  const path = new URL(page.url()).pathname
  await expect(page.locator('#status')).toHaveText('Помещается')
  await expect(page.getByRole('navigation', { name: 'Раздел дизайн-системы' }).getByRole('link', { name: 'Компоненты', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#style')).not.toBeVisible()
  await expect(page.locator('#padding')).not.toBeVisible()
  await page.locator('#state').selectOption('horizontal')
  await page.locator('#alignment [data-value=center]').click(); await page.locator('#position [data-value=center]').click()
  await page.locator('#save').click()
  await expect(page.locator('#save-status')).toContainText('Проверяем:')
  await expect(page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Проекты', exact: true })).toBeEnabled()
  await expect(page.locator('#save-status')).toContainText('Сохранена версия 1 · проверка пройдена', { timeout: 90000 })
  await page.screenshot({ path: info.outputPath('component-editor.png') })
  expect(writes).toHaveLength(1)
  await page.getByRole('link', { name: '← К компонентам', exact: true }).click()
  await expect(card).toBeVisible(); await expect(card).toHaveAttribute('data-highlighted', 'true')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.rf-toolbar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Дополнить дизайн-систему', exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('saved-library-component.png') })
  await card.click()
  await expect(page.locator('#save-status')).toContainText('Сохранена версия 1')
  await page.locator('#state').selectOption('horizontal')
  await expect(page.locator('#position [data-value=center]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#alignment [data-value=center]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('#component').selectOption('lab-text')
  await expect(page).toHaveURL(/\/components\/lab-text$/); await expect(page.locator('#status')).toHaveText('Помещается')
  await expect(page.locator('#save-status')).toHaveText('Правила ещё не сохранены')
  await page.goto(path); await expect(page.locator('#save-status')).toContainText('Сохранена версия 1')
  await page.getByRole('link', { name: 'Проекты', exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await expect(page.locator('.component-editor')).toHaveCount(0)
  // Scoped editor styles cannot change the app header after client navigation.
  expect(await page.locator('header').first().evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(64)
  expect(JSON.stringify(catalog)).toBe(original); expect(errors).toEqual([])
})

test('main service preserves a labelled font replacement after a real rule-store save', async ({ page }, info) => {
  const { writes } = await sources(page, true)
  const upload = '00000000-0000-4000-a000-000000000001'
  await page.goto(componentSettingsPath(upload, 'lab-metric'))
  await expect(page.locator('#status')).toHaveText('Помещается')
  await expect(page.locator('#font-note')).toHaveText('Шрифт заменён: MSP Absent Sans → Noto Sans (Google Fonts).')
  await page.locator('#save').click()
  await expect(page.locator('#save-status')).toContainText('Сохранена версия 1 · проверка пройдена', { timeout: 90000 })
  await page.evaluate(() => localStorage.clear()); await page.reload()
  await expect(page.locator('#save-status')).toContainText('Сохранена версия 1')
  await expect(page.locator('#font-note')).toContainText('Noto Sans')
  expect(await page.locator('#preview [data-component-field]').evaluateAll(fields => fields.every(f => getComputedStyle(f).fontFamily.includes('Noto Sans')))).toBe(true)
  await page.screenshot({ path: info.outputPath('font-replacement-in-app.png') })
  expect(writes).toHaveLength(1)
})

test('leaving an in-flight check cancels it and retains the draft; a stale component URL never opens a different card', async ({ page }) => {
  const { writes } = await sources(page), errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const upload = '00000000-0000-4000-a000-000000000001', path = componentSettingsPath(upload, 'lab-metric')
  await page.goto(path)
  await expect(page.locator('#status')).not.toHaveText('Ожидание')
  await expect(page.locator('#status')).toHaveText('Помещается')
  await page.locator('#state').selectOption('vertical'); await page.locator('#alignment [data-value=center]').click()
  await page.locator('#save').click(); await expect(page.locator('#save-status')).toContainText('Проверяем:')
  await page.getByRole('link', { name: 'Проекты', exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await page.goBack(); await expect(page.locator('#save-status')).toContainText('Восстановлен ваш несохранённый черновик')
  await page.locator('#state').selectOption('vertical')
  await expect(page.locator('#alignment [data-value=center]')).toHaveAttribute('aria-pressed', 'true')
  expect(writes).toEqual([])
  await page.goto(componentSettingsPath(upload, 'no-longer-in-catalog'))
  await expect(page.locator('#component-title')).toHaveText('Компонент недоступен')
  await expect(page.locator('#preview [data-component-box]')).toHaveCount(0)
  await expect(page.locator('#save')).toBeDisabled()
  expect(errors).toEqual([])
})

test('MSP 2 reuses presentation import and component editing while retaining its navigation', async ({ page, request }, info) => {
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  await sources(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/msp2/styles'); await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').first().setInputFiles({ name: 'MSP 2 — общие компоненты.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(await nativePptx()) })
  const card = page.getByRole('link', { name: 'Открыть конструкцию «Тестовый компонент metric»', exact: true })
  await expect(card).toBeVisible({ timeout: 60000 })
  await expect(page).toHaveURL(/\/msp2\/styles\/[a-f0-9-]+(?:\?.*)?$/)
  await card.click()
  await expect(page).toHaveURL(/\/msp2\/styles\/[a-f0-9-]+\/components\/lab-metric$/)
  await expect(page.locator('#status')).toHaveText('Помещается')
  await page.locator('#component').selectOption('lab-text')
  await expect(page).toHaveURL(/\/msp2\/styles\/[a-f0-9-]+\/components\/lab-text$/)
  await expect(page.locator('#status')).toHaveText('Помещается')
  await page.getByRole('link', { name: '← К компонентам', exact: true }).click()
  await expect(card).toBeVisible()
  await expect(page).toHaveURL(/\/msp2\/styles\/[a-f0-9-]+\?/)
  await page.screenshot({ path: info.outputPath('msp2-shared-components.png') })
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Проекты', exact: true }).click()
  await expect(page).toHaveURL(/\/msp2\/projects$/)
  await expect(page.locator('.m2-header')).toBeVisible()
  expect(errors).toEqual([])
})
