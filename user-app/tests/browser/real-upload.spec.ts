import { test, expect, openTestProject } from './workspace-fixture'
import { writeFile } from 'node:fs/promises'
import type { CatalogPage, CatalogComponent } from '../../lib/design-system/catalog-types'
import { blankSlide, composeSlide, type SlideDocument, type SavedSlide } from '../../lib/slides/document'
import { renderSlideInBrowser } from './slide-engine'

// Opt-in acceptance against a local source deck; no copying into the app or model calls.
test('real PPTX imports without the visual-package size error', async ({page,request},testInfo)=>{
  test.skip(!process.env.MSP_ACCEPTANCE_PPTX, 'Set MSP_ACCEPTANCE_PPTX to a local source PPTX')
  test.setTimeout(180000)
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  await page.goto('/styles')
  if(page.url().includes('signin-with-chatgpt')) await page.getByRole('button').filter({hasText:/войти|sign in|continue/i}).first().click()
  await expect(page.getByRole('heading',{name:'Банк стилей',exact:true})).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles(process.env.MSP_ACCEPTANCE_PPTX!)
  await expect(page.locator('.pw-error').or(page.getByRole('link',{name:'Компоненты'})).first()).toBeVisible({timeout:150000})
  expect((await page.locator('.pw-error').allTextContents()).join(' ')).toBe('')
  await expect(page.getByRole('link',{name:'Компоненты'})).toBeVisible()
  const uploadId=new URL(page.url()).pathname.split('/').at(-1)!
  expect(uploadId).toMatch(/^[a-f0-9-]{36}$/)
  await expect(page.locator('.cw-list button').first()).toBeVisible()
  const saved=await request.get(`/api/uploads/${uploadId}/catalog`)
  expect(saved.ok()).toBe(true)
  const library=await saved.json() as CatalogPage
  await writeFile(testInfo.outputPath('library.json'),JSON.stringify(library,null,2))
  if(process.env.MSP_ACCEPTANCE_PPTX!.includes('VK Education')){
    expect(library.total).toBeGreaterThan(150)
    const detail=await (await request.get(`/api/uploads/${uploadId}/catalog/cmp-s13-object-83`)).json() as CatalogComponent
    const card=detail.component
    expect(card).toBeTruthy()
    const select=async()=>{await page.goto(`/styles/${uploadId}?component=${card.id}`);await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('.cw-detail h3')).not.toContainText('Google Shape')}
    await select()
    await expect(page.locator('.cw-ok')).toContainText('Компонент готов к использованию')
    await expect(page.locator('.cw-detail textarea,.cw-text-test')).toHaveCount(0)
    await page.locator('.cw-detail').screenshot({path:testInfo.outputPath('vk-component.png')})
    await page.reload();await select();await expect(page.locator('.cw-preview img')).toBeVisible()
  }
  if(process.env.MSP_ACCEPTANCE_PPTX!.includes('VK Education')){
    const projectId = await openTestProject(page, request, uploadId)
    const get = async (id: string) => await (await request.get(`/api/uploads/${uploadId}/catalog/${id}`)).json() as CatalogComponent
    const card = await get('cmp-s13-object-83'), heading = await get('cmp-s13-object-80')
    const item = (c: CatalogComponent, text: string, x: number, y: number, scale: number) => ({ id: crypto.randomUUID(), componentId: c.component.id, definitionId: c.definitionId, values: { [c.component.slots[0].id]: text }, x, y, scale })
    const headingScale = Math.min(1, 880 / heading.component.scene.width, 460 / heading.component.scene.height)
    const document: SlideDocument = { ...blankSlide(), name: 'VK Education — новый веб-слайд', items: [item(card, 'Подпись', 64, 220, 1.6), item(card, 'Новая среда', 448, 220, 1.6), item(heading, 'Обучение в вебе', 64, 56, headingScale)] }
    const response = await request.put(`/api/projects/${projectId}/slide`, { data: { baseRevision: null, document } })
    expect(response.ok()).toBe(true)
    const saved = (await response.json()).slide as SavedSlide
    const rendered = await renderSlideInBrowser(page, uploadId, composeSlide(saved.document, saved.definitions))
    expect(rendered.report.fits, JSON.stringify(rendered.report.issues)).toBe(true)
    await writeFile(testInfo.outputPath('vk-new-slide.pptx'), Buffer.from(rendered.bytes))
    await writeFile(testInfo.outputPath('vk-new-slide.png'), Buffer.from(rendered.report.dataUrl.split(',')[1], 'base64'))
    await expect(page.getByRole('region', { name: 'Новый слайд' })).toHaveCount(0)
  }
  await writeFile(testInfo.outputPath('upload-id.txt'),uploadId)
  await page.screenshot({path:testInfo.outputPath('imported.png'),fullPage:true})
})
