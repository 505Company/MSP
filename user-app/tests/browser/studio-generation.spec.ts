import { test,expect } from './workspace-fixture'
import { readFile, writeFile } from 'node:fs/promises'
import { studioFixture,studioText } from '../fixtures/studio'
import {recipeExamples} from '../fixtures/studio-recipe-examples'
import {oneDayText} from '../fixtures/studio-one-day'
import { normalizeText } from '../../lib/presentations/studio/material'
import {receiptPreservesFields} from '../../lib/presentations/studio/field-bindings'
import { candidatesFor } from '../../lib/presentations/studio/recipes'
import { fastPlan } from '../../lib/presentations/studio/bindings'
import {listStudioGenerations} from '../../lib/presentations/studio/generations'
import { studioKey,readStudioRun,commitStudioOptions,chooseStudioOption,applyStudioOption,validateReceipt } from '../../lib/presentations/studio/storage'
import {offeredOptions} from '../../lib/presentations/studio/options'
import {recordStudioHistory,readStudioHistory} from '../../lib/presentations/studio/history'
import {memoryBucket} from '../helpers/memory-bucket'
import { labUnitMetric } from '../../component-lab/fixtures'
import { sourceCandidate } from '../../lib/component-lab/source'
import { LAB_VERSION } from '../../lib/component-lab/contract'
import type { StudioRun } from '../../lib/presentations/studio/contract'
import type { PresentationProject } from '../../lib/workspace/types'

test('dense review metrics fit unchanged recipe without the old seventy-percent type floor',async({page},info)=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
  const source=await readFile('tests/fixtures/studio-content-456.md','utf8'),work=studioFixture('fast',source.split('---')[0]).slides[0],library=studioFixture().library
  const result=await page.evaluate(async({library,work})=>{
    const paths={render:'/browser/studio-generation.ts',options:'/lib/presentations/studio/options.ts'}
    const candidate=work.candidates.find(c=>c.id==='composition/metrics')!,single={...work,candidates:[candidate]}
    const {draftOptions}=await import(paths.options) as typeof import('../../lib/presentations/studio/options')
    return (await import(paths.render) as typeof import('../../browser/studio-generation')).renderStudioSlide(library,{...single,plan:draftOptions(single,library)[0].plan})
  },{library,work})
  expect(result.passed,result.issues.join('; ')).toBe(true)
  for(const b of work.content.blocks)expect(receiptPreservesFields(b,result.text)).toBe(true)
  expect(result.text.every(t=>t.size>=20&&t.size%4===0)).toBe(true)
  await writeFile(info.outputPath('dense-reviews.png'),Buffer.from(result.preview.split(',')[1],'base64'))
})

