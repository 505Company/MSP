// Local diagnostic: replay immutable evidence with the production compiler.
// It never mutates source objects/catalogs or makes recognition requests.
import fs from 'node:fs/promises'
import {build} from 'esbuild'
import {chromium} from '@playwright/test'
import {compileEditableSlides} from '../lib/design-system/editable-analysis'
import {EDITABLE_VERSION,EDITABLE_COMPILER_VERSION} from '../lib/design-system/editable-contract'

const [dir,uploadId,base='http://127.0.0.1:5184']=process.argv.slice(2)
if(!dir||!uploadId)throw Error('Usage: check-editable-replay.ts <evidence-dir> <upload-id> [origin]')
const manifest=JSON.parse(await fs.readFile(`${dir}/manifest.json`,'utf8')),parts=JSON.parse(await fs.readFile(`${dir}/parts.json`,'utf8'))
const catalog={...await compileEditableSlides(manifest.snapshot,parts.flatMap((p:{reply:{slides:never[]}})=>p.reply.slides),uploadId),id:'a'.repeat(64),version:EDITABLE_VERSION,compilerVersion:EDITABLE_COMPILER_VERSION,catalogId:'a'.repeat(64),sourceRevision:'diagnostic',createdAt:'',modelRunIds:[],liveRequests:0}
await fs.writeFile(`${dir}/compiled-local.json`,JSON.stringify(catalog))
const bundle=await build({stdin:{contents:"export {qualifyEditableCatalog} from './lib/design-system/editable-qualification';export {renderEditableHtml} from './lib/design-system/editable-render';export {hydrateEditableHtml} from './lib/design-system/editable-hydrate';export {ensureUploadFonts} from './browser/fonts';",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'Probe',write:false})
const browser=await chromium.launch({headless:true,executablePath:process.env.MSP_BROWSER_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
 const page=await browser.newPage({viewport:{width:1480,height:1100}})
 await page.goto(`${base}/api/uploads/${uploadId}/fonts`)
 await page.setContent('<html><head><style>body{margin:24px;background:#f3f4f7;font:16px Arial}h2{font-size:18px}article{break-inside:avoid;background:white;padding:16px;margin:12px;border:1px solid #ccd1da}.grid{display:grid;grid-template-columns:repeat(3,1fr)}.frame{height:300px;position:relative;overflow:hidden}.content{width:800px;position:absolute;left:50%;top:50%;transform-origin:center}</style></head><body></body></html>')
 await page.addScriptTag({content:bundle.outputFiles[0].text})
 const report=await page.evaluate(async({catalog,uploadId})=>{
  const api=(window as unknown as {Probe:typeof import('../lib/design-system/editable-qualification')&typeof import('../lib/design-system/editable-render')&typeof import('../lib/design-system/editable-hydrate')&typeof import('../browser/fonts')}).Probe
  await api.ensureUploadFonts(uploadId)
  const report=await api.qualifyEditableCatalog(catalog)
  const grid=document.createElement('div');grid.className='grid';document.body.appendChild(grid)
  for(const family of catalog.families.filter(f=>f.kind!=='text')){
   const template=family.variants.find(t=>report.checks.find(c=>c.id===t.id)?.passed)??family.variants[0],card=document.createElement('article')
   const title=document.createElement('h2');title.textContent=family.name+' · '+template.id;card.appendChild(title)
   const frame=document.createElement('div');frame.className='frame';const content=document.createElement('div');content.className='content';content.innerHTML=api.renderEditableHtml(template);frame.appendChild(content);card.appendChild(frame);grid.appendChild(card)
   await api.hydrateEditableHtml(content);await document.fonts.ready
   const scale=Math.min(frame.clientWidth/800,frame.clientHeight/Math.max(1,content.scrollHeight));content.style.transform=`translate(-50%,-50%) scale(${scale})`
  }
  return report
 },{catalog,uploadId})
 await fs.writeFile(`${dir}/qualification-local.json`,JSON.stringify(report,null,2))
 await page.screenshot({path:`${dir}/compiled-gallery.png`,fullPage:true})
 console.log(JSON.stringify({families:catalog.families.length,passed:report.checks.filter(c=>c.passed).length,total:report.checks.length,failed:report.checks.filter(c=>!c.passed).map(c=>({id:c.id,issues:c.issues})),excluded:catalog.excluded},null,2))
}finally{await browser.close()}
