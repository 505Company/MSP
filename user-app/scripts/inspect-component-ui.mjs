import {chromium,expect} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const [id,out='outputs/style-rows']=process.argv.slice(2)
assert.match(id??'',/^[a-f0-9-]{36}$/)
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.MSP_BROWSER_PATH?{executablePath:process.env.MSP_BROWSER_PATH}:{})})
try{
  const page=await browser.newPage({baseURL:'http://localhost:5184',viewport:{width:1440,height:1100}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`/styles/${id}`)
  await expect(page.locator('.cw-list button')).toHaveCount(24)
  await expect(page.locator('.cw-detail h3')).toBeVisible()
  await expect(page.locator('.cw-preview')).toHaveAttribute('aria-busy','false')
  await expect(page.getByRole('button',{name:/Принять после проверки|Сохранить кандидата|Отклонить/})).toHaveCount(0)
  await expect(page.locator('.cw-text-test')).not.toHaveAttribute('open','')
  const tabs=page.getByRole('tablist',{name:'Раздел дизайн-системы'}),panel=page.getByRole('tabpanel')
  const a=await tabs.boundingBox(),b=await panel.boundingBox()
  assert.ok(a.x+a.width<=b.x+1)
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/vk-components-desktop.png`,fullPage:true})
  const viewports=[]
  for(const width of [1024,720,390,320]){
    await page.setViewportSize({width,height:900})
    const noOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)
    assert.ok(noOverflow,`Horizontal overflow at ${width}`);viewports.push({width,noOverflow})
    if(width===390){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/vk-components-mobile.png`,fullPage:true})}
  }
  await page.getByRole('combobox',{name:'Раздел дизайн-системы',exact:true}).selectOption('type')
  await expect(page.locator('.ss-style').first()).toBeVisible()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.setViewportSize({width:1440,height:1100})
  await page.getByRole('tab',{name:'Рабочие компоненты'}).click()
  await page.goto(`/styles/${id}?component=cmp-s13-object-83`)
  await expect(page.locator('.cw-list button[aria-pressed=true]')).toHaveAttribute('data-component-id','cmp-s13-object-83')
  await expect(page.locator('.cw-ok')).toContainText('Текст помещается')
  await page.locator('.cw-text-test summary').click()
  await page.locator('.cw-fields textarea').first().fill('Новая цель')
  await expect(page.locator('.cw-ok')).toContainText('Текст помещается')
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/vk-component-text-preview.png`,fullPage:true})
  await page.getByRole('button',{name:'Вернуть исходный текст'}).click()
  await expect(page.locator('.cw-fields textarea').first()).toHaveValue('Подпись')
  const styleRows=[]
  for(const [tab,label,file] of [['Цвета','colors','vk-colors-rows.png'],['Типографика','typography','vk-typography-rows.png']]){
    await page.getByRole('tab',{name:tab,exact:true}).click()
    await expect(page.locator('.ss-style-row').first()).toBeVisible()
    const bounds=await page.locator('.ss-style-row').first().boundingBox()
    assert.ok(bounds.height<=44)
    styleRows.push({section:label,height:bounds.height,rows:await page.locator('.ss-style-row').count()})
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/'+file,fullPage:true})
    await page.setViewportSize({width:320,height:900})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/mobile-'+file,fullPage:true})
    await page.setViewportSize({width:1440,height:1100})
  }
  await page.getByRole('tab',{name:'Состав и связи'}).click()
  await expect(page.locator('.ss-records>article').first()).toBeVisible()
  assert.equal(await page.locator('.ss-summary,.ss-sections').count(),0)
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/vk-source-rows.png',fullPage:true})
  for(const tab of ['Рабочие компоненты','Состав и связи','Цвета','Типографика','Графика и иконки','Композиция','Правила стиля','Исходные слайды']){
    await page.getByRole('tab',{name:tab,exact:true}).click()
    assert.equal(await page.getByText(/Сохранены исходные изображения|Реконструкция читателем PPTX|Текст и замечания/).count(),0)
    assert.equal(await page.locator('.ds-explorer').locator('pre,code,details:not(.cw-text-test)').count(),0)
    assert.doesNotMatch(await page.getByRole('tabpanel').innerText(),/Google Shape;|s\d+-object-|ppt\/media\/|definitionId|lineHeight/)
  }
  assert.equal(await page.getByRole('link',{name:'Скачать JSON',exact:true}).count(),0)
  const catalog=await(await page.request.get(`/api/uploads/${id}/catalog`)).json()
  assert.ok(catalog.items.every(i=>!('status' in i)))
  const definition=await(await page.request.get(`/api/uploads/${id}/catalog/cmp-s13-object-83`)).json()
  assert.ok(!('revision' in definition))
  await page.goto(`/projects/${id}`)
  await expect(page.locator('#presentation-content')).toBeVisible()
  await expect(page.getByRole('region',{name:'Новый слайд'})).toHaveCount(0)
  const project=await(await page.request.get(`/api/projects/${id}/slide`)).json()
  assert.equal(project.slide.document.items.length,3)
  const bank=await(await page.request.get('/api/style-bank')).json()
  const projects=await(await page.request.get('/api/projects')).json()
  assert.deepEqual(bank.styles.map(s=>s.id),[id]);assert.equal(projects.projects.length,1)
  assert.deepEqual(errors,[])
  const result={id,total:catalog.total,counts:catalog.counts,verticalNavigation:true,manualReview:false,technicalDisclosures:false,styleRows,viewports,savedProjectInstances:3,bankEntries:bank.styles.length,projects:projects.projects.length,pageErrors:errors}
  await writeFile(`${out}/verification.json`,JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
}finally{await browser.close()}
