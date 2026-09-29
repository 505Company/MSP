import {test,expect} from './workspace-fixture'
import {writeFile} from 'node:fs/promises'
import {studioFixture} from '../fixtures/studio'
import {stage7Compound,stage7Table,textBlock,metricBlock} from '../fixtures/studio-stage7'
import {candidatesFor} from '../../lib/presentations/studio/recipes'
import {receiptPreservesFields} from '../../lib/presentations/studio/field-bindings'
import {labUnitMetric} from '../../component-lab/fixtures'
import {sourceCandidate} from '../../lib/component-lab/source'
import {LAB_VERSION} from '../../lib/component-lab/contract'
import type {Candidate,ContentSlide,SlideWork} from '../../lib/presentations/studio/contract'

test.beforeEach(async({page})=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
  await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
  await page.goto('/processing-worker')
})

test('all assignments are measured at preferred size before a narrow candidate can shrink the title',async({page})=>{
  const text='Путешественники ждут понятных маршрутов, удобного сервиса и новых впечатлений',content:ContentSlide={id:'s',title:text,directions:[],blocks:[textBlock('title',text,'title')]}
  const candidates:Candidate[]=[900,1824].map((w,i)=>({id:`allocation-${i}`,recipeId:'one-recipe',label:`Распределение ${i}`,score:100-i,slots:[{region:'title',blocks:['title'],rect:{x:48,y:48,w,h:160},direction:'column',columns:1,gap:0}]}))
  const work:SlideWork={content,candidates,bindings:{},plan:{candidateId:candidates[0].id,primary:[],components:{},rationale:''}}
  const result=await page.evaluate(async({work,library})=>{const p='/browser/studio-generation.ts',{renderStudioSlide,renderStudioOptions}=await import(p) as typeof import('../../browser/studio-generation');return {direct:await renderStudioSlide(library,work),options:await renderStudioOptions(library,work)}},{work,library:studioFixture().library})
  expect(result.direct.passed).toBe(true);expect(result.direct.candidateId).toBe('allocation-1');expect(result.direct.text[0].size).toBeGreaterThanOrEqual(64)
  expect(result.options.length).toBeGreaterThanOrEqual(1);expect(result.options[0].receipt!.candidateId).toBe('allocation-1');expect(result.options[0].receipt!.text[0].size).toBeGreaterThanOrEqual(64)
})

test('nested fields and repeated items render all words and numbers through the incoming contract',async({page},info)=>{
  const content=stage7Compound(),candidates=candidatesFor(content,'new').filter(c=>c.recipeId==='39:798/display-two-approaches'&&!c.mirrored),work:SlideWork={content,candidates,bindings:{},plan:{candidateId:candidates[0].id,primary:[],components:{},rationale:''}}
  const receipt=await page.evaluate(async({library,work})=>{const p='/browser/studio-generation.ts';return (await import(p) as typeof import('../../browser/studio-generation')).renderStudioSlide(library,work)},{work,library:studioFixture().library})
  expect(receipt.passed,receipt.issues.join('; ')).toBe(true)
  for(const b of content.blocks)expect(receiptPreservesFields(b,receipt.text)).toBe(true)
  expect(receipt.text.filter(t=>t.blockId==='approach-1'&&t.sourceRange).length).toBe(7)
  await writeFile(info.outputPath('nested.png'),Buffer.from(receipt.preview.split(',')[1],'base64'))
})

test('wide table plus two compact KPIs and conclusion keeps native cells and DS component sizes',async({page},info)=>{
  const {profile}=await sourceCandidate(labUnitMetric(),'fixture'),library=studioFixture().library
  const content:ContentSlide={id:'s',title:'Аудитория',directions:[],blocks:[textBlock('title','Аудитория','title'),stage7Table(),metricBlock('metric-1','76%','Самостоятельные поездки'),metricBlock('metric-2','38 млн','Путешественники'),textBlock('note','Итог: сохраняем все данные 2026 года.','footer')]}
  const candidates=candidatesFor(content,'new').filter(c=>c.authored?.variant?.kind==='table-content'&&c.authored.variant.density==='compact'&&!c.mirrored)
  const result=await page.evaluate(async({content,candidates,library,profile,labVersion})=>{
    const paths={render:'/browser/studio-generation.ts',fonts:'/browser/component-lab/fonts.ts',bind:'/lib/presentations/studio/bindings.ts'}
    const {sourceFonts}=await import(paths.fonts) as typeof import('../../browser/component-lab/fonts'),{componentBindings}=await import(paths.bind) as typeof import('../../lib/presentations/studio/bindings'),{renderStudioSlide}=await import(paths.render) as typeof import('../../browser/studio-generation')
    const resources=await sourceFonts(library.uploadId,profile!,true)
    library.prepared.metric={version:`preparation-1:${profile!.version}:${labVersion}`,profile:profile!,faces:resources.faces??[],assets:resources.artwork?.assets??[],fidelity:{status:'preserved'}} as typeof library.prepared[string]
    const work={content,candidates,bindings:Object.fromEntries(content.blocks.map(b=>[b.id,componentBindings(b,library)])),plan:{candidateId:candidates[0].id,primary:[],components:{'metric-1':'metric','metric-2':'metric'},rationale:''}}
    return renderStudioSlide(library,work)
  },{content,candidates,library,profile,labVersion:LAB_VERSION})
  await writeFile(info.outputPath('wide-table-receipt.json'),JSON.stringify(result))
  expect(result.passed,result.issues.join('; ')).toBe(true)
  expect(result.dataValues![0].values).toEqual(content.blocks[1].data!.values)
  const table=result.components.find(c=>c.blockId==='data')!;expect(table.width).toBe(1828)
  const metrics=result.components.filter(c=>c.kind==='prepared');expect(metrics.length).toBe(2)
  expect(metrics.every(c=>c.state==='compact')).toBe(true)
  for(const b of content.blocks.filter(b=>b.kind==='metric'))for(const f of profile!.fields){const role=f.role==='number'?'value':'caption';expect(result.text.find(t=>t.blockId===b.id&&t.field===role)!.size).toBe(f.size)}
  await writeFile(info.outputPath('wide-table.png'),Buffer.from(result.preview.split(',')[1],'base64'))
})

