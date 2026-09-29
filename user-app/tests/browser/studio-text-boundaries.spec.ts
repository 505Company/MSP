import {test,expect} from './workspace-fixture'

test('paste and text-file input show slide boundaries before generation without external calls',async({page},info)=>{
  let writes=0
  await page.route('**/api/**',r=>{
    if(r.request().method()!=='GET'){writes++;return r.abort()}
    if(new URL(r.request().url()).pathname==='/api/style-bank')return r.fulfill({json:{styles:[]}})
    return r.fallback()
  })
  await page.goto('/create');await expect(page.getByRole('link',{name:'Открыть банк стилей',exact:true})).toBeVisible()
  const input=page.locator('#presentation-content'),count=page.locator('[data-slide-count]')
  const plain='Первый заголовок\nОписание первого слайда.\n\nВторой заголовок\nОписание второго слайда.\n\nТретий заголовок\nОписание третьего слайда.'
  await input.fill(plain);await expect(count).toHaveText('Распознано слайдов: 3 · по пустым строкам')
  for(const name of [/Сбалансированный/,/Творческий/,/Быстрый/]){await page.getByRole('radio',{name}).check();await expect(count).toHaveAttribute('data-slide-count','3')}
  await input.fill('Слайд 1\nПервый заголовок\n\nПервый абзац.\n\nВторой абзац.\n\nСлайд 2\nВторой заголовок\n\nОписание.')
  await expect(count).toHaveText('Распознано слайдов: 2 · по заголовкам и разделителям')
  await page.getByLabel('Файл содержания').setInputFiles({name:'Слайды.txt',mimeType:'text/plain',buffer:Buffer.from(plain.replace(/\n/g,'\r\n'))})
  await expect(count).toHaveAttribute('data-slide-count','3');await expect(input).toHaveValue(plain)
  await page.screenshot({path:info.outputPath('plain-text-input.png'),fullPage:true})
  expect(writes).toBe(0)
})
