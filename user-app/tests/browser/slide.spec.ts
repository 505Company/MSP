import { test, expect, openTestProject } from './workspace-fixture'
import JSZip from 'jszip'
import { writeFile } from 'node:fs/promises'
import { XMLValidator } from 'fast-xml-parser'
import { controlPptx, controlImage } from '../fixtures/control-pptx'
import { blankSlide, composeSlide, type SavedSlide, type SlideDocument } from '../../lib/slides/document'
import type { CatalogComponent, CatalogPage } from '../../lib/design-system/catalog-types'
import { renderSlideInBrowser } from './slide-engine'

test('retained slide engine saves independent revisions and exports native text, groups and cropped images', async ({ page, request }, info) => {
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  await page.goto('/styles'); await page.waitForLoadState('networkidle')
  await page.getByLabel('PPTX или PDF дизайн-системы').setInputFiles({ name: 'Новый веб-слайд.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await controlPptx() })
  await expect(page.locator('.cw-list button').first()).toBeVisible({ timeout: 60000 })
  const uploadId = new URL(page.url()).pathname.split('/').at(-1)!
  const catalog = await (await request.get(`/api/uploads/${uploadId}/catalog`)).json() as CatalogPage
  const definition = async (name: string) => await (await request.get(`/api/uploads/${uploadId}/catalog/${catalog.items.find(c => c.name === name)!.id}`)).json() as CatalogComponent
  const card = await definition('Карточка решения'), photo = await definition('Карточка с фото')
  const title = card.component.slots.find(s => s.label === 'Заголовок')!.id, body = card.component.slots.find(s => s.label === 'Описание')!.id
  const doc: SlideDocument = { ...blankSlide(), name: 'MSP — редактируемый слайд', items: [
    { id: crypto.randomUUID(), componentId: card.component.id, definitionId: card.definitionId, values: { [title]: 'Новый текст & PPTX — 2026', [body]: 'Текст из веб-приложения.\nВторая строка сохранена полностью.' }, x: 40, y: 40, scale: 1 },
    { id: crypto.randomUUID(), componentId: photo.component.id, definitionId: photo.definitionId, values: {}, x: 590, y: 345, scale: 1 },
  ] }
  const projectId = await openTestProject(page, request, uploadId)
  const endpoint = `/api/projects/${projectId}/slide`
  const response = await request.put(endpoint, { data: { baseRevision: null, document: doc } })
  expect(response.ok()).toBe(true)
  const saved = (await response.json()).slide as SavedSlide
  await page.reload()
  await expect(page.locator('#presentation-content')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Новый слайд' })).toHaveCount(0)
  const reloaded = (await (await request.get(endpoint)).json()).slide as SavedSlide
  expect(reloaded).toEqual(saved)
  const result = await renderSlideInBrowser(page, uploadId, composeSlide(reloaded.document, reloaded.definitions))
  expect(result.report.fits).toBe(true)
  const bytes = Buffer.from(result.bytes)
  await writeFile(info.outputPath('editable-slide.pptx'), bytes)
  await writeFile(info.outputPath('new-slide.png'), Buffer.from(result.report.dataUrl.split(',')[1], 'base64'))
  const zip = await JSZip.loadAsync(bytes), slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
  for (const f of Object.values(zip.files).filter(f => !f.dir && (f.name.endsWith('.xml') || f.name.endsWith('.rels')))) expect(XMLValidator.validate(await f.async('string')), f.name).toBe(true)
  expect(slide).toContain('Новый текст &amp; PPTX — 2026'); expect(slide).toContain('Вторая строка сохранена полностью.')
  expect((slide.match(/<p:pic>/g) ?? []).length).toBe(1)
  expect((slide.match(/<p:grpSp>/g) ?? []).length).toBeGreaterThan(3)
  expect(slide).toContain('<a:srcRect')
  expect(Buffer.from(await zip.file('ppt/media/image1.png')!.async('uint8array'))).toEqual(controlImage())
  expect(result.texts).toContain('Новый текст & PPTX — 2026')
  expect(result.texts).toContain('Текст из веб-приложения.\nВторая строка сохранена полностью.')
  expect(result.warnings).toEqual([])
  expect((await (await request.get(endpoint)).json()).slide.id).toBe(saved.id)
  const secondId = await openTestProject(page, request, uploadId)
  expect((await (await request.get(`/api/projects/${secondId}/slide`)).json()).slide).toBeNull()
  expect((await (await request.get(`/api/uploads/${uploadId}/slide`)).json()).slide).toBeNull()
  doc.items[0].values[title] = 'Полный текст, который нельзя обрезать. '.repeat(50)
  const overflow = await renderSlideInBrowser(page, uploadId, composeSlide(doc, saved.definitions))
  expect(overflow.report.fits).toBe(false)
  expect(overflow.report.issues.some(i => i.code === 'text-overflow')).toBe(true)
  expect(overflow.bytes).toEqual([])
  const changed = await request.put(endpoint, { data: { baseRevision: saved.id, document: doc } })
  expect(changed.ok()).toBe(true)
  expect((await (await request.get(endpoint)).json()).slide.document.items[0].values[title]).toBe(doc.items[0].values[title])
})
