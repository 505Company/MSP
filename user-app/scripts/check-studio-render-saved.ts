import {chromium} from '@playwright/test'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import type {StudioRun} from '../lib/presentations/studio/contract'
const input=process.argv[2],run=JSON.parse(await readFile(input,'utf8')) as StudioRun,out=process.argv[3]
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{const page=await browser.newPage();await page.goto('http://127.0.0.1:5184/processing-worker')
for(const work of run.slides.filter(s=>!run.results[s.content.id]?.passed&&(!process.argv[4]||s.content.id===process.argv[4]))){
 const receipts=await page.evaluate(async({library,work})=>{const paths={r:'/browser/studio-generation.ts',o:'/lib/presentations/studio/options.ts'},renderer=await import(paths.r) as typeof import('../browser/studio-generation'),opts=await import(paths.o) as typeof import('../lib/presentations/studio/options'),result=[]
 for(const draft of opts.draftOptions(work,library)){const candidate=work.candidates.find(c=>c.id===draft.plan.candidateId)!;result.push(await renderer.renderStudioSlide(library,{...work,candidates:[candidate],plan:draft.plan}))}return result
 },{library:run.library,work})
 for(const [i,r] of receipts.entries()){await writeFile(`${out}/${work.content.id}-${i}.json`,JSON.stringify(r));await writeFile(`${out}/${work.content.id}-${i}.png`,Buffer.from(r.preview.split(',')[1],'base64'));console.log({id:work.content.id,candidate:r.candidateId,passed:r.passed,issues:r.issues,text:r.text.map(t=>({id:t.blockId,field:t.field,size:t.size,x:t.x,y:t.y,w:t.width,h:t.height}))})}
}}finally{await browser.close()}
