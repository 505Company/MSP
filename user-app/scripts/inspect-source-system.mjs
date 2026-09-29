import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const [id,out='outputs/source-system-parity']=process.argv.slice(2)
if(!/^[a-f0-9-]{36}$/.test(id??''))throw new Error('Pass an existing local upload ID')
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.MSP_BROWSER_PATH?{executablePath:process.env.MSP_BROWSER_PATH}:{})})
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}})
  await page.goto(`http://localhost:5184/styles/${id}`)
  const source=await page.request.get(`http://localhost:5184/api/uploads/${id}/source-system`)
  assert.ok(source.ok());const data=await source.json()
  await page.getByRole('tab',{name:'Состав и связи',exact:true}).click()
  await page.locator('.ss-records>article').first().waitFor()
  assert.equal(data.system.constructions.filter(c=>c.kind==='table').length,data.system.summary.tables)
  await page.locator('.ss-panel').screenshot({path:`${out}/vk-system-components.png`})
  await page.getByRole('tab',{name:'Типографика',exact:true}).click()
  await page.locator('.ss-style').first().waitFor()
  await page.getByLabel('Поиск стиля').fill('Play')
  await page.locator('.ss-style').first().waitFor()
  await page.locator('.ss-styles').screenshot({path:`${out}/vk-system-type.png`})
  const noHorizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)
  assert.ok(noHorizontalOverflow)
  await writeFile(`${out}/vk-current-system.json`,JSON.stringify(data))
  await writeFile(`${out}/inspection.json`,JSON.stringify({uploadId:id,version:data.system.version,summary:data.system.summary,noHorizontalOverflow},null,2))
  console.log(JSON.stringify({uploadId:id,version:data.system.version,summary:data.system.summary,noHorizontalOverflow}))
}finally{await browser.close()}
