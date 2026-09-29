// Read-only timings for the split between quick profiles and browser matrix QA.
import {build,stop} from 'esbuild';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [upload,component,output='outputs/diagnostics/component-preparation']=process.argv.slice(2);
if(!upload||!component)throw Error('Usage: benchmark-component-preparation.mjs UPLOAD_ID COMPONENT_ID [OUTPUT]');
const origin='http://127.0.0.1:5184',url=`${origin}/api/uploads/${upload}/editable-system`;
const before=await (await fetch(url)).json();assert(before.catalog);
const bundle=await build({stdin:{contents:`export {sourceCandidate} from './lib/component-lab/source';export {resolveComponentFonts} from './browser/component-lab/fonts';export {checkQuality} from './browser/component-lab/qualification';export {measureComponent} from './browser/component-lab/measure';`,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'PreparationBenchmark',write:false});
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.MSP_BROWSER_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),blocked=[];
 await page.route('**/api/**',r=>{if(r.request().method()==='GET')return r.continue();blocked.push(r.request().url());return r.abort()});
 await page.goto(`${origin}/api/uploads/${upload}/fonts`);await page.addScriptTag({content:bundle.outputFiles[0].text});
 const report=await page.evaluate(async({catalog,upload,component})=>{
  document.body.replaceChildren();const api=window.PreparationBenchmark,start=performance.now();
  const candidates=await Promise.all(catalog.families.flatMap(f=>f.variants).map(t=>api.sourceCandidate(t,catalog.id))),profiles=performance.now();
  const candidate=candidates.find(c=>c.template.id===component);if(!candidate?.profile)throw Error('No supported profile');
  const resolved=await api.resolveComponentFonts(upload,candidate.profile,{states:{}}),fonts=performance.now();
  const preview=await api.measureComponent(resolved.profile,candidate.content,{width:600,maxHeight:400,widthMode:'fill',heightMode:'fill'},resolved.fonts),previewed=performance.now();
  const quality=await api.checkQuality(resolved.profile,resolved.fonts),done=performance.now();
  return{upload,component,catalogId:catalog.id,createdAt:new Date().toISOString(),candidates:candidates.length,supported:candidates.filter(c=>c.profile).length,
   milliseconds:{deriveAll:profiles-start,loadFonts:fonts-profiles,onePreview:previewed-fonts,matrix:done-previewed,total:done-start},
   preview:preview.status,quality:{version:quality.version,technical:quality.technical,coverage:quality.coverage,policy:quality.policy},
   limitations:'One local Chrome run on this computer. No cold-server or remote throughput claim.',modelRequests:0};
 },{catalog:before.catalog,upload,component});
 const after=await (await fetch(url)).json();assert.deepEqual(before.catalog,after.catalog);assert.deepEqual(blocked,[]);
 await mkdir(output,{recursive:true});await writeFile(`${output}/timings.json`,JSON.stringify({...report,unchangedCatalog:true},null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();stop()}
