import {test,expect} from './workspace-fixture'
import {studioFixture} from '../fixtures/studio'
import {backgroundFixture} from '../fixtures/backgrounds'
import {buildBackgroundCatalog} from '../../lib/design-system/backgrounds'
import {libraryCoverCandidates} from '../../lib/presentations/studio/visual-design'
import {candidatesFor} from '../../lib/presentations/studio/recipes'
import type {ContentBlock} from '../../lib/presentations/studio/contract'

test('library background is visible, source artwork stays outside text and HTML embeds its assets',async({page})=>{
 await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}))
 await page.route('**/api/uploads/*/assets/image',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=','base64')}))
 await page.goto('/processing-worker')
 const run=studioFixture('fast','# Путешествия становятся привычкой\n\nПонятный сервис помогает планировать поездку.\n\nИсточник: 2026'),f=backgroundFixture()
 run.library.backgrounds=buildBackgroundCatalog(f.snapshot,f.library,'fixture')
 const work=run.slides[0];work.candidates=libraryCoverCandidates(work.content,run.library)
 const option=await page.evaluate(async({library,work})=>{const path='/browser/studio-generation.ts';return (await(await import(path) as typeof import('../../browser/studio-generation')).renderStudioOptions(library,work,undefined,{limit:1}))[0]},{library:run.library,work})
 const receipt=option.receipt!;expect(receipt.passed,receipt.issues.join('; ')).toBe(true);expect(receipt.html).toContain('data-studio-background');expect(receipt.html).toContain('data:image/png;base64,');expect(receipt.html).not.toContain('/assets/image')
 for(const t of receipt.text)expect(t.x+t.width).toBeLessThanOrEqual(1393)
})
test('a left graph and a top title can use a broad composition together',async({page})=>{
 await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
 const run=studioFixture('fast','# Спрос распределяется по году равномернее — путешественники выходят за пределы высокого сезона'),work=run.slides[0]
 work.content.blocks[0].placement='top'
 const data={categories:['Январь','Февраль','Март'],series:[{name:'2024',values:[12,20,32]},{name:'2026',values:[24,28,34]}]}
 const chart:ContentBlock={id:'b2',kind:'visual',role:'body',placement:'left',fields:{},source:JSON.stringify(data),data:{values:data,template:{id:'chart',kind:'chart',name:'Спрос',description:'',tags:[],slide:1,sourceIds:[],memberIds:[],width:800,height:400,data,style:{font:'Play',fontSize:24,color:'#162D40',palette:['#00805e','#ed7347']},config:{chartType:'line',legend:true},graphicHtml:{},dataStatus:'native'}}}
 work.content.blocks.push(chart);work.candidates=candidatesFor(work.content)
 const options=await page.evaluate(async({library,work})=>{const path='/browser/studio-generation.ts';return (await import(path) as typeof import('../../browser/studio-generation')).renderStudioOptions(library,work,undefined,{limit:1})},{library:run.library,work})
 const receipt=options[0].receipt!;expect(receipt.passed).toBe(true);expect(receipt.candidateId).toBe('composition/chart-header');expect(receipt.components.find(c=>c.blockId==='b2')!.width).toBeGreaterThan(1700);expect(receipt.dataValues?.[0].values).toEqual(data)
})
