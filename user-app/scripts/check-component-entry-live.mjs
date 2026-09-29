import {chromium} from '@playwright/test';
import{writeFile,mkdir}from'node:fs/promises';
import assert from'node:assert/strict';
const [id,out='outputs/diagnostics/component-entry']=process.argv.slice(2);
if(!id)throw Error('Usage: check-component-entry-live.mjs UPLOAD_ID [OUTPUT]');
const root='http://127.0.0.1:5184';
await mkdir(out,{recursive:true});
const read=async path=>{const r=await fetch(root+path);assert(r.ok);return r.json()};
const before=await read(`/api/uploads/${id}/editable-system`);
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[],blocked=[],preventedEnqueue=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async r=>{
  const q=r.request(),u=new URL(q.url());
  if(q.method()==='POST'&&u.pathname===`/api/uploads/${id}/processing`){const current=await read(u.pathname);assert.equal(current.job?.status,'complete');preventedEnqueue.push(u.pathname);return r.fulfill({status:202,json:current})}
  if(q.method()==='GET'||q.method()==='POST'&&/\/catalog$/.test(u.pathname))return r.continue();
  blocked.push({method:q.method(),path:u.pathname});return r.abort();
 });
 await page.goto(`${root}/styles/${id}?section=components`);
 await page.locator('.ed-card').first().waitFor({timeout:60000});
 await page.waitForLoadState('networkidle');
 assert.equal(await page.locator('.rf-toolbar').count(),0);
 const cards=await page.locator('.cw-card').evaluateAll(nodes=>nodes.map(n=>({id:n.getAttribute('href')?.split('/').at(-1)||n.dataset.componentId,name:n.getAttribute('aria-label')})));
 for(const card of await page.locator('.cw-card').all()){await card.scrollIntoViewIfNeeded();await page.waitForFunction(el=>!el.querySelector('[aria-busy=\"true\"],.cw-preview-skeleton'),await card.elementHandle(),{timeout:60000})}
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:`${out}/library.png`,fullPage:true});
 for(const c of cards){
  const started=Date.now();
  await page.goto(`${root}/styles/${id}/components/${c.id}`);
  await page.waitForFunction(()=>document.querySelector('#preview [data-component-box],#preview [data-original-preview]')||document.querySelector('#preview .preview-problem')||document.querySelector('#component-title')?.textContent==='Компонент недоступен',{},{timeout:60000});
  const view=await page.locator('#preview').evaluate(n=>({adaptive:!!n.querySelector('[data-component-box]'),original:!!n.querySelector('[data-original-preview]'),text:n.textContent?.slice(0,160)}));
  const row={...c,title:await page.locator('#component-title').innerText(),status:await page.locator('#status').innerText(),...view,millis:Date.now()-started,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),notice:await page.locator('#result').innerText()};
  results.push(row);console.log(JSON.stringify({id:c.id,status:row.status,millis:row.millis,overflow:row.overflow}));
  if(results.length<=8||row.notice||['chart','gantt','timeline'].some(k=>before.catalog.families.some(f=>f.kind===k&&f.variants.some(t=>t.id===c.id))))await page.screenshot({path:`${out}/${c.id}.png`,fullPage:true});
 }
 const after=await read(`/api/uploads/${id}/editable-system`);
 assert.deepEqual(before.catalog,after.catalog);
 await writeFile(`${out}/summary.json`,JSON.stringify({id,catalogId:before.catalog.id,results,errors,blocked,preventedEnqueue,unchangedCatalog:true},null,2));
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.ok(results.every(r=>r.original||r.adaptive));assert.ok(results.every(r=>!r.overflow));
}finally{await browser.close()}
