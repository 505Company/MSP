import {chromium} from '@playwright/test'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {normalizeText} from '../lib/presentations/studio/material'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {componentBindings,fastPlan} from '../lib/presentations/studio/bindings'
import {oneDayText} from '../tests/fixtures/studio-one-day'
import type {StudioLibrary} from '../lib/presentations/studio/contract'

const library=JSON.parse(await readFile('outputs/diagnostics/studio-composition/library-vk.json','utf8')) as StudioLibrary
const content=normalizeText(oneDayText)[0],work={content,candidates:candidatesFor(content),bindings:Object.fromEntries(content.blocks.map(b=>[b.id,componentBindings(b,library)]))}
const slide={...work,plan:fastPlan(work,0)},out=`outputs/diagnostics/studio-composition/${Date.now()}`
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
  const page=await browser.newPage()
  await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.abort())
  await page.goto('http://127.0.0.1:5184/processing-worker')
  const result=await page.evaluate(async({library,slide})=>{
    const path='/browser/studio-generation.ts'
    const {renderStudioOptions}=await import(path) as typeof import('../browser/studio-generation')
    return renderStudioOptions(library,slide)
  },{library,slide})
  for(const [i,option] of result.entries()){
    await writeFile(out+`/option-${i+1}.png`,Buffer.from(option.receipt!.preview.split(',')[1],'base64'))
    await writeFile(out+`/option-${i+1}.html`,option.receipt!.html)
  }
  await writeFile(out+'/options.json',JSON.stringify(result,null,2))
  console.log(JSON.stringify({out,options:result.map(o=>({id:o.id,candidate:o.plan.candidateId,signature:o.signature,components:o.plan.components,issues:o.receipt!.issues,warnings:o.receipt!.warnings,elapsedMs:o.receipt!.elapsedMs}))},null,2))
  if(result.length<3)process.exitCode=1
}finally{await browser.close()}
