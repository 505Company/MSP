import {chromium} from '@playwright/test'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import type {StudioRun,SlideWork} from '../lib/presentations/studio/contract'
import {STUDIO_VERSION} from '../lib/presentations/studio/contract'
import {creativeRecipeChoices} from '../lib/presentations/studio/creative-choices'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {libraryCoverCandidates} from '../lib/presentations/studio/visual-design'
import {componentBindings} from '../lib/presentations/studio/bindings'
import {fastOption} from '../lib/presentations/studio/options'
const input=process.argv[2]??'outputs/msp3-three-modes-audit',output=process.argv[3]??'/private/tmp/msp-quality-v11',modes=(process.argv[4]??'fast,balanced,creative').split(','),numbers=process.argv[5]?.split(',').map(Number)
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{for(const mode of modes){
  const run=JSON.parse(await readFile(`${input}/${mode}/run.json`,'utf8')) as StudioRun
  run.version=STUDIO_VERSION;run.results={};run.status='preparing'
  const out=`${output}/${mode}`;await mkdir(out,{recursive:true})
  const page=await browser.newPage();await page.goto('http://127.0.0.1:5184/processing-worker');await page.waitForTimeout(1200)
  for(const [index,old] of run.slides.entries()){
    if(numbers&&!numbers.includes(index+1))continue
    const content=old.fallback?.source??old.content
    let work:SlideWork={...old,content,candidates:[...libraryCoverCandidates(content,run.library),...candidatesFor(content)],bindings:Object.fromEntries(content.blocks.map(b=>[b.id,componentBindings(b,run.library)]))}
    if(old.strictComponents)work=creativeRecipeChoices(old,run.library)
    delete work.options;delete work.error;delete work.fallback
    try{
      work.options=await page.evaluate(async({library,work})=>{const path='/browser/studio-generation.ts';const renderer=await import(path) as typeof import('../browser/studio-generation');return renderer.renderStudioOptions(library,work)}, {library:run.library,work})
      const chosen=fastOption(work,run.slides.slice(0,index).flatMap(s=>s.plan?[s.plan.candidateId]:[]))
      work.plan=chosen.plan;run.slides[index]=work;run.results[content.id]=chosen.receipt!
      const stem=String(index+1).padStart(2,'0');await writeFile(`${out}/${stem}.png`,Buffer.from(chosen.receipt!.preview.split(',')[1],'base64'));await writeFile(`${out}/${stem}.html`,chosen.receipt!.html)
      console.log(JSON.stringify({mode,slide:index+1,chosen:chosen.plan.candidateId,quality:chosen.receipt!.quality,options:work.options.map(o=>({id:o.plan.candidateId,quality:o.receipt!.quality})),text:chosen.receipt!.text.map(t=>({id:t.blockId,f:t.field,size:t.size,v:t.value.slice(0,65)}))}))
      await writeFile(`${out}/run.json`,JSON.stringify(run))
    }catch(e){console.error(mode,index+1,String(e));throw e}
  }
  run.status=Object.keys(run.results).length===run.slides.length?'complete':'preparing';await writeFile(`${out}/run.json`,JSON.stringify(run));await page.close()
}}finally{await browser.close()}
