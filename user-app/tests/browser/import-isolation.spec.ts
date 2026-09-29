import { test, expect } from './workspace-fixture'
import { nativePptx } from '../fixtures/native-pptx'

test('skipped import elements are visible without hiding available components or starting model work', async ({ page, request }, info) => {
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  const errors: string[] = [], writes: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (r.method() === 'POST' && /\/(semantic-scan|editable-system|calibration|reconstruction)$/.test(new URL(r.url()).pathname)) writes.push(r.url()) })
  await page.route('**/api/uploads/*/import-issues', route => route.fulfill({ json: { omissions: [
    { name: 'Карточка со списком', elementIds: ['bad-card'], slides: [2], reason: 'Состав или адаптивные поля не прошли проверку. Исходник сохранён.' },
  ] } }))
  await page.goto('/styles')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({ name: 'Частичный импорт.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(await nativePptx()) })
  const issues = page.getByLabel('Пропущенные элементы импорта', { exact: true })
  await expect(issues).toBeVisible()
  await issues.getByText('Пропущено при импорте: 1', { exact: true }).click()
  await expect(issues).toContainText('Карточка со списком · слайды 2')
  await expect(page.getByRole('region', { name: 'Компоненты', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('import-issues.png') })
  await issues.getByRole('link', { name: 'Посмотреть исходные слайды' }).click()
  await expect(page).toHaveURL(/section=source/)
  expect(writes).toEqual([]); expect(errors).toEqual([])
})
