import { test, expect } from './workspace-fixture'
import JSZip from 'jszip'
import { controlPptx } from '../fixtures/control-pptx'

test('curated cards, source links and second-level navigation work on desktop and mobile', async ({ page, request }) => {
  expect((await (await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  const zip = await JSZip.loadAsync(await controlPptx()), slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
  const extras = Array.from({ length: 72 }, (_, i) => '<p:sp><p:nvSpPr><p:cNvPr id="' + (100+i) + '" name="Кандидат ' + i + '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + (i*9525) + '" y="0"/><a:ext cx="' + (952500+(i>60?0:i)*9525) + '" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="0077FF"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>').join('')
  zip.file('ppt/slides/slide1.xml', slide.replace('</p:spTree>', extras + '</p:spTree>'))
  await page.goto('/styles'); await page.waitForLoadState('networkidle')
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles({ name: 'Отобранные компоненты.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await zip.generateAsync({ type: 'nodebuffer' }) })
  await expect(page.locator('.cw-card').first()).toBeVisible({ timeout: 60000 })
  const id = new URL(page.url()).pathname.split('/').at(-1)!
  const components=await (await request.get('/api/uploads/'+id+'/catalog?section=components')).json()
  expect(components.total).toBeGreaterThan(0);expect(components.total).toBeLessThan(10)
  expect(components.items.every((item:{kind:string})=>item.kind==='compound')).toBe(true)
  const menu = page.getByRole('navigation', { name: 'Раздел дизайн-системы' })
  await menu.getByRole('link', { name: 'Графика и иконки', exact: true }).click()
  await expect(page.locator('.cw-card')).toHaveCount(24)
  const body = await (await request.get('/api/uploads/' + id + '/catalog?section=graphics')).json()
  expect(body.total).toBeGreaterThan(60)
  expect(body.items.every((item: { usage: { tags: string[] } }) => item.usage.tags.length > 0)).toBe(true)
  const repeat = await (await request.get('/api/uploads/' + id + '/catalog?section=graphics&q=Кандидат%2071')).json()
  expect(repeat.items[0].name).toBe('Кандидат 0'); expect(repeat.items[0].repeatCount).toBe(12)

  await expect(menu.getByRole('link')).toHaveCount(9)
  await expect(page.locator('.ds-navigation,.ds-section-select')).toHaveCount(0)
  await menu.getByRole('link', { name: 'Цвета', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.ss-style').first()).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Цвета', exact: true })).toHaveAttribute('aria-current', 'page')
  const rows = page.locator('.ss-style-row'), rowOne = await rows.nth(0).boundingBox(), rowTwo = await rows.nth(1).boundingBox()
  expect(rowOne!.height).toBeLessThanOrEqual(44); expect(rowOne!.x).toBe(rowTwo!.x)
  await menu.getByRole('link', { name: 'Графика и иконки', exact: true }).click()
  await expect(page.locator('.cw-card img').first()).toBeVisible()
  const imageFits = await page.locator('.cw-card-preview img').evaluateAll(images => images.every(img => {
    const box = img.getBoundingClientRect(), frame = img.parentElement!.getBoundingClientRect()
    return box.left >= frame.left + 15 && box.right <= frame.right - 15 && box.top >= frame.top + 20 && box.bottom <= frame.bottom - 10
  }))
  expect(imageFits).toBe(true)
  await expect(page.locator('.cw-type-badge .lucide-square')).toHaveCount(0)
  const cards = page.locator('.cw-card'), one = await cards.nth(0).boundingBox(), two = await cards.nth(1).boundingBox()
  expect(one!.width).toBeGreaterThanOrEqual(240); expect(one!.height).toBeGreaterThan(200)
  expect(two!.x).toBeGreaterThan(one!.x); expect(two!.y).toBe(one!.y)
  await cards.first().focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.cw-detail .cw-preview img')).toBeVisible()
  await page.keyboard.press('Escape'); await expect(cards.first()).toBeFocused()
  await page.locator('.cw-gallery-toolbar').getByRole('button', { name: 'Дальше', exact: true }).click()
  await expect(page.locator('.cw-gallery-toolbar')).toContainText('Страница 2 из')

  const late = (await (await request.get('/api/uploads/' + id + '/catalog?section=graphics&q=Кандидат%2060')).json()).items[0]
  await page.goto('/styles/' + id + '?section=assets&component=' + late.id)
  await expect(page.locator('.cw-detail h3')).toHaveText('Кандидат 60')
  await expect(page.locator('.cw-detail .cw-preview img')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть компонент' }).click()
  for (const width of [720, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByRole('navigation', { name: 'Раздел дизайн-системы' }).getByRole('link', { name: 'Типографика', exact: true }).click()
  await expect(page.locator('.ss-style').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Типографика', exact: true })).toBeVisible()
})
