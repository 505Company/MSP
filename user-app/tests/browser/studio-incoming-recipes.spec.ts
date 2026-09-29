import {test,expect} from './workspace-fixture'
import {writeFile} from 'node:fs/promises'
import {studioFixture} from '../fixtures/studio'
import {normalizeText} from '../../lib/presentations/studio/material'
import {candidatesFor} from '../../lib/presentations/studio/recipes'
import type {ContentSlide,SlideWork} from '../../lib/presentations/studio/contract'
import type {PresentationProject} from '../../lib/workspace/types'

test('three explicit modes and experimental-recipe filter persist without conflating creative with recipes',async({page},info)=>{
  const fixture=studioFixture(),style={id:fixture.library.uploadId,name:fixture.library.name,fileName:'test.pptx',sourceId:'x',createdAt:fixture.createdAt,slideCount:1,componentCount:3,styleCount:4,previewId:null,colors:['#00805E'],fonts:['Play']}
  let project:PresentationProject|null=null,starts=0
  await page.route('**/api/style-bank',r=>r.fulfill({json:{styles:[style]}}))
  await page.route('**/api/projects',r=>{if(r.request().method()==='POST'){project={...r.request().postDataJSON(),schemaVersion:1,styleName:style.name,createdAt:fixture.createdAt,updatedAt:fixture.createdAt,revision:crypto.randomUUID()};return r.fulfill({status:201,json:{project}})}return r.fulfill({json:{projects:[]}})})
  await page.route('**/api/projects/*',r=>{if(!/^\/api\/projects\/[^/]+$/.test(new URL(r.request().url()).pathname))return r.fallback();if(r.request().method()==='PUT')project={...project!,...r.request().postDataJSON(),revision:crypto.randomUUID()};return r.fulfill({json:{project}})})
  await page.route('**/api/projects/*/compose*',r=>{if(r.request().method()==='POST'){expect(r.request().postDataJSON().action).toBe('start');starts++}return r.fulfill({json:{configured:true,run:project?{...fixture,projectId:project.id,revision:project.revision,status:'complete',slides:[],results:{}}:null}})})
  await page.goto('/create');await expect(page.locator('#presentation-style input')).toHaveCount(1);await expect(page.getByRole('group', {name:'Режим генерации'}).getByRole('radio')).toHaveCount(3)
  await page.getByRole('radio',{name:/Сбалансированный/}).check();await page.getByRole('checkbox',{name:'Только экспериментальные рецепты'}).check()
  await expect(page.getByText('Подключение модели автоматически:', {exact:false})).toBeVisible()
  await page.locator('#presentation-content').fill('# Проверка\n\nИсходный текст.');await page.getByRole('button',{name:'Сгенерировать слайды'}).click()
  await expect.poll(()=>project?.recipeScope).toBe('new');expect(project!.generationMode).toBe('smart');expect(project!.compositionMode).toBe('recipes')
  await expect(page.locator('.ws-generation-mode')).toBeVisible();await page.getByRole('radio',{name:/Творческий/}).check()
  await expect.poll(()=>project?.compositionMode).toBe('components');await expect(page.getByRole('checkbox',{name:'Только экспериментальные рецепты'})).toBeDisabled()
  await page.reload();await expect(page.getByRole('radio',{name:/Творческий/})).toBeChecked()
  await page.getByRole('radio',{name:/Сбалансированный/}).check();await expect(page.getByRole('checkbox',{name:'Только экспериментальные рецепты'})).toBeChecked()
  await expect.poll(()=>project?.compositionMode).toBe('recipes');await page.getByRole('radio',{name:/Быстрый/}).check();await expect.poll(()=>project?.generationMode).toBe('fast')
  await page.reload();await expect(page.getByRole('radio',{name:/Быстрый/})).toBeChecked();await expect(page.getByRole('checkbox',{name:'Только экспериментальные рецепты'})).toBeChecked()
  expect(starts).toBe(0);await page.screenshot({path:info.outputPath('three-modes.png'),fullPage:true})
})

test('new authored cover and adaptive table render with active DS styles and exact source content',async({page},info)=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
  const {library}=studioFixture(),cover=normalizeText('# Путешествия становятся привычкой\n\nСамостоятельные маршруты открывают новые регионы.\n\nИсточник: 2026')[0]
  const values={columns:['Сценарий','Доля','Поездок'],rows:[['Командировочные','31%','7,2×'],['Пары','24%','4,1×'],['Семьи','19%','3,4×'],['Solo','14%','5,6×'],['Другие','12%','2,8×']]}
  const table:ContentSlide={id:'slide-2',title:'Аудитория',directions:[],blocks:[{id:'b1',kind:'text',role:'title',source:'Аудитория',fields:{text:'Аудитория'}},{id:'b2',kind:'visual',role:'body',source:JSON.stringify(values),fields:{},data:{template:{id:'table',kind:'table',name:'Таблица',description:'',tags:[],slide:1,sourceIds:[],memberIds:[],width:1200,height:600,style:{font:'Play',fontSize:28,color:'#162D40',headerFill:'#00805E',headerColor:'#FFFFFF'},config:{},data:values,graphicHtml:{},dataStatus:'native'},values}}]}
  const works:SlideWork[]=[cover,table].map(content=>({content,bindings:{},candidates:candidatesFor(content,'new')}))
  works[0].candidates=works[0].candidates.filter(c=>c.recipeId.includes('chapter-cover'))
  works[1].candidates=works[1].candidates.filter(c=>c.recipeId.includes('data-approach-table'))
  expect(works.every(w=>w.candidates.length>0)).toBe(true)
  const receipts=await page.evaluate(async({works,library})=>{const renderPath='/browser/studio-generation.ts',optionsPath='/lib/presentations/studio/options.ts';const {renderStudioSlide}=await import(renderPath) as typeof import('../../browser/studio-generation'),{draftOptions}=await import(optionsPath) as typeof import('../../lib/presentations/studio/options');const result=[];for(const work of works)result.push(await renderStudioSlide(library,{...work,plan:draftOptions(work,library)[0].plan}));return result},{works,library})
  for(const [i,r] of receipts.entries()){
    expect(r.passed,r.issues.join('; ')).toBe(true)
    if(i===0)expect(r.html.includes('data-recipe-decoration')).toBe(true)
    for(const b of works[i].content.blocks)for(const [field,value] of Object.entries(b.fields))expect(r.text.some(t=>t.blockId===b.id&&t.field===field&&t.value===value)).toBe(true)
    await writeFile(info.outputPath(`incoming-${i+1}.png`),Buffer.from(r.preview.split(',')[1],'base64'))
  }
  expect(receipts[1].dataValues?.[0].values).toEqual(values);expect(/#00805e|rgb\(0, 128, 94\)/i.test(receipts[1].html)).toBe(true)
})
