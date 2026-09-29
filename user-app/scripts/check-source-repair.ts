/** Exercise the product's local source-repair path. All model, processing,
 * catalog and unrelated writes are blocked; the saved source is unchanged. */
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {chromium} from '@playwright/test'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {applicationSnapshot,saveJson,digest} from './pixel-pilot-store'

const upload=process.argv[2],out=process.argv[3],apply=process.argv.includes('--apply')
const checkUi=process.argv.includes('--ui')
if(!/^[a-f0-9-]{36}$/.test(upload??'')||!out?.startsWith('outputs/'))throw Error('Usage: check-source-repair.ts UPLOAD outputs/DIRECTORY [--apply]')
await mkdir(out,{recursive:true})
const before=applicationSnapshot(),manifest=await before.read(`visual/${upload}/manifest.json`)
const incomplete=manifest.snapshot.slides.filter((s:{warnings:string[]})=>s.warnings.some(w=>w.startsWith('normalized-page-unavailable'))).map((s:{number:number})=>s.number)
const protectedRows=before.rows.filter(r=>r.key.includes(upload)&&!r.key.startsWith('visual/')&&!r.key.startsWith('source-repairs/')&&r.blob_id)
const hashes=new Map(await Promise.all(protectedRows.map(async r=>[r.key,digest(await readFile(`.wrangler/state/v3/r2/site-creator-r2/blobs/${r.blob_id}`))] as const)))
const bundle=await build({stdin:{contents:`export {repairIncompleteSource} from './browser/source-repair';`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'SourceRepairAudit'})
const browser=await chromium.launch({headless:true,executablePath:process.env.MSP_BROWSER_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const blocked:string[]=[],errors:string[]=[],progress:string[]=[]
let receipt:unknown
const page=await browser.newPage()
try{
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='log')progress.push(m.text())})
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.pathname==='/__source-repair-audit')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'})
  const local=url.origin==='http://127.0.0.1:5184'
  if(checkUi&&local&&req.method()==='GET')return route.continue()
  if(local&&req.method()==='GET'&&(url.pathname==='/pptx-reader.js'||url.pathname.startsWith('/fonts/')||url.pathname.startsWith('/api/fonts/')||new RegExp(`^/api/uploads/${upload}/(source|source-repair|fonts)$`).test(url.pathname)))return route.continue()
  if(local&&url.pathname===`/api/uploads/${upload}/source-repair`&&req.method()==='POST'){
   const patch=req.postDataJSON();await saveJson(`${out}/repair-patch.json`,patch)
   if(apply)return route.continue()
   const repaired=patch.snapshot.slides.filter((s:{warnings:string[]})=>!s.warnings.some(w=>w.startsWith('normalized-page-unavailable'))).map((s:{number:number})=>s.number)
   return route.fulfill({contentType:'application/json',body:JSON.stringify({repaired,remaining:incomplete.filter((n:number)=>!repaired.includes(n)),dryRun:true})})
  }
  if(checkUi&&local&&req.method()==='POST'&&new RegExp(`^/api/uploads/${upload}/(processing|catalog|editable-system|component-preparation|reconstruction)$`).test(url.pathname))return route.fulfill({response:await route.fetch({method:'GET',postData:undefined})})
  blocked.push(`${req.method()} ${url.pathname}`);return route.abort('blockedbyclient')
 })
 await page.goto('http://127.0.0.1:5184/__source-repair-audit');await page.addScriptTag({content:bundle.outputFiles[0].text})
 receipt=await page.evaluate(async upload=>{
  const api=(window as unknown as {SourceRepairAudit:typeof import('../browser/source-repair')}).SourceRepairAudit
  return api.repairIncompleteSource(upload,new AbortController().signal,message=>console.log(message))
 },upload)
 if(checkUi){
  await page.goto(`http://127.0.0.1:5184/styles/${upload}`)
  await page.getByText('Исходные слайды восстановлены. Продолжите сборку с сохранённого этапа.',{exact:true}).first().waitFor()
  assert.equal(await page.getByRole('button',{name:'Повторить с сохранённого этапа',exact:true}).count(),1)
  await page.screenshot({path:`${out}/ui.png`,fullPage:true})
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
}finally{await page.unrouteAll({behavior:'wait'});await browser.close()}
const after=applicationSnapshot(),updated=await after.read(`visual/${upload}/manifest.json`)
for(const slide of manifest.snapshot.slides.filter((s:{number:number})=>!incomplete.includes(s.number))){
 assert.deepEqual(updated.snapshot.slides.find((s:{number:number})=>s.number===slide.number),slide)
 assert.deepEqual(updated.snapshot.elements.filter((e:{slide:number})=>e.slide===slide.number),manifest.snapshot.elements.filter((e:{slide:number})=>e.slide===slide.number))
}
for(const [key,hash] of hashes){const row=after.rows.find(r=>r.key===key)!;assert.equal(digest(await readFile(`.wrangler/state/v3/r2/site-creator-r2/blobs/${row.blob_id}`)),hash,`Protected state changed: ${key}`)}
for(const n of incomplete){const id=`s${String(n).padStart(2,'0')}`,row=after.rows.find(r=>r.key===`visual/${upload}/preview-${id}`);if(row?.blob_id)await writeFile(`${out}/${id}.jpg`,await readFile(`.wrangler/state/v3/r2/site-creator-r2/blobs/${row.blob_id}`))}
const summary={upload,apply,receipt,progress,errors,blocked,modelRequests:0,unchangedPages:manifest.snapshot.slides.length-incomplete.length,protectedRecords:hashes.size,slides:updated.snapshot.slideCount,previews:updated.previews.length,incomplete:updated.snapshot.slides.filter((s:{warnings:string[]})=>s.warnings.some(w=>w.startsWith('normalized-page-unavailable'))).map((s:{number:number})=>s.number)}
await saveJson(`${out}/verification.json`,summary);console.log(JSON.stringify(summary,null,2))
if(apply)assert.equal(summary.incomplete.length,0)
