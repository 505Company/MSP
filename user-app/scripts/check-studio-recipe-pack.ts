import {chromium} from '@playwright/test'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {normalizeText} from '../lib/presentations/studio/material'
import {candidatesFor} from '../lib/presentations/studio/recipes'
import {componentBindings} from '../lib/presentations/studio/bindings'
import {draftOptions} from '../lib/presentations/studio/options'
import {recipeExamples} from '../tests/fixtures/studio-recipe-examples'
import type {StudioLibrary} from '../lib/presentations/studio/contract'

const library=JSON.parse(await readFile('outputs/diagnostics/studio-composition/library-vk.json','utf8')) as StudioLibrary
const out=`outputs/diagnostics/studio-recipe-pack/${Date.now()}`
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
try{
  const page=await browser.newPage();await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.abort());await page.goto('http://127.0.0.1:5184/processing-worker')
  const results=[]
  for(const [i,example] of recipeExamples.entries()){
    const content=normalizeText(example.text)[0],candidate=candidatesFor(content).find(c=>c.id===example.recipe)
    if(!candidate)throw Error('Incompatible example: '+example.recipe)
    const work={content,candidates:[candidate],bindings:Object.fromEntries(content.blocks.map(b=>[b.id,componentBindings(b,library)]))},plan=draftOptions(work,library)[0].plan
    const result=await page.evaluate(async({library,work,plan})=>{const path='/browser/studio-generation.ts';const {renderStudioSlide}=await import(path) as typeof import('../browser/studio-generation');return renderStudioSlide(library,{...work,plan})},{library,work,plan})
    await writeFile(out+`/${i+1}.png`,Buffer.from(result.preview.split(',')[1],'base64'));await writeFile(out+`/${i+1}.html`,result.html)
    results.push({example,content,candidate,plan,result});console.log(JSON.stringify({recipe:example.recipe,passed:result.passed,issues:result.issues,warnings:result.warnings,components:result.components.map(c=>c.componentId),elapsedMs:result.elapsedMs}))
  }
  await writeFile(out+'/results.json',JSON.stringify(results))
  const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Шесть новых рецептов MSP</title><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#f4f5f7;color:#172534;font:20px system-ui}h1{margin:0 0 28px;font-size:32px}main{display:grid;grid-template-columns:repeat(2,1fr);gap:30px}figure{margin:0}img{width:100%;display:block;background:white;border:1px solid #d9dfe7}figcaption{font-weight:600;margin-top:12px}</style><h1>Шесть новых рецептов · автоматическое заполнение · VK</h1><main>${results.map((r,i)=>`<figure><img src="${r.result.preview}" alt="${r.candidate.label}"><figcaption>${i+1}. ${r.candidate.label}</figcaption></figure>`).join('')}</main></html>`
  await writeFile(out+'/overview.html',html);await page.setViewportSize({width:1920,height:900});await page.setContent(html);await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>(img as HTMLImageElement).decode())));await page.screenshot({path:out+'/overview.png',fullPage:true})
  console.log(JSON.stringify({out,passed:results.every(r=>r.result.passed)}));if(results.some(r=>!r.result.passed))process.exitCode=1
}finally{await browser.close()}
