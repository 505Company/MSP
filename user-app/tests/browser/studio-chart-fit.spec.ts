import {test,expect} from './workspace-fixture'
import {studioFixture} from '../fixtures/studio'
import type {SlideWork} from '../../lib/presentations/studio/contract'
import type {EditableTemplate} from '../../lib/design-system/editable-contract'

test('extra table columns keep library cell styles without changing the source',async({page})=>{
  await page.goto('/processing-worker')
  const template:EditableTemplate={id:'table',kind:'table',name:'Таблица',description:'',tags:[],slide:1,sourceIds:[],memberIds:[],width:800,height:400,data:{columns:['Регион','2024'],rows:[['Москва','10']]},style:{font:'Arial',fontSize:24},config:{},graphicHtml:{},dataStatus:'native',tableStyles:[[{background:'#0080ff'},{background:'#0080ff',color:'#ffffff'}],[{background:'#efe8ff'},{background:'#efe8ff',color:'#202020'}]]}
  const values={columns:['Регион','2024','2026'],rows:[['Москва','10','21']]}
  const result=await page.evaluate(async({template,values})=>{const before=JSON.stringify(template),path='/browser/studio-data.ts';const instance=(await import(path) as typeof import('../../browser/studio-data')).studioDataInstance(template,values,1000);return {...instance,unchanged:before===JSON.stringify(template)}},{template,values})
  expect(result.unchanged).toBe(true)
  expect(result.data.columns).toEqual(values.columns);expect(result.data.rows).toEqual(values.rows)
  expect(result.template.tableStyles?.[0][2]).toMatchObject({background:'#0080ff',color:'#ffffff',colSpan:1,rowSpan:1,hidden:false})
  expect(result.template.tableStyles?.[1][2]).toMatchObject({background:'#efe8ff',color:'#202020',align:'right'})
})

test('a line chart adapts to a flex box without tiny labels or changed values',async({page})=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
  const {library}=studioFixture(),data={title:'Динамика',categories:['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'],series:[{name:'2024',values:[58,49,55,64,78,91,100,96,72,58,43,68]},{name:'2026',values:[72,65,69,75,84,94,100,98,86,76,63,79]}]}
  const template={id:'line',kind:'chart' as const,name:'Динамика',description:'График',tags:['График'],slide:1,sourceIds:['source'],memberIds:[],width:1000,height:500,data,style:{font:'Play',fontSize:24,color:'#162D40',palette:['#00805E','#ED7347']},config:{chartType:'line' as const,legend:true},graphicHtml:{},dataStatus:'native' as const}
  const work:SlideWork={content:{id:'slide-1',title:'График',directions:[],blocks:[{id:'b1',kind:'visual',role:'body',source:JSON.stringify(data),fields:{},data:{template,values:data}}]},bindings:{},candidates:[{id:'fixture',recipeId:'fixture',label:'Измерение',score:1,slots:[{region:'plot',blocks:['b1'],direction:'column',columns:1,gap:0,rect:{x:80,y:80,w:1160,h:350}}]}],plan:{candidateId:'fixture',components:{},primary:[],rationale:'Тест вместимости'}}
  const receipt=await page.evaluate(async({library,work})=>{const path='/browser/studio-generation.ts';return (await import(path) as typeof import('../../browser/studio-generation')).renderStudioSlide(library,work)},{library,work})
  expect(receipt.passed,receipt.issues.join('; ')).toBe(true)
  expect(receipt.dataValues?.[0].values).toEqual(data)
  expect(receipt.html).toContain('data-series="2024"');expect(receipt.html).toContain('data-series="2026"')
  expect(receipt.html).toContain('font-size="20"')
})
