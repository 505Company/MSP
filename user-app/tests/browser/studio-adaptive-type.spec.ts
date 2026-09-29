import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { studioFixture } from '../fixtures/studio'
import { strictComponentFixture } from '../fixtures/studio-components'
import { receiptPreservesFields } from '../../lib/presentations/studio/field-bindings'

const examples = [
  '# Новый взгляд\nНичего больше.\n\nЭто должен быть самый агрессивный тест масштаба: сколько пространства мы можем отдать двум словам, не превращая их в случайный плакат.',
  '# Новый взгляд на привычные решения для здоровья\n\nСовременный подход к профилактике, в котором данные, повседневные привычки и медицинские рекомендации складываются в одну понятную систему.',
  '# Путешествие начинается с простого выбора\n\nПользователю важно быстро понять, куда ехать, сколько займет дорога и чем можно заняться на месте.\n\nЧем проще процесс планирования, тем выше вероятность, что идея превратится в реальную поездку.',
  '# Новые сценарии меняют привычки туристов\n\nГородские выходные, гастрономические маршруты и отдых на природе становятся всё популярнее.\n\nВ одной поездке путешественники всё чаще объединяют несколько разных форматов отдыха.',
]

test('original Frame 9 and 10 recipes fit large typography and preserve separate paragraphs', async ({ page }, info) => {
  await page.route('**/api/uploads/*/fonts', r=>r.fulfill({json:{fonts:[]}}))
  await page.route('**/api/fonts/google?*', r=>r.fulfill({status:404,json:{files:[]}}))
  await page.goto('/processing-worker')
  const fixture=studioFixture(),results=await page.evaluate(async ({library,examples})=>{
    const paths={render:'/browser/studio-generation.ts',material:'/lib/presentations/studio/material.ts',recipes:'/lib/presentations/studio/recipes.ts',options:'/lib/presentations/studio/options.ts'}
    const {renderStudioOptions,renderStudioSlide}=await import(paths.render) as typeof import('../../browser/studio-generation')
    const {normalizeText}=await import(paths.material) as typeof import('../../lib/presentations/studio/material')
    const {candidatesFor}=await import(paths.recipes) as typeof import('../../lib/presentations/studio/recipes')
    const {draftOptions}=await import(paths.options) as typeof import('../../lib/presentations/studio/options')
    const output=[]
    for(const [index,example] of examples.entries()){
      const content=normalizeText(example)[0]
      // The first reference uses an intentional two-line title.
      if(index===0){content.blocks[0].fields.text='Новый взгляд\nНичего больше.';content.blocks[0].source=content.blocks[0].fields.text;content.blocks=content.blocks.filter(b=>b.fields.text!=='Ничего больше.')}
      const candidates=candidatesFor(content),work={content,candidates,bindings:{}}
      const chosen=await renderStudioOptions(library,work,undefined,{limit:1})
      const variants=[]
      for(const family of ['title-support-01','title-support-02']){
        const candidate=candidates.find(c=>c.recipeId.endsWith('/'+family))!
        const single={...work,candidates:[candidate]}
        variants.push(await renderStudioSlide(library,{...single,plan:draftOptions(single,library)[0].plan}))
      }
      output.push({content,chosen:chosen[0].receipt!,variants})
    }
    return output
  },{library:fixture.library,examples})
  await writeFile(info.outputPath('raw-results.json'),JSON.stringify(results))
  for(const [i,result] of results.entries()){
    expect(result.chosen.candidateId).toContain('title-support-')
    for(const [j,receipt] of [result.chosen,...result.variants].entries()){
      expect(receipt.passed,receipt.issues.join('; ')).toBe(true)
      for(const block of result.content.blocks)expect(receiptPreservesFields(block,receipt.text)).toBe(true)
      expect(receipt.text.find(t=>t.blockId==='b1')!.size).toBeGreaterThanOrEqual(120)
      expect(receipt.text.filter(t=>t.blockId!=='b1').every(t=>t.size>=40)).toBe(true)
      expect(receipt.text.every(t=>t.size%4===0&&t.x>=40&&t.y+t.height<=1040)).toBe(true)
      await writeFile(info.outputPath(`example-${i+1}-recipe-${j}.png`),Buffer.from(receipt.preview.split(',')[1],'base64'))
    }
  }
  await writeFile(info.outputPath('measurements.json'),JSON.stringify(results.map(r=>({candidate:r.chosen.candidateId,text:r.chosen.text})),null,2))
})

test('native text fits its region and reports actual glyph sizes in both modes',async({page},info)=>{
  await page.route('**/api/uploads/*/fonts',r=>r.fulfill({json:{fonts:[]}}));await page.route('**/api/fonts/google?*',r=>r.fulfill({status:404,json:{files:[]}}));await page.goto('/processing-worker')
  const {library}=strictComponentFixture()
  const receipts=await page.evaluate(async library=>{
    const path='/browser/studio-generation.ts',{renderStudioSlide}=await import(path) as typeof import('../../browser/studio-generation')
    const content={id:'slide-2',title:'Проверка',directions:[],blocks:[{id:'b1',kind:'text' as const,role:'title' as const,source:'Путешествие начинается с выбора',fields:{text:'Путешествие начинается с выбора'}}]}
    const candidate={id:'native-test',recipeId:'native-test',label:'Проверка',score:1,slots:[{region:'title',blocks:['b1'],direction:'column' as const,columns:1,gap:0,rect:{x:80,y:280,w:1760,h:600}}]}
    const work={content,candidates:[candidate],bindings:{b1:[{id:'native-title',kind:'editable' as const,fields:{title:'text'}}]},plan:{candidateId:candidate.id,components:{b1:'native-title'},primary:[],rationale:'Проверка'}}
    const results=[]
    for(const strictComponents of [false,true])results.push(await renderStudioSlide(library,{...work,strictComponents}))
    return results
  },library)
  for(const [i,r] of receipts.entries()){
    expect(r.passed,r.issues.join('; ')).toBe(true);expect(r.text[0].size).toBeGreaterThan(100)
    expect(r.components[0].componentId).toBe('native-title')
    await writeFile(info.outputPath(`native-${i}.png`),Buffer.from(r.preview.split(',')[1],'base64'))
  }
})
