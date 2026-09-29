import {test,expect} from './workspace-fixture'
import {writeFile} from 'node:fs/promises'
import {studioFixture} from '../fixtures/studio'
import type {Candidate,ContentSlide,SlideWork} from '../../lib/presentations/studio/contract'

test('text fitting grows and shrinks within fixed areas while retaining heading hierarchy',async({page},info)=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
  await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
  await page.goto('/processing-worker')
  const candidate:Candidate={id:'font-fit',recipeId:'font-fit',label:'Fixed slots',score:1,slots:[
    {region:'title',blocks:['title'],rect:{x:48,y:48,w:900,h:160},direction:'column',columns:1,gap:0},
    {region:'body',blocks:['body'],rect:{x:48,y:240,w:900,h:480},direction:'column',columns:1,gap:0},
  ]}
  const works:SlideWork[]=['Короткий заголовок','Путешественники ждут понятных маршрутов, удобного сервиса и новых впечатлений','Слишком длинный заголовок. '.repeat(80)].map(text=>({
    content:{id:'s',title:text,directions:[],blocks:[{id:'title',role:'title',kind:'text',source:text,fields:{text}},{id:'body',role:'body',kind:'text',source:'Содержимое соседнего блока',fields:{text:'Содержимое соседнего блока'}}]},
    candidates:[candidate],bindings:{},plan:{candidateId:candidate.id,components:{},primary:[],rationale:'Font fitting regression'},
  }))
  const result=await page.evaluate(async({works,library})=>{
    const path='/browser/studio-generation.ts',{renderStudioSlide}=await import(path) as typeof import('../../browser/studio-generation'),out=[]
    for(const w of works)out.push(await renderStudioSlide(library,w));return out
  },{works,library:studioFixture().library})
  for(const [i,r] of result.entries())await writeFile(info.outputPath(`font-${i}.json`),JSON.stringify(r))
  expect(result[0].passed,result[0].issues.join('; ')).toBe(true)
  expect(result[1].passed,result[1].issues.join('; ')).toBe(true)
  const sizes=result.map(r=>r.text.find(t=>t.blockId==='title')!.size)
  expect(sizes[1]).toBeLessThan(sizes[0]);expect(sizes[1]).toBeGreaterThanOrEqual(40)
  expect(result[1].text.find(t=>t.blockId==='body')!.size).toBeGreaterThanOrEqual(28);expect(result[1].text.find(t=>t.blockId==='body')!.size).toBeLessThan(sizes[1])
  expect(result[2].passed).toBe(false);expect(sizes[2]).toBe(40)
  expect(result.every(r=>r.text.every(t=>t.size%4===0))).toBe(true)
})

test('native table fits by font size without changing slots, padding, rows or data',async({page},info)=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
  await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
  await page.goto('/processing-worker')
  const values={columns:['Сценарий','Доля','Поездок'],rows:[['Командировки','31%','7,2×'],['Пары','24%','4,1×'],['Семьи','19%','3,4×'],['Solo','14%','5,6×'],['Другие','12%','2,8×']]}
  const candidate:Candidate={id:'fixed-table',recipeId:'fixed-table',label:'Fixed table',score:1,slots:[{region:'data',blocks:['table'],rect:{x:48,y:120,w:1100,h:480},direction:'column',columns:1,gap:0}]}
  const content:ContentSlide={id:'s',title:'Аудитория',directions:[],blocks:[{id:'table',kind:'visual',role:'body',source:JSON.stringify(values),fields:{},data:{template:{id:'table',kind:'table',name:'Таблица',description:'',tags:[],slide:1,sourceIds:[],memberIds:[],width:1100,height:600,style:{font:'Play',fontSize:32,padding:20,color:'#162D40',headerFill:'#00805E',headerColor:'#FFFFFF'},config:{},data:values,graphicHtml:{},dataStatus:'native'},values}}]}
  const result=await page.evaluate(async({candidate,content,library})=>{
    const path='/browser/studio-generation.ts',{renderStudioSlide}=await import(path) as typeof import('../../browser/studio-generation')
    const work={content,candidates:[candidate],bindings:{},plan:{candidateId:candidate.id,components:{},primary:[],rationale:'Font fitting regression'}},out=[]
    for(const height of [620,480,200]){
      const w=structuredClone(work);w.candidates[0].slots[0].rect.h=height
      const r=await renderStudioSlide(library,w),host=document.createElement('div');host.innerHTML=r.html;document.body.appendChild(host)
      const box=host.querySelector<HTMLElement>('[data-block]')!,cell=box.querySelector('th')!,s=getComputedStyle(cell),rect=box.getBoundingClientRect()
      out.push({receipt:r,cellSize:parseFloat(s.fontSize),padding:s.padding,box:{w:rect.width,h:rect.height},values:[...box.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('td,th')].map(c=>c.textContent))});host.remove()
    }return out
  },{candidate,content,library:studioFixture().library})
  await writeFile(info.outputPath('table-fit.json'),JSON.stringify(result))
  expect(result[0].receipt.passed).toBe(true)
  expect(result[1].receipt.passed,result[1].receipt.issues.join('; ')).toBe(true)
  expect(result[0].cellSize).toBe(32);expect(result[1].cellSize).toBe(24)
  expect(result[1].padding).toBe(result[0].padding);expect(result[1].box).toEqual({w:1100,h:480})
  expect(result[1].values).toEqual([values.columns,...values.rows])
  expect(result[2].cellSize).toBe(24);expect(result[2].receipt.passed).toBe(false)
})
