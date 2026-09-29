import {test,expect} from '@playwright/test'
import {sourceStyleFixture} from '../fixtures/studio-source-style'
import {normalizeText} from '../../lib/presentations/studio/material'
import {studioFixture} from '../fixtures/studio'

test('three modes produce different reading compositions while reusing only observed canvases',async({page})=>{
 const library=sourceStyleFixture(),dark=library.backgrounds!.fills[0],light=structuredClone(dark)
 light.id='source-light';light.slides=[1,2,3,4,5,6]
 light.element.fill={type:'solid',color:{r:1,g:1,b:1,a:1}}
 library.backgrounds!.fills.push(light)
 const content=normalizeText('# Что делает продукт удобным\n\nПонятный маршрут\n\nПрозрачная цена\n\nХорошая навигация\n\nБыстрое бронирование\n\nАктуальная информация\n\nПоддержка в поездке')[0]
 await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
 await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
 await page.route('**/api/uploads/*/assets/image',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=','base64')}))
 await page.goto('/processing-worker')
 const results=await page.evaluate(async({library,content})=>{
  const p={recipes:'/lib/presentations/studio/recipes.ts',directions:'/lib/presentations/studio/art-direction.ts',render:'/browser/studio-generation.ts',fields:'/lib/presentations/studio/field-bindings.ts'}
  const {artDirectedCandidates}=await import(p.directions) as typeof import('../../lib/presentations/studio/art-direction'),{candidatesFor}=await import(p.recipes) as typeof import('../../lib/presentations/studio/recipes'),{renderStudioOptions}=await import(p.render) as typeof import('../../browser/studio-generation'),{receiptPreservesFields}=await import(p.fields) as typeof import('../../lib/presentations/studio/field-bindings')
  const candidates=artDirectedCandidates(content,candidatesFor(content),library),result=[]
  for(const mode of ['fast','balanced','creative'] as const){
   const work={content,candidates,bindings:{},variation:{mode,seed:'same-test',sourceKey:'source-brief'}},options=await renderStudioOptions(library,work,undefined,{limit:1}),o=options[0],c=candidates.find(c=>c.id===o.plan.candidateId)!,r=o.receipt!,doc=new DOMParser().parseFromString(r.html,'text/html'),root=doc.querySelector<HTMLElement>('[data-studio-slide]')!
   result.push({mode,passed:r.passed,direction:c.artDirection??'fast',headline:c.slots.find(s=>s.blocks.includes(content.blocks[0].id))!.rect,background:root.style.backgroundColor,fields:content.blocks.every(b=>receiptPreservesFields(b,r.text))})
  }
  return result
 },{library,content})
 expect(results.every(r=>r.passed&&r.fields)).toBe(true)
 expect(results.map(r=>r.direction)).toEqual(['fast','balanced','creative'])
 expect(new Set(results.map(r=>JSON.stringify(r.headline))).size).toBe(3)
 expect(results.map(r=>r.background)).toEqual(['rgb(255, 255, 255)','rgb(255, 255, 255)','rgb(0, 0, 0)'])
})

test('text over a neutral recipe panel takes its ink from the panel',async({page})=>{
 const library=sourceStyleFixture()
 library.backgrounds!.fills[0].element.fill!.color={r:1,g:1,b:1,a:1}
 library.tokens.colors.push({hex:'#DDE3EA',occurrences:20})
 library.prepared={};library.editable=[]
 await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
 await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
 await page.goto('/processing-worker')
 const work=studioFixture('fast','# Шаги поездки\n\nДо поездки: выбрать направление и купить билет.').slides[0]
 const result=await page.evaluate(async({library,work})=>{
  const path='/browser/studio-generation.ts',{renderStudioSlide}=await import(path) as typeof import('../../browser/studio-generation')
  const candidate={id:'panel-check',recipeId:'panel-check',label:'Проверка',score:1,slots:[
   {region:'title',blocks:['b1'],direction:'column' as const,columns:1,gap:0,rect:{x:80,y:64,w:1760,h:160}},
   {region:'body',blocks:['b2'],direction:'column' as const,columns:1,gap:0,rect:{x:108,y:296,w:1696,h:620},presentation:{primitiveFirst:true,ink:'panel' as const}},
  ],decorations:[{id:'surface',rect:{x:80,y:268,w:1760,h:676},surface:'panel' as const}]}
  const receipt=await renderStudioSlide(library,{...work,candidates:[candidate],bindings:{},plan:{candidateId:candidate.id,components:{},primary:[],rationale:'Test'}})
  const host=document.createElement('div');host.innerHTML=receipt.html;document.body.appendChild(host)
  const text=host.querySelector<HTMLElement>('[data-block-id="b2"] [data-field]')??[...host.querySelectorAll<HTMLElement>('[data-field]')].find(el=>el.textContent?.includes('До поездки'))!
  const color=getComputedStyle(text).color;host.remove()
  return {passed:receipt.passed,color}
 },{library,work})
 expect(result.passed).toBe(true)
 expect(result.color).toBe('rgb(0, 0, 0)')
})
