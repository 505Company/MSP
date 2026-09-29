import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const [id,out='outputs/diagnostics/component-navigation']=process.argv.slice(2);
if(!id)throw Error('Usage: check-component-navigation-live.mjs UPLOAD_ID [OUTPUT]');
const origin='http://127.0.0.1:5184';
const read=async path=>{const r=await fetch(origin+path);assert(r.ok);return r.json()};
const before=await read(`/api/uploads/${id}/editable-system`);
const errors=[],failedModules=[],blocked=[],steps=[];
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.MSP_BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
let unchangedCatalog=false;
try{
 const page=await browser.newPage({viewport:{width:1440,height:1080}});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).pathname.includes('/node_modules/'))failedModules.push({url:r.url(),status:r.status()})});
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='POST'&&url.pathname===`/api/uploads/${id}/processing`){const current=await read(url.pathname);assert.equal(current.job?.status,'complete');return route.fulfill({status:202,json:current})}
  if(request.method()==='GET'||request.method()==='POST'&&url.pathname.endsWith('/catalog'))return route.continue();
  blocked.push({method:request.method(),path:url.pathname});return route.abort();
 });
 await page.goto(`${origin}/styles/${id}?section=components`);
 await page.locator('.ed-card').first().waitFor({timeout:60000});
 const links=await page.locator('a.cw-card[href*="/components/"]').evaluateAll(nodes=>nodes.map(n=>({href:n.getAttribute('href'),name:n.getAttribute('aria-label')})));
 assert.ok(links.length>0);
 const selected=[links.find(c=>c.href.endsWith('/b7-1')),links.find(c=>c.href.endsWith('/b45-1')),links[0]].filter((c,i,a)=>c&&a.findIndex(v=>v?.href===c.href)===i);
 for(const card of selected){
  await page.locator(`a.cw-card[href="${card.href}"]`).click();
  await page.waitForFunction(()=>document.querySelector('#preview [data-component-box],#preview [data-original-preview]')||document.querySelector('vite-error-overlay'),{},{timeout:25000});
  assert.deepEqual(errors,[],'clicking a component must not fail a dynamic module import');
  assert.deepEqual(failedModules,[],'navigation modules must remain available');
  assert.equal(new URL(page.url()).pathname,card.href);
  assert.equal(await page.locator('#preview [data-component-box],#preview [data-original-preview]').count(),1);
  steps.push({...card,status:await page.locator('#status').innerText()});
  await page.getByRole('link',{name:'← К компонентам',exact:true}).click();
  await page.locator(`a.cw-card[href="${card.href}"]`).waitFor({timeout:25000});
 }
 await page.screenshot({path:`${out}/library.png`,fullPage:false});
 const after=await read(`/api/uploads/${id}/editable-system`);
 assert.deepEqual(before.catalog,after.catalog);unchangedCatalog=true;
 assert.deepEqual(errors,[]);assert.deepEqual(failedModules,[]);assert.deepEqual(blocked,[]);
 console.log(JSON.stringify({steps,errors,failedModules,unchangedCatalog}));
}finally{
 await writeFile(`${out}/summary.json`,JSON.stringify({steps,errors,failedModules,blocked,unchangedCatalog},null,2));
 await browser.close();
}
