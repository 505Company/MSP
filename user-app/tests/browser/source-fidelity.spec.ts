import {test,expect,type Page} from '@playwright/test'
import {readFileSync,existsSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {nativeLayoutFixture} from '../fixtures/native-layout'
import {compileEditableProposal} from '../../lib/design-system/editable-source'
import {editableHtmlDocument} from '../../lib/design-system/editable-html'
import {EDITABLE_VERSION,EDITABLE_COMPILER_VERSION,type EditableTemplate,type EditableCatalog} from '../../lib/design-system/editable-contract'
import type {HtmlQualification} from '../../lib/design-system/editable-qualification'

async function qualify(page:Page,templates:EditableTemplate[]):Promise<HtmlQualification>{
 const catalog:EditableCatalog={version:EDITABLE_VERSION,compilerVersion:EDITABLE_COMPILER_VERSION,id:'a'.repeat(64),catalogId:'a'.repeat(64),sourceRevision:'fixture',createdAt:'',coverage:[],excluded:[],modelRunIds:[],liveRequests:0,families:templates.map(t=>({id:t.id,name:t.name,description:t.description,tags:t.tags,kind:t.kind,variants:[t],sourceIds:t.sourceIds,slides:[t.slide]}))}
 return page.evaluate(async catalog=>{const moduleUrl='/lib/design-system/editable-qualification.ts';const {qualifyEditableCatalog}=await import(moduleUrl);return qualifyEditableCatalog(catalog)},catalog)
}

async function showDocument(page:Page,template:EditableTemplate){
 await page.unroute('**/__source_fidelity__')
 await page.route('**/__source_fidelity__',route=>route.fulfill({contentType:'text/html',body:editableHtmlDocument(template,template.data)}))
 await page.goto('/__source_fidelity__')
}

test('source typography, radial shapes and metric captions survive editable HTML and data changes',async({page})=>{
 for(const kind of ['metric','radial','diagram'] as const){
  const {snapshot,proposal}=nativeLayoutFixture(kind),template=compileEditableProposal(proposal,1,snapshot,'job',[])
  await showDocument(page,template)
  await expect(page.locator('#preview [data-native-overflow]')).toHaveCount(template.sourceLayout!.text.length)
  await expect(page.locator('#preview [data-native-overflow="true"]')).toHaveCount(0)
  if(kind==='radial'){await expect(page.locator('#preview ellipse')).toHaveCount(6);await expect(page.locator('#preview [data-source-text="item0"]')).toContainText('Пояснение 1')}
  if(kind==='metric'){
   await expect(page.locator('#preview')).toContainText('Описание показателя')
   const fonts=await page.locator('#preview [data-source-text="value"] text').evaluateAll(nodes=>nodes.map(n=>(n as SVGElement).style.font))
   expect(fonts.some(f=>/bold|700/.test(f)&&f.includes('319px'))).toBe(true);expect(fonts.some(f=>f.includes('184px'))).toBe(true)
   await page.getByText('Изменить данные',{exact:true}).click();await page.locator('#data').fill(JSON.stringify({value:'73',unit:'%',items:[{text:'Новый показатель'}]}));await page.getByRole('button',{name:'Применить',exact:true}).click()
   await expect(page.locator('#preview')).toContainText('Новый показатель');await expect(page.locator('#preview')).toContainText('73%')
  }
 }
})

test('qualification rejects omitted content, graphics, missing images and changed-text overflow',async({page})=>{
 const {snapshot,proposal}=nativeLayoutFixture('radial'),t=compileEditableProposal(proposal,1,snapshot,'job',[])
 await showDocument(page,t)
 const removed=structuredClone(t);removed.id='removed';removed.sourceLayout!.graphic=''
 const extra=structuredClone(t);extra.id='extra';extra.data.items!.push({text:'Пропавший пятый пункт'})
 const long=structuredClone(t);long.id='overflow';long.data.title='Очень длинный заголовок '.repeat(30)
 const missing=structuredClone(t);missing.id='missing';missing.sourceLayout!.graphic+='<svg><image href="/missing-test-image.png"/></svg>'
 const {snapshot:ms,proposal:mp}=nativeLayoutFixture('metric'),unbound=compileEditableProposal(mp,1,ms,'job',[]);unbound.id='unbound';unbound.sourceLayout!.text=unbound.sourceLayout!.text.filter(s=>s.binding.field!=='metric')
 const report=await qualify(page,[t,removed,extra,long,missing,unbound])
 expect(report.checks[0].passed).toBe(true)
 expect(report.checks.slice(1).every(c=>!c.passed)).toBe(true)
 expect(report.checks[1].issues.join(' ')).toContain('потеряна исходная графика')
 expect(report.checks[2].issues.join(' ')).toContain('потеряно текстовое содержание')
 expect(report.checks[3].issues.join(' ')).toContain('текст выходит')
 expect(report.checks[4].issues.join(' ')).toContain('графика не загрузилась')
 expect(report.checks[5].issues.join(' ')).toContain('потеряно текстовое содержание')
})

test('actual source diagrams, metric and radial sample retain their editable geometry',async({page},info)=>{
 const file=process.env.MSP_SOURCE_FIDELITY_FIXTURE;test.skip(!file,'Requires the local immutable source audit fixture')
 const templates=JSON.parse(readFileSync(file!,'utf8')) as EditableTemplate[]
 await page.route('**/api/uploads/*/assets/*',route=>{
  const id=new URL(route.request().url()).pathname.split('/').at(-1)!,asset=join(dirname(file!),'assets',id)
  return /^asset-[a-f0-9]+$/.test(id)&&existsSync(asset)?route.fulfill({contentType:'image/png',body:readFileSync(asset)}):route.continue()
 })
 for(const t of templates){
  await showDocument(page,t)
  await expect(page.locator('#preview [data-native-overflow]')).toHaveCount(t.sourceLayout!.text.length)
  const overflow=await page.locator('#preview [data-native-overflow="true"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-source-text')))
  await page.locator('#preview').screenshot({path:info.outputPath(t.id+'.png')})
  expect(overflow,t.id).toEqual([])
 }
 const report=await qualify(page,templates)
 expect(report.checks.filter(c=>!c.passed)).toEqual([])
})
