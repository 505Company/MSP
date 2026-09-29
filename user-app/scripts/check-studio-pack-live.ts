import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {recipeExamples} from '../tests/fixtures/studio-recipe-examples'
import {oneDayText} from '../tests/fixtures/studio-one-day'
import type {StudioRun} from '../lib/presentations/studio/contract'
const base='http://127.0.0.1:5184',id=crypto.randomUUID(),out=`outputs/diagnostics/studio-recipe-pack/live/${id}`
const text=[oneDayText,...recipeExamples.map(e=>e.text)].join('\n\n---\n\n')
const response=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,uploadId:'7f88bbe2-84f0-4c73-9c24-3409aca3f5b8',name:'MSP · 7 рецептов · VK',text,generationMode:'fast'})})
if(!response.ok)throw Error(await response.text())
await mkdir(out,{recursive:true});console.log(JSON.stringify({url:`${base}/projects/${id}`,out}))
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}})
  await page.route('**/api/uploads/**',r=>r.request().method()==='GET'?r.continue():r.abort())
  await page.route('**/api/projects/*/compose',r=>r.request().method()==='POST'&&r.request().postDataJSON().action==='design'?r.abort():r.continue())
  const started=Date.now();await page.goto(`${base}/projects/${id}?generate=1`)
  let run:StudioRun|undefined,last=''
  while(Date.now()-started<300000){run=(await(await fetch(`${base}/api/projects/${id}/compose`)).json() as {run:StudioRun}).run
    const status=run?`${run.status}:${Object.keys(run.results).length}`:'starting';if(status!==last){console.log(JSON.stringify({elapsedMs:Date.now()-started,status}));last=status}
    if(run?.status==='complete'||run?.status==='blocked'||await page.locator('.pw-error').count())break
    await new Promise(r=>setTimeout(r,1000))
  }
  const elapsedMs=Date.now()-started
  await writeFile(out+'/run.json',JSON.stringify(run));await page.screenshot({path:out+'/project.png',fullPage:true})
  for(const [i,r] of Object.values(run?.results??{}).entries())await writeFile(out+`/slide-${i+1}.png`,Buffer.from(r.preview.split(',')[1],'base64'))
  const report={project:id,url:`${base}/projects/${id}`,elapsedMs,status:run?.status,modelRequests:run?.modelRequests,messages:await page.locator('[role=status],.pw-error').allTextContents(),recipes:run?.slides.map(s=>s.plan?.candidateId),slides:Object.values(run?.results??{}).map(r=>({candidate:r.candidateId,passed:r.passed,issues:r.issues,warnings:r.warnings}))}
  await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
  if(run?.status!=='complete'||run.modelRequests!==0||new Set(report.recipes).size!==7)process.exitCode=1
}finally{await browser.close()}