test('mirrored data composition retains a unilateral right-side request after measured fitting',async({page},info)=>{
  const content:ContentSlide={id:'s',title:'Данные справа',directions:['Таблица справа'],blocks:[textBlock('title','Данные справа','title'),{...stage7Table(),placement:'right'},metricBlock('metric','76%','Самостоятельные поездки')]}
  const candidates=candidatesFor(content,'new').filter(c=>c.mirrored&&c.authored?.variant?.kind==='data-sidebar')
  const receipt=await page.evaluate(async({content,candidates,library})=>{const p='/browser/studio-generation.ts';return (await import(p) as typeof import('../../browser/studio-generation')).renderStudioSlide(library,{content,candidates,bindings:{},plan:{candidateId:candidates[0].id,primary:[],components:{},rationale:''}})},{content,candidates,library:studioFixture().library})
  expect(receipt.passed,receipt.issues.join('; ')).toBe(true);expect(receipt.candidateId).toMatch(/\/mirror$/)
  const candidate=candidates.find(c=>c.id===receipt.candidateId)!,data=candidate.slots.find(s=>s.blocks.includes('data'))!,metric=candidate.slots.find(s=>s.blocks.includes('metric'))!
  expect(data.rect.x).toBeGreaterThanOrEqual(metric.rect.x+metric.rect.w)
  await writeFile(info.outputPath('mirror.png'),Buffer.from(receipt.preview.split(',')[1],'base64'))
})

test('a seven-item compound preserves column-major order and puts its conclusion after the last item',async({page})=>{
  const body=Array.from({length:7},(_,i)=>`- Тезис ${i+1}`).join('\n'),content:ContentSlide={id:'s',title:'Семь тезисов',directions:[],blocks:[textBlock('title','Семь тезисов','title'),{id:'list',kind:'list',role:'body',fields:{body,conclusion:'Итого: 7 тезисов'},source:body+'\nИтого: 7 тезисов'}]}
  const candidate=candidatesFor(content,'new').find(c=>!c.mirrored&&c.recipeId==='39:514/seven-theses-01'&&c.authored?.primitives.list.direction==='row')!
  expect(candidate).toBeTruthy()
  const result=await page.evaluate(async({content,candidate,library})=>{const p='/browser/studio-generation.ts';return (await import(p) as typeof import('../../browser/studio-generation')).renderStudioSlide(library,{content,candidates:[candidate],bindings:{},plan:{candidateId:candidate.id,primary:[],components:{},rationale:''}})},{content,candidate,library:studioFixture().library})
  expect(result.passed,result.issues.join('; ')).toBe(true)
  expect(receiptPreservesFields(content.blocks[1],result.text)).toBe(true)
  const items=Array.from({length:7},(_,i)=>result.text.find(t=>t.value.trim()===`Тезис ${i+1}`)!)
  expect(items.slice(0,4).every(t=>t.x===items[0].x)).toBe(true)
  expect(items.slice(4).every(t=>t.x===items[4].x)).toBe(true);expect(items[4].x).toBeGreaterThan(items[0].x)
  expect(items[3].y).toBeGreaterThan(items[0].y);expect(items[6].y).toBeGreaterThan(items[4].y)
  const tail=result.text.find(t=>t.field==='conclusion')!
  expect(tail.x).toBeGreaterThan(items[0].x+200);expect(tail.y).toBeGreaterThan(items[6].y+items[6].height)
})
