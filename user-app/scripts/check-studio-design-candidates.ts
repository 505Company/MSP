import {chromium} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {draftOptions} from '../lib/presentations/studio/options'
import type {StudioRun} from '../lib/presentations/studio/contract'
const dir='outputs/diagnostics/studio-design-system-usage',run=JSON.parse(await readFile(dir+'/9b5a393d-aca4-407d-8585-f50d6cf81016-13f468ff-c16c-4392-905d-235bdb8b2f1f-before.json','utf8')) as StudioRun
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{const page=await browser.newPage();await page.goto('http://127.0.0.1:5184/processing-worker');for(const [id,choice] of [['slide-4','composition/dense-journey-columns'],['slide-5','composition/chart-focus']]){
const work=run.slides.find(w=>w.content.id===id)!;work.candidates=candidatesFor(work.content).filter(c=>c.id===choice);work.plan=draftOptions(work,run.library)[0].plan
const r=await page.evaluate(async({library,work})=>{const path='/browser/studio-generation.ts',m=await import(path) as typeof import('../browser/studio-generation');return m.renderStudioSlide(library,work)}, {library:run.library,work})
console.log(JSON.stringify({id,issues:r.issues,components:r.components,text:r.text.map(t=>({id:t.blockId,field:t.field,x:t.x,y:t.y,w:t.width,h:t.height,size:t.size}))}));await writeFile(`${dir}/after/debug-${id}.png`,Buffer.from(r.preview.split(',')[1],'base64'));await writeFile(`${dir}/after/debug-${id}.json`,JSON.stringify(r))
}}finally{await browser.close()}
