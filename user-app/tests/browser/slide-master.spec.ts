import {test,expect} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {slideMasterFixture} from '../fixtures/slide-master'
import {studioFixture} from '../fixtures/studio'
import {buildBackgroundCatalog} from '../../lib/design-system/backgrounds'
import {masterContentArea} from '../../lib/design-system/slide-masters'

test('the fixed footer survives ordinary, inverse and cover rendering and portable export',async({page},info)=>{
 await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
 await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
 await page.route('**/api/uploads/*/assets/*',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="112" height="22"><rect width="112" height="22" fill="#ffd600"/><text x="5" y="17" font-size="16">BRAND</text></svg>'}))
 await page.goto('/processing-worker')
 const run=studioFixture('fast','# Фирменный слайд\n\nПодвал сохраняется при изменении содержания.'),f=slideMasterFixture()
 run.library.backgrounds=buildBackgroundCatalog(f.snapshot,f.library,'source')
 const results=await page.evaluate(async run=>{
  const load=(p:string)=>import(p),{renderStudioSlide}=await load('/browser/studio-generation.ts'),{libraryCoverCandidates}=await load('/lib/presentations/studio/visual-design.ts')
  const work=run.slides[0],ordinary={id:'ordinary',recipeId:'test',label:'Test',score:1,slots:[{region:'title',blocks:['b1'],direction:'column',columns:1,gap:0,rect:{x:64,y:64,w:1400,h:200}},{region:'body',blocks:['b2'],direction:'column',columns:1,gap:0,rect:{x:64,y:304,w:1400,h:728}}]},inverse={...ordinary,id:'inverse',authored:{bundleId:'test',stateId:'test',regions:{},layers:[],surface:'slide-inverse'}}
  const results=[]
  for(const c of [ordinary,inverse,libraryCoverCandidates(work.content,run.library)[0]]){
   const receipt=await renderStudioSlide(run.library,{...work,candidates:[c],plan:{candidateId:c.id,components:{},primary:[],rationale:'Test'}})
   const el=document.createElement('div');el.innerHTML=receipt.html
   results.push({receipt,masters:el.querySelectorAll('[data-studio-master]').length,images:[...el.querySelectorAll('[data-studio-master] image')].map(e=>e.getAttribute('href'))})
  }
  return results
 },run)
 const area=masterContentArea(run.library.backgrounds.masters![0])
 for(const [index,{receipt,masters,images}] of results.entries()){
  expect(receipt.passed,receipt.issues.join('; ')).toBe(true)
  expect(masters).toBe(1);expect(images).toHaveLength(1)
  expect(images[0]).toMatch(/^data:image\/svg\+xml;base64,/)
  expect(receipt.text.every((t:{y:number;height:number})=>t.y+t.height<=area.y+area.h+1)).toBe(true)
  expect(receipt.text.map((t:{value:string})=>t.value).sort()).toEqual(run.slides[0].content.blocks.map(b=>b.fields.text).sort())
  await writeFile(info.outputPath(`footer-${index}.png`),Buffer.from(receipt.preview.split(',')[1],'base64'))
 }
})
