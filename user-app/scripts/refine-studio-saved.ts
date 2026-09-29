import {chromium} from '@playwright/test'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import type {StudioRun} from '../lib/presentations/studio/contract'
const project=process.argv[2],input=process.argv[3],output=process.argv[4],base=process.argv[5]??'http://127.0.0.1:5184'
if(!project||!input||!output)throw Error('Usage: projectId savedModesDirectory outputDirectory [baseUrl]')
const endpoint=`${base}/api/projects/${project}/compose`
async function post(action:string,revision:string,receipt?:unknown){
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,revision,...receipt?{receipt}:{}})})
 const value=await response.json() as {run?:StudioRun;error?:string};if(!response.ok||!value.run)throw Error(value.error??`HTTP ${response.status}`);return value.run
}
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{for(const mode of (process.argv[6]??'fast,balanced,creative').split(',')){
 const source=JSON.parse(await readFile(`${input}/${mode}/run.json`,'utf8')) as StudioRun
 let run=await post('refine',source.revision)
 const out=`${output}/${mode}`;await mkdir(out,{recursive:true});await writeFile(`${out}/revision.txt`,run.revision)
 const page=await browser.newPage();await page.goto(`${base}/processing-worker`);await page.waitForTimeout(1000)
 for(const [index,work] of run.slides.entries()){
  if(!run.results[work.content.id]?.passed){
   const options=await page.evaluate(async({library,work})=>{const path='/browser/studio-generation.ts',{renderStudioOptions}=await import(path) as typeof import('../browser/studio-generation');return renderStudioOptions(library,work)}, {library:run.library,work})
   run=await post('options',run.revision,{slideId:work.content.id,options:options.map(o=>({id:o.id,receipt:o.receipt}))})
  }
  const receipt=run.results[work.content.id];if(!receipt?.passed)throw Error(`${mode}/${index+1}: no valid slide`)
  const stem=String(index+1).padStart(2,'0');await writeFile(`${out}/${stem}.png`,Buffer.from(receipt.preview.split(',')[1],'base64'));await writeFile(`${out}/${stem}.html`,receipt.html)
  console.log(JSON.stringify({mode,slide:index+1,revision:run.revision,chosen:receipt.candidateId,quality:receipt.quality,text:receipt.text.map(t=>({field:t.field,size:Math.round(t.size)}))}))
 }
 await writeFile(`${out}/run.json`,JSON.stringify(run));await page.close()
}}finally{await browser.close()}
