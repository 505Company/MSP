import {test,expect} from '@playwright/test'
import {sourceStyleFixture} from '../fixtures/studio-source-style'
import {studioFixture} from '../fixtures/studio'
import {writeFile} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import type {EditableTemplate} from '../../lib/design-system/editable-contract'

const pill=JSON.parse(readFileSync(new URL('../fixtures/source-pill-metric.json',import.meta.url),'utf8')) as EditableTemplate

for(const caption of ['Время выбора','Столько в среднем пользователь готов потратить на первичный выбор направления.'])test(`source badge accepts a short label, but gives a long explanation an open area: ${caption.length}`,async({page},info)=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
  const run=studioFixture('fast','# Выбор направления\n\n4 минуты\nСтолько в среднем пользователь готов потратить на первичный выбор направления.')
  run.slides[0].content.blocks[1]={id:'b2',kind:'metric',role:'body',fields:{value:'4 минуты',caption},source:`4 минуты\n${caption}`}
  run.library.editable=[pill as EditableTemplate];run.library.tokens.colors=[{hex:'#000000',occurrences:1},{hex:'#FFFFFF',occurrences:1},{hex:'#0077FF',occurrences:1}]
  const receipt=await page.evaluate(async run=>{
    const path='/browser/studio-generation.ts',{renderStudioSlide}=await import(path) as typeof import('../../browser/studio-generation')
    const work=run.slides[0],c={id:'badge-test',recipeId:'badge-test',label:'Проверка',score:1,slots:[{region:'title',blocks:['b1'],direction:'column' as const,columns:1,gap:0,rect:{x:80,y:64,w:1760,h:156}},{region:'metric',blocks:['b2'],direction:'column' as const,columns:1,gap:0,rect:{x:80,y:268,w:752,h:732}}]}
    work.candidates=[c];work.bindings.b2=[{id:'b19-1',kind:'editable',fields:{value:'value','items.0.text':'caption'}}];work.plan={candidateId:c.id,components:{b2:'b19-1'},primary:['b2'],rationale:'Test'}
    return renderStudioSlide(run.library,work)
  },run)
  expect(receipt.passed,receipt.issues.join('; ')).toBe(true)
  expect(receipt.components.some(c=>c.componentId==='b19-1')).toBe(caption.length<20)
  expect(receipt.text.find(t=>t.field==='caption')?.value).toBe(run.slides[0].content.blocks[1].fields.caption)
  await writeFile(info.outputPath('open-caption.png'),Buffer.from(receipt.preview.split(',')[1],'base64'))
})

test('the source canvas and readable inks survive rendering on dark and light systems',async({page},info)=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
  await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
  await page.route('**/api/uploads/*/assets/image',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=','base64')}))
  await page.goto('/processing-worker')
  const dark=sourceStyleFixture(),light=structuredClone(dark)
  light.backgrounds!.fills[0].element.fill!.color={r:1,g:1,b:1,a:1}
  const run=studioFixture('fast','# Проверка исходного стиля\n\nТекст презентации остаётся читаемым и сохраняет все слова.')
  const results=await page.evaluate(async({libraries,work})=>{
    const path='/browser/studio-generation.ts',{renderStudioSlide}=await import(path) as typeof import('../../browser/studio-generation')
    const c={id:'source-style-test',recipeId:'source-style-test',label:'Проверка',score:1,slots:[{region:'title',blocks:['b1'],rect:{x:60,y:180,w:1120,h:270},direction:'column' as const,columns:1,gap:0},{region:'body',blocks:['b2'],rect:{x:60,y:490,w:1120,h:350},direction:'column' as const,columns:1,gap:0}]}
    const results=[]
    for(const library of libraries){
      const receipt=await renderStudioSlide(library,{...work,content:{...work.content,id:'slide-2'},candidates:[c],plan:{candidateId:c.id,components:{},primary:[],rationale:'Test'}})
      const host=document.createElement('div');host.innerHTML=receipt.html;document.body.appendChild(host)
      const root=host.querySelector<HTMLElement>('[data-studio-slide]')!,background=getComputedStyle(root).backgroundColor
      const inks=[...host.querySelectorAll<HTMLElement>('[data-field]')].map(el=>getComputedStyle(el).color)
      host.remove();results.push({receipt,background,inks})
    }
    return results
  },{libraries:[dark,light],work:run.slides[0]})
  expect(results.map(r=>r.background)).toEqual(['rgb(0, 0, 0)','rgb(255, 255, 255)'])
  expect(results[0].inks).toEqual(['rgb(255, 255, 255)','rgb(255, 255, 255)'])
  expect(results[1].inks).toEqual(['rgb(0, 0, 0)','rgb(0, 0, 0)'])
  for(const [index,{receipt}] of results.entries()){
    expect(receipt.passed,receipt.issues.join('; ')).toBe(true)
    expect(receipt.html).toContain('data-studio-background')
    expect(receipt.html).toContain('data:image/png;base64,')
    expect(receipt.text.map(t=>t.value)).toEqual(run.slides[0].content.blocks.map(b=>b.fields.text))
    await writeFile(info.outputPath(`source-style-${index}.png`),Buffer.from(receipt.preview.split(',')[1],'base64'))
  }
})
