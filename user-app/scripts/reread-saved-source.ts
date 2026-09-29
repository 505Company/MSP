/** Read the saved original with the current importer. No model or app writes. */
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {saveJson} from './pixel-pilot-store'
const [id,source,out]=process.argv.slice(2)
assert.match(id??'',/^[a-f\d-]{36}$/);assert.ok(source&&out)
await mkdir(out,{recursive:true})
const bytes=await readFile(source),browser=await chromium.launch({headless:true,executablePath:process.env.MSP_BROWSER_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
 const page=await browser.newPage(),blocked:string[]=[]
 await page.addInitScript('globalThis.__name = value => value')
 await page.route('**/*',async route=>{
  const r=route.request(),url=new URL(r.url())
  if(url.pathname==='/__source-reread__')return route.fulfill({contentType:'text/html',body:'<html><body></body></html>'})
  if(r.method()==='GET'&&url.origin==='http://127.0.0.1:5184'&&(url.pathname==='/pptx-reader.js'||url.pathname.startsWith('/api/fonts/')||url.pathname.startsWith('/fonts/')))return route.continue()
  blocked.push(r.method()+' '+url.href);return route.abort()
 })
 await page.goto('http://127.0.0.1:5184/__source-reread__');await page.addScriptTag({path:'public/pptx-reader.js'})
 const result=await page.evaluate(async data=>{
  const api=(window as unknown as {MspPptxReader:typeof import('../browser/prepare')}).MspPptxReader
  const r=await api.preparePresentation(Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0)),data.name)
  const encode=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)}
  return {...r,assets:r.assets.map(a=>({...a,bytes:undefined,base64:encode(a.bytes)}))}
 },{base64:bytes.toString('base64'),name:process.env.MSP_SOURCE_NAME??source.split('/').at(-1)!})
 await saveJson(`${out}/prepared.json`,result)
 for(const p of result.previews)await writeFile(`${out}/${p.id}.jpg`,Buffer.from(p.dataUrl.split(',')[1],'base64'))
 await saveJson(`${out}/verification.json`,{blocked,modelRequests:0,slides:result.snapshot.slides.map(s=>({slide:s.number,warnings:s.warnings}))})
 assert.deepEqual(blocked,[])
 console.log(JSON.stringify({slides:result.snapshot.slides.length,resources:result.assets.filter(a=>a.origins.some(o=>o.startsWith('ppt/media/'))).length,incomplete:result.snapshot.slides.filter(s=>s.warnings.some(w=>w.startsWith('normalized-page-unavailable'))),modelRequests:0}))
}finally{await browser.close()}
