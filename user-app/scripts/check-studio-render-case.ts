import {chromium} from '@playwright/test'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {draftOptions} from '../lib/presentations/studio/options'
import type {StudioRun} from '../lib/presentations/studio/contract'

const run=JSON.parse(await readFile(process.argv[2],'utf8')) as StudioRun,index=Number(process.argv[3]??0)
const out=`outputs/diagnostics/studio-semantic-pilot/render-${Date.now()}`
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
  const page=await browser.newPage();await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.abort());await page.goto('http://127.0.0.1:5184/processing-worker')
  const results=[]
  for(const bare of [false,true]){
    const library=structuredClone(run.library),work=structuredClone(run.slides[index])
    if(bare){library.prepared={};library.editable=[];work.bindings={}}
    const candidate=work.candidates.find(c=>c.id.startsWith('composition/'))!
    work.candidates=[candidate];work.plan=draftOptions(work,library)[0].plan
    const receipt=await page.evaluate(async({library,work})=>{const path='/browser/studio-generation.ts';return(await import(path) as typeof import('../browser/studio-generation')).renderStudioSlide(library,work)},{library,work})
    const label=bare?'primitive':'library';await writeFile(`${out}/${label}.json`,JSON.stringify(receipt));await writeFile(`${out}/${label}.html`,receipt.html);await writeFile(`${out}/${label}.png`,Buffer.from(receipt.preview.split(',')[1],'base64'))
    results.push({label,candidate:candidate.id,passed:receipt.passed,issues:receipt.issues,components:receipt.components,text:receipt.text.map(t=>({field:t.blockId+'.'+t.field,value:t.value,size:t.size,w:t.width,h:t.height}))})
  }
  await writeFile(out+'/report.json',JSON.stringify(results,null,2));console.log(JSON.stringify({out,results},null,2));if(!results[0].passed)process.exitCode=1
}finally{await browser.close()}