test('both modes create from file/text, persist previews, reopen without paid calls and retain history after edits',async({page},info)=>{
  const inputText=oneDayText+'\n---\n'+studioText.split('---')[1],fixture=studioFixture('fast',inputText),style={id:fixture.library.uploadId,name:fixture.library.name,fileName:'test.pptx',sourceId:'a',createdAt:fixture.createdAt,slideCount:2,componentCount:5,styleCount:4,previewId:null,colors:['#00805E'],fonts:['Play']}
  let project:PresentationProject|null=null,run:StudioRun|null=null,designs=0,renders=0,starts=0,structures=0
  let parsed:StudioRun['slides']=[]
  const {bucket}=memoryBucket()
  await page.route('**/api/style-bank',r=>r.fulfill({json:{styles:[style,{...style,id:'c7e332ce-47fa-44e8-94bc-ddf9845afed2',name:'Другая система',colors:['#A03032']}]}}))
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
  await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
  await page.route('**/api/projects',async r=>{if(r.request().method()==='POST'){const p=r.request().postDataJSON();project={schemaVersion:1,...p,revision:crypto.randomUUID(),createdAt:fixture.createdAt,updatedAt:fixture.createdAt,styleName:style.name};return r.fulfill({status:201,json:{project}})}return r.fulfill({json:{projects:[]}})})
  await page.route('**/api/projects/*',async r=>{
    const path=new URL(r.request().url()).pathname
    if(!/^\/api\/projects\/[^/]+$/.test(path))return r.fallback()
    if(r.request().method()==='PUT'){project={...project!,...r.request().postDataJSON(),revision:crypto.randomUUID()};run=null}
    await r.fulfill({json:{project}})
  })
  await page.route('**/api/projects/*/generations',async r=>r.fulfill({json:{generations:await listStudioGenerations(bucket,project!.id)}}))
  await page.route('**/api/projects/*/compose*',async r=>{
    if(r.request().method()==='POST'){
      const b=r.request().postDataJSON()
      if(b.action==='start'){starts++;run=studioFixture(project!.generationMode,inputText);run.projectId=project!.id;run.revision=project!.revision;run.library.uploadId=project!.uploadId;run.status='preparing'
        const history=await readStudioHistory(bucket,project!.id)
        for(const s of run.slides){delete s.plan;s.contentKey=s.content.id;s.history=history.entries.filter(e=>e.contentKey===s.contentKey).map(e=>e.signature)}
        // Simulated semantic reply for the UI contract, not a model-quality test.
        if(run.mode==='smart'){parsed=run.slides;run.slides=[];run.semantic={source:inputText,status:'pending'}}
        await bucket.put(`workspace/projects/${project!.id}.json`,JSON.stringify(project));await bucket.put(studioKey(run.projectId,run.revision),JSON.stringify(run))
      }
      if(b.action==='structure'){
        structures++;expect(run!.slides).toHaveLength(0);expect(run!.semantic?.source).toBe(inputText)
        run!.semantic!.status='complete';run!.slides=parsed;run!.modelRequests=1
        await bucket.put(studioKey(run!.projectId,run!.revision),JSON.stringify(run))
      }
      if(b.action==='options'){renders++;run=await commitStudioOptions(bucket,project!.id,project!.revision,b.receipt)}
      if(b.action==='choose')run=await chooseStudioOption(bucket,project!.id,project!.revision,b.slideId,b.optionId)
      if(b.action==='design'){designs++;for(const s of run!.slides)if(!s.plan)applyStudioOption(run!,s.content.id,offeredOptions(s)[0].id)
        await bucket.put(studioKey(run!.projectId,run!.revision),JSON.stringify(run));await recordStudioHistory(bucket,run!)
        await r.fulfill({contentType:'application/x-ndjson',body:'{"complete":true}\n'});return
      }
    }
    const revision=new URL(r.request().url()).searchParams.get('revision')??project!.revision
    await r.fulfill({json:{run:await readStudioRun(bucket,project!.id,revision),configured:true}})
  })
  await page.goto('/create')
  await expect(page.locator('#presentation-style input')).toHaveCount(2)
  await page.getByLabel('Файл содержания').setInputFiles({name:'Поездки.md',mimeType:'text/markdown',buffer:Buffer.from(inputText)})
  await expect(page.locator('#presentation-content')).toHaveValue(inputText)
  await page.getByRole('button',{name:'Сгенерировать слайды'}).click()
  await expect(page.locator('.ws-slide-canvas img')).toHaveCount(2,{timeout:90000})
  await expect(page.locator('[data-generation-busy=true]')).toHaveCount(0)
  expect(designs).toBe(0);expect(renders).toBe(2)
  await page.screenshot({path:info.outputPath('fast-project.png'),fullPage:true})
  const chosen=run!.slides[0].plan!.optionId
  await page.reload();await expect(page.locator('.ws-slide-canvas img')).toHaveCount(2);expect(renders).toBe(2);expect(starts).toBe(1)
  expect(run!.slides[0].plan!.optionId).toBe(chosen)
  // Explicit regeneration must not merely redisplay the previous saved run.
  const beforeRevision=project!.revision
  await page.getByRole('button',{name:'Сгенерировать слайды'}).click()
  await expect.poll(()=>renders).toBe(4)
  await expect(page.locator('.ws-slide-canvas img')).toHaveCount(4)
  await expect(page.locator('[data-generation-busy=true]')).toHaveCount(0)
  expect(run!.slides[0].plan!.optionId).not.toBe(chosen)
  expect(project!.revision).not.toBe(beforeRevision);expect(designs).toBe(0)
  await page.getByRole('button',{name:'Содержание и параметры'}).click()
  await page.getByRole('radio',{name:/Сбалансированный/}).check()
  await expect(page.getByRole('button',{name:'Сгенерировать слайды'})).toBeEnabled()
  await page.getByRole('button',{name:'Сгенерировать слайды'}).click()
  await expect(page.locator('.ws-slide-canvas img')).toHaveCount(6,{timeout:90000})
  await expect.poll(()=>renders,{timeout:90000}).toBe(6)
  expect(structures).toBe(1);expect(designs).toBe(0);expect(renders).toBe(6)
  await page.reload();await expect(page.locator('.ws-slide-canvas img')).toHaveCount(6);expect(structures).toBe(1);expect(renders).toBe(6)
  await expect(page.getByText('Исходники презентации',{exact:true})).toHaveCount(0)
  await expect(page.getByText(/Варианты оформления/)).toHaveCount(0)
  await page.getByRole('button',{name:'Содержание и параметры'}).click()
  await page.getByRole('radio', {name:/Другая система/}).check();await expect(page.locator('.ws-slide-canvas img')).toHaveCount(6)
})

