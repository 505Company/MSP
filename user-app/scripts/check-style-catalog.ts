// Exercise the normal automatic update and gallery after a compiler change.
// Run only against a completed local upload; no hand-written catalog records.
import fs from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import type {EditableCatalog} from '../lib/design-system/editable-contract'
const [uploadId,dir,base='http://127.0.0.1:5184']=process.argv.slice(2)
if(!uploadId||!dir)throw Error('Usage: check-style-catalog.ts <upload-id> <output-dir> [origin]')
const api=`${base}/api/uploads/${uploadId}`
const readState=async()=>await (await fetch(api+'/editable-system')).json() as {catalog:EditableCatalog|null}
const before=await readState()
const calibration=await (await fetch(api+'/calibration')).json() as {calibrated?:unknown},reconstruction=await (await fetch(api+'/reconstruction')).json() as {pending?:unknown[]}
if(!before.catalog||!calibration.calibrated||reconstruction.pending?.length)throw Error('Finish recognition first; this check must only reuse saved evidence')
const browser=await chromium.launch({headless:true,executablePath:process.env.MSP_BROWSER_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
 const page=await browser.newPage({viewport:{width:1480,height:1100}}),errors:string[]=[],posts:Array<{path:string;status:number}>=[]
 page.on('pageerror',error=>errors.push(error.message))
 page.on('response',r=>{if(r.request().method()==='POST')posts.push({path:new URL(r.url()).pathname,status:r.status()})})
 await page.goto(`${base}/styles/${uploadId}?section=components`)
 await expect.poll(async()=>!!(await readState()).catalog?.qualification,{timeout:120000,intervals:[1000,3000,5000]}).toBe(true)
 await expect(page.locator('.ed-card').first()).toBeVisible({timeout:30000})
 await expect(page.locator('.ed-card [aria-busy="true"]')).toHaveCount(0,{timeout:30000})
 await expect(page.getByText('Дизайн-система готова',{exact:true})).toBeVisible({timeout:30000})
 const componentNames=await page.locator('.ed-card strong').allTextContents()
 await expect(page.locator('.cw-card[data-component-id]')).toHaveCount(0)
 await page.screenshot({path:`${dir}/live-components.png`,fullPage:true})
 const numbered=page.getByRole('button',{name:'Открыть конструкцию «Карточка с номером»',exact:true}).first()
 await numbered.click();await expect(page.getByRole('dialog').locator('[data-native-overflow="true"]')).toHaveCount(0)
 await page.getByRole('dialog').screenshot({path:`${dir}/live-card.png`})
 await page.getByRole('button',{name:'Закрыть конструкцию',exact:true}).click()
 await page.goto(`${base}/styles/${uploadId}?section=composition`)
 await expect(page.locator('.ed-card').first()).toBeVisible()
 await expect(page.locator('.ed-card [aria-busy="true"]')).toHaveCount(0,{timeout:30000})
 await expect(page.getByText('Дизайн-система готова',{exact:true})).toBeVisible({timeout:30000})
 const compositionNames=await page.locator('.ed-card strong').allTextContents()
 await page.screenshot({path:`${dir}/live-compositions.png`,fullPage:true})
 await page.goto(`${base}/styles/${uploadId}?section=type`)
 await expect(page.locator('.ss-style').first()).toBeVisible({timeout:30000})
 await expect(page.getByText('Дизайн-система готова',{exact:true})).toBeVisible({timeout:30000})
 const typography=await page.locator('.ss-style').count()
 await page.screenshot({path:`${dir}/live-typography.png`,fullPage:true})
 const after=await readState()
 if(!after.catalog?.qualification)throw Error('Missing qualified catalog')
 expect(after.catalog.modelRunIds).toEqual(before.catalog.modelRunIds)
 expect(after.catalog.liveRequests).toBe(before.catalog.liveRequests)
 expect(errors).toEqual([])
 expect(componentNames.some(n=>['Подпись','Заголовок','Текстовый блок'].includes(n))).toBe(false)
 await fs.writeFile(`${dir}/editable-after.json`,JSON.stringify(after))
 const report={componentNames,compositionNames,typography,posts,errors,liveRequests:after.catalog.liveRequests,passed:after.catalog.qualification.checks.filter((c:{passed:boolean})=>c.passed).length,total:after.catalog.qualification.checks.length}
 await fs.writeFile(`${dir}/live-ui-check.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await browser.close()}
