/** Publish only native graph measurements. Raster recognition and all model
 * calls are blocked; the source graph itself is never hand-edited. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {build} from 'esbuild'
import {chromium} from '@playwright/test'
import {saveJson} from './pixel-pilot-store'
const [id,out]=process.argv.slice(2);assert.match(id??'',/^[a-f\d-]{36}$/);assert.ok(out);await mkdir(out,{recursive:true})
const bundle=await build({stdin:{contents:"export {prepareNativeDiagrams} from './lib/design-system/reconstruction-browser'; export {diagramHtml} from './lib/design-system/diagram-graph'; export {hydrateEditableHtml} from './lib/design-system/editable-hydrate';",resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'NativeAudit',write:false})
const browser=await chromium.launch({headless:true,executablePath:process.env.MSP_BROWSER_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
 const page=await browser.newPage(),blocked:string[]=[],writes:string[]=[]
 await page.addInitScript('globalThis.__name = value => value')
 await page.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url()),base=`/api/uploads/${id}/reconstruction`
  if(u.pathname==='/__native-audit__')return route.fulfill({contentType:'text/html',body:'<html><body></body></html>'})
  if(u.origin==='http://127.0.0.1:5184'){
   if(r.method()==='GET'&&(u.pathname===base||u.pathname.startsWith('/fonts/')||/^\/api\/(fonts\/|uploads\/[^/]+\/(assets\/|fonts$))/.test(u.pathname)))return route.continue()
   if(r.method()==='POST'&&u.pathname===base){const d=r.postDataJSON();if(d.nativeOnly===true||d.qualification||d.partsQualification){writes.push(d.nativeOnly?'native':d.qualification?'qualification':'parts');return route.continue()}}
  }
  blocked.push(r.method()+' '+u.href);return route.abort()
 })
 await page.goto('http://127.0.0.1:5184/__native-audit__');await page.addScriptTag({content:bundle.outputFiles[0].text})
 const result=await page.evaluate(async id=>{
  const api=(window as unknown as {NativeAudit:typeof import('../lib/design-system/reconstruction-browser')&typeof import('../lib/design-system/diagram-graph')&typeof import('../lib/design-system/editable-hydrate')}).NativeAudit
  const r=await fetch(`/api/uploads/${id}/reconstruction`);if(!r.ok)throw Error(await r.text())
  const result=await api.prepareNativeDiagrams(id,await r.json(),new AbortController().signal)
  for(const graph of result.results.filter(r=>r.diagram)){
   const host=document.createElement('div');host.id=graph.id;host.style.cssText=`width:1100px;padding:30px;background:${graph.diagram!.sourceSurface??graph.diagram!.background??'#ffffff'}`
   host.innerHTML=api.diagramHtml(graph.diagram!,id);document.body.appendChild(host);await api.hydrateEditableHtml(host)
  }
  return result
 },id)
 for(const r of result.results.filter(r=>r.diagram))await page.locator(`[id="${r.id}"]`).screenshot({path:`${out}/${r.id}.png`})
 await saveJson(`${out}/verification.json`,{result,blocked,writes,modelRequests:0});assert.deepEqual(blocked,[])
 console.log(JSON.stringify({pending:result.pending.map(c=>c.id),results:result.results.map(r=>({id:r.id,status:r.status,qualification:r.qualification,parts:r.partsQualification?.checks.map(c=>({id:c.id,passed:c.passed,issues:c.issues}))})),modelRequests:0}))
}finally{await browser.close()}
