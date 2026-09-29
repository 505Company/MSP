/** Inspect the real app with model/import commands blocked. Only local
 * adaptive preparation may run through its ordinary queue. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {saveJson} from './pixel-pilot-store'
const [id,out]=process.argv.slice(2);assert.match(id??'',/^[a-f\d-]{36}$/);assert.ok(out);await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.MSP_BROWSER_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),blocked:string[]=[],errors:string[]=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/api/**',async route=>{
  const r=route.request(),u=new URL(r.url())
  if(r.method()==='GET')return route.continue()
  const data=r.postDataJSON()
  if(u.pathname.endsWith('/processing')&&!data.restart||u.pathname.endsWith('/catalog'))return route.fulfill({response:await page.request.get(u.href)})
  if(u.pathname===`/api/uploads/${id}/component-preparation`&&data.action==='ensure')return route.continue()
  if(u.pathname===`/api/uploads/${id}/editable-system/refinements`&&data.action==='recheck')return route.continue()
  blocked.push(r.method()+' '+u.pathname);return route.abort()
 })
 await page.goto(`http://127.0.0.1:5184/styles/${id}?section=components`)
 const audit=page.getByLabel('Аудит дизайн-системы');await expect(audit.locator('summary')).toBeVisible({timeout:45000})
 await audit.locator('summary').click();await expect(audit.getByRole('button',{name:'Проверить дизайн-систему'})).toBeVisible()
 await audit.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/audit.png`})
 await page.goto(`http://127.0.0.1:5184/styles/${id}?section=diagrams`)
 const graph=page.getByLabel('Исходная схема',{exact:true});await expect(graph).toBeVisible({timeout:45000})
 await graph.scrollIntoViewIfNeeded();await graph.screenshot({path:`${out}/diagram.png`})
 const details=await page.request.get(`http://127.0.0.1:5184/api/uploads/${id}/quality-audit`),state=await details.json()
 await saveJson(`${out}/verification.json`,{errors,blocked,audit:state,modelRequests:0})
 assert.equal(state.enabled,false);assert.equal(state.job,null);assert.deepEqual(blocked,[]);assert.deepEqual(errors,[])
 console.log(JSON.stringify({errors,blocked,auditEnabled:state.enabled,modelRequests:0}))
}finally{await browser.close()}
