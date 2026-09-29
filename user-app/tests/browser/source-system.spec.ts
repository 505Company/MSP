import { test,expect } from './workspace-fixture'
import type { SourceSystem } from '../../lib/design-system/source-system'
import { controlPptx } from '../fixtures/control-pptx'

test('style rows and components expose human-readable content without technical disclosures',async({page,request},testInfo)=>{
  expect((await(await request.get('/api/capabilities/qwen')).json()).configured).toBe(false)
  await page.goto('/styles');await page.waitForLoadState('networkidle')
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles({name:'Состав дизайн-системы.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:await controlPptx()})
  await expect(page.locator('.cw-list button').first()).toBeVisible({timeout:60000})
  const id=new URL(page.url()).pathname.split('/').at(-1)!
  const response=await request.get(`/api/uploads/${id}/source-system`)
  expect(response.ok()).toBe(true)
  const {system}=await response.json() as {system:SourceSystem}
  expect(system.ledger.length).toBe(system.summary.records)
  expect(new Set(system.ledger.map(r=>r.elementId)).size).toBe(system.ledger.length)
  expect(system.summary.unresolved).toBe(0)
  expect(system.styles.some(s=>s.kind==='typography'&&s.value.fontStyle==='Regular')).toBe(true)
  expect(system.scan.batches.every(b=>b.bytes<=32000)).toBe(true)
  await page.getByRole('link',{name:'Типографика',exact:true}).click()
  await expect(page.locator('.ss-style').first()).toBeVisible()
  await page.getByLabel('Поиск стиля').fill('Arial')
  await expect(page.locator('.ss-style').first()).toContainText('Arial')
  await expect(page.locator('.ss-style pre,.ss-style details')).toHaveCount(0)
  await expect(page.locator('.ss-style-row').first()).toContainText('Arial')
  await expect(page.getByRole('link',{name:'Состав и связи',exact:true})).toHaveCount(0)
  await page.getByRole('link',{name:'Компоненты',exact:true}).click()
  await page.locator('.cw-list button').filter({hasText:'Карточка решения'}).click()
  await expect(page.locator('.cw-preview img')).toBeVisible()
  await expect(page.locator('.cw-detail textarea,.cw-text-test')).toHaveCount(0)
  await expect(page.locator('.cw-detail')).not.toContainText('Текстовых полей')
  await expect(page.locator('.cw-ok')).toContainText('Исходный вид воспроизведён')
  await page.screenshot({path:testInfo.outputPath('source-system.png'),fullPage:true})
  await page.getByRole('button',{name:'Закрыть компонент'}).click()
  await page.getByRole('link',{name:'Цвета',exact:true}).click()
  await expect(page.locator('.ss-style').first()).toBeVisible()
  const rows=page.locator('.ss-style-row'),first=await rows.nth(0).boundingBox(),second=await rows.nth(1).boundingBox()
  expect(first!.height).toBeLessThanOrEqual(44);expect(second!.x).toBe(first!.x)
  expect(second!.y).toBeGreaterThan(first!.y)
  expect(system.texts.some(t=>t.text==='Решение для города')).toBe(true)
  for(const tab of ['Компоненты','Цвета','Типографика','Графика и иконки','Композиция','Правила стиля','Исходные слайды']){
    await page.getByRole('link',{name:tab,exact:true}).click()
    await expect(page.getByText(/Сохранены исходные изображения|Реконструкция читателем PPTX|Текст и замечания/)).toHaveCount(0)
    await expect(page.locator('.ds-panel').locator('details,pre,code')).toHaveCount(0)
    expect(await page.locator('.ds-panel').innerText()).not.toMatch(/Google Shape;|s\d+-object-|ppt\/media\/|definitionId|lineHeight/)
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await testInfo.attach('source-system',{body:JSON.stringify(system,null,2),contentType:'application/json'})
})
