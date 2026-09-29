import {test,expect} from '@playwright/test'
import {studioFixture} from '../fixtures/studio'
import {generationPreview,generationSummary} from '../../lib/presentations/studio/generations'
import type {PresentationProject} from '../../lib/workspace/types'
import type {StudioRun} from '../../lib/presentations/studio/contract'

test('generate freezes the active mode and collapses settings while the server job continues',async({page})=>{
 const fixture=studioFixture(),runs=new Map<string,StudioRun>(),starts:string[]=[]
 let project:PresentationProject={schemaVersion:1,id:fixture.projectId,revision:fixture.revision,name:'Проверка режимов',text:'Заголовок\n\nСодержание презентации',uploadId:fixture.library.uploadId,styleName:fixture.library.name,createdAt:fixture.createdAt,updatedAt:fixture.createdAt,generationMode:'fast',compositionMode:'recipes'}
 await page.route('**/api/style-bank',r=>r.fulfill({json:{styles:[{id:project.uploadId,name:project.styleName,fileName:'test.pptx',colors:['#00805E'],fonts:['Play'],componentCount:20,createdAt:fixture.createdAt}]}}))
 await page.route('**/api/projects/**',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(req.method()==='PUT'){project={...project,...req.postDataJSON(),revision:crypto.randomUUID()};return route.fulfill({json:{project}})}
  if(url.pathname.endsWith('/generations'))return route.fulfill({json:{generations:[...runs.values()].map(generationSummary)}})
  if(url.pathname.endsWith('/compose')){
   if(req.method()==='POST'){
    const body=req.postDataJSON();expect(body.action).toBe('start');expect(body.revision).toBe(project.revision)
    const run:StudioRun={...fixture,revision:project.revision,mode:project.generationMode!,semantic:project.compositionMode==='components'?{source:project.text,status:'pending',strategy:'components'}:undefined}
    starts.push(project.compositionMode==='components'?'creative':project.generationMode==='fast'?'fast':'balanced');runs.set(run.revision,run)
    return route.fulfill({json:{run:generationPreview(run)}})
   }
   const run=runs.get(url.searchParams.get('revision')!)
   return route.fulfill({json:{run:run?generationPreview(run):null,configured:true,background:run?{status:'running',available:true,progress:{detail:'Сервер готовит слайды'}}:null}})
  }
  return route.fulfill({json:{project}})
 })
 await page.goto('/projects/'+project.id)
 await page.getByRole('tab',{name:'Творческий',exact:true}).click()
 await page.getByRole('button',{name:'Содержание и параметры',exact:true}).click()
 await expect(page.locator('input[value="creative"]')).toBeChecked()
 await expect(page.getByText('Все изменения сохранены',{exact:true})).toBeVisible()
 await page.locator('#project-inputs').getByRole('button',{name:'Сгенерировать слайды',exact:true}).click()
 await expect(page.locator('#project-inputs')).toBeHidden()
 await expect(page.getByText('Сервер готовит слайды')).toBeVisible()
 await page.getByRole('tab',{name:'Быстрый',exact:true}).click()
 await expect(page.getByText('Все изменения сохранены',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Содержание и параметры',exact:true}).click()
 await expect(page.locator('input[value="fast"]')).toBeChecked()
 await page.locator('#project-inputs').getByRole('button',{name:'Сгенерировать слайды',exact:true}).click()
 await expect(page.locator('#project-inputs')).toBeHidden()
 expect(starts).toEqual(['creative','fast'])
 await page.reload()
 await expect(page.locator('.msp-generation-group')).toHaveCount(2)
 expect(starts).toEqual(['creative','fast'])
})