test('prepared library card stretches; fields and data objects survive a second design system',async({page},info)=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
  await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
  await page.goto('/processing-worker')
  const fixture=studioFixture(),source=await sourceCandidate(labUnitMetric(),'fixture')
  const result=await page.evaluate(async({fixture,profile,preparationVersion})=>{
    const paths={render:'/browser/studio-generation.ts',fonts:'/browser/component-lab/fonts.ts',bind:'/lib/presentations/studio/bindings.ts'}
    const {sourceFonts}=await import(paths.fonts) as typeof import('../../browser/component-lab/fonts')
    const {componentBindings,fastPlan}=await import(paths.bind) as typeof import('../../lib/presentations/studio/bindings')
    const {renderStudioSlide}=await import(paths.render) as typeof import('../../browser/studio-generation')
    const resources=await sourceFonts(fixture.library.uploadId,profile!,true)
    fixture.library.tokens.fonts.push({family:'Arial',sizes:[28,48],occurrences:900})
    fixture.library.prepared.test={version:preparationVersion,profile:profile!,faces:resources.faces??[],assets:resources.artwork?.assets??[],fidelity:{status:'preserved'}} as typeof fixture.library.prepared[string]
    const slide=fixture.slides[0];slide.bindings=Object.fromEntries(slide.content.blocks.map(b=>[b.id,componentBindings(b,fixture.library)]));slide.plan=fastPlan(slide,0)
    slide.plan.candidateId='composition/evidence'
    const a=await renderStudioSlide(fixture.library,slide)
    const other=structuredClone(fixture);other.library.tokens.colors=[{hex:'#FFF8ED',occurrences:1},{hex:'#742C18',occurrences:1},{hex:'#BB5339',occurrences:1}];other.library.prepared={}
    other.library.tokens.fonts=other.library.tokens.fonts.filter(f=>f.family==='Play')
    other.library.tokens.fonts.unshift({family:'Unavailable MSP Test Font',sizes:[28,72],occurrences:999})
    const work=other.slides[1];work.bindings={};work.plan=fastPlan(work,0)
    const b=await renderStudioSlide(other.library,work)
    return {a,b}
  },{fixture,profile:source.profile,preparationVersion:`preparation-1:${source.profile!.version}:${LAB_VERSION}`})
  await writeFile(info.outputPath('raw-results.json'),JSON.stringify(result))
  expect(result.a.passed,JSON.stringify(result.a.issues)).toBe(true);expect(result.a.components.some(c=>c.componentId==='test'&&c.kind==='prepared')).toBe(true)
  expect(result.a.text.some(t=>t.value==='76%')).toBe(true);expect(result.b.passed,JSON.stringify(result.b.issues)).toBe(true)
  expect(result.a.text.find(t=>t.field==='text')?.font).toContain('Play')
  expect(result.a.html).toMatch(/@font-face\{font-family:"Play";[^}]+src:url\("data:/)
  expect(result.b.html).toContain('rgb(255, 248, 237)')
  expect(result.b.warnings.some(w=>w.includes('Unavailable MSP Test Font')&&w.includes('Play'))).toBe(true)
  await writeFile(info.outputPath('adaptive-card.png'),Buffer.from(result.a.preview.split(',')[1],'base64'))
  await writeFile(info.outputPath('second-system.png'),Buffer.from(result.b.preview.split(',')[1],'base64'))
})

test('all six new recipes fill unchanged content in an unrelated design system',async({page},info)=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
  const {library}=studioFixture();library.tokens.colors=[{hex:'#FFF8ED',occurrences:1},{hex:'#742C18',occurrences:1},{hex:'#BB5339',occurrences:1},{hex:'#F1D9C7',occurrences:1}];library.rules=['Основной цвет #BB5339']
  const results=await page.evaluate(async({library,examples})=>{
    const paths={render:'/browser/studio-generation.ts',material:'/lib/presentations/studio/material.ts',recipes:'/lib/presentations/studio/recipes.ts',options:'/lib/presentations/studio/options.ts'}
    const {renderStudioSlide}=await import(paths.render) as typeof import('../../browser/studio-generation'),{normalizeText}=await import(paths.material) as typeof import('../../lib/presentations/studio/material'),{candidatesFor}=await import(paths.recipes) as typeof import('../../lib/presentations/studio/recipes'),{draftOptions}=await import(paths.options) as typeof import('../../lib/presentations/studio/options')
    const results=[]
    for(const example of examples){const content=normalizeText(example.text)[0],candidate=candidatesFor(content).find(c=>c.id===example.recipe)!,work={content,candidates:[candidate],bindings:{}}
      results.push(await renderStudioSlide(library,{...work,plan:draftOptions(work,library)[0].plan}))
    }return results
  },{library,examples:recipeExamples})
  for(const [i,r] of results.entries()){
    expect(r.passed,`${recipeExamples[i].recipe}: ${r.issues.join('; ')}`).toBe(true)
    expect(r.html).not.toMatch(/#0077ff|#ebf3f9|0, 119, 255/i)
    expect(r.html).toContain('rgb(187, 83, 57)')
    const blocks=normalizeText(recipeExamples[i].text)[0].blocks
    for(const b of blocks)expect(receiptPreservesFields(b,r.text)).toBe(true)
    await writeFile(info.outputPath(`other-system-${i+1}.png`),Buffer.from(r.preview.split(',')[1],'base64'))
  }
})

test('native tables and charts keep exact data and export editable Office objects',async({page},info)=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
  const run=studioFixture(),content=normalizeText('# Данные')[0]
  const template={id:'test-table',kind:'table' as const,name:'Таблица',description:'Таблица',tags:['Таблица'],slide:1,sourceIds:['source'],memberIds:[],width:1000,height:500,data:{columns:['Регион','Рост'],rows:[['Нижегородская область','48%'],['Карелия','37%']]},columnWidths:[10,90],style:{font:'Play',fontSize:14,color:'#162D40',headerFill:'#00805E',headerColor:'#FFFFFF'},config:{},graphicHtml:{},dataStatus:'native' as const}
  content.blocks.push({id:'b2',kind:'visual',role:'body',fields:{},source:JSON.stringify(template.data),data:{template,values:template.data}})
  const work={content,candidates:candidatesFor(content),bindings:{},plan:undefined as ReturnType<typeof fastPlan>|undefined};work.plan=fastPlan(work,0)
  const report=await page.evaluate(async({run,work})=>{const path='/browser/studio-generation.ts';return (await import(path) as typeof import('../../browser/studio-generation')).renderStudioSlide(run.library,work)},{run,work})
  expect(report.passed,JSON.stringify(report.issues)).toBe(true);expect(report.html).toContain('<table');expect(report.html).toContain('48%')
  const firstWidth=Number(report.html.match(/<col style="width:\s*([\d.]+)%/)?.[1]);expect(firstWidth).toBeGreaterThan(40)
  expect(template.columnWidths).toEqual([10,90]);expect(report.html).toMatch(/font-size:\s*24px/)
  run.slides=[work];expect(validateReceipt(run,report,true).dataValues?.[0].values.rows).toEqual(template.data.rows)
  const forged=structuredClone(report);forged.dataValues![0].values.rows![0][1]='99%';expect(()=>validateReceipt(run,forged,true)).toThrow(/данные/)
  const {exportEditableTemplatePptx}=await import('../../lib/design-system/editable-pptx'),{default:JSZip}=await import('jszip')
  const table=await JSZip.loadAsync(await exportEditableTemplatePptx(template,template.data));expect(await table.file('ppt/slides/slide1.xml')!.async('string')).toContain('<a:tbl>')
  const chart={...template,id:'chart',kind:'chart' as const,config:{chartType:'bar' as const},data:{categories:['Алтай','Карелия'],series:[{name:'Рост',values:[48,37]}]}}
  const packed=await JSZip.loadAsync(await exportEditableTemplatePptx(chart,chart.data));expect(packed.file('ppt/embeddings/data.xlsx')).not.toBeNull();expect(await packed.file('ppt/charts/chart1.xml')!.async('string')).toContain('<c:v>48</c:v>')
  await writeFile(info.outputPath('editable-table.png'),Buffer.from(report.preview.split(',')[1],'base64'))
})

test('unreadable dense content is rejected rather than shrunk below the body floor',async({page})=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
  const {library}=studioFixture(),content={id:'dense',title:'Плотный материал',directions:[],blocks:[{id:'b1',role:'title' as const,kind:'text' as const,fields:{text:'Плотный материал'},source:'Плотный материал'},{id:'b2',role:'body' as const,kind:'text' as const,fields:{text:'Полное содержание должно оставаться читаемым. '.repeat(400)},source:'Полное содержание должно оставаться читаемым. '.repeat(400)}]}
  const candidate=candidatesFor(content).find(c=>c.id==='flex-mix-1')!,work={content,candidates:[candidate],bindings:{}};
  const receipt=await page.evaluate(async({library,work})=>{const path='/browser/studio-generation.ts';return (await import(path) as typeof import('../../browser/studio-generation')).renderStudioSlide(library,{...work,plan:{candidateId:work.candidates[0].id,components:{},primary:[],rationale:'Regression fixture'}})},{library,work})
  expect(receipt.passed).toBe(false);expect(receipt.text.find(t=>t.blockId==='b2')?.size).toBeGreaterThanOrEqual(24)
  expect(receipt.text.find(t=>t.blockId==='b2')?.value).toBe(content.blocks[1].fields.text)
})

test('one plain brief renders three different compositions with library components and preserved hierarchy',async({page},info)=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}))
  await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
  await page.goto('/processing-worker')
  const {library}=studioFixture(),source=await sourceCandidate(labUnitMetric(),'fixture')
  const content=normalizeText(oneDayText)[0]
  const result=await page.evaluate(async({library,profile,content,preparationVersion})=>{
    const paths={render:'/browser/studio-generation.ts',fonts:'/browser/component-lab/fonts.ts',bind:'/lib/presentations/studio/bindings.ts',recipes:'/lib/presentations/studio/recipes.ts'}
    const {sourceFonts}=await import(paths.fonts) as typeof import('../../browser/component-lab/fonts')
    const {componentBindings,fastPlan}=await import(paths.bind) as typeof import('../../lib/presentations/studio/bindings')
    const {candidatesFor}=await import(paths.recipes) as typeof import('../../lib/presentations/studio/recipes')
    const {renderStudioOptions}=await import(paths.render) as typeof import('../../browser/studio-generation')
    const resources=await sourceFonts(library.uploadId,profile!,true)
    library.tokens.fonts.push({family:'Arial',sizes:[12,24],occurrences:9000})
    library.prepared.hero={version:preparationVersion,profile:profile!,faces:resources.faces??[],assets:resources.artwork?.assets??[],fidelity:{status:'preserved'}} as typeof library.prepared[string]
    const work={content,candidates:candidatesFor(content),bindings:Object.fromEntries(content.blocks.map(b=>[b.id,componentBindings(b,library)]))}
    return renderStudioOptions(library,{...work,plan:fastPlan(work,0)})
  },{library,profile:source.profile,content,preparationVersion:`preparation-1:${source.profile!.version}:${LAB_VERSION}`})
  expect(result).toHaveLength(3);expect(new Set(result.map(o=>o.signature)).size).toBe(3)
  expect(result.some(o=>o.receipt!.components.some(c=>c.componentId==='hero'))).toBe(true)
  for(const [i,option] of result.entries()){
  const receipt=option.receipt!
  expect(receipt.passed,receipt.issues.join('\n')).toBe(true)
  const value=receipt.text.find(t=>t.value==='+1 день')!,points=receipt.text.filter(t=>t.field==='heading')
  expect(points).toHaveLength(3)
  for(const point of points){expect(point.x).toBeGreaterThan(value.x+value.width);expect(value.size).toBeGreaterThan(point.size)}
  expect(receipt.text.every(t=>t.font.includes('Play'))).toBe(true)
  expect(receipt.html).not.toMatch(/Слева огромно|Справа три пункта|минималистичный слайд|Внизу:/)
  await writeFile(info.outputPath(`one-day-${i+1}.png`),Buffer.from(receipt.preview.split(',')[1],'base64'))
  }
})
