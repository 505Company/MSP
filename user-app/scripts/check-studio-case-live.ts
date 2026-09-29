import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {oneDayText} from '../tests/fixtures/studio-one-day'
import type {StudioRun} from '../lib/presentations/studio/contract'

const mode=process.argv[2]
if(mode!=='fast'&&mode!=='smart')throw Error('Usage: check-studio-case-live.ts fast|smart')
const base='http://127.0.0.1:5184',id=crypto.randomUUID(),out=`outputs/diagnostics/studio-live-one-day/${mode}/${id}`
const created=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,uploadId:'7f88bbe2-84f0-4c73-9c24-3409aca3f5b8',name:`+1 день · варианты по превью · ${mode==='fast'?'быстрый':'Qwen'}`,text:oneDayText,generationMode:mode})})
if(!created.ok)throw Error(await created.text())
await mkdir(out,{recursive:true})
await writeFile(out+'/project.json',JSON.stringify(await created.json(),null,2))
console.log(JSON.stringify({project:id,url:base+`/projects/${id}`,out,mode}))
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/api/uploads/**',r=>r.request().method()==='GET'?r.continue():r.abort())
  const rounds=mode==='fast'?Number(process.argv[3]??1):1
  if(!Number.isInteger(rounds)||rounds<1||rounds>3)throw Error('Rounds must be 1..3')
  const selections:string[]=[],reports:unknown[]=[]
  let previousRevision=''
  await page.goto(base+`/projects/${id}?generate=1`)
  for(let round=1;round<=rounds;round++){
  if(round>1)await page.getByRole('button',{name:'Сгенерировать слайды'}).click()
  const started=Date.now()
  let run:StudioRun|undefined,last=''
  while(Date.now()-started<330000){
    const response=await fetch(base+`/api/projects/${id}/compose`)
    const data=await response.json() as {run:StudioRun};run=data.run
    const status=run?`${run.status}:${Object.keys(run.results).length}`:'starting'
    if(last!==status){console.log(JSON.stringify({elapsedMs:Date.now()-started,status}));last=status}
    if(run?.revision!==previousRevision&&(run?.status==='complete'||run?.status==='blocked')||await page.locator('.pw-error').count())break
    await new Promise(resolve=>setTimeout(resolve,1500))
  }
  const elapsedMs=Date.now()-started
  await page.screenshot({path:out+`/project-${round}.png`,fullPage:true})
  await writeFile(out+`/run-${round}.json`,JSON.stringify(run))
  for(const [i,o] of (run?.slides[0]?.options??[]).entries())await writeFile(out+`/option-${i+1}.png`,Buffer.from(o.receipt!.preview.split(',')[1],'base64'))
  await writeFile(out+'/run.json',JSON.stringify(run))
  for(const [i,result] of Object.values(run?.results??{}).entries())await writeFile(out+`/slide-${i+1}.png`,Buffer.from(result.preview.split(',')[1],'base64'))
  const summary={project:id,url:base+`/projects/${id}`,mode,elapsedMs,status:run?.status,modelRequests:run?.modelRequests,errors,messages:await page.locator('[role=status],.pw-error').allTextContents(),plans:run?.slides.map(s=>s.plan),results:Object.values(run?.results??{}).map(({html,preview,...result})=>{void html;void preview;return result})}
  await writeFile(out+'/summary.json',JSON.stringify(summary,null,2))
  console.log(JSON.stringify({...summary,results:summary.results.map(r=>({candidateId:r.candidateId,optionId:r.optionId,passed:r.passed,issues:r.issues,elapsedMs:r.elapsedMs,components:r.components}))},null,2))
  reports.push(summary);if(run?.status!=='complete'){process.exitCode=1;break}
  selections.push(run.slides[0].plan!.optionId!);previousRevision=run.revision
  await page.getByRole('button',{name:'Сгенерировать слайды'}).waitFor({state:'visible'})
  }
  await writeFile(out+'/rounds.json',JSON.stringify({selections,reports},null,2))
  if(rounds>1&&new Set(selections).size!==rounds)throw Error('Regeneration repeated a previous design before exhausting alternatives')
}finally{await browser.close()}
