import {chromium} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
import type {StudioRun} from '../lib/presentations/studio/contract'
const origin='http://127.0.0.1:5184',out='outputs/diagnostics/studio-design-system-usage/live'
const jobs=JSON.parse(await readFile(out+'/jobs.json','utf8')) as {mode:string;project:string;revision:string}[]
async function get(j:typeof jobs[number]){const response=await fetch(`${origin}/api/projects/${j.project}/compose?revision=${j.revision}`);if(!response.ok)throw Error('Read failed '+response.status);return (await response.json() as {run:StudioRun}).run}
async function post(j:typeof jobs[number],action:string,receipt?:unknown,slideId?:string){const response=await fetch(`${origin}/api/projects/${j.project}/compose`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,revision:j.revision,...receipt?{receipt}:{},...slideId?{slideId}:{}})});if(!response.ok)throw Error((await response.text()).slice(0,1500));return response.text()}
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{const page=await browser.newPage();await page.goto(origin+'/processing-worker');
for(const j of jobs.filter(j=>!process.argv[2]||j.mode===process.argv[2])){
 let run=await get(j);const ids=run.semantic?.units?.map(u=>u.id)??run.slides.map(w=>w.content.id)
 for(const id of ids){for(let attempt=0;attempt<3;attempt++){
  run=await get(j);if(run.results[id]?.passed)break
  let work=run.slides.find(w=>w.content.id===id),unit=run.semantic?.units?.find(u=>u.id===id)
  if(unit&&unit.status==='pending'||unit?.status==='running')throw Error('Model stage is still running '+j.mode+'/'+id)
  if(unit?.status==='failed'||work?.strictComponents&&work.error){console.log('REPAIR_MODEL',j.mode,id,attempt);await post(j,'structure',undefined,id);run=await get(j);unit=run.semantic?.units?.find(u=>u.id===id);work=run.slides.find(w=>w.content.id===id)}
  if(!work||unit&&unit.status!=='complete'){console.log('NO_PLAN',j.mode,id,unit?.error);continue}
  try{
   console.log('RENDER',j.mode,id,attempt)
   const options=await page.evaluate(async({library,work})=>{const path='/browser/studio-generation.ts',m=await import(path) as typeof import('../browser/studio-generation');return m.renderStudioOptions(library,work)},{library:run.library,work})
   await post(j,'options',{slideId:id,options:options.map(o=>({id:o.id,receipt:o.receipt}))})
   run=await get(j);const r=run.results[id];if(!r?.passed)throw Error('Saved result did not pass')
   await writeFile(`${out}/${j.mode}-${id}.png`,Buffer.from(r.preview.split(',')[1],'base64'));console.log('SAVED',j.mode,id,r.candidateId,Math.round(r.elapsedMs),run.modelRequests)
   break
  }catch(e){console.log('RENDER_ERROR',j.mode,id,String(e));await post(j,'fail',{slideId:id,error:String(e).slice(0,3800)});if(!work.strictComponents)break}
 }
 await writeFile(`${out}/${j.mode}-run.json`,JSON.stringify(await get(j)))
 }
 run=await get(j);console.log('RESULT',j.mode,run.status,Object.values(run.results).filter(r=>r.passed).length,ids.length,'models',run.modelRequests)
}
}finally{await browser.close()}
